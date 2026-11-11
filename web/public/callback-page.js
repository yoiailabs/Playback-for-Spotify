(function() {
  'use strict';
  var params = new URLSearchParams(window.location.search);
  // Remove OAuth credentials before reading storage or making any network request.
  window.history.replaceState(null, '', window.location.pathname);
  var status = document.getElementById('status');
  var core = ConfigCore;

  async function completeLogin() {
    try {
      var session = {
        verifier: sessionStorage.getItem('pkce_verifier'),
        state: sessionStorage.getItem('pkce_state'),
        clientId: sessionStorage.getItem('pkce_client_id')
      };
      core.validateSession(params.get('state'), session);
      if (params.get('error')) {
        throw new Error(params.get('error_description') || params.get('error'));
      }
      var code = params.get('code');
      if (!code) throw new Error('Spotify did not return an authorization code. Please log in again.');
      var settings = core.normalizeSettings(JSON.parse(sessionStorage.getItem('pkce_settings')));
      var response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code: code, redirect_uri: core.REDIRECT_URI,
          client_id: session.clientId, code_verifier: session.verifier
        }).toString()
      });
      var data;
      try {
        data = await response.json();
      } catch (error) {
        throw new Error('Spotify returned an unreadable login response. Please log in again.');
      }
      if (!data || typeof data !== 'object') throw new Error('Spotify returned an incomplete login response.');
      if (!response.ok) throw new Error(data.error_description || data.error || 'Spotify login failed.');
      if (typeof data.access_token !== 'string' || !data.access_token.trim() ||
          typeof data.refresh_token !== 'string' || !data.refresh_token.trim() ||
          typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
        throw new Error('Spotify returned an incomplete login response. Please log in again.');
      }
      var link = document.getElementById('return');
      link.href = core.closeUrl(settings, {
        clientId: session.clientId, token: data.access_token,
        refreshToken: data.refresh_token, expiresIn: data.expires_in
      });
      core.clearSession(sessionStorage);
      status.textContent = 'Connected. Return to Pebble to apply your settings.';
      link.hidden = false;
    } catch (error) {
      core.clearSession(sessionStorage);
      // Only explicit errors and Spotify's error fields are shown, never a token body.
      status.textContent = error.message || 'Could not complete login. Please try again from settings.';
    }
  }
  completeLogin();
}());
