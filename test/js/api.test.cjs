const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers.cjs');

function setup(initial = {}) {
  const h = harness({ initial: {
    spotify_token: 'fake-access-token', spotify_token_expiry: '2000000',
    spotify_refresh_token: 'fake-refresh-token', spotify_client_id: 'test-client-id', ...initial
  } });
  const auth = h.load('src/pkjs/spotify_auth.js').module.exports;
  const api = h.load('src/pkjs/spotify_api.js', { './spotify_auth': auth }).module.exports;
  return { h, api };
}

const routes = [
  ['getCurrentPlayback', [], 'GET', '/me/player?additional_types=episode'],
  ['getPlaylists', [], 'GET', '/me/playlists?limit=20'],
  ['getFollowedArtists', [], 'GET', '/me/following?type=artist&limit=20'],
  ['getSavedAlbums', [], 'GET', '/me/albums?limit=20'],
  ['getLikedTracks', [], 'GET', '/me/tracks?limit=20'],
  ['play', [], 'PUT', '/me/player/play'], ['pause', [], 'PUT', '/me/player/pause'],
  ['nextTrack', [], 'POST', '/me/player/next'], ['previousTrack', [], 'POST', '/me/player/previous'],
  ['setVolume', [75], 'PUT', '/me/player/volume?volume_percent=75'],
  ['seek', [15000], 'PUT', '/me/player/seek?position_ms=15000'],
  ['getSavedShows', [], 'GET', '/me/shows?limit=20'],
  ['getShowEpisodes', ['test-show'], 'GET', '/shows/test-show/episodes?limit=1'],
  ['getQueue', [], 'GET', '/me/player/queue'],
  ['addToQueue', ['spotify:track:test'], 'POST', '/me/player/queue?uri=spotify%3Atrack%3Atest'],
  ['setShuffle', [true], 'PUT', '/me/player/shuffle?state=true'],
  ['setShuffle', [false], 'PUT', '/me/player/shuffle?state=false'],
  ['setRepeat', ['context'], 'PUT', '/me/player/repeat?state=context'],
  ['getPlaylistFirstTrack', ['test-list'], 'GET', '/playlists/test-list/tracks?limit=1&fields=items(track(uri))'],
  ['getAlbumFirstTrack', ['test-album'], 'GET', '/albums/test-album/tracks?limit=1'],
  ['getArtistTopTrack', ['test-artist'], 'GET', '/artists/test-artist/top-tracks?market=from_token']
];
for (const [name, args, method, path] of routes) {
  test(`API ${name}(${args.join(',')}) builds request and bearer header`, () => {
    const { h, api } = setup();
    let result;
    api[name](...args, (err, data) => { assert.equal(err, null); result = data; });
    const xhr = h.requests[0];
    assert.equal(xhr.method, method);
    assert.equal(xhr.url, 'https://api.spotify.com/v1' + path);
    assert.equal(xhr.async, true);
    assert.deepEqual(xhr.headers, { Authorization: 'Bearer fake-access-token' });
    assert.equal(xhr.body, null);
    xhr.respond(200, { ok: true });
    assert.equal(result.ok, true);
  });
}

