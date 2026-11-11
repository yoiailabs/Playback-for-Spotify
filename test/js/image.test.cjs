const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, plain } = require('./helpers.cjs');

function setup(platform = 'basalt') {
  const h = harness({ platform });
  const jpeg = { decode: () => ({ data: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 }) };
  const context = h.load('src/pkjs/image_transfer.js', { 'jpeg-js': jpeg });
  return { h, context, image: context.module.exports };
}
const platforms = [
  ['aplite', 96, 96, 1152, 1000], ['basalt', 144, 106, 15264, 2000],
  ['chalk', 180, 180, 32400, 1000], ['diorite', 144, 106, 2120, 1000],
  ['emery', 200, 166, 33200, 2000], ['flint', 144, 106, 2120, 1000],
  ['gabbro', 260, 260, 67600, 2000]
];
for (const [platform, width, height, bytes, chunkSize] of platforms) {
  test(`${platform}: JPEG produces platform size and ordered ACK-paced chunks`, () => {
    const { h, context, image } = setup(platform);
    context.processJpeg(new Uint8Array(), 0);
    assert.equal(image.isTransferring(), true);
    assert.equal(h.messages.length, 1);
    assert.deepEqual(plain(h.messages[0].body), {
      ImageWidth: width, ImageHeight: height, ImageDataSize: bytes, ImageChunksTotal: Math.ceil(bytes / chunkSize)
    });
    h.messages[0].ack();
    let received = 0;
    for (let i = 0; i < Math.ceil(bytes / chunkSize); i++) {
      const message = h.messages[i + 1];
      assert.equal(message.body.ImageChunkIndex, i);
      assert.equal(message.body.ImageChunkData.length, Math.min(chunkSize, bytes - received));
      received += message.body.ImageChunkData.length;
      message.ack();
    }
    assert.equal(received, bytes);
    assert.equal(image.isTransferring(), false);
  });
}
test('color quantization packs opaque ARGB2222 and center-crops', () => {
  const { context } = setup();
  const rgba = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255];
  assert.deepEqual(Array.from(context.resizeAndQuantize(rgba, 3, 1, 3, 1)), [0xf0, 0xcc, 0xc3]);
  assert.deepEqual(Array.from(context.resizeAndQuantize(rgba, 3, 1, 1, 1)), [0xcc]);
});
test('round fit keeps aspect ratio and letterboxes in opaque black', () => {
  const { context } = setup();
  const rgba = [255, 0, 0, 255, 255, 0, 0, 255];
  assert.deepEqual(Array.from(context.resizeAndQuantizeFit(rgba, 2, 1, 2, 4)),
    [0xc0, 0xc0, 0xc0, 0xc0, 0xf0, 0xf0, 0xc0, 0xc0]);
});
test('monochrome uses LSB-first black bits with 32-bit row padding', () => {
  const { context } = setup();
  assert.deepEqual(Array.from(context.resizeAndDither([0, 0, 0, 255, 255, 255, 255, 255], 2, 1, 2, 1)), [1, 0, 0, 0]);
  assert.equal(context.resizeAndDither([0, 0, 0, 255], 1, 1, 33, 2).length, 16);
});
test('Floyd-Steinberg diffusion turns constant middle gray into alternating bits', () => {
  const { context } = setup();
  const rgba = Array.from({ length: 4 }, () => [128, 128, 128, 255]).flat();
  assert.deepEqual(Array.from(context.resizeAndDither(rgba, 4, 1, 4, 1)), [0b1010, 0, 0, 0]);
});
test('chunk failure retries once after 500ms then releases transfer state', () => {
  const { h, context, image } = setup();
  context.sendImageToWatch(new Uint8Array([1, 2, 3]), 3, 1, 0);
  h.messages[0].ack();
  h.messages[1].nack();
  assert.equal(h.messages.length, 2);
  assert.equal(h.runTimer(), 500);
  assert.deepEqual(plain(h.messages[2].body), plain(h.messages[1].body));
  h.messages[2].nack();
  assert.equal(image.isTransferring(), false);
  assert.equal(h.messages[3].body.ErrorMsg, 'Chunk fail');
});
test('header failure releases transfer state and reports error', () => {
  const { h, context, image } = setup();
  context.sendImageToWatch(new Uint8Array([1]), 1, 1);
  h.messages[0].nack();
  assert.equal(image.isTransferring(), false);
  assert.equal(h.messages[1].body.ErrorMsg, 'Header fail');
});
test('prefetch completes in slot 1 and promotes without retransmitting pixels', () => {
  const { h, context, image } = setup('emery');
  context.prefetchUrl = 'https://example.invalid/art.jpg';
  context.prefetchTrackUri = 'spotify:track:test';
  context.sendImageToWatch(new Uint8Array([1]), 1, 1, 1);
  assert.equal(h.messages[0].body.ImageSlot, 1);
  h.messages[0].ack();
  assert.equal(h.messages[1].body.ImageSlot, 1);
  h.messages[1].ack();
  assert.equal(image.getPrefetchedUri(), 'spotify:track:test');
  assert.equal(image.promotePrefetch(), true);
  assert.deepEqual(plain(h.messages[2].body), { ImagePromote: 1 });
  h.messages[2].ack();
  assert.equal(image.getPrefetchedUri(), null);
  assert.equal(context.lastUrl, 'https://example.invalid/art.jpg');
});
test('prefetch abort stops after the current ACK', () => {
  const { h, context, image } = setup('gabbro');
  context.sendImageToWatch(new Uint8Array(4001), 1, 1, 1);
  h.messages[0].ack();
  image.dropPrefetch();
  h.messages[1].ack();
  assert.equal(h.messages.length, 2);
  assert.equal(image.getPrefetchedUri(), null);
});
test('download errors clear cached URL so a later request can retry', () => {
  const { h, image } = setup();
  const url = 'https://example.invalid/art.jpg';
  image.sendImageFromUrl(url);
  assert.equal(h.requests[0].responseType, 'arraybuffer');
  h.requests[0].respond(404);
  assert.equal(h.messages[0].body.ErrorMsg, 'Download 404');
  image.sendImageFromUrl(url);
  h.requests[1].fail();
  assert.equal(h.messages[1].body.ErrorMsg, 'Download failed');
});

