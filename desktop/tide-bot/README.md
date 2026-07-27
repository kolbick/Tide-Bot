# Tide-Bot desktop companion shell

Tauri 2 shell for the Tide-Bot native companion. The shell hosts:

- a **main** window that renders Tide-Bot directly via the existing SvelteKit build (`../../build`), and
- a **companion** window (380×520, always-on-top, no decorations) that renders Tide-Bot's `/companion` route.

The companion window is the **only** webview granted a permission. The single exposed command is `show_main_window`. No filesystem, shell, process, credential, arbitrary-navigation, eval, or `core:default` webview permission is granted. Tray controls (Show Tide-Bot, Show or Hide Ted-Bot, Always on Top, Sign Out, Quit) and window-close lifecycle are implemented in native Rust and are not webview permissions.

The companion's **Open Tide-Bot** control calls the native `show_main_window` command only inside Tauri. In a browser or during SSR it falls back to navigating to `/`; no Tauri bridge is required for browser use.

## Production origin (Cloudflare)

`tide-bot.com` is served via Cloudflare. The desktop build is bound to this origin at compile time. The full URL is provisioned per-build through the non-secret repository variable `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` (Settings → Secrets and variables → Actions → Variables). It is never a secret and is never written to source.

```text
TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN = https://tide-bot.com
```