test('playContext sends JSON body and supports the custom-body argument', () => {
  const { h, api } = setup();
  api.playContext('spotify:album:test', () => {});
  api.playContext(null, () => {}, { uris: ['spotify:track:test'] });
  assert.equal(h.requests[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(h.requests[0].body), { context_uri: 'spotify:album:test' });
  assert.deepEqual(JSON.parse(h.requests[1].body), { uris: ['spotify:track:test'] });
});

for (const [status, body] of [[204, ''], [202, 'snapshot'], [200, '']]) {
  test(`API ${status} empty/plain success yields null`, () => {
    const { h, api } = setup();
    let calls = 0;
    api.play((err, data) => { calls++; assert.equal(err, null); assert.equal(data, null); });
    h.requests[0].respond(status, body);
    assert.equal(calls, 1);
  });
}
for (const status of [400, 403, 404, 429, 500]) {
  test(`API ${status} is delivered to the callback`, () => {
    const { h, api } = setup();
    let error;
    api.play(err => { error = err; });
    h.requests[0].respond(status);
    assert.equal(error.message, 'API error ' + status);
    assert.equal(h.requests.length, 1);
  });
}
test('missing token fails before creating an XHR', () => {
  const { h, api } = setup();
  h.localStorage.removeItem('spotify_token');
  let error;
  api.play(err => { error = err; });
  assert.equal(error.message, 'Not authenticated');
  assert.equal(h.requests.length, 0);
});
test('network error is delivered', () => {
  const { h, api } = setup();
  let error;
  api.play(err => { error = err; });
  h.requests[0].fail();
  assert.equal(error.message, 'Network error');
});
test('expired concurrent requests share refresh and retry with the new token', () => {
  const { h, api } = setup({ spotify_token_expiry: '1' });
  let calls = 0;
  api.play(err => { assert.equal(err, null); calls++; });
  api.pause(err => { assert.equal(err, null); calls++; });
  assert.equal(h.requests.length, 1);
  h.requests[0].respond(200, { access_token: 'fake-new-token', expires_in: 3600 });
  assert.equal(h.requests.length, 3);
  for (const xhr of h.requests.slice(1)) {
    assert.equal(xhr.headers.Authorization, 'Bearer fake-new-token');
    xhr.respond(204);
  }
  assert.equal(calls, 2);
});
test('401 refreshes and retries a JSON request without losing its body', () => {
  const { h, api } = setup();
  let calls = 0;
  api.playContext('spotify:album:test', err => { assert.equal(err, null); calls++; });
  h.requests[0].respond(401);
  h.requests[1].respond(200, { access_token: 'fake-new-token', expires_in: 3600 });
  assert.equal(h.requests[2].body, h.requests[0].body);
  h.requests[2].respond(204);
  assert.equal(calls, 1);
});
test('failed 401 refresh reports Token expired and retains stored token', () => {
  const { h, api } = setup();
  let error;
  api.play(err => { error = err; });
  h.requests[0].respond(401);
  h.requests[1].respond(400);
  assert.equal(error.message, 'Token expired');
  assert.equal(h.localStorage.getItem('spotify_token'), 'fake-access-token');
});
test('repeated 401 responses refresh only once and report Token expired', () => {
  const { h, api } = setup();
  const results = [];
  api.play((err, data) => { results.push([err.message, data]); });
  h.requests[0].respond(401);
  h.requests[1].respond(200, { access_token: 'fake-new-token', expires_in: 3600 });
  h.requests[2].respond(401);
  assert.equal(h.requests.length, 3);
  assert.deepEqual(results, [['Token expired', null]]);
  assert.equal(h.localStorage.getItem('spotify_token'), 'fake-new-token');
  assert.equal(h.localStorage.getItem('spotify_refresh_token'), 'fake-refresh-token');
});

test('preemptive expiry refresh consumes the single refresh allowed for a request', () => {
  const { h, api } = setup({ spotify_token_expiry: '1' });
  const results = [];
  api.play((err, data) => { results.push([err.message, data]); });
  h.requests[0].respond(200, { access_token: 'fake-new-token', expires_in: 3600 });
  h.requests[1].respond(401);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(results, [['Token expired', null]]);
});

test('retry does not refresh again even if the refreshed token is already expired', () => {
  const { h, api } = setup({ spotify_token_expiry: '1' });
  let calls = 0;
  api.play((err, data) => { assert.equal(err, null); assert.equal(data.ok, true); calls++; });
  h.requests[0].respond(200, { access_token: 'fake-new-token', expires_in: -1 });
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].headers.Authorization, 'Bearer fake-new-token');
  h.requests[1].respond(200, { ok: true });
  assert.equal(calls, 1);
});

test('401 followed by refresh and a 200 retry returns data', () => {
  const { h, api } = setup();
  const results = [];
  api.getCurrentPlayback((err, data) => { results.push([err, data.ok]); });
  h.requests[0].respond(401);
  h.requests[1].respond(200, { access_token: 'fake-new-token', expires_in: 3600 });
  h.requests[2].respond(200, { ok: true });
  assert.deepEqual(results, [[null, true]]);
  assert.equal(h.requests.length, 3);
});
