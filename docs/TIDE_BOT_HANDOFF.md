# Tide-Bot Product Handoff

## What Tide-Bot is

Tide-Bot is the private, branded Open WebUI deployment for Changing Tides Treatment Center. It is not a generic pet page and it is not a public Open WebUI community instance. Ted-Bot is the product mascot and appears as part of the Tide-Bot visual system.

## Current reality as of 2026-07-23

There are two distinct environments:

| Environment                | Address                 | State                                                                                                  |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Local Docker testing stack | `http://localhost:3102` | The current checkout. This is where source changes are verified.                                       |
| Public production site     | `https://tide-bot.com`  | A separate live deployment and the accepted visual reference for the authenticated Tide-Bot workspace. |

The public site does not update when the local testing stack is rebuilt. It needs a deliberate production deployment using the current checkout and the production Compose overlay.

## Product work in this checkout

- Open WebUI is pinned to the current upstream development baseline used by this checkout.
- Tide-Bot identity, favicon, manifest, auth/onboarding, and private deployment defaults are present.
- Ted-Bot uses the supplied sprite atlas in the product interface, rather than launching as a separate site.
- The authenticated public Tide-Bot workspace is the visual baseline: Archivo typography, ocean-blue palette, pale-blue sidebar, signal line, and restrained controls. That presentation layer is captured in `src/app.css` without replacing current Open WebUI layout or behavior.
- Do not replace the application shell wholesale without reviewing the authenticated live product first.
- Public Open WebUI community review/sharing exits are disabled in deployment and removed from the relevant product UI paths.
- Upstream attribution remains in the About surface and license materials.

## Local testing

The testing stack is intentionally left running. Do not use it as production.

```sh
cd /Users/kolbyunderwood/Desktop/Projects/Tide-Bot/deploy/tide-stack
docker compose ps
curl -fsS http://127.0.0.1:3102/health
```

Expected health response:

```json
{ "status": true }
```

To rebuild the local application after source changes:

```sh
cd /Users/kolbyunderwood/Desktop/Projects/Tide-Bot/deploy/tide-stack
docker compose up -d --build
```

To stop or restart it:

```sh
docker compose stop
docker compose up -d
```

## Private Tailscale access

The running local stack is available only to devices signed into this tailnet:

```text
https://kolbys-mac-mini.tail756dc8.ts.net:3102/
```

Use the Tide-Bot administrator account provisioned for this checkout. Credentials were supplied
out-of-band and are not stored in this repository. This is Tailscale Serve, not Funnel, so it is not
publicly reachable from the internet. The Tide routes on the main tailnet hostname are intentionally
left unchanged.

The proxy survives Tailscale restarts and can be checked or restored with:

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=3102 http://127.0.0.1:3102
```

To disable remote Tide-Bot access without stopping the local Docker stack:

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --https=3102 off
```

The `tide-bot` Docker container uses the `unless-stopped` restart policy. The Mac must remain awake
and Docker Desktop must be running for remote access to work.

## Production deployment boundary

Production must be deployed from the approved server/CI path; do not copy a local database, `.env`, logs, or user data. The production Compose overlay limits browser origins to `https://tide-bot.com` and `https://www.tide-bot.com`.

```sh
cd /path/to/Tide-Bot/deploy/tide-stack
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
```

Before an actual production release, verify the server has the required production secrets and the reverse proxy serves the domain with a valid TLS certificate. Detailed backup, rollback, and proxy instructions are in [PRODUCTION.md](PRODUCTION.md).

## Safeguards

- Do not commit secrets, databases, logs, or user data.
- Preserve the user-owned untracked `AGENTS.md`, `tide-bot-pet/`, and `teddy-v2-upgrade/` directories.
- Do not claim the public site is updated until the live domain is rechecked in an authenticated browser after deployment.
- The local administrator account was created directly in the persistent Tide-Bot data volume; do not
  copy a production database, session, or user data into the test stack.

## Native desktop companion (Tauri)

The Tauri-based native companion is the supported path for keeping a typed
Tide-Bot session usable when the main browser window is minimized. Browser
Picture-in-Picture is not an equivalent substitute. The companion ships on
macOS and Windows; build, signing, and acceptance evidence live in
`desktop/tide-bot/`.

### Origin provisioning

`tide-bot.com` is served via Cloudflare. The desktop build is bound to this
origin at compile time, and the value is provisioned per-build through the
non-secret repository variable `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN`
(Settings → Secrets and variables → Actions → Variables). It is never a
secret and is never written to source. For a Tide-Bot release build the
value is `https://tide-bot.com`. The optional loopback-only
`TIDE_BOT_DESKTOP_DEV_ORIGIN` is reserved for an intentionally loopback
development artifact; the release workflow and protected-branch pushes
reject it. The build launcher
(`desktop/tide-bot/scripts/build-desktop.mjs`) revalidates both inputs
through the tracked resolver before compiling, and the Cargo `build.rs`
re-hashes the resolver, template, and generated capability/provenance
before they are embedded in the binary. Any drift fails the build.

### Windows artifact workflow

A reproducible GitHub Actions workflow at
`.github/workflows/ted-bot-windows.yml` builds the unsigned Windows
artifact on `windows-latest`. It accepts manual dispatch (with an optional
loopback-dev flag) and pushes to protected `release/**` branches. It pins
Node 22.18.0, Rust stable with the MSVC default host triple, and forwards
`TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` (and the optional dev origin) to
`desktop/tide-bot`'s `npm run build:windows`. The workflow fails before
compilation if the required variable is absent or invalid, refuses a dev
origin on a release push, uploads the unsigned binary alongside a SHA-256
checksum file and a `ted-bot-windows-metadata.json` summary, and never
records the resolved origin values to runner output.

### Acceptance state (as of 2026-07-27)

The Windows release artifact is **built and downloaded**. Run
[30295334507](https://github.com/kolbick/Tide-Bot/actions/runs/30295334507)
produced `tide-bot.exe` (101 MB, PE32+ x86-64 GUI) with SHA-256
`81a99f69ce83cf1a31a445dee305e3b9ca7c01f2fcb61b380fb88435345f5579`, baked
with `https://tide-bot.com` as the production origin. All five build fixes
landed on `origin/main`; the workflow now produces a clean artifact from a
cold start in ~15 minutes.

Local macOS debug evidence remains a development convenience only. The
remaining external gates are:

- **Manual Windows artifact acceptance** — run `tide-bot.exe` on a Windows
  box with a non-production test account; exercise sign-in, main-window
  hide, typed companion chat, active-chat sync, denied chat confirmation,
  disconnect/reconnect, sign-out, OS lock/unlock, tray menu, keyboard
  navigation, reduced motion, and uninstall. Record OS build and binary
  checksum.
- **Real Tauri macOS runtime acceptance** — sign-in, minimized main
  window, typed chat, active-chat sync, sign-out, lock behavior, tray
  actions, keyboard navigation, reduced motion, and uninstall. Run
  separately from the debug compilation.
- **Fresh Hatch Pet v2 visual/runtime acceptance** from the actual Tauri
  app, via the required direction-evidence pipeline. Browser or local
  macOS-only evidence does not replace this gate.

Full evidence, digests, and the build-fix chain are in
`docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md` and
`docs/TED_BOT_NATIVE_COMPANION_HANDOFF_2026-07-27.md`.
