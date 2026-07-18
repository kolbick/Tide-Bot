# Tide-Bot

Tide-Bot is the in-progress, work-focused fork of Open WebUI for Changing Tides Treatment Center. It is intended to become a private, self-hosted AI workspace served from `tide-bot.com`.

## Current status

**Bootstrapped, not yet rebranded or deployment-ready.**

The Open WebUI source baseline is now present on `main`, imported from the upstream `dev` branch at commit `1a32d92d08aafbbc7443039cf8bce2485bc8d180`. Tide-Bot's initial README, implementation plan, and upstream record were retained during the import.

This repository is not yet a finished Tide-Bot product. Do not treat it as deployed, brand-complete, production-hardened, or ready for sensitive work data.

## What is here now

- The Open WebUI application source and upstream Git history
- Tide-Bot's initial product and security requirements
- A phased implementation plan
- The exact upstream baseline record
- Supplied Tide-Bot visual reference assets, not yet processed into application branding
- A connected Compose package with a shared multi-user Tide Terminal and CPTR approval gateway

## What has not been completed

- Complete frontend, PWA, metadata, localization, and asset rebrand
- Central Tide-Bot brand configuration and generated icon variants
- Branding audit, allowlist, CI, and automated tests
- Tide-Bot-specific Docker Compose stack, deployment configuration, backups, or operator documentation
- Full Tide-specific rebrand of the Open Terminal service and its user-facing surfaces
- Tide Computer naming and user-facing connection polish
- Final security, isolation, and sensitive-work safeguards

Upstream GitHub Actions workflows were intentionally not copied into the initial import. Tide-Bot will receive its own CI and branding enforcement instead of inheriting upstream release automation unchanged.

## Build documents

- [Build specification](docs/BUILD_SPECIFICATION.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Upstream baseline](docs/UPSTREAM.md)

The build specification is the authoritative scope for the remaining work. The implementation plan defines the recommended order.

## Connected stack

The first connected deployment package is available in [deploy/tide-stack](deploy/tide-stack/README.md). It starts Tide-Bot with a persistent, shared multi-user Tide Terminal and an internal CPTR gateway. Admins have CPTR by default; non-admin users require explicit email approval. This is a deployment foundation, not the finished Tide-Bot rebrand.

## Next milestone

Create the central Tide-Bot brand configuration, inventory and process the supplied visual assets, then complete the first user-visible identity sweep and validate the connected deployment package.

## Upstream and licensing

Tide-Bot is derived from [Open WebUI](https://github.com/open-webui/open-webui). Required upstream license files and notices remain in the repository. See [UPSTREAM.md](docs/UPSTREAM.md) for the imported commit and sync notes.
