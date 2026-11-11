const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, plain } = require('./helpers.cjs');

function setup(api = {}, platform = 'basalt') {
  const h = harness({ platform });
  const image = {
    prefetchSupported: () => false, getPrefetchedUri: () => null,
    isTransferring: () => false, isBusy: () => false, dropPrefetch() {}, sendImageFromUrl() {}
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
  assert.deepEqual(h.messages.map(m => plain(m.body)), [{ LongPressMode: 0, JsReady: 1, AuthStatus: 0 }]);
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

function setupArt(platform = 'basalt') {
  const h = harness({ platform });
  const jpeg = { decode: () => ({ data: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 }) };
  const image = h.load('src/pkjs/image_transfer.js', { 'jpeg-js': jpeg }).module.exports;
  const playback = { item: {
    name: 'Test track', uri: 'spotify:track:test', duration_ms: 1000,
    album: { images: [{ width: 300, url: 'https://example.invalid/art.jpg' }] }
  } };
  const context = h.load('src/pkjs/index.js', {
    './spotify_auth': { init() {} }, './image_transfer': image,
    './spotify_api': { getCurrentPlayback: cb => cb(null, playback) }
  });
  return { h, image, jpeg, playback, context };
}

function ackImages(h) {
  for (let i = 0; i < h.messages.length; i++) {
    const message = h.messages[i];
    if (message.ack) message.ack();
  }
}

for (const failure of ['http', 'network', 'decode', 'header', 'chunk']) {
  test(`art ${failure} failure retries on a later poll and success prevents further downloads`, () => {
    const { h, image, jpeg, context } = setupArt();
    context.fetchNowPlaying();
    assert.equal(h.requests.length, 1);
    context.fetchNowPlaying();
    assert.equal(h.requests.length, 1, 'no duplicate download while pending');
    if (failure === 'http') h.requests[0].respond(404);
    else if (failure === 'network') h.requests[0].fail();
    else if (failure === 'decode') {
      const decode = jpeg.decode;
      jpeg.decode = () => { throw new Error('Test decode failure'); };
      h.requests[0].respond(200);
      jpeg.decode = decode;
    } else {
      h.requests[0].respond(200);
      const header = h.messages.find(message => message.body.ImageWidth);
      if (failure === 'header') header.nack();
      else {
        header.ack();
        h.messages.at(-1).nack();
        assert.equal(h.runTimer(), 500);
        h.messages.at(-1).nack();
      }
    }
    const error = {
      http: 'Download 404', network: 'Download failed', decode: 'Decode: Test decode failure',
      header: 'Header fail', chunk: 'Chunk fail'
    }[failure];
    assert.ok(h.messages.some(message => message.body.ErrorMsg === error));
    assert.equal(image.isTransferring(), false);
    context.fetchNowPlaying();
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].url, h.requests[0].url);
    h.messages.length = 0;
    h.requests[1].respond(200);
    context.fetchNowPlaying();
    assert.equal(h.requests.length, 2, 'no duplicate download while transferring');
    ackImages(h);
    assert.equal(image.isTransferring(), false);
    for (let i = 0; i < 5; i++) context.fetchNowPlaying();
    assert.equal(h.requests.length, 2, 'successful art is cached');
  });
}

test('art retries stop after three attempts per track and URL and a new URL resets the bound', () => {
  const { h, playback, context } = setupArt();
  for (let i = 0; i < 3; i++) {
    context.fetchNowPlaying();
    assert.equal(h.requests.length, i + 1);
    h.requests[i].respond(404);
  }
  for (let i = 0; i < 10; i++) context.fetchNowPlaying();
  assert.equal(h.requests.length, 3);
  const url = 'https://example.invalid/new-art.jpg';
  playback.item.album.images[0].url = url;
  for (let i = 3; i < 6; i++) {
    context.fetchNowPlaying();
    assert.equal(h.requests.length, i + 1);
    assert.equal(h.requests[i].url, url);
    h.requests[i].fail();
  }
  for (let i = 0; i < 10; i++) context.fetchNowPlaying();
  assert.equal(h.requests.length, 6);
});

