# Task 6 report — Open WebUI main integration

## Scope and provenance

- Worktree: isolated reconciliation worktree only.
- Tide-Bot first parent: `cf3e495c3f3a551d6b90361b2e8f6df862201944`.
- Official remote: `https://github.com/open-webui/open-webui.git`.
- Fetched `upstream/main`: `d3e8bf3405e848cfba377814d0aa7ba7290e414d`.
- Official `v0.11.1` tag commit: `d3e8bf3405e848cfba377814d0aa7ba7290e414d`.
- Ancestry check: `v0.11.1` is an ancestor of fetched `upstream/main` (exit 0).
- Integration command: `git merge --no-commit --no-ff d3e8bf3405e848cfba377814d0aa7ba7290e414d`.
- Integration merge: `b0b299c27f3cf3fd682b526c35f89ef4f14ee1af`.
- Merge parents, in order: Tide-Bot
  `cf3e495c3f3a551d6b90361b2e8f6df862201944`, then upstream
  `d3e8bf3405e848cfba377814d0aa7ba7290e414d`.
- Merge subject: `chore: integrate Open WebUI main d3e8bf3405e8`.

No push, pull request, canonical/origin `main` mutation, deployable-tag move,
deployment, or live-resource access occurred in this task.

## Conflict inventory

Git reported 36 conflicted files:

1. `backend/open_webui/config.py`
2. `backend/open_webui/env.py`
3. `backend/open_webui/main.py`
4. `backend/open_webui/routers/chats.py`
5. `backend/open_webui/routers/openai.py`
6. `backend/open_webui/socket/main.py`
7. `backend/open_webui/utils/access_control/__init__.py`
8. `backend/open_webui/utils/middleware.py`
9. `package-lock.json`
10. `src/app.html`
11. `src/lib/components/AddTerminalServerModal.svelte`
12. `src/lib/components/OnBoarding.svelte`
13. `src/lib/components/admin/Evaluations/Feedbacks.svelte`
14. `src/lib/components/admin/Functions.svelte`
15. `src/lib/components/admin/Functions/FunctionMenu.svelte`
16. `src/lib/components/admin/Settings/Authentication.svelte`
17. `src/lib/components/admin/Settings/General.svelte`
18. `src/lib/components/chat/Chat.svelte`
19. `src/lib/components/chat/MessageInput.svelte`
20. `src/lib/components/chat/ModelSelector/ModelItemMenu.svelte`
21. `src/lib/components/chat/Settings/About.svelte`
22. `src/lib/components/chat/Settings/General.svelte`
23. `src/lib/components/chat/Settings/SyncStatsModal.svelte`
24. `src/lib/components/chat/ShareChatModal.svelte`
25. `src/lib/components/chat/ToolServersModal.svelte`
26. `src/lib/components/layout/Sidebar.svelte`
27. `src/lib/components/layout/Sidebar/UserMenu.svelte`
28. `src/lib/components/workspace/Models.svelte`
29. `src/lib/components/workspace/Prompts.svelte`
30. `src/lib/components/workspace/Tools.svelte`
31. `src/lib/components/workspace/common/CommunityDiscover.svelte`
32. `src/lib/constants.ts`
33. `src/routes/(app)/+layout.svelte`
34. `src/routes/+layout.svelte`
35. `src/routes/auth/+page.svelte`
36. `static/opensearch.xml`

All conflict markers were removed and all unmerged index entries were resolved.
No file or feature area was resolved by choosing one side wholesale.

## Resolution record

- Branding: retained Tide-Bot names, assets, favicon, onboarding/auth copy, and
  the branding audit while accepting compatible upstream v0.11.1 UI and
  accessibility changes. Upstream promotional/community-sharing surfaces were
  not reintroduced.
- ChatGPT subscription: combined upstream OpenAI connection/access/codec changes
  with device OAuth, encrypted credential persistence, status and refresh,
  model discovery, Responses request sanitization and SSE streaming, and the
  safe catalog probe.
- Voice: retained the ElevenLabs `CallOverlay` and the STT/chat/TTS fallback;
  no undocumented ChatGPT Realtime replacement was added.
