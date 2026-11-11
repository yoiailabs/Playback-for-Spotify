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

for (const body of [
  '{"access_token":"fake-sensitive-access",',
  '{"refresh_token":"fake-sensitive-refresh"}',
  '{"access_token":123,"refresh_token":"fake-sensitive-refresh"}'
]) {
  test(`invalid 200 refresh response logs status without its body: ${body}`, () => {
    const { h, auth } = setup(credentials);
    const logs = [];
    h.console.log = message => logs.push(message);
    let error;
    auth.refreshAccessToken(err => { error = err; });
    h.requests[0].respond(200, body);
    assert.equal(error.message, 'Refresh failed');
    assert.ok(logs.includes('[playback] Refresh failed: 200'));
    assert.ok(logs.every(message => !message.includes('fake-sensitive') && !message.includes(body)));
  });
}

test('non-200 refresh failure preserves status and body logging', () => {
  const { h, auth } = setup(credentials);
  const logs = [];
  h.console.log = message => logs.push(message);
  auth.refreshAccessToken(() => {});
  h.requests[0].respond(400, '{"error":"invalid_grant"}');
  assert.ok(logs.includes('[playback] Refresh failed: 400 {"error":"invalid_grant"}'));
});

test('configuration URL includes mode, platform, authentication and cache busting', () => {
  const { h, auth } = setup({
    spotify_client_id: 'test client+id', spotify_token: 'token',
    ongaku_settings: JSON.stringify({ longPressMode: 'volume' })
  });
  auth.init();
  h.listeners.showConfiguration();
  const url = new URL(h.Pebble.openedURL);
  assert.equal(url.origin + url.pathname, 'https://ongaku.yoiailabs.com/');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    long_press: 'volume', platform: 'basalt', authed: '1', t: '1000000', client_id: 'test client+id'
  });
});
for (const watchInfo of [undefined, () => { throw new Error('unavailable'); }]) {
  test(`config opens even with unavailable watch info: ${typeof watchInfo}`, () => {
    const { h, auth } = setup();
    h.Pebble.getActiveWatchInfo = watchInfo;
    auth.init();
    assert.doesNotThrow(() => h.listeners.showConfiguration());
    const url = new URL(h.Pebble.openedURL);
    assert.equal(url.searchParams.get('platform'), '');
    assert.equal(url.searchParams.get('long_press'), 'seek');
    assert.equal(url.searchParams.get('authed'), '0');
    assert.equal(url.searchParams.has('client_id'), false);
  });
}
test('settings-only response saves and sends integer mode while preserving all token state', () => {
  const initial = { ...credentials, spotify_token: 'token', spotify_token_expiry: '123456' };
  const { h, auth } = setup(initial);
  let calls = 0;
  auth.init(() => { calls++; });
  for (const [mode, wire] of [['volume', 1], ['seek', 0]]) {
    h.listeners.webviewclosed({ response: encodeURIComponent(JSON.stringify({ settings: { longPressMode: mode } })) });
    assert.deepEqual(JSON.parse(h.localStorage.getItem('ongaku_settings')), { longPressMode: mode });
    assert.equal(h.messages.at(-1).body.LongPressMode, wire);
  }
  for (const [key, value] of Object.entries(initial)) assert.equal(h.localStorage.getItem(key), value);
  assert.equal(calls, 0);
});
test('invalid/cancelled config data cannot overwrite settings or create token state', () => {
  const initial = { ongaku_settings: JSON.stringify({ longPressMode: 'volume' }) };
  const { h, auth } = setup(initial);
  let calls = 0;
  auth.init(() => { calls++; });
  const values = [null, true, 3, [], {}, { token: {} }, { token: 123 }, { token: '  ' },
    { settings: null }, { settings: [] }, { settings: {} }, { settings: { longPressMode: 1 } },
    { settings: { longPressMode: 'bad' } }];
  for (const value of values) {
    h.listeners.webviewclosed({ response: encodeURIComponent(JSON.stringify(value)) });
  }
  for (const response of ['', '%', '{']) h.listeners.webviewclosed({ response });
  h.listeners.webviewclosed();
  assert.equal(h.localStorage.getItem('ongaku_settings'), initial.ongaku_settings);
  assert.equal(auth.getToken(), null);
  assert.equal(h.messages.length, 0);
  assert.equal(calls, 0);
});