test('a new track sharing failed album art gets its own bounded retry budget', () => {
  const { h, playback, context } = setupArt();
  const url = playback.item.album.images[0].url;
  for (const uri of ['spotify:track:first', 'spotify:track:second']) {
    playback.item.uri = uri;
    const start = h.requests.length;
    for (let i = 0; i < 3; i++) {
      context.fetchNowPlaying();
      assert.equal(h.requests.length, start + i + 1);
      assert.equal(h.requests[start + i].url, url);
      h.requests[start + i].fail();
    }
    for (let i = 0; i < 10; i++) context.fetchNowPlaying();
    assert.equal(h.requests.length, start + 3);
  }
  assert.equal(h.requests.length, 6);
});

test('a stale art failure does not duplicate the newer download or spend its retry budget', () => {
  const { h, playback, context } = setupArt();
  context.fetchNowPlaying();
  playback.item.uri = 'spotify:track:new';
  playback.item.album.images[0].url = 'https://example.invalid/new-art.jpg';
  context.fetchNowPlaying();
  h.requests[0].fail();
  context.fetchNowPlaying();
  assert.equal(h.requests.length, 2);
  for (let i = 1; i <= 3; i++) {
    h.requests[i].fail();
    context.fetchNowPlaying();
    assert.equal(h.requests.length, Math.min(i + 2, 4));
  }
  for (let i = 0; i < 10; i++) context.fetchNowPlaying();
  assert.equal(h.requests.length, 4, 'one old attempt plus three newer attempts');
});

test('successfully cached album art stays cached across tracks sharing the URL', () => {
  const { h, playback, context } = setupArt();
  context.fetchNowPlaying();
  h.requests[0].respond(200);
  ackImages(h);
  playback.item.uri = 'spotify:track:second';
  for (let i = 0; i < 5; i++) context.fetchNowPlaying();
  assert.equal(h.requests.length, 1);
});

test('prefetched current art is promoted without a new download', () => {
  const { h, image, playback, context } = setupArt('emery');
  context.fetchNowPlaying();
  h.requests[0].fail();
  image.sendPrefetchFromUrl(playback.item.album.images[0].url, playback.item.uri);
  h.requests[1].respond(200);
  ackImages(h);
  h.messages.length = 0;
  context.fetchNowPlaying();
  assert.equal(h.messages[0].body.ImagePromote, 1);
  context.fetchNowPlaying();
  assert.equal(h.messages.filter(message => message.body.ImagePromote).length, 1);
  h.messages[0].ack();
  context.fetchNowPlaying();
  assert.equal(h.requests.length, 2);
});

for (const outcome of ['ack', 'nack']) {
  test(`promotion waits for a slot-0 chunk ${outcome} before a later poll promotes`, () => {
    const { h, image, playback, context } = setupArt('emery');
    context.fetchNowPlaying();
    const promotedUrl = 'https://example.invalid/promoted-art.jpg';
    image.sendPrefetchFromUrl(promotedUrl, 'spotify:track:promoted');
    h.requests[1].respond(200);
    ackImages(h);
    h.messages.length = 0;
    h.requests[0].respond(200);
    h.messages[0].ack();
    const pendingChunk = h.messages.at(-1);
    playback.item.uri = 'spotify:track:promoted';
    playback.item.album.images[0].url = promotedUrl;
    for (let i = 0; i < 5; i++) context.fetchNowPlaying();
    assert.equal(h.messages.some(message => message.body.ImagePromote), false);
    assert.equal(h.requests.length, 2, 'busy polls start no downloads');
    assert.equal(context.imageAttempts, 0, 'busy polls consume no attempts');
    assert.notEqual(context.lastImageUrl, promotedUrl);
    assert.equal(image.isTransferring(), true);
    const completionIndex = h.messages.length;
    pendingChunk[outcome]();
    if (outcome === 'nack') {
      h.clearTimeout(context.prefetchTimer);
      assert.equal(h.runTimer(), 500);
      h.messages.at(-1).nack();
    } else {
      for (let i = completionIndex; i < h.messages.length; i++) {
        if (h.messages[i].ack) h.messages[i].ack();
      }
    }
    assert.equal(image.isTransferring(), false);
    context.fetchNowPlaying();
    const promotion = h.messages.find(message => message.body.ImagePromote);
    assert.ok(promotion, 'a later poll promotes once the send finishes');
    assert.equal(context.imageAttempts, 1);
    promotion.ack();
    assert.equal(image.getFailedUrl(), null);
    context.fetchNowPlaying();
    assert.equal(h.requests.length, 2, 'promoted art stays cached');
    playback.item.uri = 'spotify:track:later';
    playback.item.album.images[0].url = 'https://example.invalid/later-art.jpg';
    context.fetchNowPlaying();
    assert.equal(h.requests.length, 3, 'a later poll can download current art');
    const nextHeaderIndex = h.messages.length;
    h.requests[2].respond(200);
    for (let i = nextHeaderIndex; i < h.messages.length; i++) {
      if (h.messages[i].ack) h.messages[i].ack();
    }
    assert.equal(image.isTransferring(), false);
    context.fetchNowPlaying();
    assert.equal(h.requests.length, 3, 'later art completes and stays cached');
  });
}

