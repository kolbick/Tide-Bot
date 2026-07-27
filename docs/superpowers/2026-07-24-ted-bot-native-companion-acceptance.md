# Ted-Bot native companion acceptance

## Scope

This record covers the Tasks 6 and 7 Tauri desktop shell, native action wiring, and Windows release pipeline. It records the evidence currently available in this worktree. It does **not** claim full production release acceptance — manual Windows artifact acceptance and fresh Hatch Pet v2 visual/runtime acceptance from the actual Tauri app are still external/pending. Tide-Bot remains the authenticated product and Ted-Bot remains its companion.

## Observed evidence

### Native action and companion panel (Task 7)

| Command | Result |
| --- | --- |
| `npx vitest run src/lib/ted-bot/openMainWindow.test.ts src/lib/components/ted-bot/CompanionPanel.test.ts` under Node 22.18.0/npm 10.9.3 | 6 tests passed; native Tauri invokes `show_main_window`, browser/SSR falls back to `navigate('/')`, the companion exposes a labelled action |
| `npx vitest run src/lib/components/ted-bot/CompanionPanel.test.ts` | source-contract test locks no-duplicate-APIs + Chat reuse |

The native action uses the Tauri runtime marker only when present and imports the Tauri invoke bridge lazily. Browser and SSR callers never require the Tauri package or a browser-global `window`.

### Tauri generated checks (Task 6)

| Command | Result |
| --- | --- |
| `cd desktop/tide-bot && TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tidebot.example TIDE_BOT_DESKTOP_DEV_ORIGIN=http://127.0.0.1:5173 npm run test:tauri:generated` | 15 Cargo integration tests passed (3 capabilities, 8 companion URL, 4 placement) |
| `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tidebot.example npm run build:debug` | Tauri debug compilation passed on macOS; not Windows acceptance |
| `unset TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN && node desktop/tide-bot/scripts/desktop-origins.mjs print-remote-urls` | rejected with `desktop-origins: TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN is required and must be an https origin` (exit 1) |
| `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tidebot.example TIDE_BOT_URL=https://evil.example node desktop/tide-bot/scripts/build-desktop.mjs test-tauri-generated` | rejected with `build-desktop: TIDE_BOT_URL is a forbidden runtime origin override` (exit 1) |

### Capability scope

The generated `companion.json` and `companion.toml` tests confirm:

- The companion window is the only webview granted a permission
- Exactly one custom command is registered: `show_main_window`
- The exact permission is `allow-show-main-window`
- No filesystem, shell, process, credential, arbitrary-navigation, eval, or `core:default` webview grants
- The Tray menu (Show Tide-Bot, Show or Hide Ted-Bot, Always on Top, Sign Out, Quit) and window-close lifecycle are implemented in native Rust and are not webview permissions

### Windows release artifact (Task 7)

