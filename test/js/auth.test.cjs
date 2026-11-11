const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers.cjs');

function setup(initial = {}) {
  const h = harness({ initial });
  const auth = h.load('src/pkjs/spotify_auth.js').module.exports;
  return { h, auth };
}
const credentials = { spotify_refresh_token: 'fake-refresh-token', spotify_client_id: 'test-client-id' };

test('config response stores tokens, client ID and millisecond expiry, then notifies', () => {
  const { h, auth } = setup();
  let changed;
  auth.init(value => { changed = value; });
  h.listeners.webviewclosed({ response: encodeURIComponent(JSON.stringify({
    token: 'fake-access-token', refreshToken: 'fake-refresh-token', expiresIn: 60, clientId: 'test-client-id'
  })) });
  assert.equal(auth.getToken(), 'fake-access-token');
  assert.equal(auth.isAuthenticated(), true);
  assert.equal(h.localStorage.getItem('spotify_token_expiry'), '1060000');
  assert.equal(h.localStorage.getItem('spotify_refresh_token'), 'fake-refresh-token');
  assert.equal(changed, true);
  assert.equal(auth.isTokenExpired(), false);
  h.advanceTime(60001);
  assert.equal(auth.isTokenExpired(), true);
});
test('missing expiry is expired and absent token is unauthenticated', () => {
  const { auth } = setup();
  assert.equal(auth.isTokenExpired(), true);
  assert.equal(auth.isAuthenticated(), false);
});
test('invalid/cancelled config responses preserve token and do not notify', () => {
  const { h, auth } = setup({ spotify_token: 'fake-access-token' });
  let calls = 0;
  auth.init(() => { calls++; });
  for (const response of ['', '%', '{', '{}']) h.listeners.webviewclosed({ response });
  h.listeners.webviewclosed();
  assert.equal(calls, 0);
  assert.equal(auth.getToken(), 'fake-access-token');
});
test('configuration URL includes encoded saved client ID', () => {
  const { h, auth } = setup({ spotify_client_id: 'test client+id' });
  auth.init();
  h.listeners.showConfiguration();
  const url = new URL(h.Pebble.openedURL);
  assert.equal(url.searchParams.get('client_id'), 'test client+id');
  assert.equal(url.searchParams.get('t'), '1000000');
});
test('clearToken removes all token state but retains client ID', () => {
  const { h, auth } = setup({ ...credentials, spotify_token: 'fake-access-token', spotify_token_expiry: '2' });
  auth.clearToken();
  assert.equal(auth.isAuthenticated(), false);
  assert.equal(h.localStorage.getItem('spotify_token_expiry'), null);
  assert.equal(h.localStorage.getItem('spotify_refresh_token'), null);
  assert.equal(h.localStorage.getItem('spotify_client_id'), 'test-client-id');
});
test('refresh builds form headers/body, rotates tokens, drains queued callbacks', () => {
  const { h, auth } = setup({ ...credentials, spotify_refresh_token: 'fake refresh+token' });
  const results = [];
  auth.refreshAccessToken((err, token) => results.push([err, token]));
  auth.refreshAccessToken((err, token) => results.push([err, token]));
  assert.equal(h.requests.length, 1);
  const xhr = h.requests[0];
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, 'https://accounts.spotify.com/api/token');
  assert.equal(xhr.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(xhr.body, 'grant_type=refresh_token&refresh_token=fake%20refresh%2Btoken&client_id=test-client-id');
  xhr.respond(200, { access_token: 'fake-new-token', refresh_token: 'fake-rotated-token', expires_in: 60 });
  assert.deepEqual(results, [[null, 'fake-new-token'], [null, 'fake-new-token']]);
  assert.equal(h.localStorage.getItem('spotify_refresh_token'), 'fake-rotated-token');
  assert.equal(h.localStorage.getItem('spotify_token_expiry'), '1060000');
});
for (const failure of ['http', 'network']) {
  test(`refresh ${failure} failure drains queue and allows a later refresh`, () => {
    const { h, auth } = setup(credentials);
    const errors = [];
    auth.refreshAccessToken(err => errors.push(err.message));
    auth.refreshAccessToken(err => errors.push(err.message));
    if (failure === 'http') h.requests[0].respond(400);
    else h.requests[0].fail();
    assert.deepEqual(errors, Array(2).fill(failure === 'http' ? 'Refresh failed' : 'Network error'));
    auth.refreshAccessToken(() => {});
    assert.equal(h.requests.length, 2);
  });
}
test('refresh without a refresh token fails without XHR', () => {
  const { h, auth } = setup();
  let error;
  auth.refreshAccessToken(err => { error = err; });
  assert.equal(error.message, 'No refresh token');
  assert.equal(h.requests.length, 0);
});
test('refresh without rotation preserves the previous refresh token', () => {
  const { h, auth } = setup(credentials);
  auth.refreshAccessToken(() => {});
  h.requests[0].respond(200, { access_token: 'fake-new-token', expires_in: 60 });
  assert.equal(h.localStorage.getItem('spotify_refresh_token'), 'fake-refresh-token');
});
for (const body of ['{', '{}', 'null', '{"access_token":null}', '{"access_token":123}',
  '{"access_token":""}', '{"access_token":"   "}']) {
  test(`invalid refresh response ${body} fails all callbacks without saving and allows a later refresh`, () => {
    const initial = { ...credentials, spotify_token: 'fake-old-token', spotify_token_expiry: '1' };
    const { h, auth } = setup(initial);
    const results = [];
    const record = (err, token) => results.push([err && err.message, token]);
    const writes = [];
    const setItem = h.localStorage.setItem;
    h.localStorage.setItem = (key, value) => { writes.push(key); setItem(key, value); };
    auth.refreshAccessToken(record);
    auth.refreshAccessToken(record);
    auth.refreshAccessToken(record);
    assert.doesNotThrow(() => h.requests[0].respond(200, body));
    assert.deepEqual(results, Array.from({ length: 3 }, () => ['Refresh failed', null]));
    assert.deepEqual(writes, []);
    for (const [key, value] of Object.entries(initial)) assert.equal(h.localStorage.getItem(key), value);
    auth.refreshAccessToken(record);
    assert.equal(h.requests.length, 2);
    h.requests[1].respond(200, { access_token: 'fake-new-token', expires_in: 60 });
    assert.equal(results.length, 4);
    assert.deepEqual(results[3], [null, 'fake-new-token']);
    assert.equal(auth.getToken(), 'fake-new-token');
  });
}