test('PrefetchAbort during a slot-0 send preserves the active art transfer', () => {
  const { h, image, context } = setupArt('emery');
  context.fetchNowPlaying();
  h.requests[0].respond(200);
  h.messages.find(message => message.body.ImageWidth).ack();
  h.listeners.appmessage({ payload: { PrefetchAbort: 1 } });
  context.fetchNowPlaying();
  assert.equal(h.requests.length, 1);
  assert.equal(image.isTransferring(), true);
  // Complete the pending chunk and all remaining chunks without replaying the header.
  const firstChunk = h.messages.findIndex(message => message.body.ImageChunkIndex === 0);
  const header = h.messages.find(message => message.body.ImageWidth);
  for (let i = firstChunk; i < h.messages.length; i++) {
    if (h.messages[i].ack) h.messages[i].ack();
  }
  assert.equal(h.messages.filter(message => message.body.ImageChunkData).length, header.body.ImageChunksTotal);
  assert.equal(image.isTransferring(), false);
  assert.equal(image.getFailedUrl(), null);
  context.fetchNowPlaying();
  assert.equal(h.requests.length, 1, 'active art remains cached after completion');
});

test('failed promotion falls back to download and a failed fallback can retry on a later poll', () => {
  const { h, image, playback, context } = setupArt('emery');
  const url = playback.item.album.images[0].url;
  image.sendPrefetchFromUrl(url, playback.item.uri);
  h.requests[0].respond(200);
  ackImages(h);
  h.messages.length = 0;
  context.fetchNowPlaying();
  h.messages[0].nack();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].url, url);
  h.requests[1].fail();
  context.fetchNowPlaying();
  assert.equal(h.requests.length, 3);
});

for (const activeArt of ['other', 'same']) {
  test(`a promotion fallback blocked by ${activeArt} art retries the same track on a later poll`, () => {
    const { h, image, playback, context } = setupArt('emery');
    const url = playback.item.album.images[0].url;
    image.sendPrefetchFromUrl(url, playback.item.uri);
    h.requests[0].respond(200);
    ackImages(h);
    h.messages.length = 0;
    context.fetchNowPlaying();
    const promotion = h.messages[0];
    // A slot-0 transfer starts before the promotion NACK arrives.
    image.sendImageFromUrl(activeArt === 'same' ? url : 'https://example.invalid/other-art.jpg');
    h.requests[1].respond(200);
    image.dropPrefetch();
    promotion.nack();
    assert.equal(h.requests.length, 2, 'fallback is blocked by the active transfer');
    assert.equal(image.getFailedUrl(), url);
    assert.equal(image.isTransferring(), true);
    context.fetchNowPlaying();
    assert.equal(h.requests.length, 2);
    // Complete only the active transfer, leaving the failed promotion alone.
    for (let i = 1; i < h.messages.length; i++) {
      if (h.messages[i].ack) h.messages[i].ack();
    }
    assert.equal(image.isTransferring(), false);
    context.fetchNowPlaying();
    assert.equal(h.requests.length, 3);
    assert.equal(h.requests[2].url, url);
    const headerIndex = h.messages.length;
    h.requests[2].respond(200);
    for (let i = headerIndex; i < h.messages.length; i++) {
      if (h.messages[i].ack) h.messages[i].ack();
    }
    assert.equal(image.isTransferring(), false);
    context.fetchNowPlaying();
    assert.equal(h.requests.length, 3, 'successful retry is cached');
  });
}

