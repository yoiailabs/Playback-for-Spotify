var jpeg = require('jpeg-js');

function getChunkSize() {
  try {
    var platform = Pebble.getActiveWatchInfo().platform || '';
    if (platform === 'basalt' || platform === 'emery' || platform === 'gabbro') return 2000;
  } catch (e) { }
  return 1000;
}

// Slot 0 — currently displayed art
var transferInProgress = false;
var lastUrl = null;
var failedUrl = null;

// Slot 1 — prefetched next-track art (emery/gabbro only)
var prefetchInProgress = false;
var prefetchAbort = false;
var prefetchUrl = null;
var prefetchTrackUri = null;
var prefetchReady = false;

function isColorPlatform() {
  try {
    var platform = Pebble.getActiveWatchInfo().platform || '';
    return ['basalt', 'chalk', 'emery', 'gabbro'].indexOf(platform) !== -1;
  } catch (e) {
    return true;
  }
}

function prefetchSupported() {
  try {
    var p = Pebble.getActiveWatchInfo().platform || '';
    return p === 'emery' || p === 'gabbro';
  } catch (e) { return false; }
}

function sendError(msg) {
  console.log('[playback] ERROR: ' + msg);
  try {
    Pebble.sendAppMessage({ 'ErrorMsg': msg });
  } catch (e) { }
}

function failImage(msg, url) {
  if (url !== lastUrl) return;
  failedUrl = url;
  lastUrl = null;
  transferInProgress = false;
  sendError(msg);
}

function failImageSend(msg, url) {
  // Only one slot-0 send can be active, even if promotion changes lastUrl.
  transferInProgress = false;
  failImage(msg, url);
}

function arrayBufferToBytes(ab) {
  return new Uint8Array(ab);
}

function resizeAndQuantize(srcPixels, srcW, srcH, dstW, dstH) {
  var dst = new Uint8Array(dstW * dstH);
  var scale = Math.max(dstW / srcW, dstH / srcH);
  var scaledW = srcW * scale, scaledH = srcH * scale;
  var offsetX = (dstW - scaledW) / 2, offsetY = (dstH - scaledH) / 2;

  for (var y = 0; y < dstH; y++) {
    for (var x = 0; x < dstW; x++) {
      var srcX = Math.floor((x - offsetX) / scale);
      var srcY = Math.floor((y - offsetY) / scale);
      var r = 0, g = 0, b = 0;
      if (srcX >= 0 && srcX < srcW && srcY >= 0 && srcY < srcH) {
        var srcIdx = (srcY * srcW + srcX) * 4;
        r = srcPixels[srcIdx]; g = srcPixels[srcIdx + 1]; b = srcPixels[srcIdx + 2];
      }
      dst[y * dstW + x] = 0xC0 | ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
    }
  }
  return dst;
}

function resizeAndDither(srcPixels, srcW, srcH, dstW, dstH) {
  var gray = new Float32Array(dstW * dstH);
  var scale = Math.max(dstW / srcW, dstH / srcH);
  var scaledW = srcW * scale, scaledH = srcH * scale;
  var offsetX = (dstW - scaledW) / 2, offsetY = (dstH - scaledH) / 2;

  for (var y = 0; y < dstH; y++) {
    for (var x = 0; x < dstW; x++) {
      var srcX = Math.floor((x - offsetX) / scale);
      var srcY = Math.floor((y - offsetY) / scale);
      var lum = 0;
      if (srcX >= 0 && srcX < srcW && srcY >= 0 && srcY < srcH) {
        var srcIdx = (srcY * srcW + srcX) * 4;
        lum = 0.299 * srcPixels[srcIdx] + 0.587 * srcPixels[srcIdx + 1] + 0.114 * srcPixels[srcIdx + 2];
      }
      gray[y * dstW + x] = lum;
    }
  }

  for (var y = 0; y < dstH; y++) {
    for (var x = 0; x < dstW; x++) {
      var idx = y * dstW + x;
      var old = gray[idx];
      var nw = old < 128 ? 0 : 255;
      gray[idx] = nw;
      var err = old - nw;
      if (x + 1 < dstW) gray[idx + 1] += err * 7 / 16;
      if (y + 1 < dstH) {
        if (x > 0) gray[(y + 1) * dstW + (x - 1)] += err * 3 / 16;
        gray[(y + 1) * dstW + x] += err * 5 / 16;
        if (x + 1 < dstW) gray[(y + 1) * dstW + (x + 1)] += err * 1 / 16;
      }
    }
  }

  var rowBytes = Math.ceil(dstW / 32) * 4;
  var dst = new Uint8Array(rowBytes * dstH);
  for (var y = 0; y < dstH; y++) {
    for (var x = 0; x < dstW; x++) {
      if (gray[y * dstW + x] <= 128) {
        dst[y * rowBytes + Math.floor(x / 8)] |= (1 << (x % 8));
      }
    }
  }
  return dst;
}

