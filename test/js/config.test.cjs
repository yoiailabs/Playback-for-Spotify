const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const core = require('../../web/public/config-core.js');
const { storage, root, plain } = require('./helpers.cjs');

const redirect = 'https://ongaku.yoiailabs.com/oauth/callback';
const decodeClose = url => JSON.parse(decodeURIComponent(url.split('#')[1]));

test('PKCE verifier and state use secure random URL-safe values', () => {
  assert.match(core.generateVerifier(webcrypto), /^[A-Za-z0-9_-]{64}$/);
  assert.match(core.generateState(webcrypto), /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(core.generateState(webcrypto), core.generateState(webcrypto));
});
test('PKCE S256 matches RFC 7636 vector', async () => {
  assert.equal(await core.challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', webcrypto),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('authorization URL uses exact callback, S256, state and existing scopes', () => {
  const url = new URL(core.authorizeUrl('test client+id', 'challenge', 'random-state'));
  assert.equal(url.origin + url.pathname, 'https://accounts.spotify.com/authorize');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: 'test client+id', response_type: 'code', redirect_uri: redirect,
    scope: 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private user-library-read user-follow-read',
    code_challenge_method: 'S256', code_challenge: 'challenge', state: 'random-state', show_dialog: 'true'
  });
});
test('session validation rejects missing verifier, client ID and mismatched or missing state', () => {
  const session = { state: 'expected', verifier: 'verifier', clientId: 'client' };
  assert.doesNotThrow(() => core.validateSession('expected', session));
  for (const state of [null, '', 'wrong']) assert.throws(() => core.validateSession(state, session), /session expired or state/);
  for (const key of ['state', 'verifier', 'clientId']) {
    assert.throws(() => core.validateSession('expected', { ...session, [key]: null }));
  }
});
test('settings normalize defaults and invalid values, and aplite hides long press', () => {
  for (const value of [null, {}, { longPressMode: 1 }, { longPressMode: 'invalid' }]) {
    assert.deepEqual(core.normalizeSettings(value), { longPressMode: 'seek' });
  }
  assert.deepEqual(core.normalizeSettings({ longPressMode: 'volume' }), { longPressMode: 'volume' });
  assert.deepEqual(core.parseSettings(''), { clientId: '', settings: { longPressMode: 'seek' }, platform: '', showLongPress: true, authed: false });
  assert.deepEqual(core.parseSettings('?client_id=%20test%2Bid%20&long_press=volume&platform=aplite&authed=1'), {
    clientId: 'test+id', settings: { longPressMode: 'volume' }, platform: 'aplite', showLongPress: false, authed: true
  });
  assert.equal(core.parseSettings('?long_press=bogus&authed=yes').settings.longPressMode, 'seek');
  assert.equal(core.parseSettings('?platform=basalt').showLongPress, true);
});
test('close URL contains settings only or settings and login credentials', () => {
  assert.deepEqual(decodeClose(core.closeUrl({ longPressMode: 'volume' })), { settings: { longPressMode: 'volume' } });
  const credentials = { clientId: 'client', token: 'test+token', refreshToken: 'refresh', expiresIn: 60 };
  assert.deepEqual(decodeClose(core.closeUrl(null, credentials)), { ...credentials, settings: { longPressMode: 'seek' } });
});

