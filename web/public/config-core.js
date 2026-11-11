(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConfigCore = factory();
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';
  var REDIRECT_URI = 'https://ongaku.yoiailabs.com/oauth/callback';
  var SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private user-library-read user-follow-read';
  var SESSION_KEYS = ['pkce_verifier', 'pkce_state', 'pkce_client_id', 'pkce_settings'];

  function normalizeSettings(value) {
    if (!value || (value.longPressMode !== 'seek' && value.longPressMode !== 'volume')) return null;
    return { longPressMode: value.longPressMode };
  }

  // Keep phone context through setup/login navigation. OAuth query parameters
  // are never passed here; only the settings page calls this helper.
  function restoreSettingsQuery(search, storage, history) {
    var key = 'settings_query';
    try {
      if (search && search !== '?') {
        storage.setItem(key, search);
      } else {
        search = storage.getItem(key) || '';
        if (search) history.replaceState(null, '', '/' + search);
      }
    } catch (error) {
      // Settings remain usable when browser storage is unavailable.
    }
    return search || '';
  }

  function parseSettings(search) {
    var params = new URLSearchParams(search);
    var platform = params.get('platform') || '';
    return {
      clientId: (params.get('client_id') || '').trim(),
      settings: normalizeSettings({ longPressMode: params.get('long_press') }),
      platform: platform,
      showLongPress: platform !== 'aplite',
      authed: params.get('authed') === '1'
    };
  }

  function generateRandom(cryptoApi, length) {
    // A power-of-two alphabet avoids modulo bias; 64 bytes = 384 random bits.
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    var bytes = new Uint8Array(length);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, function(value) { return chars[value & 63]; }).join('');
  }

  function generateVerifier(cryptoApi) { return generateRandom(cryptoApi, 64); }
  function generateState(cryptoApi) { return generateRandom(cryptoApi, 32); }

  async function challenge(verifier, cryptoApi) {
    var hash = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    var binary = Array.from(new Uint8Array(hash), function(value) { return String.fromCharCode(value); }).join('');
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function authorizeUrl(clientId, codeChallenge, state) {
    var params = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: REDIRECT_URI,
      scope: SCOPES, code_challenge_method: 'S256', code_challenge: codeChallenge,
      state: state, show_dialog: 'true'
    });
    return 'https://accounts.spotify.com/authorize?' + params.toString();
  }

  function validateSession(state, session) {
    if (!session.verifier || !session.clientId || !session.state || !state || state !== session.state) {
      throw new Error('Login session expired or state did not match. Please start login again from settings.');
    }
  }

  function closeUrl(settings, credentials) {
    var payload = {};
    var normalized = normalizeSettings(settings);
    if (normalized) payload.settings = normalized;
    if (credentials) {
      if (credentials.clientId) payload.clientId = credentials.clientId;
      if (credentials.token) {
        payload.token = credentials.token;
        payload.refreshToken = credentials.refreshToken;
        payload.expiresIn = credentials.expiresIn;
      }
    }
    return 'pebblejs://close#' + encodeURIComponent(JSON.stringify(payload));
  }

  function clearSession(storage) {
    SESSION_KEYS.forEach(function(key) { storage.removeItem(key); });
  }

  return {
    REDIRECT_URI: REDIRECT_URI, restoreSettingsQuery: restoreSettingsQuery, normalizeSettings: normalizeSettings, parseSettings: parseSettings,
    generateVerifier: generateVerifier, generateState: generateState, challenge: challenge,
    authorizeUrl: authorizeUrl, validateSession: validateSession, closeUrl: closeUrl, clearSession: clearSession
  };
}));
