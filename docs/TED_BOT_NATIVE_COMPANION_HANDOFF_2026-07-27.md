# Ted-Bot native companion handoff — 2026-07-27

Supersedes `docs/TED_BOT_NATIVE_COMPANION_HANDOFF_2026-07-25.md`. Read that document first for full feature context (Tasks 1–5a, the original Task 5a intent, the historical blockers found on 2026-07-25), then this one for the current state.

## Snapshot

- Worktree: `/Users/kolbyunderwood/Desktop/Projects/.worktrees/ted-bot-native-companion`
- Branch: `agent/ted-bot-native-companion`
- Pushed HEAD on `origin/agent/ted-bot-native-companion`: `c66bad522 fix(build): externalize @tauri-apps/api in vite rollup config`
- Companion branch is **5 commits ahead** of the merge-base of `origin/main` (after this session).
- `origin/main` is at `ff9a4f303f048112494d79c3f4fae903f19b5a9b` after this session's merges.
- Plan: `docs/superpowers/plans/2026-07-24-ted-bot-native-companion.md`
- SDD ledger: `.superpowers/sdd/2026-07-24-ted-bot-native-companion/progress.md`
- Updated this session to record the follow-up + Windows build fixes
- No new tasks beyond Task 7; all plan tasks are now implementation-complete.

## Status