function page(file, search = '', initial = {}, fetchImpl) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, focus() {} });
    return elements.get(id);
  };
  const events = [];
  const sessionStorage = storage(initial);
  const window = {
    crypto: webcrypto, location: { search, pathname: '/oauth/callback', href: '' },
    history: { replaceState(...args) { events.push(['replaceState', ...args]); } }
  };
  const context = vm.createContext({
    ConfigCore: core, window, sessionStorage, URLSearchParams,
    document: { getElementById: element },
    fetch: async (...args) => { events.push(['fetch', ...args]); return fetchImpl(...args); }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'web/public', file), 'utf8'), context);
  return { element, events, sessionStorage, window };
}
const loginSession = {
  pkce_verifier: 'test-verifier', pkce_state: 'expected', pkce_client_id: 'client',
  pkce_settings: JSON.stringify({ longPressMode: 'volume' })
};
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('settings page pre-fills client/mode and settings-only save needs no login', () => {
  const p = page('settings-page.js', '?client_id=client&long_press=volume&platform=aplite&authed=1');
  assert.equal(p.element('client-id').value, 'client');
  assert.equal(p.element('long-press-settings').hidden, true);
  assert.equal(p.element('aplite-note').hidden, false);
  assert.match(p.element('status').textContent, /connected/);
  p.element('save').onclick();
  assert.deepEqual(decodeClose(p.window.location.href), { clientId: 'client', settings: { longPressMode: 'volume' } });
});
test('login stores verifier/state/client/pending settings and redirects with challenge', async () => {
  const p = page('settings-page.js', '?client_id=client&long_press=volume');
  await p.element('login').onclick();
  const url = new URL(p.window.location.href);
  assert.equal(url.searchParams.get('state'), p.sessionStorage.getItem('pkce_state'));
  assert.equal(url.searchParams.get('code_challenge'), await core.challenge(p.sessionStorage.getItem('pkce_verifier'), webcrypto));
  assert.equal(p.sessionStorage.getItem('pkce_client_id'), 'client');
  assert.deepEqual(JSON.parse(p.sessionStorage.getItem('pkce_settings')), { longPressMode: 'volume' });
});
test('callback strips query before exchange, uses PKCE, returns tokens/settings and clears session', async () => {
  const p = page('callback-page.js', '?code=test-code%2Bvalue&state=expected', loginSession, async () => ({
    ok: true, json: async () => ({ access_token: 'test-token', refresh_token: 'refresh', expires_in: 60 })
  }));
  await settle();
  assert.deepEqual(p.events[0], ['replaceState', null, '', '/oauth/callback']);
  const [, url, options] = p.events[1];
  assert.equal(url, 'https://accounts.spotify.com/api/token');
  assert.equal(options.method, 'POST');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(options.body)), {
    grant_type: 'authorization_code', code: 'test-code+value', redirect_uri: redirect, client_id: 'client', code_verifier: 'test-verifier'
  });
  assert.deepEqual(decodeClose(p.element('return').href), {
    clientId: 'client', token: 'test-token', refreshToken: 'refresh', expiresIn: 60, settings: { longPressMode: 'volume' }
  });
  assert.equal(p.element('return').hidden, false);
  for (const key of Object.keys(loginSession)) assert.equal(p.sessionStorage.getItem(key), null);
});
for (const [search, session] of [
  ['?code=code&state=wrong', loginSession], ['?code=code', loginSession],
  ['?code=code&state=expected', { ...loginSession, pkce_verifier: '' }]
]) {
  test(`callback rejects invalid session without network: ${search}`, async () => {
    const p = page('callback-page.js', search, session);
    await settle();
    assert.equal(p.events.length, 1);
    assert.match(p.element('status').textContent, /session expired or state/);
    for (const key of Object.keys(loginSession)) assert.equal(p.sessionStorage.getItem(key), null);
  });
}
test('callback displays only Spotify error fields on failure', async () => {
  const p = page('callback-page.js', '?code=code&state=expected', loginSession, async () => ({
    ok: false, json: async () => ({ error: 'invalid_grant', error_description: 'Code expired', access_token: 'sensitive' })
  }));
  await settle();
  assert.equal(p.element('status').textContent, 'Code expired');
  assert.equal(p.element('return').href, undefined);
});
test('UMD module also loads as a browser global', () => {
  const context = vm.createContext({ self: {}, URLSearchParams });
  vm.runInContext(fs.readFileSync(path.join(root, 'web/public/config-core.js'), 'utf8'), context);
  assert.deepEqual(plain(context.self.ConfigCore.normalizeSettings(null)), { longPressMode: 'seek' });
});
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
test('source, web and README contain no old config hostname', () => {
  const oldHost = 'alex523ap' + '.github.io';
  for (const file of [...files(path.join(root, 'src')), ...files(path.join(root, 'web')), path.join(root, 'README.md')]) {
    assert.equal(fs.readFileSync(file, 'utf8').includes(oldHost), false, path.relative(root, file));
  }
});
test('static HTML/JS respects CSP: no inline scripts/styles or innerHTML', () => {
  for (const file of files(path.join(root, 'web/public'))) {
    const text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.html')) {
      assert.doesNotMatch(text, /<style\b|\sstyle\s*=|\son\w+\s*=|<script(?![^>]*\bsrc=)/i);
    }
    if (file.endsWith('.js')) assert.doesNotMatch(text, /innerHTML|console\.log/);
  }
});

test('malformed token response cannot disclose response contents in the error message', async () => {
  const p = page('callback-page.js', '?code=code&state=expected', loginSession, async () => ({
    ok: true, json: async () => JSON.parse('{"access_token":"sensitive"')
  }));
  await settle();
  assert.match(p.element('status').textContent, /unreadable login response/);
  assert.doesNotMatch(p.element('status').textContent, /sensitive|access_token/);
});
test('Spotify denial clears the login session without exchanging a code', async () => {
  const p = page('callback-page.js', '?error=access_denied&state=expected', loginSession);
  await settle();
  assert.equal(p.events.length, 1);
  assert.equal(p.element('status').textContent, 'access_denied');
  assert.equal(p.sessionStorage.getItem('pkce_verifier'), null);
});

test('settings query survives setup and OAuth navigation and is replaced by a fresh phone query', () => {
  const session = storage();
  const history = { calls: [], replaceState(...args) { this.calls.push(args); } };
  const query = '?client_id=client&long_press=volume&platform=aplite&authed=1';
  assert.equal(core.restoreSettingsQuery(query, session, history), query);
  assert.equal(history.calls.length, 0);
  // OAuth cleanup removes only PKCE data, retaining phone configuration context.
  core.clearSession(session);
  const restored = core.restoreSettingsQuery('', session, history);
  assert.equal(restored, query);
  assert.deepEqual(history.calls[0], [null, '', '/' + query]);
  assert.deepEqual(core.parseSettings(restored), {
    clientId: 'client', settings: { longPressMode: 'volume' }, platform: 'aplite', showLongPress: false, authed: true
  });
  const newer = '?long_press=seek&platform=basalt&authed=0';
  core.restoreSettingsQuery(newer, session, history);
  assert.equal(core.restoreSettingsQuery('', session, history), newer);
});
test('returning to settings without a query restores client, mode, aplite visibility and auth status', () => {
  const query = '?client_id=client&long_press=volume&platform=aplite&authed=1';
  const p = page('settings-page.js', '', { settings_query: query });
  assert.deepEqual(p.events[0], ['replaceState', null, '', '/' + query]);
  assert.equal(p.element('client-id').value, 'client');
  assert.equal(p.element('long-press').value, 'volume');
  assert.equal(p.element('long-press-settings').hidden, true);
  assert.match(p.element('status').textContent, /connected/);
  p.element('save').onclick();
  assert.equal(decodeClose(p.window.location.href).settings.longPressMode, 'volume');
});
test('settings query restoration defaults safely without storage or saved context', () => {
  const history = { replaceState() { assert.fail('no saved context should not rewrite URL'); } };
  assert.equal(core.restoreSettingsQuery('', storage(), history), '');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(core.restoreSettingsQuery('', blocked, history), '');
  assert.equal(core.restoreSettingsQuery('?long_press=volume', blocked, history), '?long_press=volume');
});
