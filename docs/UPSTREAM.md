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

## 2026-07-23 current-dev recovery merge

| Item | Value |
| --- | --- |
| Upstream branch | `dev` |
| Reviewed commit | `e64acf1c0a532c7a87c5f6666cb88ba02f8fe237` |
| Commit date | 2026-07-23 |
| Reason | Replace the stale July 17 bootstrap with the current development baseline before Tide-Bot branding. |

This recovery merge intentionally uses a reviewed moving `dev` commit because
the user requested the newest development baseline. Future production updates
must return to explicit release tags and follow the documented sync procedure.

## Next upstream sync

Use the process in `docs/UPSTREAM_SYNC.md`. Every sync must be reviewed for
user-visible branding, security-sensitive configuration, licensing, and
Docker/runtime changes before merging.

## Automated upstream/main integrations

| Date | Upstream commit | Record |
| --- | --- | --- |
| 2026-08-25 | `d3e8bf3405e848cfba377814d0aa7ba7290e414d` | Open WebUI `v0.11.1`; explicit merge `b0b299c27f3cf3fd682b526c35f89ef4f14ee1af`, with Tide-Bot first parent `cf3e495c3f3a551d6b90361b2e8f6df862201944` and upstream second parent `d3e8bf3405e848cfba377814d0aa7ba7290e414d`. |

The `Tide-Bot upstream main` workflow fetches a fresh `upstream/main` SHA and
does no work when that SHA is already an ancestor of `origin/main`. Before it
attempts a merge, it fetches `v0.11.1`, verifies that its commit begins with
`d3e8bf3`, and verifies that it is ancestral to the fetched upstream SHA. A
failed baseline, merge conflict, or gate failure creates a sanitized issue and
leaves `main` and `tide-bot-deployable` unchanged. Passing integrations use a
review branch and the repository's protected GitHub pull-request merge path.

The deployable-marker workflow reruns the common gate for eligible `main`
commits before force-updating only the annotated `tide-bot-deployable` tag. The
production updater deploys that tag's commit only after it verifies the commit
is an ancestor of `origin/main`.

### 2026-08-25 Open WebUI v0.11.1 integration

The official `v0.11.1` tag and the fetched `upstream/main` both resolved to
`d3e8bf3405e848cfba377814d0aa7ba7290e414d`; the tag was verified as an
ancestor of the fetched branch before the merge began. The integration keeps
Tide-Bot branding, ChatGPT subscription device OAuth and encrypted credential
handling, Responses streaming, the ElevenLabs call overlay and fallback voice
path, companion presence and restricted desktop origins, browser-extension
authorization boundaries, and the local-only external-volume production
topology. Upstream workflows, telemetry, public signup defaults, promotional
sharing, and public terminal or CPTR exposure were not inherited.