- Chat and companion: combined upstream ask-user, tool approval, variables,
  queue migration, stop-by-chat, and scroll behavior with the Tide-Bot
  one-shot lifecycle, companion surface, presence socket service, compact
  composer, abort behavior, and URL suppression.
- Desktop and browser extension: retained companion origin restrictions,
  Tauri boundaries, browser pairing/authorization policy, voice unit behavior,
  and the static extension build.
- Deployment/security: retained the external-volume, localhost-only production
  overlay and the no-public-terminal/CPTR, no-telemetry, no-public-signup, and
  no-upstream-workflow-inheritance boundaries.
- Upstream v0.11.1 UI: accepted current persistent OAuth configuration,
  mobile sidebar/resizer, terminal context/chat-upload settings, dependency
  lock, Pyodide lock, migrations, API changes, and localization updates where
  they did not weaken Tide-Bot boundaries.

## Conflict-specific test evidence

Existing focused tests already covered most named boundaries before conflict
resolution. The custom `Chat.svelte` lifecycle/ask-user seam required a source
contract update: the red run failed because five wrapped socket callbacks were
expected while the merged behavior required six; after wrapping
`request:user_input` in the one-shot lifecycle, the contract passed with six.

## Verification evidence

- Node runtime: `v22.18.0`; npm `10.9.3`.
- Focused companion/chat frontend: 6 files, 23 tests passed.
- Browser extension: 18 files, 96 tests passed, including voice.
- Backend ChatGPT subscription, Responses streaming, safe CLI, companion store,
  and companion handlers: 50 tests passed.
- Windows/live-compose/upstream-workflow validators: 24 tests passed.
- Production health, updater, and schedule safeguards: all three scripts passed.
- Branding audit: passed after removing inherited promotional comments/URLs
  from audited product surfaces.
- Production build: passed under Node 22.18.0 with an 8 GB Node heap; 6,409
  client modules transformed and the static site was written to `build/`.
- Global `npm run check`: inherited baseline remains 7,774 errors and 200
  warnings in 344 files; recorded separately and not represented as a clean gate.
- Disposable companion smoke: invoked after the build with fresh run ID
  `task6-20260825-2109`, but the hermetic runner stopped before Docker mutation
  because it could not find the Compose plugin in an approved fixed system
  location. `docker compose version` independently reports v5.3.0. The runner's
  location restriction was not weakened.
- Whitespace/conflict/index verification: staged and unstaged `git diff
  --check` passed immediately before the merge; zero unmerged entries and zero
  unstaged paths were present.

The first build attempt reached chunk rendering but exhausted Node's default
approximately 4 GB heap. A shell-default Node 25 rerun was stopped immediately
and is not counted as evidence. The successful build above used only the pinned
Node 22.18.0 runtime.

## Review fix round 1

Independent review found that the upstream merge left two Alembic heads and
introduced the unapproved upstream `issue-label.yaml` workflow. The expected
Task 6 brief was also absent.

### RED evidence

- `test_migration_graph_has_exactly_one_head` failed with the literal heads
  `['c9f5e7a2b310', 'd4c1a8e37b62']`.
- `test_custom_pre_merge_database_upgrades_through_v0_11_1` first upgraded a
  disposable SQLite database to and verified stamp `c9f5e7a2b310`, then failed
  `upgrade('head')` with Alembic's `MultipleHeads` error naming both heads.
- `workflow directory contains only approved Tide-Bot workflows` failed because
  actual workflow files included unapproved `issue-label.yaml` in addition to
  the four expected Tide-Bot workflows.

### Implementation and GREEN evidence

- Added no-op merge revision `e8a7c2d4f691` with down revisions
  `c9f5e7a2b310` and `d4c1a8e37b62`. This joins version history only; it does
  not alter the existing migration environment, database URL handling, or
  synchronous/async application database configuration.
- The real SQLite upgrade test now passes from the custom pre-merge head to the
  single integrated head. It verifies upstream `chat.variables`,
  `chat.timer_at`, `user.variables`, and `automation.folder_id`, plus Tide-Bot
  browser rotation-grace columns.
