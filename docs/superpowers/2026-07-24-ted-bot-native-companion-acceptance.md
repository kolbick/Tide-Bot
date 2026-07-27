# Ted-Bot native companion acceptance

## Scope

This record covers the Task 7 native action wiring and the evidence currently
available in this worktree. It does not claim production release acceptance.
Tide-Bot remains the authenticated product and Ted-Bot remains its companion.

## Observed local evidence

| Area | Command or artifact | Result |
| --- | --- | --- |
| Native action | `npx vitest run src/lib/ted-bot/openMainWindow.test.ts src/lib/components/ted-bot/CompanionPanel.test.ts` under Node 22.18.0/npm 10.9.3 | 6 tests passed; native Tauri invokes `show_main_window`, browser/SSR falls back to `/`, and the companion exposes a labelled action |
| Tauri generated checks | `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tidebot.example TIDE_BOT_DESKTOP_DEV_ORIGIN=http://127.0.0.1:5173 npm run test:tauri:generated` | 15 Cargo integration tests passed; the origin is test-only, not a production deployment claim |
| macOS debug compilation | `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tidebot.example npm run build:debug` | Tauri debug compilation passed on macOS; this is not Windows acceptance |
| Capability scope | Generated `companion.json` and `companion.toml` tests | Companion window only; exactly `allow-show-main-window` / `show_main_window`; no broad webview grants |

The native action uses the Tauri runtime marker only when present and imports
the Tauri invoke bridge lazily. Browser and SSR callers never require the
Tauri package or a browser-global `window`.

## Required release evidence

The following remains **external/pending** and must be completed before a
release claim:

- Provision the real non-secret `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN`; no real
  production origin is recorded here.
- Run `.github/workflows/ted-bot-windows.yml` on `windows-latest` and record the
  workflow URL, commit SHA, artifact name, binary checksum, generated
  capability/provenance SHA-256 values, generation nonce, and parsed capability
  test result.
- Download the actual Windows artifact. On Windows, use a non-production test
  account and record sign-in, main-window minimize/hide, typed companion chat,
  active-chat sync, denied chat, confirmation behavior, disconnect/reconnect,
  sign-out, OS lock/unlock, tray actions, keyboard navigation, reduced motion,
  and uninstall with OS build and checksum.
- Run fresh Hatch Pet v2 visual/runtime acceptance from the actual Tauri app,
  including the required direction-evidence pipeline and current atlas hash.
  Browser or local macOS-only evidence does not replace this gate.
- Record macOS runtime checks from the actual Tauri app separately from the
  debug compilation: sign-in, minimized main window, typed chat, active-chat
  sync, sign-out, lock behavior, tray actions, keyboard navigation, reduced
  motion, and uninstall.

Until those artifacts and manual results exist, desktop release acceptance is
pending rather than passed.

## Safety boundaries

- The desktop workflow receives origins through non-secret repository variables;
  origins are never source constants or secrets.
- Generated capability and provenance files are regenerated per build and are
  not committed.
- The workflow uploads an unsigned artifact; signing and distribution remain a
  release-owner responsibility.
- No production database, user credential, token, or local Docker state is
  included in this evidence.
