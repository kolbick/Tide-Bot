# Tide-Bot

Tide-Bot is the private, branded Open WebUI fork for Changing Tides Treatment Center, served from `tide-bot.com`. It is a self-hosted AI workspace plus three companion surfaces: a floating desktop window, a Chrome side panel that can drive a tab, and a voice mode.

Two mascots, easy to confuse:

- **Tide-Bot** is the product, and its mark is the cyborg pirate in `static/tide-bot/`.
- **Ted-Bot** is the black goldendoodle companion pet that appears inside the product (`static/tide-bot/ted-bot/`). It is a supporting character, not a separate app or auth surface.

## What this repo is

- The full [Open WebUI](https://github.com/open-webui/open-webui) application source (SvelteKit frontend + FastAPI backend)
- Tide-Bot visual identity, server defaults, browser chrome, PWA metadata, and supplied assets
- The **native companion**: a two-window desktop app pairing the main session with a compact always-on-top window
- **Tide-Bot Browser Control**: a paired Chrome side panel for text and voice chat, single-tab browser actions, workflows, and Chrome-open schedules
- **Voice**: ElevenLabs realtime conversational mode in the call overlay, plus a reasoning-stripped completions endpoint so spoken replies do not read chain-of-thought aloud
- A Docker Compose stack for self-hosting (`deploy/tide-stack/`)
- A reproducible Windows desktop build pipeline (GitHub Actions)
- An isolated Cypress E2E harness for the companion, and a Playwright harness for the extension

## How tide-bot.com is served

The public site is not a separate cloud deployment. A Cloudflare Tunnel fronts the Docker stack running on the operator's machine:

```
tide-bot.com ──> Cloudflare Tunnel ──> 127.0.0.1:3102 ──> tide-bot container
```

The tunnel's ingress lives in `C:\ProgramData\cloudflared\config.yml` on the current host. Two consequences worth knowing:

- The site is only up while that machine and Docker are running.
- Ingress rules are matched in order and `path` is an **unanchored regex**. A rule like `path: /browser*` will also capture `/api/v1/browser-extension/...`, which is exactly how the extension API once started returning 502s. Anchor new path rules (`^/browser($|/)`).

Production deploys use both Compose files so CORS and Socket.IO permit only the public origins:

```sh
cd deploy/tide-stack
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
```

Backup, rollback, and reverse-proxy detail: [`deploy/tide-stack/PRODUCTION.md`](deploy/tide-stack/PRODUCTION.md).

## Companion feature

A small always-on-top window that follows the active conversation in the main window. Drag it to a second monitor, close the main window without losing it, and reopen the main window from its button.

| Surface            | Where                                                               | What                                                                        |
| ------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Browser**        | `https://tide-bot.com/companion` (any browser)                      | The companion rendered as a SvelteKit route. No install.                    |
| **Native desktop** | `tide-bot.exe` (Windows) / `tide-bot.app` (macOS, from local build) | Tauri 2 shell that bundles Tide-Bot into a desktop app with two OS windows. |

The desktop build is the production-shipped path; the browser path works the same way and is a development convenience.

## Chrome browser extension

A Manifest V3 side panel that chats through your Tide-Bot account and can act in one controlled tab.

**Pairing.** Clicking _Pair browser_ claims a device directly from your signed-in `tide-bot.com` session — no tab, no code. Only the pinned extension ID may claim, so another installed extension cannot mint a device against the same session. Browsers with no active session fall back automatically to the device-code flow, which opens an approval page and closes it once approved.

**Installing.** Chrome removed website-initiated installs in Chrome 71, so there is no click-to-install for any extension. Two supported paths:

| Path                                 | What the user does                                                                              | Updates                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Self-hosted policy** (recommended) | Runs one administrator command once per machine, from **Settings → Browser Control**            | Chrome installs and auto-updates it from Tide-Bot |
| **Manual**                           | Downloads the authenticated ZIP, unzips, `chrome://extensions` → Developer mode → Load unpacked | Re-download and reload by hand                    |

The self-hosted path serves a signed `.crx` plus an update manifest from a token-bearing URL, because Chrome's updater is a background process that cannot authenticate interactively. Setup, key handling, and token rotation: [`docs/browser-extension/self-hosted-install.md`](docs/browser-extension/self-hosted-install.md).

**Safety.** One controlled tab at a time. Autonomous is the action default, with Consequential approval and Manual approval available; downloads, delete-like actions, secret fields, and suspected prompt injection pause for approval regardless of mode. Scheduled workflows use Chrome alarms, so Chrome must stay open.

## Quick start

### 1. Get the source

```sh
git clone https://github.com/kolbick/Tide-Bot.git
cd Tide-Bot
```

### 2. Install the toolchain

The project is engine-strict. You need **exactly** these versions:

- **Node.js 22.18.0** and **npm 10.9.3** — a newer shell-default Node violates `package.json` engines and is rejected by `.npmrc`
- **Python 3.11 or 3.12** (`requires-python >=3.11, <3.13.0a1`)
- **Rust 1.77+** (desktop build only)
- **Docker** (deploy stack and the Cypress E2E harness)
- **Visual Studio Build Tools** with the C++ workload (Windows, desktop build)
- **Xcode Command Line Tools** (macOS, desktop build)

### 3. Run the dev stack

```sh
# Frontend (http://localhost:5173)
npm ci
npm run dev

# Backend (http://localhost:8080) — separate terminal
cd backend && sh dev.sh
```

### 4. Run the self-hosted stack

```sh
cd deploy/tide-stack
docker compose up -d --build
# Tide-Bot is now on http://localhost:3102
```

This is the dev/test stack. Never treat it as the production path or copy its data into production.

### 5. Build the desktop companion

The desktop build embeds a single production origin at compile time. Full procedure in `desktop/tide-bot/README.md`. Short version:

1. Set repository variable `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tide-bot.com` (Settings → Secrets and variables → Actions → Variables).
2. Trigger `.github/workflows/ted-bot-windows.yml` from the Actions tab.
3. Download `ted-bot-windows-artifact` and run `tide-bot.exe` on Windows.

## Common commands

```sh
npm run dev                       # frontend dev server
npm run build                     # production frontend build
npm run check                     # svelte-kit sync + svelte-check (large pre-existing baseline)
npm run lint                      # eslint --fix; check; pylint backend/
npm run audit:branding            # REQUIRED before any branding-adjacent change
npm run test:frontend             # vitest
npm run build:browser-extension   # package the extension ZIP
npm run test:browser-extension:unit
npm run test:companion:e2e        # isolated Cypress runner (needs RUN_ID)
node --test scripts/sign-browser-extension.test.mjs   # CRX signing
```

## Repository layout

```
.
├── src/                              # SvelteKit frontend
│   ├── routes/(app)/companion/       # The /companion route
│   ├── routes/(app)/browser-extension/pair/  # Device-code approval page
│   ├── lib/ted-bot/                  # Companion presence primitives
│   ├── lib/components/ted-bot/       # CompanionPanel, MainPresencePublisher, TedBotPet
│   ├── lib/components/browser-extension/     # Settings → Browser Control
│   └── lib/components/chat/          # Canonical chat surface (incl. surface='companion')
├── backend/open_webui/               # FastAPI backend
│   ├── routers/browser_extension.py  # Pairing, tokens, workflows, schedules, distribution
│   ├── socket/companion_presence.py  # Presence service + stores
│   └── socket/main.py                # Socket.IO handlers
├── browser-extension/                # Chrome MV3 side panel and tab executor
├── desktop/tide-bot/                 # Tauri 2 desktop shell
├── deploy/tide-stack/                # Docker Compose overlays
├── scripts/
│   ├── build-browser-extension.mjs   # Deterministic extension package
│   ├── sign-browser-extension.mjs    # CRX3 signing + update manifest
│   ├── run-companion-cypress.mjs     # Hermetic isolated E2E runner
│   └── audit-branding.mjs            # Branding gate
├── docs/                             # Build, security, and hand-off documents
└── .github/workflows/                # Windows desktop + extension CI
```

## Current state

**Live.** The web app, the browser extension (pairing, chat, tab control, workflows, schedules), and voice are deployed and serving from `tide-bot.com` through the Cloudflare Tunnel above. The extension self-hosts its own signed updates.

**Implementation-complete, acceptance-pending.** The desktop companion builds reproducibly and the Windows artifact has been produced ([run 30295334507](https://github.com/kolbick/Tide-Bot/actions/runs/30295334507), SHA-256 `81a99f69ce83cf1a31a445dee305e3b9ca7c01f2fcb61b380fb88435345f5579`), but release acceptance needs things no terminal in this repo can do:

- Running the `.exe` on a real Windows box and exercising sign-in, main-window hide, companion typing, active-chat sync, tray menu, sign-out, lock/unlock
- Real Tauri macOS runtime acceptance, separate from debug compilation
- Fresh Hatch Pet v2 visual/runtime acceptance from the actual Tauri app

Evidence record: `docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md`.

**Not verified in a real browser.** The extension's one-click session claim depends on Chrome attaching the `tide-bot.com` session cookie to a request from the extension origin. If it does not fire, pairing degrades to the device-code flow rather than failing outright.

## Security and origin policy

- The desktop build is **bound to one production origin at compile time**. The `.exe` cannot be redirected at runtime; raw `TIDE_BOT_URL` overrides are rejected by the build launcher.
- The companion window is the **only** webview with a permission: a single `allow-show-main-window` command. No filesystem, shell, process, credential, arbitrary-navigation, eval, or `core:default` permissions.
- The extension's identity is pinned by a public `key` in its manifest; the server allows session claiming only from that extension origin. Changing the key changes the ID and requires updating `BROWSER_EXTENSION_ID`.
- The CRX signing key lives outside the repository and outside any Docker build context. Losing it means a new extension ID and a reinstall everywhere.
- The Windows artifact is **unsigned**. Signing and distribution are a release-owner responsibility.

## Documents

- [Build specification](docs/BUILD_SPECIFICATION.md) — authoritative product brief
- [Tide-Bot product handoff](docs/TIDE_BOT_HANDOFF.md) — operational handbook
- [Production operation](deploy/tide-stack/PRODUCTION.md) — deploy, backup, rollback
- [Browser extension guide](docs/browser-extension/README.md) — installation, use, administration
- [Browser extension security](docs/browser-extension/security.md) — permissions, retention, incident recovery
- [Self-hosted install](docs/browser-extension/self-hosted-install.md) — signed updates without the Web Store
- [Chrome Web Store checklist](docs/browser-extension/chrome-web-store.md) — owner-run submission prep
- [Branding guide](docs/BRANDING.md) — identity rules
- [Upstream baseline](docs/UPSTREAM.md) — Open WebUI commit pin
- [Upstream sync procedure](docs/UPSTREAM_SYNC.md) — how to take a new upstream release
- [Security](docs/SECURITY.md) — security and origin policy
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) — roadmap snapshot as of 2026-07-24; predates the browser extension and voice work
- [Companion handoff, 2026-07-27](docs/TED_BOT_NATIVE_COMPANION_HANDOFF_2026-07-27.md) — desktop session record

## Upstream and licensing

Tide-Bot is derived from [Open WebUI](https://github.com/open-webui/open-webui). Required upstream license files and notices remain in the repository. See [UPSTREAM.md](docs/UPSTREAM.md) for the imported commit and sync notes.

## Conventions for new agents

Read [AGENTS.md](AGENTS.md) first. It documents the engine-strict toolchain, the production deploy boundary, the Cypress E2E safety rules, the branding audit gate, and the SDD-ledger evidence convention.