- Removed `.github/workflows/issue-label.yaml` and added an exact workflow
  allowlist validator covering the four required Tide-Bot workflows and
  rejecting any unapproved YAML workflow introduction.
- Added `task-6-brief.md` with scope, constraints, and acceptance criteria.
- Focused GREEN run: 2 Alembic tests passed; 13 upstream workflow validator
  tests passed under Node 22.18.0.
- Broader affected-path GREEN run: 52 backend OAuth, Responses, companion, and
  migration tests passed; 25 Windows/live-compose/upstream-workflow validators
  passed under Node 22.18.0; the branding audit passed.
- Ruff 0.15.10 check and format verification passed for the new migration and
  migration regression test. The disposable project venv did not include Ruff,
  so the available host executable was used only for these read-only checks.
- `git diff --check` passed after the fixes.

## Whole-branch release review fix round 2

Commit `e61ba7f8225041c8e1635f76ab37c544611495df` addresses all confirmed
release-review findings without changing the explicit upstream merge ancestry.

### RED evidence

- The parsed workflow validator failed because the single reconciliation job
  had global `contents/issues/pull-requests: write`, no `verify`/`publish` job
  separation, and accepted any 40-character SHA beginning with `d3e8bf3`.
- The production-environment migration regression failed because a legacy
  empty `OAUTH_CLIENT_INFO_ENCRYPTION_KEY=` was copied unchanged, defeating the
  backend's absence-based `WEBUI_SECRET_KEY` fallback.
- The updater regression failed because it fetched `tide-bot-deployable` as an
  ambiguous name, resolved `origin/tide-bot-deployable`, did not refresh
  `origin/main`, archived a live SQLite/WAL volume through mutable Alpine plus
  online `apk`, and wrote the Tide deploy commit as `upstream_sha`.
- The rendered Compose regression exposed the old empty-string OAuth variable;
  the final contract distinguishes null/unset pass-through from an explicit
  nonempty value. A two-process credential test also proves ciphertext created
  under the legacy WEBUI secret decrypts when the dedicated OAuth key is absent.

### Implementation

- Compose now uses null pass-through for the optional OAuth encryption key.
  The initializer removes only a legacy empty declaration, preserves omitted
  state, and copies an explicit nonempty key unchanged. Reconnect-required
  remains a non-rollback health warning, while the schedule explicitly refuses
  that state until OAuth is connected, decryptable, and has a nonempty catalog.
- Updater and schedule force-fetch the exact tag ref, refresh the exact main
  tracking ref, resolve only `refs/tags/tide-bot-deployable^{commit}`, and test
  ancestry. A real temporary bare Git remote proves a stale main refreshes and
  a conflicting remote branch is rejected in favor of the tag.
- The upstream workflow now runs merge and gate work in a read-only job with
  `persist-credentials: false` and no GitHub token. A separate post-verification
  job revalidates the sanitized outcome/SHA and performs only issue or
  branch/pull-request mutations. It executes the record helper copied from the
  trusted base before merging and compares the full v0.11.1 SHA.
- Candidate build now finishes before downtime. The updater stops the service
  before snapshotting the data volume, uses the immutable already-local prior
  image with `--pull=never` and Python's standard-library tar support, and
  restarts the prior service on any pre-replacement backup failure. No online
  package install or mutable helper image remains.
- ProgramData production and backup roots receive protected SYSTEM and
  Administrators-only ACLs before sensitive writes. Every marker/ref/ancestry/
  checkout/provenance/build/backup failure writes a stage-only sanitized
  failure record before rethrowing.
- `docs/UPSTREAM_MAIN_SHA` records the exact integrated Open WebUI commit. The
  detached candidate must contain a full SHA that Git proves ancestral before
  successful state records use it as `upstream_sha`.
- Production documentation now states that the existing Windows Cloudflared
  service and `C:\ProgramData\cloudflared\config.yml` routing remain unchanged;
  the Nginx replacement example was removed.

### GREEN evidence