for (const failure of ['http', 'network']) {
  for (const newerTransferring of [false, true]) {
    test(`stale ${failure} failure preserves newer art while ${newerTransferring ? 'transferring' : 'downloading'}`, () => {
      const { h, context, image } = setup();
      const oldUrl = 'https://example.invalid/old-art.jpg';
      const newUrl = 'https://example.invalid/new-art.jpg';
      image.sendImageFromUrl(oldUrl);
      image.sendImageFromUrl(newUrl);
      if (newerTransferring) h.requests[1].respond(200);
      const messageCount = h.messages.length;
      if (failure === 'http') h.requests[0].respond(404);
      else h.requests[0].fail();
      assert.equal(h.messages.length, messageCount, 'stale failure sends no error or image messages');
      assert.equal(image.getFailedUrl(), null);
      assert.equal(context.lastUrl, newUrl);
      assert.equal(image.isTransferring(), newerTransferring);
      image.sendImageFromUrl(newUrl);
      assert.equal(h.requests.length, 2, 'newer request remains cached while pending');
      if (!newerTransferring) h.requests[1].respond(200);
      h.messages.find(message => message.body.ImageWidth).nack();
      assert.equal(image.getFailedUrl(), newUrl, 'the current request can still fail normally');
      assert.equal(image.isTransferring(), false);
    });
  }
}

for (const [phase, outcome] of [
  ['header', 'ack'], ['header', 'nack'],
  ['chunk', 'ack'], ['chunk', 'nack'], ['last chunk', 'ack'],
  ['retry', 'ack'], ['retry', 'nack'], ['last retry', 'ack']
]) {
  test(`promotion during slot-0 ${phase} releases a stale send on ${outcome}`, () => {
    const { h, context, image } = setup('emery');
    const oldUrl = 'https://example.invalid/old-art.jpg';
    const promotedUrl = 'https://example.invalid/promoted-art.jpg';
    assert.equal(image.sendImageFromUrl(oldUrl), true);
    // Prefetch is allowed while current art is downloading, before its send starts.
    image.sendPrefetchFromUrl(promotedUrl, 'spotify:track:promoted');
    h.requests[1].respond(200);
    for (let i = 0; i < h.messages.length; i++) h.messages[i].ack();
    h.messages.length = 0;
    h.requests[0].respond(200);
    const header = h.messages[0];
    let pending = header;
    if (phase !== 'header') {
      header.ack();
      pending = h.messages.at(-1);
      if (phase.startsWith('last')) {
        while (pending.body.ImageChunkIndex < header.body.ImageChunksTotal - 1) {
          pending.ack();
          pending = h.messages.at(-1);
        }
      }
      if (phase.includes('retry')) {
        pending.nack();
        assert.equal(h.runTimer(), 500);
        pending = h.messages.at(-1);
      }
    }
    assert.equal(image.isTransferring(), true);
    assert.equal(image.promotePrefetch(), true);
    h.messages.at(-1).ack();
    assert.equal(context.lastUrl, promotedUrl);
    const messageCount = h.messages.length;
    pending[outcome]();
    if (phase === 'chunk' && outcome === 'nack') assert.equal(h.runTimer(), 500);
    assert.equal(image.isTransferring(), false);
    assert.equal(h.messages.length, messageCount, 'stale send stops without sending pixels or errors');
    assert.equal(image.getFailedUrl(), null);
    assert.equal(context.lastUrl, promotedUrl, 'promotion remains cached');
    assert.equal(image.sendImageFromUrl(promotedUrl), false);
    assert.equal(image.sendImageFromUrl('https://example.invalid/later-art.jpg'), true);
    assert.equal(h.requests.length, 3, 'a later current-art download can start');
    const nextHeaderIndex = h.messages.length;
    h.requests[2].respond(200);
    assert.equal(image.isTransferring(), true);
    for (let i = nextHeaderIndex; i < h.messages.length; i++) h.messages[i].ack();
    assert.equal(image.isTransferring(), false);
  });
}

