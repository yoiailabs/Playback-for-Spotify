// Spotify OAuth - Authorization Code with PKCE via Pebble config page

var SPOTIFY_CLIENT_ID = '0b9be8bdf4ae48d29bde7e52220d5b5e';
var settings = require('./settings');

var TOKEN_KEY = 'spotify_token';
var EXPIRY_KEY = 'spotify_token_expiry';
var REFRESH_KEY = 'spotify_refresh_token';
var CLIENT_ID_KEY = 'spotify_client_id';

// Set to the full "pebblejs://close#..." link for emulator testing, or null for store builds.
// Populated automatically from .env at build time via debug_env.js (gitignored).
var DEBUG_RESPONSE = null;
try {
  DEBUG_RESPONSE = require('./debug_env');
} catch (e) {}

var refreshInProgress = false;
var refreshQueue = [];

function saveToken(token, expiresIn, clientId, refreshToken) {
  var expiryTime = Date.now() + (expiresIn * 1000);
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EXPIRY_KEY, String(expiryTime));
  if (clientId) {
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  if (refreshToken) {
    localStorage.setItem(REFRESH_KEY, refreshToken);
  }
}

// Handle debug response override
if (DEBUG_RESPONSE) {
  try {
    var decoded = decodeURIComponent(DEBUG_RESPONSE.split('#')[1]);
    var data = JSON.parse(decoded);
    if (data.token) {
      saveToken(data.token, data.expiresIn || 3600, data.clientId, data.refreshToken);
      console.log('[playback] Debug token loaded');
    }
  } catch (e) {
    console.log('[playback] Debug parse error: ' + e.message);
  }
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function isTokenExpired() {
  if (DEBUG_RESPONSE) return false; // Prevent refresh loops in debug mode
  var expiryTime = localStorage.getItem(EXPIRY_KEY);
  if (!expiryTime) return true;
  return Date.now() > parseInt(expiryTime, 10);
}

function refreshAccessToken(callback) {
  // If a refresh is already in progress, queue this callback
  if (refreshInProgress) {
    refreshQueue.push(callback);
    return;
  }

  var refreshToken = localStorage.getItem(REFRESH_KEY);
  var clientId = localStorage.getItem(CLIENT_ID_KEY) || SPOTIFY_CLIENT_ID;

  if (!refreshToken) {
    console.log('[playback] No refresh token available');
    if (callback) callback(new Error('No refresh token'), null);
    return;
  }

  if (!clientId) {
    console.log('[playback] No client ID available');
    if (callback) callback(new Error('No client ID'), null);
    return;
  }

  refreshInProgress = true;
  console.log('[playback] Refreshing access token...');
  var xhr = new XMLHttpRequest();
  xhr.open('POST', 'https://accounts.spotify.com/api/token', true);
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');

  var body = 'grant_type=refresh_token' +
             '&refresh_token=' + encodeURIComponent(refreshToken) +
             '&client_id=' + encodeURIComponent(clientId);

  function finishRefresh(err, token) {
    refreshInProgress = false;
    var queued = [callback].concat(refreshQueue);
    refreshQueue = [];
    // Isolate callers so one exception cannot strand the remaining callbacks.
    for (var i = 0; i < queued.length; i++) {
      try {
        if (queued[i]) queued[i](err, token);
      } catch (e) {
        console.log('[playback] Refresh callback failed');
      }
    }
  }

  xhr.onload = function() {
    var data = null;
    if (xhr.status === 200) {
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {}
    }
    if (data && typeof data.access_token === 'string' && data.access_token.trim().length > 0) {
      saveToken(data.access_token, data.expires_in, clientId, data.refresh_token);
      console.log('[playback] Token refreshed successfully');
      finishRefresh(null, data.access_token);
    } else {
      console.log('[playback] Refresh failed: ' + xhr.status +
                  (xhr.status === 200 ? '' : ' ' + xhr.responseText));
      finishRefresh(new Error('Refresh failed'), null);
    }
  };
  xhr.onerror = function() {
    finishRefresh(new Error('Network error'), null);
  };
  xhr.send(body);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

function isAuthenticated() {
  return !!getToken();
}

function init(onAuthChange, onSettingsChange) {
  Pebble.addEventListener('showConfiguration', function() {
    Pebble.openURL(settings.configUrl(localStorage.getItem(CLIENT_ID_KEY), isAuthenticated()));
  });

  Pebble.addEventListener('webviewclosed', function(e) {
    if (e && e.response) {
      try {
        var decoded = decodeURIComponent(e.response);
        var data = JSON.parse(decoded);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        var hasToken = typeof data.token === 'string' && data.token.trim().length > 0;
        var savedSettings = data.settings && settings.save(data.settings);
        if (hasToken) {
          var expiresIn = typeof data.expiresIn === 'number' && isFinite(data.expiresIn) && data.expiresIn > 0 ? data.expiresIn : 3600;
          saveToken(data.token, expiresIn,
            typeof data.clientId === 'string' ? data.clientId : null,
            typeof data.refreshToken === 'string' ? data.refreshToken : null);
          if (onAuthChange) onAuthChange(true);
        }
        if (savedSettings) {
          if (onSettingsChange) onSettingsChange();
          else settings.send({});
        }
      } catch (ex) {
        console.log('[playback] Invalid config response');
      }
    }
  });
}

module.exports = {
  init: init,
  getToken: getToken,
  isTokenExpired: isTokenExpired,
  refreshAccessToken: refreshAccessToken,
  clearToken: clearToken,
  isAuthenticated: isAuthenticated
};
