(function() {
  'use strict';
  var core = ConfigCore;
  var initial = core.parseSettings(window.location.search);
  var clientId = document.getElementById('client-id');
  var mode = document.getElementById('long-press');
  var status = document.getElementById('status');
  var login = document.getElementById('login');
  clientId.value = initial.clientId;
  mode.value = initial.settings.longPressMode;
  document.getElementById('long-press-settings').hidden = !initial.showLongPress;
  document.getElementById('aplite-note').hidden = initial.showLongPress;
  if (initial.authed) status.textContent = 'Spotify is connected. Save settings or log in again.';

  function settings() { return core.normalizeSettings({ longPressMode: mode.value }); }

  document.getElementById('save').onclick = function() {
    window.location.href = core.closeUrl(settings(), { clientId: clientId.value.trim() });
  };

  login.onclick = async function() {
    var id = clientId.value.trim();
    if (!id) {
      status.textContent = 'Enter your Spotify Client ID first. See the setup guide for help.';
      clientId.focus();
      return;
    }
    login.disabled = true;
    try {
      var verifier = core.generateVerifier(window.crypto);
      var state = core.generateState(window.crypto);
      var challenge = await core.challenge(verifier, window.crypto);
      sessionStorage.setItem('pkce_verifier', verifier);
      sessionStorage.setItem('pkce_state', state);
      sessionStorage.setItem('pkce_client_id', id);
      sessionStorage.setItem('pkce_settings', JSON.stringify(settings()));
      window.location.href = core.authorizeUrl(id, challenge, state);
    } catch (error) {
      // A browser error may contain sensitive context; show a fixed message.
      status.textContent = 'Could not start secure login. Enable session storage and try again.';
      login.disabled = false;
    }
  };
}());
