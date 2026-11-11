const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const { harness, storage, root } = require('./helpers.cjs');

function configPage(query = '', initialSession = {}, crypto = webcrypto) {
  const h = harness();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '' });
    return elements.get(id);
  };
  const context = vm.createContext({
    localStorage: h.localStorage, sessionStorage: storage(initialSession),
    XMLHttpRequest: h.XMLHttpRequest, crypto, TextEncoder, btoa,
    document: { getElementById: element }, window: { location: { search: query } }
  });
  const html = fs.readFileSync(path.join(root, 'config/index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context, { filename: 'config/index.html' });
  return { h, context, element };
}

test('PKCE verifier has requested length and only RFC 7636 unreserved characters', () => {
  const { context } = configPage();
  const verifier = context.generateRandom(64);
  assert.match(verifier, /^[A-Za-z0-9._~-]{64}$/);
});
test('PKCE challenge matches RFC 7636 S256 example with URL-safe unpadded base64', async () => {
  const { context } = configPage();
  assert.equal(await context.sha256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('login stores verifier and builds authorization-code URL with S256', async () => {
  // Deterministic crypto keeps this test independent of asynchronous I/O timing.
  const crypto = {
    getRandomValues: array => array.fill(0),
    subtle: { digest: async (_, data) => createHash('sha256').update(data).digest() }
  };
  const { context, element } = configPage('?client_id=test-client-id', {}, crypto);
  element('loginBtn').onclick();
  await Promise.resolve();
  await Promise.resolve();
  const url = new URL(context.window.location.href);
  assert.equal(url.origin, 'https://accounts.spotify.com');
  assert.equal(url.searchParams.get('client_id'), 'test-client-id');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), await context.sha256('A'.repeat(64)));
  assert.equal(context.sessionStorage.getItem('pkce_verifier'), 'A'.repeat(64));
  assert.equal(context.sessionStorage.getItem('pkce_client_id'), 'test-client-id');
});
test('authorization callback exchanges code with the stored PKCE verifier', () => {
  const { h, element } = configPage('?code=fake-code%2Bvalue', {
    pkce_verifier: 'fake-verifier', pkce_client_id: 'test-client-id'
  });
  const xhr = h.requests[0];
  assert.equal(xhr.url, 'https://accounts.spotify.com/api/token');
  const form = new URLSearchParams(xhr.body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), 'fake-code+value');
  assert.equal(form.get('code_verifier'), 'fake-verifier');
  assert.equal(form.get('client_id'), 'test-client-id');
  xhr.respond(200, { access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', expires_in: 60 });
  const href = element('action').innerHTML.match(/href="([^"]+)"/)[1];
  const response = JSON.parse(decodeURIComponent(href.split('#')[1]));
  assert.deepEqual(response, { token: 'fake-access-token', refreshToken: 'fake-refresh-token', expiresIn: 60, clientId: 'test-client-id' });
});
test('callback without a verifier refuses to exchange the code', () => {
  const { h, element } = configPage('?code=fake-code');
  assert.equal(h.requests.length, 0);
  assert.match(element('status').textContent, /Session expired/);
});
