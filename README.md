# Ongaku for Spotify

Control Spotify from your Pebble smartwatch. Browse playlists, artists, albums and liked songs, skip tracks, adjust volume, and see album art — all from your wrist.

Based on [Playback for Spotify](https://github.com/alex523ap/Playback-for-Spotify) by alex523ap.
The [original Repebble AppStore listing](https://apps.repebble.com/cd7c4d5fe7ec4989a64976c6)
installs the upstream app, not Ongaku for Spotify. The repository name remains `Playback-for-Spotify`.

Version 1.4.0 introduces the new name and app UUID
`c5d2c288-0e8b-4b80-bd43-530bb57bb7f5`, allowing Ongaku for Spotify to be installed
alongside the original store app. The minor version bump marks this separate app
identity. It is a fresh installation: log in to Spotify again, enter your Client ID again
if the settings page does not already show it, repeat the tutorial, and choose
your long-press setting again. The tutorial and long-press setting are
unavailable on Aplite.

![basalt menu](screenshots/basalt_1_menu.png) ![basalt now playing](screenshots/basalt_2_adele.png) ![basalt now playing 2](screenshots/basalt_3_weeknd.png)

## Features

- **Now Playing** — track title, artist, album art, and progress bar
- **Playback controls** — play/pause, next/previous track
- **Volume control** — choose Volume in the phone settings page, then hold UP/DOWN on Now Playing (unavailable on Aplite; currently only while playing on external speakers)
- **Browse library** — playlists, artists, albums, liked songs
- **Queue control** — long-press a song to add it to your queue; preview the queue anytime
- **Shuffle & repeat** — hold SELECT on the main menu's Now Playing row to open shuffle and repeat settings (off / context / track; unavailable on Aplite)
- **Album art** — full-color on color watches, Floyd-Steinberg dithered on B&W
- **First-launch tutorial** — quick guide to controls

## Supported Platforms

| Platform | Watch |
|----------|-------|
| Basalt | Pebble Time / Time Steel |
| Chalk | Pebble Time Round |
| Diorite | Pebble 2 |
| Emery | Pebble Time 2 |
| Flint | Pebble 2 Duo |
| Gabbro | Pebble Round 2 |
| Aplite | Original Pebble (96×96 dithered album art) |

## Setup

### 1. Configuration Page

Open the [configuration page](https://ongaku.yoiailabs.com/) from the Pebble
phone app to save settings or log in with Spotify using Authorization Code + PKCE.
No client secret is needed. The page and OAuth callback are hosted from `web/`.

### 2. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Set Redirect URI to exactly `https://ongaku.yoiailabs.com/oauth/callback`
4. Copy your **Client ID**

If you used the previous configuration page, add the new Redirect URI above
to your existing app in the Spotify Developer Dashboard before logging in again.

### 3. Install the App

1. Clone this repo
2. Run `pebble build && pebble install`
3. Open Settings on your phone for Ongaku for Spotify
4. Enter your Client ID and log in with Spotify

## Controls

On the **Now Playing screen**:

| Action | Button |
|--------|--------|
| Previous track | UP |
| Next track | DOWN |
| Open queue | SELECT |
| Seek back / forward 15 seconds (Skip 15s mode) | Hold UP / DOWN for 700 ms |
| Volume up / down (Volume mode) | Hold UP / DOWN for 700 ms |

Choose **Long press UP/DOWN** in the **phone settings page**. The default is
**Skip 15s**, and the choice is saved across launches. Aplite has neither these
UP/DOWN long-press actions nor the mode setting.

To **play/pause**, open the queue and press SELECT on its first row (the current
track). The queue closes after a selection or after 3 seconds of inactivity.
SELECT has no long-press action on the Now Playing screen. To toggle shuffle or
cycle repeat (Off → Context → Track → Off), return to the **main menu**, hold
SELECT on the **Now Playing row**, then select Shuffle or Repeat in the submenu.
This submenu is unavailable on Aplite.

On touch platforms (Emery and Gabbro), **tap** the Now Playing screen to open the
queue, **swipe left** for the next track, or **swipe right** for the previous
track. Vertical gestures on this screen do nothing.

## Building

Requires [Pebble SDK](https://developer.rebble.io/developer.pebble.com/sdk/index.html).

```
pebble build
pebble install --emulator basalt   # emulator
pebble install --phone IP_ADDRESS  # real watch
```

## Hosting the config page

The `web/` directory contains plain HTML, CSS, and JavaScript, with no build step.
Cloudflare serves `web/public/` as static assets; there is no Worker script.
The Worker name `ongaku` intentionally replaces the existing Worker of that name.

```sh
npm run web:check   # Validate and package without Cloudflare credentials
npm run web:deploy  # Deploy to ongaku.yoiailabs.com
```

Deployment requires `wrangler login` with access to the account in
`web/wrangler.jsonc`. CI only runs the dry run; deployment is manual.

## Testing on Emulator

The emulator can't reach the phone's config page, so OAuth has to be completed manually in a browser and the resulting token URL saved to a `.env` file.

1. Open the configuration page linked in Setup in a regular browser.
2. Enter your Client ID and log in with Spotify as you normally would.
3. On the success page, right-click the **Return to Pebble** button and copy its link — it looks like `pebblejs://close#%7B%22token%22...%7D`.
4. Create a `.env` file at the repo root (it's gitignored):
   ```
   DEBUG_RESPONSE=pebblejs://close#%7B%22token%22...%7D
   ```
5. Rebuild and reinstall: `pebble build && pebble install --emulator basalt`.
6. The token is valid for 1 hour — update `.env` with a fresh link when it expires.

The build step reads `.env` and generates `src/pkjs/debug_env.js` (also gitignored) which injects the token. Without a `.env` file, `DEBUG_RESPONSE` is `null` and production/store builds are unaffected.

## Development

Use Node.js 22+, Python 3, and a host C compiler (`cc`, or set `CC`). Install
Pebble Tool 5.0.39 and SDK 4.33 using the [SDK setup guide](https://developer.repebble.com/sdk/).
For static analysis, install the same version used by CI:
`pipx install cppcheck==1.5.3` (PyPI wrapper that ships Cppcheck 2.22.0).

```sh
npm ci
npm run lint      # ESLint recommended rules with PebbleKit globals
npm test          # Node unit tests and host C tests
npm run test:js   # JavaScript tests only
npm run test:c    # Host C tests only; no SDK required
npm run lint:c    # Cppcheck against SDK headers for all seven platforms
pebble build     # Build all seven platforms from package.json
```

C analysis locates the installed SDK automatically; set `PEBBLE_SDK_CORE` to
the `sdk-core` directory for a custom installation. Tests use isolated mocks
and a small host `pebble.h` stub, with no watch, phone, or Spotify account needed.
Characterization tests explicitly label remaining known bugs. Host C tests also
cover marquee font changes and progress label formatting. CI runs separate
JavaScript, C analysis/test, and watch-build jobs.

## License

MIT. See [LICENSE](LICENSE).
