# Upstream baseline

Tide-Bot is derived from [Open WebUI](https://github.com/open-webui/open-webui).

## Initial import

| Item | Value |
| --- | --- |
| Upstream repository | `https://github.com/open-webui/open-webui.git` |
| Tracked upstream branch | `dev` |
| Imported upstream commit | `1a32d92d08aafbbc7443039cf8bce2485bc8d180` |
| Upstream commit date | 2026-07-17 |
| Initial Tide-Bot merge commit | `81b27b3a7` |

The initial import preserves the upstream Git history through an unrelated-history merge into Tide-Bot's `main` branch. Tide-Bot's root README and repository-specific documentation were intentionally retained as the project's implementation specification.

## Deferred upstream workflow files

The upstream `.github/workflows` files were deliberately excluded from the initial import. GitHub restricts the temporary Actions token used for the import from creating workflow files, and Tide-Bot requires its own CI and branding enforcement rather than inheriting upstream release automation unchanged.

This exception applies only to the upstream workflow directory. The application source, static assets, licensing files, and history were imported.

## Next upstream sync

Use the process in `docs/UPSTREAM_SYNC.md` once it is added. Every sync must be reviewed for user-visible branding, security-sensitive configuration, licensing, and Docker/runtime changes before merging.
