# Tide-Bot Fork Build Specification

This README is the authoritative implementation brief for the Tide-Bot repository.

## Product definition

Build **Tide-Bot**, a completely branded, private, self-hosted work AI workspace derived from Open WebUI.

Tide-Bot is the owner's work-focused AI interface. It must feel like a standalone product, not a renamed Open WebUI installation. The application will eventually be served at:

- Primary domain: `https://tide-bot.com`via cloudfare
- Product name: `Tide-Bot`
- Product short name: `Tide-Bot`
- Product slug: `tide-bot`
- Main container name: `tide-bot`
- Suggested Compose project name: `tide-bot`
- Suggested default host port: `3102`
- Branded terminal name: `Tide Terminal`
- Branded computer-workspace connection name: `Tide Computer`

Do not add Kolb-Bot branding, personal-assistant copy, personal data, or Kolb-specific visual elements to this repository.

The interface should be professional, focused, and practical without using generic corporate filler or therapy-style slogans. Do not invent claims about compliance, privacy certification, clinical capability, or medical use. The product may handle sensitive work, so use a conservative private-by-default security posture.



## CPTR

1. Integrate CPTR through its OpenAI-compatible gateway API.
2. Brand the connection, launcher, model alias, surrounding navigation, and documentation inside this application.
3. Do not expose CPTR directly to the public internet. Treat access as equivalent to access to the host computer.

This is an engineering constraint, not an instruction to remove or weaken any license notice.


## Starting state and upstream bootstrap

The repository initially contains only this README and a logo/reference folder supplied by the owner. Treat the logo folder as the authoritative visual reference.

Bootstrap the project from the latest dev branch from Open WebUI 

Required bootstrap process:

1. Add the dev Open WebUI repository as an `upstream` remote.
2. Import a stable release into this repository while retaining a useful commit history.
3. Record the exact upstream tag and commit in `docs/UPSTREAM.md`.
4. Preserve the upstream license files and license history.
5. Create a maintainable rebranding layer rather than scattering brand-specific literals throughout the application.
6. Add an upstream-sync process documented in `docs/UPSTREAM_SYNC.md`.
7. Do not replace the application with a shallow mockup, iframe shell, or reduced clone. This must remain a functional Open WebUI-derived application with its existing core capabilities intact.

The finished repository must build entirely from source and must not depend on pulling a prebuilt Open WebUI frontend image at runtime.


## Complete frontend rebranding requirements

The rebrand is not complete after changing a logo and page title. Audit every user-visible surface and replace upstream product identity with this repository's product identity.

At minimum, inspect and update:

- Browser title, page metadata, Open Graph metadata, and application descriptions
- Login, signup, password reset, onboarding, loading, empty, offline, maintenance, and error screens
- Header, sidebar, menus, mobile navigation, admin pages, settings pages, dialogs, confirmations, tooltips, notifications, and toast messages
- Default avatars, placeholder graphics, splash graphics, loading graphics, favicons, app icons, maskable icons, Apple touch icons, and pinned-tab assets
- PWA manifest name, short name, description, theme colors, start URL, shortcuts, and install prompts
- About, help, update, version, support, documentation, community, feedback, and external-link surfaces
- Localization strings in every bundled language
- Generated frontend bundles, service-worker caches, email-like frontend templates, downloadable exports, and client-generated filenames
- Accessibility labels and screen-reader text
- Default workspace names, default assistant labels, connection labels, terminal labels, and any user-visible API/provider labels that expose upstream branding
- Source maps or public static assets that unnecessarily expose upstream branding
- Mobile layouts and narrow-screen views

Remove upstream promotional links, enterprise sales prompts, community links, donation links, careers links, and upstream marketing copy from the user-facing application unless they are legally required notices. Do not remove required license content from the repository.

Create a single brand configuration module containing, at minimum:

- Product name
- Product short name
- Product slug
- Primary domain
- Support/contact placeholder
- Default page description
- Light and dark logo paths
- Square icon path
- Favicon path
- PWA icon paths
- Theme tokens
- Default terminal display name
- Default CPTR connection display name

Components must consume this configuration instead of hardcoded brand strings.

### Logo handling

Use the supplied logo/reference folder as the source of truth.

- Inspect every provided asset before designing the theme.
- Derive a restrained light and dark color system from the logo.
- Do not redraw, distort, crop, stretch, rotate, or add effects to the main logo without a clear technical need.
- Produce optimized SVG or PNG variants as needed while preserving the originals.
- Create square, favicon, touch-icon, maskable PWA, monochrome, light-background, and dark-background variants.
- Keep generated assets in a clearly named brand-assets directory.
- Document which supplied file was used for each generated asset.
- Never substitute an upstream Open WebUI logo when a brand asset is unavailable. Use a neutral temporary placeholder and record it as an unfinished item.

### Brand isolation

No asset, string, environment variable default, cache key, container name, volume name, browser storage namespace, PWA identity, or generated filename from the other bot may appear in this build.

Add automated tests that fail if the two brands are mixed.


## Branding audit and automated enforcement

Create a repeatable branding audit, not a one-time manual search.