function resizeAndQuantizeFit(srcPixels, srcW, srcH, dstW, dstH) {
  var dst = new Uint8Array(dstW * dstH);
  for (var i = 0; i < dst.length; i++) dst[i] = 0xC0;
  var scale = Math.min(dstW / srcW, dstH / srcH);
  var scaledW = srcW * scale, scaledH = srcH * scale;
  var offsetX = (dstW - scaledW) / 2, offsetY = (dstH - scaledH) / 2;

  for (var y = 0; y < dstH; y++) {
    for (var x = 0; x < dstW; x++) {
      var srcX = Math.floor((x - offsetX) / scale);
      var srcY = Math.floor((y - offsetY) / scale);
      if (srcX >= 0 && srcX < srcW && srcY >= 0 && srcY < srcH) {
        var srcIdx = (srcY * srcW + srcX) * 4;
        var r = srcPixels[srcIdx], g = srcPixels[srcIdx + 1], b = srcPixels[srcIdx + 2];
        dst[y * dstW + x] = 0xC0 | ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
      }
    }
  }
  return dst;
}

function resetPrefetch() {
  prefetchInProgress = false;
  prefetchAbort = false;
  prefetchUrl = null;
  prefetchTrackUri = null;
  prefetchReady = false;
}

function processJpeg(jpegData, slot, url) {
  if (url === undefined) url = lastUrl;
  try {
    var raw = jpeg.decode(jpegData, { useTArray: true });
    var W = 144, H = 106, isRound = false;
    try {
      var platform = Pebble.getActiveWatchInfo().platform || '';
      if (platform === 'emery') { W = 200; H = 166; }
      else if (platform === 'gabbro') { W = 260; H = 260; isRound = true; }
      else if (platform === 'chalk') { W = 180; H = 180; isRound = true; }
      else if (platform === 'aplite') { W = 96; H = 96; }
    } catch (e) { }

    var imageData = isRound ? resizeAndQuantizeFit(raw.data, raw.width, raw.height, W, H)
      : isColorPlatform() ? resizeAndQuantize(raw.data, raw.width, raw.height, W, H)
        : resizeAndDither(raw.data, raw.width, raw.height, W, H);

    sendImageToWatch(imageData, W, H, slot, url);
  } catch (ex) {
    if (slot === 1) {
      resetPrefetch();
    } else {
      failImage('Decode: ' + ex.message, url);
    }
  }
}

function downloadAndSend(url) {
  if (!url || transferInProgress || (url === lastUrl && failedUrl !== url)) return false;
  // Current art always wins — abort any in-flight prefetch.
  if (prefetchInProgress) prefetchAbort = true;
  lastUrl = url;
  failedUrl = null;
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'arraybuffer';
  xhr.onload = function () {
    // A newer track may have started downloading while this request was pending.
    if (url !== lastUrl) return;
    if (xhr.status === 200) {
      processJpeg(arrayBufferToBytes(xhr.response), 0, url);
    } else {
      failImage('Download ' + xhr.status, url);
    }
  };
  xhr.onerror = function () {
    failImage('Download failed', url);
  };
  xhr.send();
  return true;
}

function downloadPrefetch(url, trackUri) {
  if (!prefetchSupported()) return;
  if (transferInProgress) return;
  if (prefetchInProgress || prefetchReady) {
    if (url === prefetchUrl) return;
    // A stale prefetch is in flight or buffered; clear it before queuing the new one.
    if (prefetchInProgress) { prefetchAbort = true; return; }
    resetPrefetch();
  }
  if (url === lastUrl) return;

  prefetchInProgress = true;
  prefetchAbort = false;
  prefetchReady = false;
  prefetchUrl = url;
  prefetchTrackUri = trackUri;

  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'arraybuffer';
  xhr.onload = function () {
    if (prefetchAbort || xhr.status !== 200) {
      resetPrefetch();
      return;
    }
    processJpeg(arrayBufferToBytes(xhr.response), 1);
  };
  xhr.onerror = function () { resetPrefetch(); };
  xhr.send();
}