When the user builds a real artifact, this is the value the binary embeds. The companion route is served by the same origin — no additional Cloudflare configuration is needed for the companion to function, **as long as the Cloudflare origin is running the upgraded companion backend** (the `agent/ted-bot-native-companion` branch's code). Without that, the companion window opens to a 404 or to the un-upgraded chat surface.

## Release evidence

The Windows workflow is `.github/workflows/ted-bot-windows.yml`. It accepts manual dispatch and pushes to protected `release/**` branches. It pins Node 22.18.0, Rust stable with the MSVC default host triple, runs `npm run build` at the repo root before the tauri build (so `build/` is populated for `frontendDist`), forwards `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` (and the optional dev origin) to `desktop/tide-bot`'s `npm run build:windows`, and uploads an unsigned `tide-bot-windows-artifact` containing the binaries, a SHA-256 checksum file, the generated capability + provenance JSON, and a `ted-bot-windows-metadata.json` summary.

### Latest successful build (2026-07-27)

| Field | Value |
| --- | --- |
| Workflow run | [30295334507](https://github.com/kolbick/Tide-Bot/actions/runs/30295334507) |
| Build duration | 14m 40s |
| Workflow SHA | `ff9a4f303f048112494d79c3f4fae903f19b5a9b` |
| Production origin | `https://tide-bot.com` |
| Binary | `tide-bot.exe` (and `tide_bot.exe`), 101 MB, PE32+ x86-64 GUI |
| Binary SHA-256 | `81a99f69ce83cf1a31a445dee305e3b9ca7c01f2fcb61b380fb88435345f5579` |
| Capability SHA-256 | `79e9fd0ee4f0a2906f1c1a49600a7e9df345d830ad70102e75e1a613c2847d53` |
| Provenance SHA-256 | `1edf611e151b5eebcc1a625a32fd9c540b03c98710466e27ecd93105006bb07e` |
| Generation nonce | `4e1c3651d365ff8e50ee4c840c68abfae3da975f7b3536d08e1e418f72914308` |
| Artifact | `ted-bot-windows-artifact` #8664790781 (197 MB, 14 days retention) |

### What's still required for full release acceptance

A local macOS debug build is **not** Windows acceptance. The unprovisioned real production origin (now provisioned as `https://tide-bot.com`), the downloaded Windows artifact's manual install / sign-in / minimize / lock / tray / sign-out results, and a fresh actual-Tauri Hatch Pet v2 visual/runtime acceptance are external/pending and are tracked in `docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md`.

## Required inputs

| Environment variable | Required | Notes |
| --- | --- | --- |
| `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` | yes (release) | Absolute canonical `https://` URL, no query, fragment, credentials, wildcard, or path. For Tide-Bot this is `https://tide-bot.com` (Cloudflare). |
| `TIDE_BOT_DESKTOP_DEV_ORIGIN` | no | Absolute `http://` URL; host must be `127.0.0.1`, `localhost`, or `::1`, no query, fragment, credentials, wildcard, or path. Only used when an intentionally-loopback dev artifact is built. |
| `TIDE_BOT_DESKTOP_GENERATION_NONCE` | yes (build only) | Set automatically by `scripts/build-desktop.mjs`; never override manually. |

Raw runtime overrides are rejected by `build-desktop.mjs`. The full rejection list: `TIDE_BOT_URL`, `TIDE_BOT_REMOTE_URL`, `TIDE_BOT_COMPANION_URL`, `TIDE_BOT_APP_URL`, `TIDE_BOT_REMOTE`, `TIDE_BOT_COMPANION_ORIGIN`, `TAURI_REMOTE_URL`. The compiled URL never depends on them.

## Building the Windows artifact

### Recommended: via GitHub Actions

1. Set `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tide-bot.com` in **Settings → Secrets and variables → Actions → Variables** (non-secret).
2. Trigger the workflow: **Actions → ted-bot-windows → Run workflow → Run**.
3. Wait ~15 minutes.
4. Download `ted-bot-windows-artifact` from the run page.
5. Unzip on a Windows box and run `tide-bot.exe`.

### Local cross-compile from macOS (not recommended)

Possible but produces an unsigned, untestable binary. Requires:

- Node 22.18.0 on PATH
- Rustup with the `x86_64-pc-windows-gnu` target (the GNU host, not MSVC; MSVC is unavailable on macOS)
- MinGW-w64 toolchain
- A long first compile (~15 min) and an unsigned result

The Windows runner in GitHub Actions is faster, has the MSVC host triple, and produces the same output. Use CI for any release-bound build.

### Local debug build on macOS

For development and for running the Tauri generated tests:

```sh
export PATH="$HOME/opt/node-22.18.0/bin:$HOME/.cargo/bin:$PATH"
cd desktop/tide-bot
TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tidebot.example \
  TIDE_BOT_DESKTOP_DEV_ORIGIN=http://127.0.0.1:5173 \
  npm run test:tauri:generated
# 15 tests should pass

TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN=https://tidebot.example \
  npm run build:debug
# Tauri debug build runs in target/debug/
```

`https://tidebot.example` is **not** a real production deployment; it is a test-only value the resolver accepts. It must never be used as the actual production origin.

## Layout

```
desktop/tide-bot/
├── README.md
├── package.json                # Tauri CLI/API pins and entry-point scripts
├── package-lock.json           # tracked; required for `npm ci` reproducibility
├── .gitignore
├── scripts/
│   ├── build-desktop.mjs       # only launcher; runs the resolver + cargo
│   └── desktop-origins.mjs     # resolver + provenance writer
└── src-tauri/
    ├── Cargo.toml              # tauri = "2.1" + minimal crate-type list
    ├── Cargo.lock              # tracked; reproducible lockfile
    ├── build.rs                # provenance verification + tauri_build
    ├── tauri.conf.json         # app metadata, no fallback origin, frontendDist = ../../../build
    ├── templates/
    │   └── companion.capability.template.json   # tracked template
    ├── permissions/
    │   └── companion.toml      # [[permission]] allow-show-main-window
    ├── capabilities/
    │   └── companion.json      # GENERATED; ignored
    ├── generated/
    │   └── desktop-origin-provenance.json        # GENERATED; ignored
    ├── icons/
    │   ├── 32x32.png           # tracked
    │   ├── 128x128.png         # tracked
    │   ├── 128x128@2x.png      # tracked (source for icon.ico)
    │   ├── tray.png            # tracked
    │   └── icon.ico            # tracked (7-size multi-resolution ICO, generated from 128x128@2x.png)
    ├── tests/
    │   ├── placement_test.rs   # 4 tests
    │   ├── capabilities_test.rs  # 3 tests
    │   ├── companion_url_test.rs  # 8 tests
    │   └── fixtures/           # stale-nonce fixtures for rejection tests
    └── src/
        ├── main.rs
        ├── lib.rs              # public exports + run()
        ├── origin.rs           # configured_companion_url/parse_for_fixtures
        └── placement.rs        # clamp_to_monitor + persistence
```

## Scripts (via `npm run`)

| Command | Effect |
| --- | --- |
| `npm run test:tauri:generated` | Resolves capability + provenance fresh; runs the three Cargo integration tests. |
| `npm run build:debug` | Resolves capability + provenance fresh; runs `cargo build` to produce the debug bundle. |
| `npm run build:windows` | Resolves capability + provenance fresh; runs `cargo build --release --target x86_64-pc-windows-msvc` for the Windows artifact. |

Direct `cargo` and `tauri` invocations are not supported. The launcher owns the ordering: it always runs the resolver with the requested `--out-dir` so the generated `companion.json`/`desktop-origin-provenance.json` match the nonce that flows through to `build.rs`.

## How the URL is bound to the build

1. `build-desktop.mjs` calls `desktop-origins.mjs resolve --out-dir <repo root>`.
2. The resolver parses `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` (and optional `TIDE_BOT_DESKTOP_DEV_ORIGIN`), validates them (canonical host, no credentials/query/fragment/wildcard, loopback host only for dev), then writes:
   - `src-tauri/capabilities/companion.json`
   - `src-tauri/generated/desktop-origin-provenance.json`
3. The launcher reads back the freshly written provenance and exports its `generationNonce` as `TIDE_BOT_DESKTOP_GENERATION_NONCE` to cargo.
4. `build.rs` re-hashes the tracked resolver and template, compares the provenance `resolverSha256`/`templateSha256`/`capabilitySha256` to the freshly regenerated capability and the on-disk resolver, fails the build if any drift, otherwise emits the nonce, digests, and the canonical remote URL list back into the binary with `cargo:rustc-env`.
5. `origin::configured_companion_url()` reads the `include_str!`-embedded capability + provenance, re-verifies the compiled digests, validates the resolved remote list, and returns `production_origin/companion` (canonicalized). Any drift returns an error.

## Placement persistence

The companion saves monitor ID, x, y, and an expanded flag in a `dirs::config_local_dir()/Tide-Bot/companion-placement.json` file. No chat IDs, message content, tokens, or credentials are ever persisted. The companion window is clamped into the current monitor work area on launch via `clamp_to_monitor`.

## Toolchain notes

- **Node 22.18.0 / npm 10.9.3** (the `package.json` `engines.node` is pinned to this exact version).
- **Rust 1.77+** (matches `rust-version`); Tauri 2 prerequisites on macOS and Windows (Xcode CLT, Visual Studio Build Tools) per upstream docs.
- For Windows, the GitHub Actions runner uses `dtolnay/rust-toolchain@stable` with the `x86_64-pc-windows-msvc` target. Local Windows builds need Visual Studio Build Tools with the C++ workload.
- For macOS, the local `build:debug` script uses the default host triple; Tauri requires Xcode Command Line Tools.

## Failure modes seen during development

Five build failures occurred before the first successful Windows build. Each one was a distinct, fixable issue:

1. **`npm ci` requires a lockfile.** Tracked `desktop/tide-bot/package-lock.json` (commit `705e28942`).
2. **`findCargo()` couldn't locate cargo on Windows.** Added `USERPROFILE`, `.exe` extension, `CARGO_HOME`, and PATH-walk fallback (commit `88e8ba2c6`).
3. **`icon.ico` was a PNG renamed to `.ico` and was gitignored.** Generated a real 7-size multi-resolution ICO and un-ignored it (commit `b0c13d535`).
4. **`build/` was empty when tauri tried to read `frontendDist`.** Added `npm ci` and `npm run build` at the repo root as workflow steps before the tauri build (commit `d91f15faa`).
5. **Rollup could not resolve `@tauri-apps/api/core`.** Externalized `@tauri-apps/api/*` in `vite.config.ts` (commit `c66bad522`).

The full chain is documented in `docs/TED_BOT_NATIVE_COMPANION_HANDOFF_2026-07-27.md`.
