# SDD ledger — plan: docs/superpowers/plans/2026-08-25-tide-bot-upstream-main-reconciliation.md

## Tasks

- [x] Task 1: Add a canonical production Compose overlay and secret-free environment migration
- [x] Task 2: Add a sanitized in-container ChatGPT subscription health verifier
- [x] Task 3: Build the locked production updater, backup, recovery, and safe state record
- [x] Task 4: Bootstrap the controlled checkout and install the guarded Windows schedule
- [x] Task 5: Add repeatable upstream and deployable-marker test gates
- [x] Task 6: Integrate the current Open WebUI main SHA without losing Tide-Bot behavior
- [ ] Task 7: Perform the observed initial cutover and enable automatic updates

## Pre-flight plan/interface scan

| Tasks / interface | Producer and consumer | Finding / ruling |
| --- | --- | --- |
| 1 -> 3, `docker-compose.live.yml` and external resource names | Task 1 creates the production topology; Task 3 builds, recreates, archives, and restores it. | Compatible after one ruling below: Task 1 supplies an image-reference override so Task 3 can restart the exact prior image without a source rebuild. |
| 1 -> 4 -> 7, `production.env` and controlled checkout | Task 1 copies and ACLs the host-only environment; Task 4 creates the controlled checkout/task; Task 7 performs the first real invocation. | Compatible. Task 7 never changes the legacy source environment file and Task 4 defaults schedule installation to disabled. |
| 2 -> 3, `open_webui.cli.verify_chatgpt_subscription` | Task 2 provides fixed safe JSON and exit semantics; Task 3 executes it inside the running container and writes its safe fields to state. | Compatible. The updater maps reconnect-related CLI exit codes to warning state rather than service-health rollback. |
| 3 -> 4 -> 7, deployment state and named mutex | Task 3 creates the updater/state contract; Task 4 registers the serialized invocation; Task 7 relies on state equality before enabling automation. | Compatible. Tests use injected command runners and do not touch Docker or Scheduled Tasks. |
| 1, 2, 3 -> 5, common update gate | Tasks 1–3 create focused validators; Task 5 invokes them in the CI gate and writes deployable marker only after success. | Compatible. The marker workflow is inert until this branch reaches canonical main. |
| 2, 5 -> 6, router seams and update workflow | Task 2 adds safe OAuth helpers; Task 6 merges `upstream/main`; Task 5 makes later upstream merges automatic. | Compatible if Task 6 treats Task 2's helpers as a required Tide-Bot seam and retains their tests. |
| 5 -> 6, workflow activation versus current upstream integration | Task 5 creates the hourly workflow before Task 6's current merge task in the written plan. | Compatible because both changes remain on the isolated branch until final shared-branch merge; current upstream integration completes before the workflow can run on canonical main. |
| 6 -> 7, deployable tag and production cutover | Task 6 merges and tests current upstream; Task 5's marker flow tags it; Task 7 deploys the tagged commit. | Compatible. Task 7 refuses a tag that is not an ancestor of canonical main. |
| 7, Cloudflared/public routing | Task 7 verifies the existing public route but has no routing-change task. | Compatible with the approved design: Cloudflared remains unchanged and routes `tide-bot.com` to localhost port 3102. |
| Task 1 self-consistency | The plan's variable spelling is `TIDEBOT_OPEN_WEB_UI_PORT`; the existing project convention and operational intent do not require an extra `WEB_UI` separator. | Ruling below. |
| Tasks 1 and 3 self-consistency | The Task 1 image value is derived only from `TIDE_BOT_COMMIT`, while Task 3 must restore the exact previous image, including the legacy image on the initial migration. | Ruling below. |
| Task 2 self-consistency | CLI non-zero reconnect status and Task 3 warning behavior could be mistaken for a rollback condition. | Compatible: preserve CLI exit status for operators and convert only known reconnect states to a successful health-check warning result. |

## Rulings

- Ruling: use `TIDEBOT_OPEN_WEBUI_PORT` as the single port variable name — the approved design binds localhost port 3102 but does not prescribe a variable spelling; this matches Tide-Bot naming and avoids two silently diverging variables. Cost if wrong: an existing host file using the alternate spelling needs one documented rename during initialization.
- Ruling: add `TIDE_BOT_IMAGE_REF` to the live Compose image expression and retain `TIDE_BOT_COMMIT` for candidate build provenance — rollback must be able to run the recorded immutable image ID with `docker compose up --no-build`, including the first migration from the legacy image. Cost if wrong: an unusually constrained Compose version may reject the nested interpolation and require the updater to write a temporary, ignored override file.