function sendImageToWatch(data, width, height, slot, url) {
  slot = slot || 0;
  if (url === undefined) url = lastUrl;
  if (slot === 0 && url !== lastUrl) return;
  if (slot === 1) prefetchInProgress = true;
  else transferInProgress = true;

  var chunkSize = getChunkSize();
  var totalChunks = Math.ceil(data.length / chunkSize);

  var headerMsg = {
    'ImageWidth': width,
    'ImageHeight': height,
    'ImageDataSize': data.length,
    'ImageChunksTotal': totalChunks
  };
  if (slot === 1) headerMsg['ImageSlot'] = 1;

  Pebble.sendAppMessage(headerMsg, function () {
    sendChunk(data, 0, totalChunks, chunkSize, slot, url);
  }, function () {
    if (slot === 1) {
      resetPrefetch();
    } else {
      failImageSend('Header fail', url);
    }
  });
}

function finishChunkRun(slot) {
  if (slot === 1) {
    prefetchInProgress = false;
    prefetchAbort = false;
    prefetchReady = true;
  } else {
    transferInProgress = false;
  }
}

function failChunkRun(slot, url) {
  if (slot === 1) {
    resetPrefetch();
  } else {
    failImageSend('Chunk fail', url);
  }
}

function sendChunk(data, index, totalChunks, chunkSize, slot, url) {
  if (slot === 0 && url !== lastUrl) { finishChunkRun(slot); return; }
  if (slot === 1 && prefetchAbort) { resetPrefetch(); return; }

  var start = index * chunkSize;
  var end = Math.min(start + chunkSize, data.length);
  var chunk = [];
  for (var i = start; i < end; i++) chunk.push(data[i]);

  var msg = { 'ImageChunkIndex': index, 'ImageChunkData': chunk };
  if (slot === 1) msg['ImageSlot'] = 1;

  Pebble.sendAppMessage(msg, function () {
    if (slot === 1 && prefetchAbort) { resetPrefetch(); return; }
    if (index + 1 < totalChunks) sendChunk(data, index + 1, totalChunks, chunkSize, slot, url);
    else finishChunkRun(slot);
  }, function () {
    setTimeout(function () {
      if (slot === 0 && url !== lastUrl) { finishChunkRun(slot); return; }
      if (slot === 1 && prefetchAbort) { resetPrefetch(); return; }
      Pebble.sendAppMessage(msg, function () {
        if (slot === 1 && prefetchAbort) { resetPrefetch(); return; }
        if (index + 1 < totalChunks) sendChunk(data, index + 1, totalChunks, chunkSize, slot, url);
        else finishChunkRun(slot);
      }, function () {
        failChunkRun(slot, url);
      });
    }, 500);
  });
}

function dropPrefetch() {
  if (prefetchInProgress) {
    prefetchAbort = true;
  } else {
    resetPrefetch();
  }
}

function promotePrefetch() {
  if (!prefetchReady) return false;
  var promotedUrl = prefetchUrl;
  failedUrl = null;
  Pebble.sendAppMessage({ 'ImagePromote': 1 }, function () {
    lastUrl = promotedUrl;
    resetPrefetch();
  }, function () {
    // Promote failed in transit — fall back to a fresh transfer.
    resetPrefetch();
    if (!transferInProgress && lastUrl === promotedUrl) lastUrl = null;
    if (!downloadAndSend(promotedUrl)) failedUrl = promotedUrl;
  });
  return true;
}

function getPrefetchedUri() {
  return prefetchReady ? prefetchTrackUri : null;
}

module.exports = {
  sendImageFromUrl: downloadAndSend,
  sendPrefetchFromUrl: downloadPrefetch,
  dropPrefetch: dropPrefetch,
  promotePrefetch: promotePrefetch,
  getPrefetchedUri: getPrefetchedUri,
  prefetchSupported: prefetchSupported,
  getFailedUrl: function () { return failedUrl; },
  isTransferring: function () { return transferInProgress; }
};
