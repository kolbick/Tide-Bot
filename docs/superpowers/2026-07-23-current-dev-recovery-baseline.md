# Tide-Bot current-dev recovery baseline

Recorded 2026-07-23 after removing the companion-first detour and merging
official Open WebUI `dev` commit
`e64acf1c0a532c7a87c5f6666cb88ba02f8fe237`.

## Toolchain

- Node `v22.18.0`
- npm `10.9.3`
- Docker Compose configuration parser

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Locked frontend install | Pass with upstream dependency notices | `npm ci` installed 1121 packages; npm reported 27 audit findings and upstream deprecation notices. |
| Frontend unit tests | Pass | `npm run test:frontend -- --run`: 1 file, 2 tests passed. |
| Production Vite build | Pass with upstream Svelte warnings | Direct `vite build` completed and regenerated `build/index.html` and `build/manifest.json` at 2026-07-23 14:35 EDT. |
| Repository diagnostics | Existing upstream baseline | `svelte-check` reported 8,708 errors and 252 warnings in 351 files. No Tide-Bot branding code exists yet, so this result is recorded rather than masked. |
| Base Compose parsing | Pass | `docker compose -f deploy/tide-stack/docker-compose.yml config --quiet`. |
| Removal boundary | Pass | Current `HEAD` contains `upstream/dev` as an ancestor and has no tracked companion or desktop path. |

## Preserved local state

The only untracked project paths are user-owned `AGENTS.md`, `tide-bot-pet/`,
and `teddy-v2-upgrade/`. The former desktop companion build residue was moved
to macOS Trash as `Tide-Bot-companion-desktop-detour-2026-07-23`, not deleted.
The complete pre-recovery branch remains available locally as
`backup/pre-tide-bot-product-recovery-2026-07-23`.

The incorrect Tide-Bot Compose containers were stopped without removing named
volumes. The unrelated `cptr` container was left running. Runtime Docker
acceptance is intentionally deferred until the Tide-Bot branding and isolated
stack implementation are complete.