- Node 22.18.0: live Compose and upstream workflow validators, 19 tests passed.
- Node 22.18.0: Windows workflow validator, 9 tests passed with the project
  Python/PyYAML supplied through its documented `PYTHON_BIN` input.
- Python 3.12: ChatGPT subscription, safe probe CLI, and Responses streaming,
  19 tests passed; focused legacy ciphertext continuity, 2 tests passed.
- PowerShell: checkout bootstrap, environment initialization, scheduler,
  health, and updater safeguard suites all passed. The updater suite includes
  real synthetic Git refs, ordered stop/snapshot/recovery, ACL ordering,
  provenance, and all pre-replacement failure categories; it invokes no Docker.
- Branding audit passed. The production build passed under Node 22.18.0 with an
  8 GB heap, transformed 6,409 client modules, and wrote the static `build/`.
- PowerShell parser accepted every changed script; Python compile check passed;
  `git diff --check` passed.

The first combined Windows validator invocation lacked PyYAML on its default
Unix-oriented candidate paths; rerunning with the existing project Python via
`PYTHON_BIN` passed all nine tests. No push, pull request, tag/release mutation,
deployment, live sign-in, secret access, production access, or live-resource
operation occurred.

## Verification-only fix round 3

Commit `19954a24c805ca3b9b874554f77947a74c2310c7` fixes the two Node test
entry points that assumed POSIX-only tool locations when the full frontend
suite runs on Windows. It does not change deployment configuration, production
state, live resources, remote refs, or the explicit upstream merge ancestry.

### RED evidence

- With Node 22.18.0 and `PYTHON_BIN` genuinely absent,
  `validate-ted-bot-windows-workflow.test.mjs` failed before running its nine
  assertions because it tried only POSIX Python locations and `python3`.
- `run-companion-presence-redis-integration.test.mjs` failed all three tests
  because its Compose discovery tried only the macOS and Linux plugin paths,
  even though Docker Desktop's fixed Windows plugin was installed and rendered
  the presence Compose file successfully when invoked directly.
- The new focused discovery contract initially failed 4/4 assertions because
  the shared module did not exist. Two added runner-invocation assertions then
  failed because the fixed Windows Docker CLI and direct Compose invocation
  helpers were not yet implemented.

### Implementation

- A small shared helper now returns platform-specific approved candidates:
  Docker Desktop's exact Compose plugin and Docker CLI locations on Windows,
  the unchanged fixed macOS/Linux Compose locations, the correct platform null
  device, and the already-supported Python candidates. It does not add a bare
  `docker-compose` candidate or arbitrary Compose/Docker PATH lookup.
- The Windows workflow validator accepts the standard `python` launcher and
  still honors an explicit `PYTHON_BIN`; non-Windows candidate order and fixed
  locations remain unchanged.
- The presence config test invokes the validated Windows Compose plugin
  directly. The real integration runner uses that same fixed plugin and the
  fixed Docker Desktop CLI on Windows, while retaining the private plugin
  symlink and isolated Docker configuration on POSIX systems.
- The two cleanup tests use intentional `#!/bin/sh` fake-Docker fixtures. They
  remain active on POSIX and are explicitly skipped on Windows so a fake test
  can never fall through to the real Docker engine. Windows discovery and real
  Compose rendering remain active tests and perform no container mutation.

### GREEN evidence

- Node 22.18.0 focused discovery contract: 6/6 passed.
- Node 22.18.0 Windows workflow validator, with `PYTHON_BIN` removed: 9/9
  passed using the host's compatible `python` plus PyYAML.
- Node 22.18.0 presence validator: the real fixed-path Windows Compose config
  render passed; two POSIX-only fake-shell cleanup fixtures were skipped.
- Full `npm run test:frontend -- --run` under Node 22.18.0 passed all 43 test
  files and all 148 tests. There were no remaining environmental failures.
- Focused Prettier verification passed for all five changed test/runner files,
  and `git diff --check` passed.

No Docker stack was started, stopped, or changed. No push, pull request,
tag/release mutation, deployment, production/live access, secret access, or
remote operation occurred.
