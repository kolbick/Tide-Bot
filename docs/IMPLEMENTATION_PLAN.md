# Tide-Bot current implementation plan

> **Status, 2026-07-24:** The upstream recovery, Tide-Bot brand foundation,
> private base Compose stack, Tide Terminal build overlay, and CPTR gateway
> overlay are present in this checkout. The base app, terminal, and gateway
> containers are currently healthy; authenticated browser flows and real CPTR
> upstream acceptance have not been freshly exercised. Historical execution
> plans are retained in `docs/superpowers/plans/`.

This is the active roadmap for the remaining Tide-Bot release work. It is
intentionally Tide-Bot-only.

## Guiding constraints

- Tide-Bot is the private, work-focused Open WebUI-derived product for `tide-bot.com`.
- Keep all application data, browser storage, cookies, Docker resources, secrets, terminal state, and CPTR configuration isolated from Kolb-Bot.
- Preserve upstream licenses, notices, and core functionality.
- Treat terminal and computer-workspace access as privileged and disabled by default.
- Never commit secrets, production data, uploads, databases, model files, or terminal homes.

## Completed foundation

- Open WebUI `dev` commit `e64acf1c0a532c7a87c5f6666cb88ba02f8fe237` is
  an ancestor of `HEAD`; the recovery record and future sync procedure are in
  `docs/UPSTREAM.md` and `docs/UPSTREAM_SYNC.md`.
- Tide-Bot identity, default assets, private sharing defaults, and the
  source-level branding audit are implemented. Ted-Bot is a supporting mascot
  asset, not a separate product.
- `deploy/tide-stack/` has a private base stack plus source-built Tide Terminal
  and CPTR gateway overlays. Each uses Tide-Bot-specific names and internal
  networking.

## Phase 1: preserve and verify the branded source

1. Run the supported Node 22.18.0 toolchain, focused frontend and backend
   regressions, `npm run audit:branding`, a production build, and
   `git diff --check` after each source change.
2. Treat the repository-wide `npm run check` result as an inherited upstream
   baseline unless changed-path evidence shows a new Tide-Bot regression.
3. Keep `AGENTS.md`, `tide-bot-pet/`, and `teddy-v2-upgrade/` untracked and
   unmodified unless the user explicitly authorizes a change.

**Checkpoint:** the source build and brand audit pass with no new
changed-path diagnostics.

## Phase 2: validate the connected local stack

1. Create or update ignored local environment values without printing or
   committing secrets, then start the base stack and required overlays.
2. Verify Compose rendering, service health, local `/health`, and the
   Socket.IO path.
3. In an authenticated browser, test bootstrap/login, ordinary chat, settings,
   private-sharing restrictions, and desktop and mobile widths.
4. Verify data persists through a safe container replacement. Keep the test
   stack running when requested and document exact stop/restart commands.

**Checkpoint:** fresh local authenticated-browser evidence, not only container
health, is recorded.

## Phase 3: accept privileged optional integrations

1. Build the Tide Terminal overlay from pinned Open Terminal source
   `v0.11.34` / `9162e808c3aaf8dba38745cea55204a42bbb348d`; verify its health,
   authenticated connection, and disabled-overlay behavior.
2. With an authorized CPTR gateway only, verify model discovery, headers,
   approved-user access, conversation continuity, rejection behavior, and
   ordinary chat with CPTR disabled.
3. Confirm neither integration publishes a host port, mounts a broad host
   filesystem, bypasses CPTR safeguards, or exposes management UI publicly.

**Checkpoint:** each integration has fresh enabled and disabled acceptance
evidence.

## Phase 4: prepare a controlled production release

1. Re-run the upstream sync review against an explicit release tag before any
   production update; inspect branding, Docker, security, and licensing
   changes before merging.
2. Validate the production overlay with deployment secrets managed outside Git,
   HTTPS reverse-proxy headers, WebSockets, backups/restores, and rollback.
3. Recheck the deployed domain in an authenticated browser before reporting a
   release. Local Docker health and Tailscale access do not prove public
   production deployment.

**Release checkpoint:** no visible upstream or Kolb-Bot identity remains,
required licensing remains, source and runtime acceptance are fresh, and the
stack is operationally documented.

## Native companion status

The Tauri shell and native-or-browser main-window action are implemented under
`desktop/tide-bot/` and `src/lib/ted-bot/openMainWindow.ts`. Focused capability,
provenance, placement, URL, native action, and debug-build checks pass under
the pinned Node 22.18.0 toolchain plus Rust stable. This is implementation
evidence, not a production release claim.

Release remains gated on provisioning the real desktop production origin,
green Windows artifact workflow output, downloaded-artifact manual Windows
acceptance, and fresh visual/runtime Hatch Pet v2 evidence from the actual
Tauri application. See
`docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md`.