for (const phase of ['download', 'header', 'chunk', 'retry timeout', 'retry ack', 'retry nack']) {
  test(`prefetch aborted during ${phase} releases its flags for a later prefetch`, () => {
    const { h, image } = setup('emery');
    image.sendPrefetchFromUrl('https://example.invalid/old-art.jpg', 'spotify:track:old');
    let pending;
    if (phase !== 'download') {
      h.requests[0].respond(200);
      pending = h.messages.at(-1);
      if (phase !== 'header') {
        pending.ack();
        pending = h.messages.at(-1);
        if (phase.startsWith('retry')) {
          pending.nack();
          if (phase !== 'retry timeout') {
            assert.equal(h.runTimer(), 500);
            pending = h.messages.at(-1);
          }
        }
      }
    }
    image.dropPrefetch();
    if (phase === 'download') h.requests[0].respond(200);
    else if (phase === 'retry timeout') assert.equal(h.runTimer(), 500);
    else if (phase === 'retry nack') pending.nack();
    else pending.ack();
    assert.equal(image.getPrefetchedUri(), null);
    image.sendPrefetchFromUrl('https://example.invalid/next-art.jpg', 'spotify:track:next');
    assert.equal(h.requests.length, 2, 'aborted prefetch no longer blocks a new download');
    const nextHeaderIndex = h.messages.length;
    h.requests[1].respond(200);
    for (let i = nextHeaderIndex; i < h.messages.length; i++) h.messages[i].ack();
    assert.equal(image.getPrefetchedUri(), 'spotify:track:next');
  });
}

test('stale download success is discarded before decoding or sending', () => {
  const { h, context, image } = setup();
  image.sendImageFromUrl('https://example.invalid/old-art.jpg');
  const newUrl = 'https://example.invalid/new-art.jpg';
  image.sendImageFromUrl(newUrl);
  context.jpeg.decode = () => { throw new Error('Stale image must not be decoded'); };
  h.requests[0].respond(200);
  assert.equal(h.messages.length, 0);
  assert.equal(image.getFailedUrl(), null);
  assert.equal(context.lastUrl, newUrl);
  assert.equal(image.isTransferring(), false);
});

for (const replacement of ['dropped', 'replaced']) {
  test(`promotion NACK downloads the captured URL after prefetch is ${replacement}`, () => {
    const { h, image } = setup('emery');
    const promotedUrl = 'https://example.invalid/promoted-art.jpg';
    image.sendPrefetchFromUrl(promotedUrl, 'spotify:track:promoted');
    h.requests[0].respond(200);
    h.messages[0].ack();
    // A single pixel still expands to the platform's full image size.
    for (let i = 1; i < h.messages.length; i++) h.messages[i].ack();
    assert.equal(image.promotePrefetch(), true);
    const promotion = h.messages[h.messages.length - 1];
    image.dropPrefetch();
    if (replacement === 'replaced') {
      image.sendPrefetchFromUrl('https://example.invalid/next-art.jpg', 'spotify:track:next');
    }
    promotion.nack();
    assert.equal(h.requests[h.requests.length - 1].url, promotedUrl);
    assert.equal(h.requests.filter(request => request.url === promotedUrl).length, 2);
    assert.equal(image.getFailedUrl(), null, 'fallback download started');
  });
}
