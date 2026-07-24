# Ted-Bot Companion Guarded Baseline

Recorded on 2026-07-24 in the isolated `agent/ted-bot-native-companion`
worktree, based on `origin/main` at `605f7c687`.

| Check | Command | Exit status | Local stack state |
| --- | --- | ---: | --- |
| Tide-Bot branding | `npx -y -p node@22.18.0 -p npm@10.9.3 npm run audit:branding` | 0 | Running |
| Frontend tests | `npx -y -p node@22.18.0 -p npm@10.9.3 npm run test:frontend -- --run` | 0 (2 tests) | Running |
| Production build | `npx -y -p node@22.18.0 -p npm@10.9.3 npm run build` | 0 | Running |
| Compose rendering | `docker compose -f deploy/tide-stack/docker-compose.yml config --quiet` | 0 | Running |
| Local health | `curl -fsS http://127.0.0.1:3102/health` | 0 (`{\"status\":true}`) | Running |

The production build completed with inherited upstream Svelte accessibility
warnings. It left the Git worktree clean. The isolated worktree does not hold
the deployment `.env`, so Compose reported a missing `WEBUI_SECRET_KEY` while
rendering configuration; no value was read or printed. The already-running
local stack nevertheless returned a healthy response.

## Recovery boundary

The previous companion detour remains reference-only. Compared with
`backup/pre-tide-bot-product-recovery-2026-07-23`, the current source does not
contain either `desktop/tide-companion` or `src/lib/components/companion`.
The new implementation starts from the approved Ted-Bot design and uses the
tracked `static/tide-bot/ted-bot/spritesheet.webp` asset rather than restoring
the prior companion tree.
