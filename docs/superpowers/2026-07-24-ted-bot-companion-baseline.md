# Ted-Bot Companion Guarded Baseline

Recorded on 2026-07-24 in the isolated `agent/ted-bot-native-companion`
worktree, based on `origin/main` at `605f7c687`.

| Check | Command | Exit status | Date | Local stack state |
| --- | --- | ---: | --- | --- |
| Tide-Bot branding | `npm run audit:branding` | 0 | 2026-07-24 | Running |
| Frontend tests | `npm run test:frontend -- --run` | 0 (2 tests) | 2026-07-24 | Running |
| Production build | `npm run build` | 0 | 2026-07-24 | Running |
| Compose rendering | `docker compose -f deploy/tide-stack/docker-compose.yml config --quiet` | 0 | 2026-07-24 | Running |
| Local health | `curl -fsS http://127.0.0.1:3102/health` | 0 (`{\"status\":true}`) | 2026-07-24 | Running |

The production build completed with inherited upstream Svelte accessibility
warnings. It left the Git worktree clean. The isolated worktree does not hold
the deployment `.env`, so Compose reported a missing `WEBUI_SECRET_KEY` while
rendering configuration; no value was read or printed. The already-running
local stack nevertheless returned a healthy response.

The three `npm` commands above were executed through the Node 22.18.0 and npm
10.9.3 wrapper: `npx -y -p node@22.18.0 -p npm@10.9.3 npm`. The table retains
the required project command names rather than substituting that wrapper.

## Recovery boundary

The previous companion detour remains reference-only. Compared with
`backup/pre-tide-bot-product-recovery-2026-07-23`, the current source does not
contain either `desktop/tide-companion` or `src/lib/components/companion`.
The new implementation starts from the approved Ted-Bot design and uses the
tracked `static/tide-bot/ted-bot/spritesheet.webp` asset rather than restoring
the prior companion tree.

The required comparison was run exactly as follows:

```
git diff --name-only backup/pre-tide-bot-product-recovery-2026-07-23..HEAD -- desktop src/lib/components/companion backend/open_webui/socket/companion_presence.py
```

It exited 0 and listed the legacy companion paths and
`backend/open_webui/socket/companion_presence.py`, which records their changes
relative to the backup. The two required absence checks both exited 0:
`test ! -e desktop/tide-companion` and
`test ! -e src/lib/components/companion`. Thus those paths are absent from the
current checkout, not restored from the reference branch.
