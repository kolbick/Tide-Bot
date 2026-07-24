# Tide-Bot Brand Foundation Implementation Plan

> **Status, updated 2026-07-24:** Historical source implementation plan. Tasks
> 1 through 4 were completed in the checkout. Source-level verification and
> atomic commits were recorded on 2026-07-23; runtime browser and connected
> integration acceptance remains in the active root plan.

**Goal:** Turn the current Open WebUI `dev` base into a visibly and operationally personalized Tide-Bot product for Changing Tides Treatment Center, with Ted-Bot as the verified mascot rather than a separate product.

**Architecture:** Keep upstream application mechanics intact. Add a small, shared Tide-Bot identity layer for browser-facing copy and local visual assets, set the server application identity from the same product values, and route visible shell surfaces through those values. Preserve upstream attribution and licensing in documentation and source history. Ted-Bot is a branded welcome/loading mascot after independent package validation; it is not a replacement chat client or standalone page.

**Tech stack:** SvelteKit, Tailwind, FastAPI, Pillow/sips for non-destructive deterministic logo derivatives, Node 22.18.0/npm 10.9.3, pytest, Vitest, Docker Compose.

## Constraints

- Preserve `AGENTS.md`, `tide-bot-pet/`, `teddy-v2-upgrade/`, and the original `/Users/kolbyunderwood/Desktop/Teddy-desktop-pet.zip` without mutation.
- Do not reintroduce the removed companion/Tauri/CPTR detour.
- Do not remove upstream license, attribution, or dependency notices.
- Use the supplied Tide-Bot master mark faithfully; no AI-generated alteration of the product logo.
- Use Ted-Bot only after the staged v2 package independently passes its validator and visual atlas inspection.
- Keep user-configurable logos supported, but use Tide-Bot assets as the product defaults.
- Run focused tests and the production build under Node 22.18.0. Record, rather than mask, inherited upstream `npm run check` diagnostics.

## Tasks

### 1. Add canonical Tide-Bot identity and assets

**Files:** `src/lib/branding.ts`, `static/tide-bot/*`, root/static favicon and PWA files, `backend/open_webui/env.py`, `backend/open_webui/main.py`

- [x] Add browser constants for Tide-Bot, Changing Tides Treatment Center, the product description, favicon, and logo paths.
- [x] Copy the user-supplied master mark into the branded static asset directory and create only deterministic resized/raster derivatives required by PWA/favicon surfaces.
- [x] Change backend defaults to `Tide-Bot` without appending the upstream product name; make the local favicon the default and make FastAPI's title Tide-Bot.
- [x] Make dynamic PWA metadata describe Tide-Bot and its Changing Tides context.
- [x] Add a narrow backend regression test for the default identity.

### 2. Apply identity to all primary browser surfaces

**Files:** `src/routes/+layout.svelte`, `src/routes/auth/+page.svelte`, `src/lib/components/app/AppSidebar.svelte`, `src/lib/components/branding/*`, `src/lib/app.css`

- [x] Replace hard-coded upstream notification, favicon, title, and metadata values with the canonical Tide-Bot identity.
- [x] Add a restrained application shell brand lockup and a complete login identity panel using the supplied mark, accessible text, and responsive behavior.
- [x] Keep existing authentication, custom-logo settings, keyboard flow, and mobile layout behavior intact.
- [x] Use the title `Tide-Bot` and the visible organization line `Changing Tides Treatment Center` wherever the product has a primary identity surface.

### 3. Validate and integrate Ted-Bot as a product mascot

**Files:** `teddy-v2-upgrade/` (read-only), `static/tide-bot/ted-bot/*`, `src/lib/components/branding/TedBotMascot.svelte`, relevant welcome/loading surface tests

- [x] Run the Hatch Pet v2 validator against the staged package and inspect its atlas visually; stop if it is not compliant.
- [x] Copy the validated release atlas into Tide-Bot static assets without editing the user-owned staged package or original ZIP.
- [x] Render Ted-Bot as an optional, non-interactive branded mascot in the login/welcome identity panel with reduced-motion-safe behavior. Do not create a standalone pet site.
- [x] Add source-level regression coverage for mascot accessibility and asset use through the brand audit.

### 4. Add branded release safeguards and documentation

**Files:** `scripts/audit-branding.mjs`, `package.json`, `README.md`, `tasks/todo.md`, `docs/BRANDING.md`, CI workflow as needed

- [x] Add a scoped brand audit that checks the deployed shell/static assets for Tide-Bot identity and flags accidental user-facing upstream branding while allowing licenses and third-party attribution.
- [x] Document asset provenance, Ted-Bot packaging, environment settings, Tide-Bot.com deployment requirements, and upstream attribution boundaries.
- [x] Replace the obsolete companion checklist with product-recovery and brand acceptance tasks.
- [x] Add the focused audit to the project verification path without pretending it fixes the inherited global checker baseline.

### 5. Verify and commit atomically

- [x] Run source-level verification, including the branded audit and Compose configuration validation; the 2026-07-23 recovery record contains the then-current focused test/build evidence.
- [ ] Re-inspect primary UI at mobile and desktop breakpoints and record fresh authenticated-browser results. This remains part of the active root plan.
- [x] Commit identity/assets, UI/Ted-Bot integration, and safeguards/docs separately. Do not push.