Task 1: review 1 open — Critical: `deploy/tide-stack/README.md` still documents the old non-canonical production Compose command; Important: `TIDE_BOT_COMMIT` is optional and loses provenance; Important: environment ACL excludes a configurable scheduled-task identity; Important: synthetic sentinel fixture is created inside the repository; Minor (deferred): PRODUCTION.md labels Windows PowerShell commands as Bash.

Task 1: fix round 1/5 (4 addressed, 1 open — image-reference override accepts arbitrary mutable refs; commits 73a1781..e5cafd5)

- Ruling: remove `TIDE_BOT_IMAGE_REF` from the tracked live Compose overlay — the approved design requires an exact recorded prior image, but a raw environment substitution cannot prove it is recorded or immutable. Task 3 will validate the stored image ID against deployment state and create a private, ignored, one-use Compose override for `docker compose up --no-build`. Cost if wrong: the updater gains a small private override-file lifecycle rather than relying on an operator-set environment variable; this is safer and matches the design's state-driven rollback boundary.
- Ruling: require Open WebUI v0.11.1 (`d3e8bf3`, official latest release verified 2026-08-25) as the minimum upstream ancestor in Task 6 — the user explicitly requested this release while the plan was executing; Task 6 must fetch the tag and reject an upstream/main tip that does not contain it before merging. Cost if wrong: if upstream rewrites history or the verified tag is later found not to match upstream/main ancestry, integration stops and produces the existing sanitized upstream failure record rather than deploying an unverified baseline.

Task 1: fix round 2/5 (1 addressed, 0 open — arbitrary image-reference override removed; commits e5cafd5..37f5029)
Task 1: complete (commits 41a4507..37f5029, review clean)
Task 2: review 1 open — Important: the expired-credential success test stubs `get_valid_chatgpt_credentials` and therefore does not exercise the required existing encrypted expiry/refresh path before the catalog probe.
Task 2: fix round 1/5 (1 addressed, 0 open — synthetic expired credential now exercises decrypt, refresh, persistence, and catalog probe; commits 873e93f..ff44ff9)
Task 2: complete (commits 37f5029..ff44ff9, review clean)
Task 3: review 1 open — Critical: validated deployable commit does not control the checkout/build context; Critical: real command dispatch lacks state/failure record writes; Critical: recovery Compose invocations lack mandatory commit interpolation; Critical: entry point passes null StatePath/ComposeFile values over defaults; Critical: rollback lacks a validated predecessor state record; Important: partially mutating compose-up failure skips recovery; Important: StateRoot accepts arbitrary production host bind; Important: tar.zst is not compressed; Important: fake runner permits unknown operations and omits primary recovery/entry-point scenarios; Minor (deferred): failed record name lacks a timestamp.

- Ruling: on the first migration when `last-successful-deployment.json` does not yet exist, create a validated predecessor recovery record from the running Tide-Bot container's non-secret image ID, the known Compose file digest, and the just-created volume-backup manifest before replacement; it is not a successful-deployment state and cannot be skipped. Cost if wrong: the initial migration has one additional safe metadata record, but rollback has an auditable exact-image source instead of trusting a mutable container name.
Task 3: fix round 1/5 (7 addressed, 5 open — recovery `down` omits required commit interpolation; predecessor record/digest is not re-read and validated; scenario coverage incomplete; built image ID relies on Compose stdout; default state path omits `state`; commits 4924cb5..d7fc34c)
Task 3: fix round 2/5 (5 addressed, 1 open — failure branches exist but local/public/Socket.IO, state-write, and rollback-failure cases do not assert required operation ordering; commits d7fc34c..4ccdcc8)
Task 3: fix round 3/5 (1 addressed, 0 open — explicit literal recovery-order traces added for all remaining branches; commits 4ccdcc8..2b37a07)
Task 3: complete (commits ff44ff9..2b37a07, review clean)
Task 4: review 1 open — Critical: schedule enable accepts truncated state rather than full successful deployment evidence; Critical: alternate descendants of C:\ProgramData\Tide-Bot can validate a different repository than the scheduled updater later uses.
Task 4: fix round 1/5 (1 addressed, 1 open — canonical paths/actions fixed; shared success predicate accepts false/malformed health evidence; commits 68b5db9..d2f79bb)

