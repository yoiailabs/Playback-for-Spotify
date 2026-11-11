const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { harness, plain } = require('./helpers.cjs');

// Synthetic 2x1 red/green JPEG, encoded at quality 90 with jpeg-js.
const fixture = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/red-green.jpg')));

function setup(platform = 'basalt') {
  const h = harness({ platform });
  // Evaluate the installed library itself in VMs without Node's Buffer global.
  const decoder = h.load('node_modules/jpeg-js/lib/decoder.js');
  const encoder = h.load('node_modules/jpeg-js/lib/encoder.js');
  const library = h.load('node_modules/jpeg-js/index.js', {
    './lib/decoder': decoder.module.exports,
    './lib/encoder': encoder.module.exports
  });
  const jpeg = library.module.exports;
  const context = h.load('src/pkjs/image_transfer.js', { 'jpeg-js': jpeg });
  return { h, context, jpeg, decoder, image: context.module.exports };
}

test('bundled jpeg-js sources parse as ES5', () => {
  for (const file of ['index.js', 'lib/decoder.js', 'lib/encoder.js']) {
    const source = fs.readFileSync(path.join(path.dirname(require.resolve('jpeg-js')), file), 'utf8');
    assert.doesNotThrow(() => acorn.parse(source, { ecmaVersion: 5 }), file);
  }
});

test('real JPEG decodes to typed RGBA pixels without Buffer', () => {
  const { jpeg, decoder } = setup();
  assert.equal('Buffer' in decoder, false);
  const raw = jpeg.decode(fixture, { useTArray: true });
  assert.equal(raw.width, 2);
  assert.equal(raw.height, 1);
  assert.equal(ArrayBuffer.isView(raw.data), true);
  assert.equal(raw.data.constructor.name, 'Uint8Array');
  assert.equal(raw.data.length, raw.width * raw.height * 4);
  assert.equal(raw.data[3], 255);
  assert.equal(raw.data[7], 255);
  assert.ok(raw.data[0] > 240 && raw.data[1] < 15 && raw.data[2] < 15);
  assert.ok(raw.data[4] < 15 && raw.data[5] > 240 && raw.data[6] < 15);
  // The patched options merge must preserve explicit overrides and own keys.
  const options = Object.create({ formatAsRGBA: false });
  options.useTArray = true;
  assert.equal(jpeg.decode(fixture, options).data.length, 8);
  assert.equal(jpeg.decode(fixture, { useTArray: true, formatAsRGBA: false }).data.length, 6);
  assert.equal(jpeg.decode(fixture, { useTArray: true, formatAsRGBA: undefined }).data.length, 6);
  assert.throws(() => jpeg.decode(fixture), /Buffer is not globally defined/);
});

const platforms = [
  ['aplite', 96, 96, 1152, 1000], ['basalt', 144, 106, 15264, 2000],
  ['chalk', 180, 180, 32400, 1000], ['diorite', 144, 106, 2120, 1000],
  ['emery', 200, 166, 33200, 2000], ['flint', 144, 106, 2120, 1000],
  ['gabbro', 260, 260, 67600, 2000]
];

for (const [platform, width, height, bytes, chunkSize] of platforms) {
  test(`${platform}: real JPEG preserves transfer size and ACK pacing without Buffer`, () => {
    const { h, context, image } = setup(platform);
    context.processJpeg(fixture, 0);
    assert.deepEqual(plain(h.messages[0].body), {
      ImageWidth: width, ImageHeight: height, ImageDataSize: bytes,
      ImageChunksTotal: Math.ceil(bytes / chunkSize)
    });
    assert.equal(h.messages.length, 1);
    assert.equal(image.isTransferring(), true);
    h.messages[0].ack();
    let received = 0;
    for (let i = 0; i < Math.ceil(bytes / chunkSize); i++) {
      const message = h.messages[i + 1];
      assert.equal(h.messages.length, i + 2);
      assert.equal(message.body.ImageChunkIndex, i);
      assert.equal(message.body.ImageChunkData.length, Math.min(chunkSize, bytes - received));
      received += message.body.ImageChunkData.length;
      message.ack();
    }
    assert.equal(received, bytes);
    assert.equal(image.isTransferring(), false);
  });
}

test('real decoder failure reports an error and permits a current-art retry', () => {
  const { h, context, image } = setup();
  context.lastUrl = 'https://example.invalid/art.jpg';
  context.processJpeg(new Uint8Array(), 0);
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0].body.ErrorMsg, /^Decode: /);
  assert.equal(context.lastUrl, null);
  assert.equal(image.isTransferring(), false);
});

test('real decoder failure resets the prefetch slot without sending an error', () => {
  const { h, context, image } = setup('emery');
  image.sendPrefetchFromUrl('https://example.invalid/art.jpg', 'spotify:track:test');
  assert.equal(context.prefetchInProgress, true);
  context.processJpeg(new Uint8Array(), 1);
  assert.equal(context.prefetchInProgress, false);
  assert.equal(context.prefetchUrl, null);
  assert.equal(context.prefetchTrackUri, null);
  assert.equal(context.prefetchReady, false);
  assert.equal(image.getPrefetchedUri(), null);
  assert.equal(h.messages.length, 0);
});