Add a script such as `scripts/audit-branding.*` that scans:

- Frontend source
- Static assets and filenames
- Localization files
- Generated production bundles
- PWA manifests and service workers
- Docker labels and image metadata
- Public documentation shipped with the app

The audit must fail on unintended user-visible occurrences of:

- `Open WebUI`
- `open-webui`
- `openwebui`
- Official Open WebUI website, documentation, community, careers, or enterprise URLs
- Upstream logo filenames and known asset hashes
- The other bot's name, slug, domain, container names, volume names, or logo filenames

Maintain a narrow allowlist only for license files, upstream-sync documentation, dependency metadata, source attribution, and internal integration identifiers that cannot safely be renamed. The allowlist must explain why every exception exists.

Run this audit in CI after the production build. A source-only grep is insufficient.


## Branded Open Terminal implementation

Implement a dedicated Open Terminal service for this stack.

Requirements:

1. Base it on the official Open Terminal source, not an unrelated terminal emulator.
2. Preserve the MIT license and copyright notice.
3. Build a custom image from source.
4. Replace user-visible Open Terminal product identity with the terminal name defined for this brand.
5. Replace visible logos, page titles, default labels, package descriptions, API documentation titles, container labels, and generated documentation where applicable.
6. Keep protocol compatibility with the Open WebUI Open Terminal integration.
7. Configure the main application to connect through the internal Docker network.
8. Keep the terminal API key server-side. Never expose it in client JavaScript, committed files, or public environment output.
9. Do not publish the terminal port directly to the internet by default.
10. Use a separate persistent volume for this stack.
11. Add a health check and make the main app tolerate the terminal service being temporarily unavailable.
12. Provide a configuration switch that disables terminal access without rebuilding the image.
13. Default to Docker isolation. Host-level execution must be a clearly documented, explicit opt-in.
14. Do not mount the Docker socket by default.
15. Document the security consequences of any host bind mounts.

The terminal must appear as part of this product in the main UI, while remaining a separately isolated service.


## CPTR integration

Implement CPTR as a connected computer workspace, not as copied frontend code inside this repository.

Use CPTR's OpenAI-compatible gateway endpoint, normally `/v1`, and support the conversation metadata headers recommended by its official integration documentation.

Requirements:

- Add CPTR as a configurable OpenAI-compatible connection.
- Use a brand-specific display alias in this application's model picker and connection settings.
- Keep the underlying provider type and license notices accurate in internal documentation.
- Support either a CPTR process running on the host or a separately managed CPTR container.
- For Docker Desktop, support `host.docker.internal`.
- For Linux Docker, include the documented host-gateway mapping option.
- Store gateway keys only in server-side secrets or environment files excluded from version control.
- Do not expose the CPTR management UI through the public reverse proxy by default.
- Do not make CPTR reachable to unauthenticated users.
- Do not mount the entire host filesystem into a CPTR container by default. Require an explicit workspace path.
- Add a clear warning that CPTR has host-level capabilities and should be treated like SSH access.
- Add health checks and useful connection diagnostics.
- Allow CPTR to be disabled without affecting normal chat.
- Keep all CPTR-specific code in an adapter or integration module so the service can be replaced later.

Within this branded application, the user-facing connection may be called the brand-specific computer workspace name. CPTR's own interface and attribution must remain unchanged unless separate permission is obtained.


## Docker and deployment architecture

This repository will ultimately run on the owner's PC as its own Docker Compose project behind a reverse proxy.

Build a production-ready Compose stack with:

- One application service built from this repository
- One branded Open Terminal service built from source
- Optional CPTR connection configuration
- Separate named volumes for application data, terminal data, and any repository-specific cache
- An internal Docker network unique to this stack
- Health checks
- Restart policies
- `.env.example` with no real secrets
- Docker secrets or an equivalent safe secret-loading pattern where practical
- A production Dockerfile using a multi-stage build
- A non-root runtime user where supported
- A read-only root filesystem where practical
- Explicit writable mounts for required data
- Log rotation settings
- A documented backup and restore process
- A documented upgrade and rollback process

The main application may listen on port `8080` inside its container. The host port must be configurable and must not conflict with the other bot.

The reverse proxy will provide HTTPS and route the product's domain to this container. Do not bake TLS certificates into the image. Include examples for forwarding standard proxy headers and WebSocket traffic.

Default security posture:

- Public account signup disabled
- Admin-created or explicitly approved users only
- No anonymous terminal or CPTR access
- No default credentials
- No secrets committed to Git
- No broad host filesystem mounts
- No shared database, volume, session secret, cookie name, browser-storage namespace, or terminal data with the other bot
- Secure, HTTP-only cookies in production
- A unique session secret and encryption key
- CSRF and trusted-origin settings appropriate for the product domain
- Telemetry and external reporting disabled unless explicitly configured
- Rate limiting at the reverse proxy or application layer


## Tide-Bot deployment values

Use brand-specific defaults similar to:

```dotenv
PRODUCT_NAME=Tide-Bot
PRODUCT_SHORT_NAME=Tide-Bot
PRODUCT_SLUG=tide-bot
PRIMARY_DOMAIN=tide-bot.com
APP_HOST_PORT=3102
APP_INTERNAL_PORT=8080
APP_CONTAINER_NAME=tide-bot
APP_DATA_VOLUME=tide-bot-data
TERMINAL_CONTAINER_NAME=tide-terminal
TERMINAL_DATA_VOLUME=tide-terminal-data
TERMINAL_DISPLAY_NAME=Tide Terminal
COMPUTER_DISPLAY_NAME=Tide Computer
ENABLE_SIGNUP=false
```

These are public examples only. Generate actual secrets during deployment.

The Compose project must use unique cookie names, session secrets, encryption keys, cache prefixes, browser-storage keys, database paths, service names, network names, and volumes beginning with `tide-bot` or another clearly Tide-specific namespace.

## Sensitive-work safeguards

Tide-Bot must be secure by default.

- Do not claim that the application is HIPAA compliant or certified.
- Disable public signup.
- Disable telemetry and external reporting unless explicitly configured.
- Do not send uploaded files, prompts, logs, diagnostics, or usage data to an external service without clear configuration.
- Redact secrets and authorization headers from logs.
- Avoid verbose request-body logging in production.
- Make retention and deletion behavior understandable to the operator.
- Provide a documented way to disable or remove optional cloud integrations.
- Keep Tide-Bot data entirely separate from Kolb-Bot data.
- Require explicit configuration before any host folder is exposed to Open Terminal or CPTR.
- Treat CPTR gateway access as privileged host access.
- Add a clear warning before enabling terminal or computer access for additional users.
- Provide an operator checklist for reviewing reverse-proxy authentication, account access, backups, logs, and exposed ports.


## Functional preservation and quality requirements

Preserve the useful upstream feature set unless a feature is deliberately removed for security, licensing, or product clarity.

At minimum, verify:

- Authentication and admin bootstrap
- Chat creation, editing, deletion, search, export, and import
- Model/provider connections
- Ollama and OpenAI-compatible providers
- File upload and retrieval workflows
- Knowledge and RAG workflows
- Tools, functions, and integrations
- Image-related workflows when configured
- Voice workflows when configured
- PWA installation and updates
- Desktop and mobile layouts
- Dark and light appearance
- Open Terminal connection and file navigation
- CPTR gateway model discovery and conversation continuity
- Database persistence across container replacement
- Backup restore
- Reverse-proxy operation over HTTPS and WebSockets

Do not silently delete upstream functionality merely because a surface still contains upstream branding. Rework the surface properly or document a deliberate removal.

### Testing

Add:

- Unit tests for brand configuration
- Tests that verify generated manifests and metadata
- Production bundle branding audit
- Integration tests for Open Terminal health and authentication
- Integration tests for optional CPTR connectivity
- End-to-end tests for login, first-run setup, chat, settings, admin, terminal, and mobile navigation
- Screenshot tests for key light and dark pages at desktop and phone widths
- A test proving that data from this stack cannot be read from the other stack's named volumes or browser-storage namespace

A release is not complete while console errors, broken assets, upstream logos, mixed branding, placeholder copy, or unreviewed TODO items remain.


## Required repository deliverables

Create and maintain:

- `README.md` as the user and operator guide after this build specification has been implemented
- `docs/UPSTREAM.md`
- `docs/UPSTREAM_SYNC.md`
- `docs/BRANDING.md`
- `docs/BRANDING_AUDIT.md`
- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT.md`
- `docs/SECURITY.md`
- `docs/BACKUP_RESTORE.md`
- `docs/CPTR_INTEGRATION.md`
- `docs/OPEN_TERMINAL.md`
- `docs/LICENSE_NOTES.md`
- `.env.example`
- `docker-compose.yml`
- Production and development Dockerfiles or clearly separated build targets
- Branding audit script
- Health-check scripts
- Test configuration
- CI workflow that builds, tests, and runs the branding audit
- A concise `CHANGELOG.md`

Do not commit generated secrets, local databases, model files, user uploads, terminal home directories, CPTR state, or production `.env` files.


## Definition of done

The Tide-Bot build is complete only when all of the following are true:

- A production build runs from this repository in its own Docker Compose stack.
- The product is reachable through a reverse proxy at `tide-bot.com`.
- No unintended Open WebUI name, logo, promotional link, or visual identity appears anywhere in the user-facing application.
- No Kolb-Bot name, domain, logo, copy, storage key, or container resource appears.
- All required upstream licenses and notices remain intact.
- Tide Terminal is built from source, branded, isolated, authenticated, healthy, and integrated.
- Tide Computer is configurable through the CPTR gateway without altering CPTR's own required attribution.
- Public signup is disabled by default.
- Sensitive-work defaults and logging safeguards are documented and tested.
- Data survives container replacement.
- Backup and restore have been tested.
- Mobile, desktop, light, dark, PWA, error, onboarding, settings, admin, and terminal surfaces have been visually reviewed.
- The branding audit passes against the production bundle.
- Automated tests and CI pass.
- There are no placeholder logos, broken links, console errors, accidental upstream marketing references, or unresolved branding TODO items.
