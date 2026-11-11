// Phone-owned settings; the watch receives the same value again on startup.
var STORAGE_KEY = 'ongaku_settings';
var CONFIG_URL = 'https://ongaku.yoiailabs.com/';

function isValid(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (value.longPressMode === 'seek' || value.longPressMode === 'volume');
}

function loadSaved() {
  try {
    var value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (isValid(value)) return { longPressMode: value.longPressMode };
  } catch (e) {}
  return null;
}

function load() {
  return loadSaved() || { longPressMode: 'seek' };
}

function save(value) {
  if (!isValid(value)) return false;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ longPressMode: value.longPressMode }));
  return true;
}

// Adopt the watch's persisted choice once; an explicit phone choice wins.
function adoptWatch(value) {
  if (loadSaved() || (value !== 0 && value !== 1)) return false;
  return save({ longPressMode: value === 1 ? 'volume' : 'seek' });
}

function message() {
  var saved = loadSaved();
  return saved ? { 'LongPressMode': saved.longPressMode === 'volume' ? 1 : 0 } : {};
}

function send(extra, ack, nack, transport) {
  var body = message();
  for (var key in extra) {
    if (Object.prototype.hasOwnProperty.call(extra, key)) body[key] = extra[key];
  }
  if (transport) transport(body, ack, nack);
  else Pebble.sendAppMessage(body, ack, nack);
}

function configUrl(clientId, authed) {
  var platform = '';
  try {
    if (Pebble.getActiveWatchInfo) platform = Pebble.getActiveWatchInfo().platform || '';
  } catch (e) {}
  var query = 'long_press=' + load().longPressMode +
    '&platform=' + encodeURIComponent(platform) + '&authed=' + (authed ? '1' : '0') +
    '&t=' + Date.now();
  if (clientId) query += '&client_id=' + encodeURIComponent(clientId);
  return CONFIG_URL + '?' + query;
}

module.exports = { load: load, loadSaved: loadSaved, adoptWatch: adoptWatch, save: save, message: message, send: send, configUrl: configUrl };