for (const outcome of ['success', 'http', 'network', 'invalid']) {
  test(`throwing refresh callbacks do not block the queue or later refreshes on ${outcome}`, () => {
    const { h, auth } = setup(credentials);
    const calls = [];
    const record = (name, throws) => (err, token) => {
      calls.push([name, err && err.message, token]);
      if (throws) throw new Error('Test callback failure');
    };
    auth.refreshAccessToken(record('direct', true));
    auth.refreshAccessToken(record('queued-first', true));
    auth.refreshAccessToken(record('queued-last', false));
    assert.doesNotThrow(() => {
      if (outcome === 'network') h.requests[0].fail();
      else if (outcome === 'http') h.requests[0].respond(400);
      else h.requests[0].respond(200, outcome === 'invalid' ? '{' : { access_token: 'fake-new-token', expires_in: 60 });
    });
    const error = outcome === 'success' ? null : outcome === 'network' ? 'Network error' : 'Refresh failed';
    const token = outcome === 'success' ? 'fake-new-token' : null;
    assert.deepEqual(calls, ['direct', 'queued-first', 'queued-last'].map(name => [name, error, token]));
    auth.refreshAccessToken(record('later', false));
    assert.equal(h.requests.length, 2);
    h.requests[1].respond(200, { access_token: 'fake-later-token', expires_in: 60 });
    assert.deepEqual(calls[3], ['later', null, 'fake-later-token']);
  });
}
