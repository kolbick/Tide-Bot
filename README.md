# Tide-Bot

Tide-Bot is the in-progress, work-focused fork of Open WebUI for Changing Tides Treatment Center. It is intended to become a private, self-hosted AI workspace served from `tide-bot.com`.

## Current status

**Current-dev foundation and first Tide-Bot identity layer complete; not yet deployment-ready.**

The Open WebUI source baseline is now present on `main`, merged from the reviewed upstream `dev` commit `e64acf1c0a532c7a87c5f6666cb88ba02f8fe237`. Tide-Bot's product documentation and required upstream attribution are retained in the repository.

This repository is not yet a finished Tide-Bot product. Do not treat it as deployed, brand-complete, production-hardened, or ready for sensitive work data.

## What is here now

- The Open WebUI application source and upstream Git history
- Tide-Bot's initial product and security requirements
- A phased implementation plan
- The exact upstream baseline record
- A shared Tide-Bot identity layer for server defaults, primary browser chrome, PWA metadata, and supplied visual assets
- Ted-Bot, the black goldendoodle mascot, integrated into the Tide-Bot login identity rather than a standalone pet webpage

## What has not been completed

- Complete frontend, localization, settings, and administrative-surface rebrand
- Full Ted-Bot v2 package validation and desktop-capability decision
- Branding CI and automated browser acceptance coverage
- Tide-Bot-specific Docker Compose stack, deployment configuration, backups, or operator documentation
- Tide-Bot.com deployment configuration, backups, and operator runbook
- Final security, isolation, and sensitive-work safeguards for live treatment-center use

Upstream GitHub Actions workflows were intentionally not copied into the initial import. Tide-Bot will receive its own CI and branding enforcement instead of inheriting upstream release automation unchanged.

## Build documents

- [Build specification](docs/BUILD_SPECIFICATION.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Branding guide](docs/BRANDING.md)
- [Upstream baseline](docs/UPSTREAM.md)

The build specification is the authoritative scope for the remaining work. The implementation plan defines the recommended order.

## Next milestone

Complete the remaining rebrand sweep, independently validate the Ted-Bot v2 package, then build and validate the production deployment path for Tide-Bot.com.

## Upstream and licensing

Tide-Bot is derived from [Open WebUI](https://github.com/open-webui/open-webui). Required upstream license files and notices remain in the repository. See [UPSTREAM.md](docs/UPSTREAM.md) for the imported commit and sync notes.
