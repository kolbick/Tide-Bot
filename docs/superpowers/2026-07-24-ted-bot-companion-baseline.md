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

## Native-companion plan correction status

This is baseline evidence only, not native-companion acceptance. The corrected
implementation plan requires separate future gates that have not run here:

- Tauri 2 capability parsing must read exactly one `[[permission]]` entry and
  preserve the unprefixed `allow-show-main-window` AppManifest/remote scope.
- The real Redis proof must run an isolated two-worker project from a neutral
  directory with the exact absolute presence compose file, generated private
  env file, explicit `tedbot-presence-it-${RUN_ID}` project name, test-only
  `REDIS_KEY_PREFIX`, and no discoverable live Compose or `.env` source.
- UI smoke must use its own disposable loopback-only Cypress stack and
  randomized supported-auth account. Cross-client/presence synchronization is
  proved only by the real Redis/two-worker gate, not Cypress.
- The tracked static atlas needs a release-only bundled-runtime Hatch Pet v2
  validator run, deterministic alpha/transparency JSON, SHA-256-bound contact
  sheet, direction QA/continuity artifacts, three independent blind verdicts,
  and a 16-direction semantic record. Missing/failing/ambiguous blind
  cardinals, semantic failure, or unassessed continuity warnings keep release
  acceptance pending.
- The three blind verdicts must be provenance-attested before Hatch consensus:
  a tracked Node verifier writes the redacted atlas/sheet/key manifest, validates
  each distinct reviewer ID and hashes against the actual artifacts/key, and
  atomically invokes Hatch combine and validation on sealed verified votes. Its envelope must
  link every source verdict and artifact hash to consensus; mutation after
  manifest generation must fail without an accepted consensus. That verifier/test
  and release evidence have not run, so they are pending rather than claimed.
- Blind publication is per unique `BLIND_RUN_ID`: the verifier owns a 0700
  pending directory and atomically publishes it only after both Hatch scripts
  and the envelope pass. An answer key with a wrong semantic `atlas_sha256`
  must fail even if all surrounding hashes are freshly consistent; stale or
  failed current-run artifacts cannot be accepted.
- All pet QA is further scoped to one outer `PET_QA_RUN_ID`: validator,
  contact-sheet, direction, blind, semantic, and metadata artifacts exist only
  under its 0700 pending directory until `publish-pet-qa-run` validates and
  atomically publishes the whole run. A pending path is never acceptance
  evidence; the baseline has no published run and remains pending.
- Lifecycle acceptance must exercise the narrow binding that `Chat.svelte`
  itself uses for deferred load, completion, stop, and queue continuations.
  A standalone epoch test is not sufficient; reset/navigation/destruction must
  suppress stale real mutations and resolve the actual pending callback false.
- Lifecycle settlement also needs normal-path proof: all five Chat callback
  assignments register the one-shot binding wrapper, which clears before normal
  dialog/execute callback invocation. Reset/destroy then only resolve callbacks
  that remain pending; no normally settled callback may be invoked again.
- Cypress acceptance needs the fixture slow-stream barrier and server-observed
  abort proof, not a normal stream completion. Its full-chat confirmation test
  must type prompt, toggle Web Search, see the dialog, deny, and retain zero
  fixture completions.
- Desktop acceptance requires a provisioned
  `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN`, generated capability SHA, parsed
  capability-test result, and actual Windows artifact/manual proof. The real
  production origin is not recorded here; this external release gate remains
  pending.
- The desktop companion URL must be derived only from the resolver-generated
  capability `remote.urls` through `configured_companion_url()`, not an app or
  runtime environment URL. Missing/stale/invalid generated source and any
  origin divergence must be rejected by the Cargo integration test.
- Desktop release artifacts must compile-time embed separately generated
  capability and provenance JSON plus the fresh build nonce. The launcher and
  `build.rs` bind the prepared output before compilation; installed runtime
  environment/source/cwd state cannot select a URL. Provenance freshness and
  installed Windows artifact proof remain pending.

No live Compose, authenticated browser, Cypress, Redis, native desktop, or
Hatch release acceptance is claimed by this baseline.

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
