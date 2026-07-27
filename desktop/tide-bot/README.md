# Tide-Bot desktop companion shell

Narrow Tauri 2 shell for the Tide-Bot companion. The shell hosts:

* a **main** window that renders Tide-Bot directly via the existing
  SvelteKit build (`../dist`), and
* a **companion** window (380×520, always-on-top, no decorations) that
  renders Tide-Bot's `/companion` route.

The companion window is the only webview granted a permission. The single
exposed command is `show_main_window`. No filesystem, shell, process,
credential, arbitrary-navigation, eval, or `core:default` webview permission
is granted. Tray controls (Show Tide-Bot, Show or Hide Ted-Bot, Always on
Top, Sign Out, Quit) and window-close lifecycle are implemented in native
Rust and are not webview permissions.

## Required inputs

| Environment variable | Required | Notes |
| --- | --- | --- |
| `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` | yes (release) | Absolute canonical `https://` URL, no query, fragment, credentials, wildcard, or path. |
| `TIDE_BOT_DESKTOP_DEV_ORIGIN` | no | Absolute `http://` URL; host must be `127.0.0.1`, `localhost`, or `::1`, no query, fragment, credentials, wildcard, or path. Only used when an intentionally-loopback dev artifact is built. |
| `TIDE_BOT_DESKTOP_GENERATION_NONCE` | yes (build only) | Set automatically by `scripts/build-desktop.mjs`; never override manually. |

Raw runtime `TIDE_BOT_URL` or similar overrides are rejected by
`build-desktop.mjs`; the compiled URL never depends on them.

## Layout

```
desktop/tide-bot/
├── README.md
├── package.json                # Tauri CLI/API pins and entry-point scripts
├── scripts/
│   ├── build-desktop.mjs       # only launcher; runs the resolver + cargo
│   └── desktop-origins.mjs     # resolver + provenance writer
└── src-tauri/
    ├── Cargo.toml              # tauri = "2.1" + minimal crate-type list
    ├── build.rs                # provenance verification + tauri_build
    ├── tauri.conf.json         # app metadata, no fallback origin
    ├── templates/
    │   └── companion.capability.template.json   # tracked template
    ├── permissions/
    │   └── companion.toml      # [[permission]] allow-show-main-window
    ├── capabilities/
    │   └── companion.json      # GENERATED; ignored
    ├── generated/
    │   └── desktop-origin-provenance.json        # GENERATED; ignored
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

Direct `cargo` and `tauri` invocations are not supported. The launcher owns the
ordering: it always runs the resolver with the requested `--out-dir` so the
generated `companion.json`/`desktop-origin-provenance.json` match the nonce
that flows through to `build.rs`.

## How the URL is bound to the build

1. `build-desktop.mjs` calls `desktop-origins.mjs resolve --out-dir <repo root>`.
2. The resolver parses `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN`
   (and optional `TIDE_BOT_DESKTOP_DEV_ORIGIN`), validates them
   (canonical host, no credentials/query/fragment/wildcard, loopback host
   only for dev), then writes:
   - `src-tauri/capabilities/companion.json`
   - `src-tauri/generated/desktop-origin-provenance.json`
3. The launcher reads back the freshly written provenance and exports its
   `generationNonce` as `TIDE_BOT_DESKTOP_GENERATION_NONCE` to cargo.
4. `build.rs` re-hashes the tracked resolver and template, compares the
   provenance `resolverSha256`/`templateSha256`/`capabilitySha256` to the
   freshly regenerated capability and the on-disk resolver, fails the build
   if any drift, otherwise emits the nonce, digests, and the canonical
   remote URL list back into the binary with `cargo:rustc-env`.
5. `origin::configured_companion_url()` reads the
   `include_str!`-embedded capability + provenance, re-verifies the
   compiled digests, validates the resolved remote list, and returns
   `production_origin/companion` (canonicalized). Any drift returns an
   error.

## Placement persistence

The companion saves monitor ID, x, y, and an expanded flag in a
`dirs::config_local_dir()/Tide-Bot/companion-placement.json` file. No chat
IDs, message content, tokens, or credentials are ever persisted. The
companion window is clamped into the current monitor work area on launch
via `clamp_to_monitor`.

## Toolchain notes

* Node 22.18.0 / npm 10.9.3 (the `package.json` `engines.node` is pinned
  to this exact version).
* Rust 1.77.2+ (matches `rust-version`); Tauri 2 prerequisites on macOS
  and Windows (Xcode CLT, Visual Studio Build Tools) per upstream docs.