| Area | State | Evidence |
| --- | --- | --- |
| Tasks 1–5a (companion feature) | merged, reviewed, accepted | on `main` since `34657da57` |
| Task 6 (Tauri shell) | implemented, debug-built on macOS, **Windows release artifact produced** | run [30295334507](https://github.com/kolbick/Tide-Bot/actions/runs/30295334507), `tide-bot.exe` SHA-256 `81a99f69...` |
| Task 7 (native action + workflow + docs) | implemented, vitest 6/6, branding audit clean | on `main` since `9fcce48b9` + this session's follow-up |
| Manual Windows artifact acceptance | **pending** | requires human on Windows |
| Real Tauri macOS runtime acceptance | **pending** | requires human on macOS |
| Fresh Hatch Pet v2 visual acceptance from actual Tauri app | **pending** | requires the Hatch Pet direction-evidence pipeline |

## What this session actually accomplished

This session was a continuation from a handoff that left the build unverified against the live GitHub Actions runner. The task was: trigger the Windows workflow, observe what breaks, fix the breakage, and land a real `.exe` on `origin/main`.

### Six commits, all on `agent/ted-bot-native-companion` and merged to `main`

1. **`705e28942` — `ci(ted-bot): commit desktop package-lock and add workflow validator`**
   Generated `desktop/tide-bot/package-lock.json` under Node 22.18.0 so `npm ci` works on a fresh checkout. Added `scripts/validate-ted-bot-windows-workflow.test.mjs` (Node `--test`) asserting the tracked workflow stays consistent with the desktop launcher. 6/6 vitest + 8/8 workflow validator green on the new HEAD.

2. **`88e8ba2c6` — `fix(desktop): make build-desktop.mjs cargo lookup Windows-aware`**
   The build launcher only checked POSIX cargo paths and only honored `HOME`. On Windows, cargo lives at `%USERPROFILE%\.cargo\bin\cargo.exe`, the rustup installer uses `USERPROFILE` not `HOME`, and the GitHub Actions runner doesn't necessarily place cargo at any of the hard-coded locations. Added `USERPROFILE`, `.exe` extension, `CARGO_HOME`, and PATH-walk fallback. Mac Tauri tests (15/15) re-run clean.

3. **`b0c13d535` — `fix(desktop): track a real multi-size icon.ico for Windows builds`**
   Tauri Windows build requires `icons/icon.ico` to embed in the `.exe` resource. The previous `icon.ico` was a PNG renamed to `.ico` and was gitignored. Generated a real 7-size multi-resolution ICO container (16, 24, 32, 48, 64, 128, 256) from `128x128@2x.png` using Pillow, and un-ignored it.

4. **`d91f15faa` — `ci(ted-bot-windows): build the SvelteKit frontend before tauri build`**
   The Tauri shell embeds the SvelteKit build output via `frontendDist: ../../../build`. The previous workflow went straight from `npm ci` on `desktop/tide-bot` to `npm run build:windows`, leaving the `build/` directory empty and causing tauri to panic with `frontendDist is set to ../../../build but this path doesn't exist`. Added two steps: `npm ci` at the repo root and `npm run build`. Updated the workflow validator to assert the order.

5. **`c66bad522` — `fix(build): externalize @tauri-apps/api in vite rollup config`**
   `CompanionPanel.svelte` dynamically imports `@tauri-apps/api/core` to call the native `show_main_window` command. The dynamic import is gated behind a `window.__TAURI_INTERNALS__` guard, so it never runs in a normal browser — but Rollup still tried to resolve the import at build time, and the module was not installed in the SvelteKit project's `node_modules`. Marked it external in `build.rollupOptions.external` so Rollup leaves it as a real runtime import. Verified with a clean `npm run build` under Node 22.18.0.

### The final Windows build that succeeded

Run [30295334507](https://github.com/kolbick/Tide-Bot/actions/runs/30295334507). Triggered by manual `workflow_dispatch` after the user provisioned the `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tide-bot.com` repository variable. Built in 14m 40s on `windows-latest`. All 12 steps green, no errors, no warnings except the inherited Node 20 deprecation notice on the `actions/*` packages themselves (out of scope).

Resulting artifact: `ted-bot-windows-artifact` #8664790781, 197 MB, 14 days retention. Contains:

- `tide-bot.exe` — 101 MB PE32+ x86-64 GUI binary, SHA-256 `81a99f69ce83cf1a31a445dee305e3b9ca7c01f2fcb61b380fb88435345f5579`
- `tide_bot.exe` — identical content (101 MB), SHA-256 `81a99f69ce83cf1a31a445dee305e3b9ca7c01f2fcb61b380fb88435345f5579`
- `companion.json` — generated capability, scope = `["companion"]` window, permissions = `["allow-show-main-window"]`, remote URLs = `["https://tide-bot.com"]`
- `desktop-origin-provenance.json` — schema `tide-bot-desktop-origins/v1`, with all the expected digests and a fresh generation nonce
- `ted-bot-windows-metadata.json` — workflow run ID, SHA, nonce, capability/provenance SHA-256, per-binary checksums
- `ted-bot-windows.sha256` — combined checksum file

The full build evidence is in `docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md`.

## Why each fix was needed (in execution order)

The five fixes happened in a chain, each one discovered by reading the failure log of the previous build:

| Build run | Failed at | Root cause | Fix |
| --- | --- | --- | --- |
| 30293226763 | `Install desktop node dependencies` | `npm ci` requires a lockfile; `desktop/tide-bot/package-lock.json` was untracked | `705e28942` |
| 30293376521 | `Build Windows artifact` | `findCargo()` only knew POSIX paths; no `cargo` on Windows PATH | `88e8ba2c6` |
| 30293597749 | `Build Windows artifact` | `icon.ico` was a PNG renamed to `.ico` and gitignored; tauri-build needs a real ICO | `b0c13d535` |
| 30294075825 | `Build Windows artifact` | `build/` was empty; tauri panicked on `frontendDist = "../../../build"` | `d91f15faa` |
| 30294595268 | `Build frontend` | Rollup could not resolve `@tauri-apps/api/core` (not in root `node_modules`) | `c66bad522` |
| **30295334507** | **success** | n/a | n/a |

## Why this took five build runs

A fresh Tauri target takes ~5–7 minutes to compile from scratch (Cargo downloads + builds ~250 crates). The first build attempt is always the slowest because there's no cache. The total wall-clock time for this session was dominated by waiting for the GitHub Actions runner.

The local macOS debug build (`npm run build:debug` on this Mac) passed in earlier sessions because the Tauri source compiles fine on macOS — none of the five fixes above were caught locally. They were all Windows-specific or build-pipeline-specific and only surfaced when the actual Windows runner tried the build. This is the classic "test in the environment you'll ship to" problem.

## Documents updated this session

- `README.md` — refreshed to reflect Tauri + companion feature being implementation-complete, added Quick Start section
- `AGENTS.md` — refreshed task status (Tasks 1–7 done), added Tauri shell conventions, added Cloudflare production context, added the 6 commits to the operational guardrails
- `docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md` — full evidence record including the Windows run, digests, the 5 build fixes, and the explicit list of remaining external gates
- `docs/TED_BOT_NATIVE_COMPANION_HANDOFF_2026-07-27.md` — this file

## Environment notes for the next agent

- **Node 22.18.0 is the only acceptable Node version** for any acceptance evidence in this repo. The shell-default Node 25 is engine-rejected. The previous handoff described the issue; this session confirmed it. Provision with:
  ```sh
  curl -fsSL https://nodejs.org/dist/v22.18.0/node-v22.18.0-darwin-x64.tar.gz | tar -xz -C ~/opt
  export PATH="$HOME/opt/node-22.18.0/bin:$PATH"
  ```
  No nvm/fnm/volta on this Mac. A copy lives at `~/opt/node-22.18.0` on the build machine.
- **The `tide-bot-pet/` and `teddy-v2-upgrade/` directories are untracked and must stay that way** unless the user explicitly authorizes a change. They contain the Hatch Pet v2 work-in-progress and are not part of the Tide-Bot build.
- **The local `tide-bot` Docker stack on `localhost:3102` is a dev/test instance**, not production. `tide-bot.com` (Cloudflare) is the production deployment and is a separate machine.
- **Do not commit generated Tauri artifacts.** `desktop/tide-bot/src-tauri/capabilities/companion.json` and `desktop/tide-bot/src-tauri/generated/desktop-origin-provenance.json` are gitignored and are regenerated by `desktop-origins.mjs` per build. A stale checked-in copy will fail Cargo's digest verification in `build.rs`.
- **Do not invoke `cargo` or `tauri` directly.** `desktop/tide-bot/scripts/build-desktop.mjs` is the only supported Tauri/cargo entry point. It owns the resolver → cargo ordering, the env rejection list, and the cargo-path lookup.
- **The Windows build workflow requires the `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` repository variable.** It is set to `https://tide-bot.com` for release builds. It is non-secret. Do not write it into source or commit history.
- **The `desktop/tide-bot/package-lock.json` is now tracked.** Do not regenerate it casually; the workflow relies on `npm ci` for reproducible installs. If you add or change desktop dependencies, regenerate it under Node 22.18.0 and commit the result.

## Reproducing the Windows build

1. Ensure `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` is set in GitHub repo Settings → Secrets and variables → Actions → Variables. (Current value: `https://tide-bot.com`.)
2. Ensure `main` has the current `desktop/tide-bot/` and `.github/workflows/ted-bot-windows.yml` state. (The five fix commits are on `main` as of `ff9a4f303f048112494d79c3f4fae903f19b5a9b`.)
3. Go to the Actions tab on GitHub → `ted-bot-windows` → Run workflow → Run.
4. Wait ~15 minutes. Download the `ted-bot-windows-artifact` from the run page.
5. On a Windows box, unzip the artifact, double-click `tide-bot.exe`, and exercise the acceptance scenarios listed in the acceptance doc.

## Recommended next steps

1. **Download the Windows artifact and run it.** Use a non-production test account. Walk through the tray menu, the companion follow behavior, the main-window hide/show, the sign-out flow, and the lock/unlock behavior. Record what works and what doesn't.
2. **Run the actual Tauri macOS app** (a real `cargo tauri dev` or local `.app` build) and record the same set of behaviors.
3. **Run the Hatch Pet v2 visual evidence pipeline** (the `verify-ted-bot-direction-evidence.test.mjs` script) from the actual Tauri app, not just the browser. This is the last external gate.
4. **Do not open a PR** unless explicitly requested. The handoff context explicitly forbade PRs; respect that. The PR URL would be `https://github.com/kolbick/Tide-Bot/pull/new/agent/ted-bot-native-companion` if/when the user wants one.
5. **Consider the optional follow-up to improve Cypress failure redaction diagnostics** — this was explicitly not a gate. The current redaction is too aggressive to make failures actionable; a structured summary with test titles and pass/fail counts but no request bodies would be better.
6. **Independent code review for the cumulative Task 6/7 diff.** Two delegated review workers were cancelled without returning findings. This remains a quality-assurance gap if the user wants one.

The implementation is done. The remaining work is human acceptance evidence: real Windows manual run, real Tauri macOS run, real Hatch Pet v2 visual evidence from the actual Tauri app.
