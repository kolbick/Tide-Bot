# Tide-Bot implementation plan

This plan operationalizes the root build specification. It is intentionally Tide-Bot-only.

## Guiding constraints

- Tide-Bot is the private, work-focused Open WebUI-derived product for `tide-bot.com`.
- Keep all application data, browser storage, cookies, Docker resources, secrets, terminal state, and CPTR configuration isolated from Kolb-Bot.
- Preserve upstream licenses, notices, and core functionality.
- Treat terminal and computer-workspace access as privileged and disabled by default.
- Never commit secrets, production data, uploads, databases, model files, or terminal homes.

## Phase 0: establish the upstream baseline

1. Add `https://github.com/open-webui/open-webui.git` as the `upstream` remote.
2. Select a pinned, tested upstream release commit for the initial import. The upstream `dev` branch may be tracked for future work, but it must not be the unpinned production baseline.
3. Import the selected upstream history into this repository rather than replacing it with a prebuilt image or shallow UI.
4. Preserve all upstream license files and record the imported tag, SHA, date, and licensing notes in `docs/UPSTREAM.md`.
5. Add `docs/UPSTREAM_SYNC.md` with a repeatable fetch, review, rebrand-audit, test, and merge process.

**Checkpoint:** the unmodified source builds locally from this repository before Tide-Bot changes begin.

## Phase 1: centralize the Tide-Bot identity

1. Inspect every logo/reference asset supplied with this repository and document its intended use.
2. Add one brand-configuration module for product names, slug, domain, colors, logos, icons, terminal name, and computer-workspace name.
3. Generate only the required derived logo variants, retaining supplied originals unchanged.
4. Replace product identity across metadata, PWA manifest, static assets, browser title, onboarding, login, settings, admin pages, dialogs, notifications, accessibility text, and mobile views.
5. Keep any allowed upstream mentions narrowly documented for license, attribution, and dependency purposes.

**Checkpoint:** light and dark desktop/mobile screenshots show Tide-Bot identity only.

## Phase 2: enforce the rebrand

1. Create a branding-audit script with an explained allowlist.
2. Scan source, localization files, static assets, manifests, Docker metadata, public docs, built production assets, and service-worker output.
3. Fail the audit for unintended Open WebUI identity, upstream promotional URLs, upstream logo assets, and any Kolb-Bot identity.
4. Add unit tests for brand configuration and generated metadata.

**Checkpoint:** the production build and branding audit both pass in CI.

## Phase 3: create the isolated deployment stack

1. Add production and development Docker build targets that build from source.
2. Add a Compose stack with Tide-Bot-specific services, volumes, network, cache prefixes, cookie name, and configurable host port.
3. Add `.env.example`, health checks, restart policies, log rotation, non-root runtime behavior where supported, and safe writable mounts.
4. Default to disabled public signup, no anonymous privileged access, disabled telemetry unless configured, and no committed secrets.
5. Document reverse-proxy headers and WebSocket forwarding for `tide-bot.com`.

**Checkpoint:** Tide-Bot starts from a clean clone with its own data volume and no shared resources.

## Phase 4: integrate Tide Terminal

1. Bring in the official Open Terminal source as a separately built and licensed service.
2. Apply the Tide Terminal user-facing branding while preserving required license notices and protocol compatibility.
3. Keep it on the internal Docker network with a dedicated volume, health check, server-side key, and no public port by default.
4. Make terminal access a configuration switch and default to Docker isolation with no Docker socket or broad host mounts.
5. Verify the main app remains usable when the terminal is unavailable.

**Checkpoint:** an authenticated Tide Terminal connection works over the internal network and can be disabled without rebuilding.

## Phase 5: integrate Tide Computer through CPTR

1. Add a replaceable, OpenAI-compatible CPTR adapter using the configured gateway endpoint.
2. Expose the connection in Tide-Bot as `Tide Computer`, while keeping CPTR attribution and its own interface unchanged.
3. Support `host.docker.internal` and the Linux host-gateway mapping, with server-side secrets only.
4. Require explicit opt-in for host workspaces and keep CPTR management/UI off the public proxy by default.
5. Add diagnostics, health checks, disablement behavior, and clear operator warnings about host-level capability.

**Checkpoint:** model discovery and conversation continuity work with CPTR enabled; ordinary chat works normally with it disabled.

## Phase 6: verify and prepare operations

1. Add CI for source build, tests, production branding audit, and relevant integration coverage.
2. Add end-to-end coverage for admin bootstrap, login, chat, settings, terminal, optional CPTR, and mobile navigation.
3. Add screenshot coverage for important light/dark desktop and phone-width screens.
4. Create operator documentation for deployment, security, architecture, backups/restores, Open Terminal, CPTR, licensing, and upgrades/rollback.
5. Test container replacement, data persistence, backup restore, reverse-proxy HTTPS/WebSockets, and isolation from Kolb-Bot resources.

**Release checkpoint:** no visible upstream or Kolb-Bot identity remains, required licensing remains, automated checks pass, no unresolved placeholders remain, and the stack is operationally documented.

## First implementation sequence

1. Pin and import the Open WebUI baseline.
2. Confirm the source builds unchanged.
3. Inventory the supplied Tide-Bot visual assets.
4. Add the brand configuration module and apply the initial identity sweep.
5. Build the first production artifact and run the branding audit.
6. Add the isolated Compose stack before enabling Tide Terminal or CPTR.