function setupSettings(initial = {}) {
  const h = harness({ initial });
  const auth = h.load('src/pkjs/spotify_auth.js').module.exports;
  const image = { isBusy: () => false };
  const context = h.load('src/pkjs/index.js', {
    './spotify_auth': auth, './spotify_api': { getCurrentPlayback() {} }, './image_transfer': image
  });
  const save = payload => h.listeners.webviewclosed({ response: encodeURIComponent(JSON.stringify(payload)) });
  return { h, auth, context, image, save };
}
test('startup resends stored settings in one message with readiness and auth', () => {
  const { h } = setupSettings({ ongaku_settings: JSON.stringify({ longPressMode: 'volume' }) });
  h.listeners.ready();
  assert.deepEqual(h.messages.map(m => plain(m.body)), [{ LongPressMode: 1, JsReady: 1, AuthStatus: 0 }]);
  assert.equal(h.timers.size, 0);
});
test('invalid stored settings fall back to seek on startup', () => {
  for (const value of ['{', 'null', '{}', '{"longPressMode":"invalid"}']) {
    const { h } = setupSettings({ ongaku_settings: value });
    h.listeners.ready();
    assert.equal(h.messages[0].body.LongPressMode, 0);
  }
});
test('login with settings coalesces auth and settings into one message', () => {
  const { h, save } = setupSettings();
  save({ token: 'token', refreshToken: 'refresh', clientId: 'client', expiresIn: 60, settings: { longPressMode: 'volume' } });
  // Polling is also scheduled; run the zero-delay settings timer specifically.
  const timer = [...h.timers.values()].find(t => t.delay === 0);
  assert.ok(timer);
  timer.fn();
  assert.deepEqual(h.messages.map(m => plain(m.body)), [{ LongPressMode: 1, AuthStatus: 1 }]);
  assert.equal(h.localStorage.getItem('spotify_refresh_token'), 'refresh');
});
for (const busy of ['image', 'list']) {
  test(`settings save waits for ${busy} transfer, coalesces updates and sends latest once`, () => {
    const { h, context, image, save } = setupSettings();
    if (busy === 'image') image.isBusy = () => true;
    else context.listSendInProgress = true;
    save({ settings: { longPressMode: 'volume' } });
    assert.equal(h.runTimer(), 0);
    assert.equal(h.messages.length, 0);
    save({ settings: { longPressMode: 'seek' } });
    assert.equal(h.timers.size, 1);
    image.isBusy = () => false;
    context.listSendInProgress = false;
    assert.equal(h.runTimer(), 250);
    assert.deepEqual(h.messages.map(m => plain(m.body)), [{ LongPressMode: 0 }]);
    assert.equal(h.timers.size, 0);
  });
}
for (const slot of ['current', 'prefetch', 'promotion']) {
  test(`settings delivery waits for actual ${slot} image ACK chain`, () => {
    const { h, image, playback, context } = setupArt('emery');
    if (slot === 'current') context.fetchNowPlaying();
    else image.sendPrefetchFromUrl(playback.item.album.images[0].url, playback.item.uri);
    h.requests[0].respond(200);
    if (slot === 'promotion') {
      ackImages(h);
      image.promotePrefetch();
    }
    context.sendSettings({});
    context.flushSettings();
    assert.equal(h.messages.some(m => m.body.LongPressMode !== undefined), false);
    ackImages(h);
    context.flushSettings();
    assert.equal(h.messages.at(-1).body.LongPressMode, 0);
  });
}

test('an image download completing during settings delivery waits for the control ACK', () => {
  const { h, image } = setupArt('emery');
  const settings = h.load('src/pkjs/settings.js').module.exports;
  settings.send({}, null, null, image.sendControlMessage);
  const control = h.messages[0];
  image.sendImageFromUrl('https://example.invalid/art.jpg');
  h.requests[0].respond(200);
  assert.equal(h.messages.length, 1, 'image header cannot collide with settings');
  control.ack();
  assert.equal(h.runTimer(), 100);
  assert.ok(h.messages.at(-1).body.ImageWidth);
  ackImages(h);
  assert.equal(image.isBusy(), false);
});