- Ruling: enablement requires local, public, and Socket.IO health to be true; an ISO-8601 UTC deployment timestamp; and a fully typed safe OAuth result reporting a connected, decryptable connection with an available nonempty model catalog. The updater may retain its non-rollback OAuth warning semantics, but the first automatic scheduler must wait until OAuth preservation has been affirmatively verified. Cost if wrong: an outage or expired ChatGPT connection delays automatic updates until manually corrected and revalidated, favoring the user's stated OAuth-preservation requirement.
Task 4: fix round 2/5 (1 addressed, 0 open — shared affirmative health/OAuth scheduler predicate and zero-registration negatives added; commits d2f79bb..068747d)
Task 4: complete (commits 2b37a07..068747d, review clean)
Task 5: review 1 open — Critical: workflow commit/tag write paths lack Git identity; Critical: common gate omits browser voice tests; Critical: issue commands lack token; Critical: concurrent marker jobs can move tag backward; Important: no-op upstream run rewrites marker; Important: wrong v0.11.1 hash stops before creating issue; Important: validator is regex/source matching rather than branch behavior; Important: upstream record helper duplicates table headings across SHAs.
Task 5: fix round 1/5 (8 addressed, 1 open — structured policy test was disconnected from the workflow no-op guard; commits 8a7fb71..f5e9aab)
Task 5: fix round 2/5 (1 addressed, 0 open — the parsed ancestry step invokes the tested policy and gates all mutations; commits f5e9aab..cf3e495)
Task 5: complete (commits 068747d..cf3e495, independent reviews clean)
Task 6: complete (explicit merge b0b299c27; first parent cf3e495c3, second parent d3e8bf340; v0.11.1 verified; focused gates and Node 22 production build passed; disposable smoke environment-blocked by fixed-path Compose discovery)
Task 6: review 1 open — Critical: the integrated Alembic graph has two heads and `upgrade('head')` can fail; Important: upstream `issue-label.yaml` was inherited with issue-write permission; Important: `task-6-brief.md` is missing.
Task 6: fix round 1/5 (3 addressed, 0 open — no-op merge revision joins both schema branches with a real custom-head upgrade regression; exact workflow allowlist removes and prevents unapproved workflow inheritance; Task 6 brief restored)
Task 6: complete (commits cf3e495..f1d323b plus repair ded9ae2; independent re-review clean; one Alembic head and four approved workflows verified)
Task 6: release review 2 open — Critical: OAuth fallback continuity, deployable tag namespace, and workflow credential isolation; Important: atomic backup, ProgramData ACL, upstream state provenance, sanitized setup-failure state, exact baseline SHA; Minor: retain Windows Cloudflared ingress documentation.
Task 6: fix round 2/5 (9 addressed, 0 open — commit e61ba7f82 preserves omitted/explicit OAuth semantics and reconnect gating; exact tag plus fresh main refs; credential-free verification and isolated writes; stopped immutable-local backups; SYSTEM/Admin ACL; checked-out upstream provenance; sanitized setup failures; full v0.11.1 SHA; Cloudflared docs)
Task 6: verification review 3 open — Windows full-suite discovery assumed POSIX-only Python and Docker Compose locations despite compatible fixed Windows tools.
Task 6: fix round 3/5 (1 addressed, 0 open — commit 19954a24c adds strict cross-platform fixed-tool discovery; Node 22 focused validators and the 43-file/148-test frontend suite pass on Windows)
Task 6: verification review 4 open — the Windows workflow validator's bare `python` launcher still allowed caller-PATH command resolution.
Task 6: fix round 4/5 (1 addressed, 0 open — commit 86ec21b75 parses workflow YAML in-process with the pinned Node dependency and removes all Python candidates; focused and 43-file/148-test frontend suites pass)
Task 6: verification review 5 open — the source-security deny detector did not cover equivalent child-process, spawn/exec, Python-launcher, or caller-PATH spellings.
Task 6: fix round 5/5 (1 addressed, 0 open — commit efec857af adds twelve mutation cases and a precise detector for the prohibited validator source mechanisms; focused and 43-file/148-test frontend suites pass)