| Field | Value |
| --- | --- |
| Workflow file | `.github/workflows/ted-bot-windows.yml` |
| Workflow run | [30295334507](https://github.com/kolbick/Tide-Bot/actions/runs/30295334507) |
| Trigger | `workflow_dispatch` (manual) |
| Workflow SHA | `ff9a4f303f048112494d79c3f4fae903f19b5a9b` |
| Build duration | 14m 40s |
| Runner | `windows-latest`, Node 22.18.0, Rust stable + MSVC host triple |
| Production origin embedded | `https://tide-bot.com` (length 20) |
| Dev origin | unset (release build) |
| Generation nonce | `4e1c3651d365ff8e50ee4c840c68abfae3da975f7b3536d08e1e418f72914308` |
| Capability SHA-256 | `79e9fd0ee4f0a2906f1c1a49600a7e9df345d830ad70102e75e1a613c2847d53` |
| Provenance SHA-256 | `1edf611e151b5eebcc1a625a32fd9c540b03c98710466e27ecd93105006bb07e` |
| Binary name | `tide-bot.exe` (and `tide_bot.exe`, identical content) |
| Binary size | 101,559,808 bytes (101 MB) |
| Binary type | `PE32+ executable (GUI) x86-64, for MS Windows` |
| Binary SHA-256 | `81a99f69ce83cf1a31a445dee305e3b9ca7c01f2fcb61b380fb88435345f5579` |
| Artifact | `ted-bot-windows-artifact` (197 MB compressed, 14 days retention) |

### CI-side evidence (Task 7)

| Command | Result |
| --- | --- |
| `node --test scripts/validate-ted-bot-windows-workflow.test.mjs` | 9 tests passed; workflow structure (Node pin, npm ci, cargo cache, origin consumption, artifact upload, build ordering) is consistent with the desktop launcher |

### Branding and quality gates

| Command | Result |
| --- | --- |
| `npm run audit:branding` | `Tide-Bot brand audit passed.` |
| `git diff --check` | clean |
| `node --check scripts/build-desktop.mjs && node --check scripts/desktop-origins.mjs` | passed on every CI run |

## Required release evidence (still pending)

The following external gates have **not** been completed and must happen before a release claim can be made:

- **Manual Windows artifact acceptance.** Download `tide-bot.exe`, install on Windows, and record: sign-in, main-window minimize/hide, typed companion chat, active-chat sync, denied chat confirmation behavior, disconnect/reconnect, sign-out, OS lock/unlock, tray actions (Show Tide-Bot, Show or Hide Ted-Bot, Always on Top, Sign Out, Quit), keyboard navigation, reduced motion, and uninstall. Record OS build and binary checksum. The binary is unsigned, so SmartScreen warnings are expected.
- **Real Tauri macOS runtime acceptance** separately from the debug compilation: sign-in, minimized main window, typed chat, active-chat sync, sign-out, lock behavior, tray actions, keyboard navigation, reduced motion, and uninstall.
- **Fresh Hatch Pet v2 visual/runtime acceptance** from the actual Tauri app, including the required direction-evidence pipeline and current atlas hash. Browser or local macOS-only evidence does not replace this gate.

## Build fixes landed in this session

The following were discovered and fixed during the first successful Windows build (run 30295334507). They are necessary context for understanding the current state.

1. **Committed `desktop/tide-bot/package-lock.json`** (commit `705e28942`). The Windows workflow uses `npm ci` for reproducible installs, but the lockfile was not tracked. Without it, `npm ci` fails immediately on a fresh checkout.
2. **Added `scripts/validate-ted-bot-windows-workflow.test.mjs`** (commit `705e28942`). A 9-test Node `--test` wrapper that asserts the tracked `ted-bot-windows.yml` workflow stays consistent with the desktop launcher.
3. **Made `desktop/tide-bot/scripts/build-desktop.mjs` cargo lookup Windows-aware** (commit `88e8ba2c6`). The launcher originally only checked POSIX cargo paths and only honored `HOME`. Added `USERPROFILE` fallback, `.exe` extension, `CARGO_HOME` support, and PATH-walk fallback for the GitHub Actions runner.
4. **Replaced `desktop/tide-bot/src-tauri/icons/icon.ico`** (commit `b0c13d535`). The previous `icon.ico` was a PNG renamed to `.ico` and was gitignored, so the build failed with `icons/icon.ico not found; required for generating a Windows Resource file during tauri-build`. Generated a real 7-size multi-resolution ICO container (16, 24, 32, 48, 64, 128, 256) from `128x128@2x.png` and un-ignored the file.
5. **Added frontend-build steps to the workflow** (commit `d91f15faa`). The Tauri shell embeds the SvelteKit build output via `frontendDist: ../../../build`. The previous workflow went straight from `npm ci` on `desktop/tide-bot` to `npm run build:windows`, leaving the `build/` directory empty and causing tauri to panic with `frontendDist is set to ../../../build but this path doesn't exist`. Added two steps before the tauri build: `npm ci` at the repo root and `npm run build` (which runs `pyodide:fetch` + `vite build` to populate `build/`).
6. **Externalized `@tauri-apps/api/*` in `vite.config.ts`** (commit `c66bad522`). `CompanionPanel.svelte` dynamically imports `@tauri-apps/api/core` to call the native `show_main_window` command. The dynamic import is gated behind a `window.__TAURI_INTERNALS__` guard, so it never runs in a normal browser — but Rollup still tried to resolve the import at build time, and the module was not installed in the SvelteKit project's `node_modules`. Marking it external in `build.rollupOptions.external` leaves it as a real runtime import (resolved by the Tauri webview, unresolved in a regular browser where the guard prevents the closure from running).

## Safety boundaries

- The desktop workflow receives origins through non-secret repository variables; origins are never source constants or secrets.
- Generated capability and provenance files are regenerated per build and are **not** committed (`/src-tauri/capabilities/companion.json` and `/src-tauri/generated/` are in `desktop/tide-bot/.gitignore`).
- The workflow uploads an unsigned artifact; signing and distribution remain a release-owner responsibility.
- No production database, user credential, token, or local Docker state is included in this evidence.
- The Windows artifact cannot be redirected to a different origin at runtime — the production URL is embedded in the binary at compile time and the capability file is read-only.
- The Cloudflare-hosted `tide-bot.com` deployment must serve the upgraded companion backend (the `/companion` route and the companion Socket.IO events) for the desktop app's companion to function. As of 2026-07-27 the production origin is provisioned as `https://tide-bot.com`; the upstream `https://tide-bot.com` deployment must be updated to the current `agent/ted-bot-native-companion` branch for the companion to work end-to-end.

## Reproducing the evidence

```sh
export PATH="$HOME/opt/node-22.18.0/bin:$PATH"

# Native action and panel
npx vitest run src/lib/ted-bot/openMainWindow.test.ts \
                src/lib/components/ted-bot/CompanionPanel.test.ts

# Tauri integration tests
cd desktop/tide-bot
TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tidebot.example \
  TIDE_BOT_DESKTOP_DEV_ORIGIN=http://127.0.0.1:5173 \
  npm run test:tauri:generated

# Workflow structure
node --test scripts/validate-ted-bot-windows-workflow.test.mjs

# Branding audit
npm run audit:branding

# Whitespace
git diff --check
```

To trigger a Windows build:

1. Ensure `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` is provisioned in the repo's Actions variables.
2. Go to the Actions tab, select `ted-bot-windows`, click "Run workflow".
3. Download the resulting `ted-bot-windows-artifact`.

Until manual Windows + macOS Tauri runtime acceptance and fresh Hatch Pet v2 visual evidence exist, desktop release acceptance is **implementation-complete, not yet acceptance-passed**.
