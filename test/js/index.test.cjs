const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, plain } = require('./helpers.cjs');

function setup(api = {}, platform = 'basalt') {
  const h = harness({ platform });
  const image = {
    prefetchSupported: () => false, getPrefetchedUri: () => null,
    isTransferring: () => false, dropPrefetch() {}, sendImageFromUrl() {}
  };
  const context = h.load('src/pkjs/index.js', {
    './spotify_auth': { init() {}, isAuthenticated: () => false },
    './spotify_api': api, './image_transfer': image
  });
  return { h, context, image };
}

test('ready sends JsReady and unauthenticated status without starting timers', () => {
  const { h } = setup();
  h.listeners.ready();
  assert.deepEqual(h.messages.map(m => plain(m.body)), [{ JsReady: 1 }, { AuthStatus: 0 }]);
  assert.equal(h.timers.size, 0);
});
test('now-playing builds track message using seconds and artist names', () => {
  const { h, context } = setup({ getCurrentPlayback: cb => cb(null, {
    item: { name: 'Test track', uri: 'spotify:track:test', duration_ms: 61001, artists: [{ name: 'Test artist' }, { name: 'Guest' }] },
    progress_ms: 15001, is_playing: true, shuffle_state: true, repeat_state: 'track', device: { volume_percent: 75 }
  }) });
  context.fetchNowPlaying();
  assert.deepEqual(plain(h.messages[0].body), {
    TrackTitle: 'Test track', TrackArtist: 'Test artist, Guest', TrackDuration: 61,
    TrackElapsed: 15, TrackIsPlaying: 1, ShuffleState: 1, RepeatState: 2
  });
  assert.equal(context.currentVolume, 75);
});
test('episode metadata uses show name and missing progress defaults to zero', () => {
  const { h, context } = setup({ getCurrentPlayback: cb => cb(null, {
    currently_playing_type: 'episode', item: { name: 'Test episode', duration_ms: 1000, show: { name: 'Test show' } }
  }) });
  context.fetchNowPlaying();
  assert.equal(h.messages[0].body.TrackArtist, 'Test show');
  assert.equal(h.messages[0].body.TrackElapsed, 0);
});
test('list waits for ACK, retries the same item on NACK, and ends with ListDone', () => {
  const { h, context } = setup();
  const items = [{ title: 'First', uri: 'spotify:track:first' }, { title: 'Second', subtitle: 'Subtitle' }];
  context.fetchAndSendList(3, cb => cb(null, items), data => data);
  assert.equal(h.messages.length, 1);
  assert.equal(context.listSendInProgress, true);
  assert.deepEqual(plain(h.messages[0].body), {
    ListType: 3, ListCount: 2, ListIndex: 0, ListItemTitle: 'First', ListItemSubtitle: '', ListItemUri: 'spotify:track:first'
  });
  h.messages[0].nack();
  assert.equal(h.messages.length, 1);
  assert.equal(h.runTimer(), 500);
  assert.deepEqual(plain(h.messages[1].body), plain(h.messages[0].body));
  h.messages[1].ack();
  assert.equal(h.messages[2].body.ListIndex, 1);
  h.messages[2].ack();
  assert.deepEqual(plain(h.messages[3].body), { ListType: 3, ListDone: 1 });
  assert.equal(context.listSendInProgress, false);
});
test('list is limited to 20 entries and polling is paused during transmission', () => {
  let polls = 0;
  const { h, context } = setup({ getCurrentPlayback: () => { polls++; } });
  const items = Array.from({ length: 22 }, (_, i) => ({ title: String(i) }));
  context.fetchAndSendList(0, cb => cb(null, items), data => data);
  context.fetchNowPlaying();
  assert.equal(polls, 0);
  for (let i = 0; i < 20; i++) h.messages[i].ack();
  assert.equal(h.messages[19].body.ListCount, 20);
  assert.equal(h.messages[20].body.ListDone, 1);
});
test('empty list sends completion; API error sends an error message', () => {
  const { h, context } = setup();
  context.fetchAndSendList(1, cb => cb(null, []), data => data);
  context.fetchAndSendList(1, cb => cb(new Error('test failure')), data => data);
  assert.deepEqual(plain(h.messages[0].body), { ListType: 1, ListDone: 1 });
  assert.deepEqual(plain(h.messages[1].body), { ErrorMsg: 'test failure' });
});
test('queue formatter excludes currently playing and supports nulls and episodes', () => {
  const { context } = setup();
  assert.deepEqual(plain(context.formatQueue({ currently_playing: { name: 'Current' }, queue: [
    null, { name: 'Episode', type: 'episode', show: { name: 'Show' }, uri: 'spotify:episode:test' }
  ] })), [{ title: '', subtitle: '', uri: '' }, { title: 'Episode', subtitle: 'Show', uri: 'spotify:episode:test' }]);
});
test('image selection uses smallest sufficient image and falls back to first', () => {
  const { context } = setup();
  const images = [{ width: 640, url: 'large' }, { width: 300, url: 'medium' }, { width: 64, url: 'small' }];
  assert.equal(context.pickImageUrl(images, 168), 'medium');
  assert.equal(context.pickImageUrl(images, 1000), 'large');
  assert.equal(context.pickImageUrl([], 168), null);
});
test('symbolic and numeric AppMessage keys both dispatch commands', () => {
  let next = 0, previous = 0;
  const { h } = setup({ nextTrack: () => { next++; }, previousTrack: () => { previous++; } });
  h.listeners.appmessage({ payload: { Command: 11 } });
  h.listeners.appmessage({ payload: { 100: 12 } });
  assert.equal(next, 1);
  assert.equal(previous, 1);
});

test('characterization: failed art download is not retried on the next playback poll', () => {
  const h = harness();
  const image = h.load('src/pkjs/image_transfer.js', { 'jpeg-js': {} }).module.exports;
  const playback = { item: {
    name: 'Test track', uri: 'spotify:track:test', duration_ms: 1000,
    album: { images: [{ width: 300, url: 'https://example.invalid/art.jpg' }] }
  } };
  const context = h.load('src/pkjs/index.js', {
    './spotify_auth': { init() {} }, './image_transfer': image,
    './spotify_api': { getCurrentPlayback: cb => cb(null, playback) }
  });
  context.fetchNowPlaying();
  assert.equal(h.requests.length, 1);
  h.requests[0].respond(404);
  assert.equal(image.isTransferring(), false);
  context.fetchNowPlaying();
  // index.js retains lastImageUrl even though image_transfer.js clears lastUrl.
  assert.equal(h.requests.length, 1);
  assert.ok(h.messages.some(message => message.body.ErrorMsg === 'Download 404'));
});
