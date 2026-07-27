# Tide-Bot

Tide-Bot is the private, branded Open WebUI fork for Changing Tides Treatment Center, served from `tide-bot.com` (hosted via Cloudflare). Ted-Bot (the black goldendoodle) is the product mascot and is integrated into the Tide-Bot login identity.

## What this repo is

A self-hosted AI workspace with:

- The full [Open WebUI](https://github.com/open-webui/open-webui) application source (SvelteKit frontend + FastAPI backend)
- Tide-Bot visual identity, server defaults, primary browser chrome, PWA metadata, and supplied visual assets
- The **Ted-Bot native companion**: a two-window desktop app that pairs the main Tide-Bot session with a compact floating companion window
- A reproducible Windows desktop build pipeline (GitHub Actions)
- A Docker Compose stack for self-hosting (`deploy/tide-stack/`)
- An isolated Cypress E2E harness for the companion feature
- A Hatch Pet v2 sprite mascot (Ted-Bot), generated and validated as a Codex v2 pet package

## Companion feature

The companion is a small always-on-top window that follows the active conversation in the main Tide-Bot window. You can drag it to a second monitor, close the main window without losing the companion, and quickly reopen the main window from the companion's "Open Tide-Bot" button.

Two surfaces:

| Surface | Where | What |
|---|---|---|
| **Browser** | `https://tide-bot.com/companion` (any browser) | The companion rendered as a SvelteKit route. No install. |
| **Native desktop** | `tide-bot.exe` (Windows) / `tide-bot.app` (macOS, from local build) | Tauri 2 shell that bundles Tide-Bot into a real desktop app with two OS windows. |

The desktop build is the production-shipped path. The browser path is a development convenience and works the same way.

## Quick start

### 1. Get the source

```sh
git clone https://github.com/kolbick/Tide-Bot.git
cd Tide-Bot
```

### 2. Install the toolchain

The project is engine-strict. You need **exactly** these versions:

- **Node.js 22.18.0** and **npm 10.9.3** — the shell default Node 25 violates `package.json` engines and is rejected. Download from <https://nodejs.org/dist/v22.18.0/> or use the included local copy at `~/opt/node-22.18.0` on the build machine.
- **Python 3.11 or 3.12** (`requires-python >=3.11, <3.13.0a1`)
- **Rust 1.77+** (for the desktop build)
- **Docker** (for the deploy stack and the Cypress E2E harness)
- **Visual Studio Build Tools** with the C++ workload (Windows, for the desktop build)
- **Xcode Command Line Tools** (macOS, for the desktop build)

Provision Node 22 on macOS:

```sh
curl -fsSL https://nodejs.org/dist/v22.18.0/node-v22.18.0-darwin-x64.tar.gz \
  | tar -xz -C ~/opt
export PATH="$HOME/opt/node-22.18.0/bin:$PATH"
```

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

### 5. Build the desktop companion

The desktop build is non-trivial because it embeds a single production origin at compile time. The full procedure is in `desktop/tide-bot/README.md`. Short version:

1. Set the repository variable `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tide-bot.com` in GitHub repo settings (Settings → Secrets and variables → Actions → Variables).
2. Trigger `.github/workflows/ted-bot-windows.yml` from the Actions tab.
3. Download the resulting `ted-bot-windows-artifact`.
4. Run `tide-bot.exe` on a Windows box.

Local cross-compile from macOS is possible but the result is unsigned and not testable from a Mac.

## Repository layout

```
.
├── src/                              # SvelteKit frontend
│   ├── routes/(app)/companion/       # The /companion route
│   ├── lib/ted-bot/                  # Companion presence primitives
│   ├── lib/components/ted-bot/       # CompanionPanel, MainPresencePublisher, TedBotPet
│   └── lib/components/chat/          # Canonical chat surface (incl. surface='companion' branch)
├── backend/open_webui/               # FastAPI backend
│   ├── socket/companion_presence.py  # Presence service + stores
│   └── socket/main.py                # Socket.IO handlers + companion events
├── desktop/tide-bot/                 # Tauri 2 desktop shell
│   ├── scripts/build-desktop.mjs     # Only supported Tauri entry point
│   ├── scripts/desktop-origins.mjs   # Resolver + provenance writer
│   └── src-tauri/                    # Rust + Tauri config
├── deploy/tide-stack/                # Docker Compose overlays
│   ├── docker-compose.yml            # Base stack (port 3102)
│   ├── docker-compose.production.yml # Production overlay
│   └── docker-compose.cypress-companion.yml  # Isolated E2E stack
├── cypress/e2e/ted-bot-companion.cy.ts  # Companion smoke spec
├── scripts/                          # Operational Node + .mjs runners
│   ├── run-companion-cypress.mjs     # Hermetic isolated E2E runner
│   └── audit-branding.mjs            # Branding gate
├── docs/                             # Build/plan/hand-off documents
└── .github/workflows/ted-bot-windows.yml  # Windows desktop build CI
```

## What's done

- **Tasks 1–5a** (companion feature): socket presence, compact chat surface, abort delegation, isolated Cypress E2E acceptance — committed and pushed to `agent/ted-bot-native-companion`.
- **Task 6** (Tauri desktop shell): `desktop/tide-bot/`, capability/provenance, Windows-targeted build — implemented, debug-built on macOS, **Windows release artifact produced and downloaded** at run [30295334507](https://github.com/kolbick/Tide-Bot/actions/runs/30295334507). Binary SHA-256: `81a99f69ce83cf1a31a445dee305e3b9ca7c01f2fcb61b380fb88435345f5579`.
- **Task 7** (native action + release acceptance): `openMainWindow()` Tauri invoke bridge, Windows workflow, branded release documentation — implemented, vitest 6/6, Cargo integration tests 15/15, branding audit passes, `git diff --check` clean.

## What is still pending

These are external gates that no one in this repo can run from a terminal — they require a real Windows box, the live production site, or the Hatch Pet v2 QA pipeline:

- **Manual Windows artifact acceptance.** Someone needs to run the `.exe` on Windows and exercise sign-in, main-window hide, companion typing, active-chat sync, tray menu, sign-out, lock/unlock.
- **Real Tauri macOS runtime acceptance** (separate from debug compilation).
- **Fresh Hatch Pet v2 visual/runtime acceptance** from the actual Tauri app via the required direction-evidence pipeline.

Until those happen, desktop release acceptance is *implementation-complete, not yet acceptance-passed*. See `docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md` for the full evidence record.

## Security and origin policy

- The desktop build is **bound to a single production origin at compile time** (set via the `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` repository variable). The `.exe` cannot be redirected to another origin at runtime. Raw `TIDE_BOT_URL` overrides are rejected by the build launcher.
- The companion window is the **only** webview with a permission: a single `allow-show-main-window` command. No filesystem, shell, process, credential, arbitrary-navigation, eval, or `core:default` permissions are granted.
- The Windows artifact is **unsigned**. Signing and distribution are a release-owner responsibility.
- The Cloudflare-hosted `tide-bot.com` deployment must serve the upgraded companion backend (`/companion` route + `/api/v1/companion-presence` Socket.IO events) for the desktop app's companion to function.

## Documents

- [Build specification](docs/BUILD_SPECIFICATION.md) — authoritative product brief
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) — active roadmap
- [Tide-Bot product handoff](docs/TIDE_BOT_HANDOFF.md) — operational handbook
- [Ted-Bot native companion handoff — 2026-07-27](docs/TED_BOT_NATIVE_COMPANION_HANDOFF_2026-07-27.md) — most recent session record
- [Acceptance evidence](docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md) — what passed and what is still pending
- [Branding guide](docs/BRANDING.md) — identity rules
- [Upstream baseline](docs/UPSTREAM.md) — Open WebUI commit pin
- [Security](docs/SECURITY.md) — security and origin policy

## Upstream and licensing

Tide-Bot is derived from [Open WebUI](https://github.com/open-webui/open-webui). Required upstream license files and notices remain in the repository. See [UPSTREAM.md](docs/UPSTREAM.md) for the imported commit and sync notes.

## Conventions for new agents

Read [AGENTS.md](AGENTS.md) first. It documents the engine-strict toolchain, the production deploy boundary, the Cypress E2E safety rules, the branding audit gate, and the SDD-ledger evidence convention.
