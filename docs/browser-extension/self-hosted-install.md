# Self-hosted install (no Chrome Web Store)

Chrome removed the ability for a website to install an extension in Chrome 71,
so no "click download and it installs" flow exists for any extension, listed or
not. For a small number of known machines the closer equivalent is an enterprise
policy: Chrome installs the extension itself from Tide-Bot and keeps it updated,
with no store listing and no review.

Setup is one administrator command per machine. After that the extension
installs, stays enabled, and auto-updates on every deploy.

## How it fits together

| Piece | Where it lives |
| --- | --- |
| Signing key | Off the server and out of git, operator-held (see below) |
| Signed `.crx` and `update.xml` | The `tide-bot-data` volume, under `browser-extension/` |
| Distribution token | `browser_extension.dist_token` in Tide-Bot config |
| Install command | **Settings → Browser Control**, admin only |

The signed package is served from a token-bearing path because Chrome's updater
is a background browser process: it has no session, no user present, and no way
to prompt, so it cannot authenticate interactively. The URL is the credential.
Treat it like a password. The package itself carries no credentials, and pairing
still requires a signed-in session from the pinned extension id, so a leaked URL
exposes client code rather than access.

## Signing key

The extension id is derived from this key, and Chrome rejects an update signed
by a different one. Losing it means a new id and a reinstall on every machine.

- Keep it outside the repository and outside any Docker build context.
- Default location on the current server: `~/.tide-bot/extension-signing-key.pem`.
- Back it up somewhere the operator controls.
- Its public half is pinned as `key` in `browser-extension/manifest.json`, and
  the resulting id is `BROWSER_EXTENSION_ID` in
  `backend/open_webui/routers/browser_extension.py`. All three move together.

## Publishing an update

Chrome only installs a build whose `version` is higher than the installed copy,
so bump `version` in `browser-extension/manifest.json` first.

```sh
npm run build:browser-extension

TOKEN=$(...)   # browser_extension.dist_token, or read it from Settings → Browser Control
node scripts/sign-browser-extension.mjs \
  --key ~/.tide-bot/extension-signing-key.pem \
  --base-url "https://tide-bot.com/api/v1/browser-extension/dist/$TOKEN"

docker cp backend/open_webui/static/browser-extension/tide-bot-browser-extension.crx \
  tide-bot:/app/backend/data/browser-extension/
docker cp backend/open_webui/static/browser-extension/update.xml \
  tide-bot:/app/backend/data/browser-extension/
```

Installed browsers pick the update up on Chrome's own schedule, roughly every
few hours; `chrome://extensions` → **Update** forces it immediately.

## Per-machine setup

Copy the command from **Settings → Browser Control** and run it once in
PowerShell as Administrator, then restart Chrome. It writes the extension id and
update URL to `ExtensionInstallForcelist`, which is what makes Chrome install and
pin the extension.

Force-installed extensions cannot be removed from `chrome://extensions` by
design. To uninstall, delete the value from the policy key and restart Chrome:

```powershell
Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist' -Name '1'
```

## Rotating the distribution token

Rotation invalidates the update URL every installed browser is polling, so
re-run the per-machine setup afterwards with the new command.

1. Set a fresh `browser_extension.dist_token` in Tide-Bot config.
2. Re-run the publish steps above so `update.xml` advertises the new path.
3. Re-run the per-machine command everywhere.
