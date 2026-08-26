# Tide-Bot Upstream Main Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Check off each step only after its stated test passes. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before the production cutover.

**Goal:** Make `kolbick/Tide-Bot` the sole live Tide-Bot source, continuously integrate compatible commits from Open WebUI `upstream/main`, preserve the existing production data and ChatGPT subscription OAuth configuration, and automatically deploy a tested deployable marker to `tide-bot.com` with backups and rollback.

**Architecture:** The canonical Tide-Bot repository gains a production Compose overlay that attaches the two existing Docker volumes and network as external resources. A GitHub Actions gate marks only tested `main` commits with a moving `tide-bot-deployable` tag. A locked Windows updater fetches that tag into a dedicated production checkout, backs up the live application volume, builds the exact commit, verifies local/public/Socket.IO/OAuth health, and restores the preceding image and volume when post-deploy verification fails. An hourly workflow merges the immutable current `upstream/main` SHA only when the merge and gate pass; conflicts and failures leave `main` and production unchanged.

**Tech Stack:** Git and GitHub Actions, Docker Compose, PowerShell 7/Windows Scheduled Tasks, Node 22.18.0/npm 10.9.3, Python 3.11, FastAPI/Open WebUI configuration APIs, Node `node:test`, pytest, Cloudflared, and the existing Tide-Bot Docker resources.

**Approved design:** `docs/superpowers/specs/2026-08-25-tide-bot-upstream-main-reconciliation-design.md`

## Global implementation constraints

- Start implementation in a fresh isolated worktree created with `superpowers:using-git-worktrees`; keep the current checkout and the legacy `kolb-bot-ui` worktree untouched.
- Use Node 22.18.0/npm 10.9.3 and Python 3.11 or 3.12. Do not use the host Node 25 as test or build evidence.
- Keep `kolbick/Tide-Bot` `main` as the only product branch after cutover. The legacy `kolb-bot-ui` Tide-Bot worktree remains a read-only rollback reference and is never merged by copying its directory or database.
- Do not commit, echo, inspect, serialize, artifact-upload, or test-report a secret, OAuth access token, refresh token, account identifier, API key, cookie, database, `.env`, log, or Docker-volume content.
- Preserve the exact values of `WEBUI_SECRET_KEY` and `OAUTH_CLIENT_INFO_ENCRYPTION_KEY` when configured. Do not rotate either during this migration. Do not migrate or replace the existing data or terminal volumes.
- Never run disposable-stack, Cypress, or browser tests against `localhost:3102`, the public domain, a user database, or user credentials. Production verification is limited to health endpoints and the sanitized in-container OAuth CLI described below.
- Never use `docker compose down -v`, `docker volume rm`, `git reset --hard`, `git checkout --`, or a broad `git add`. Stage named paths only.
- A successful deployment is recorded only after all post-deploy checks pass. Backup archives are retained indefinitely in the first implementation and rollback explicitly warns that writes since the pre-deploy backup are discarded.
- An upstream merge conflict or failed upstream test gate must create a sanitized visible GitHub issue and stop. It must not resolve conflicts automatically, modify `main`, move the deployable tag, or touch production.

## Deployment resource contract

| Resource | Required production value | Guardrail |
| --- | --- | --- |
| Application service | `tidebot-open-webui` | Bind only `127.0.0.1:3102:8080`; Cloudflared continues to own public ingress. |
| Application data | external volume `tidebot-webui_tidebot-open-webui` | Attach unchanged; archive before each replacement. |
| Terminal data | external volume `tidebot-webui_tidebot-computer` | Attach unchanged; do not copy or recreate. |
| Network | external network `tidebot-net` | Preserve the current internal terminal/provider connectivity. |
| Runtime secrets | `C:\ProgramData\Tide-Bot\production.env` | Host-only ACL; repository contains only a redacted example. |
| Deployment state | `C:\ProgramData\Tide-Bot\state\last-successful-deployment.json` | Safe metadata only: commit, upstream SHA, image ID, timestamps, and verifier result booleans. |
| Backup root | `C:\ProgramData\Tide-Bot\backups` | Immutable timestamped archives and non-secret manifests; no automatic cleanup. |
| Deploy candidate | annotated `tide-bot-deployable` tag | Updater rejects a tag that is not an ancestor of `origin/main`. |

## Task 1: Add a canonical production Compose overlay and secret-free environment migration

**Files:**

- Create: `deploy/tide-stack/docker-compose.live.yml`
- Create: `deploy/tide-stack/.env.live.example`
- Create: `scripts/validate-tide-bot-live-compose.test.mjs`
- Create: `scripts/initialize-tide-bot-production-environment.ps1`
- Create: `scripts/test-initialize-tide-bot-production-environment.ps1`
- Modify: `deploy/tide-stack/PRODUCTION.md`
- Modify: `deploy/tide-stack/README.md`
- Modify: `.gitignore`

**Step 1: Write the failing Compose-contract test**

Create a Node `node:test` suite that parses the live overlay with the repository YAML dependency and asserts the deployment resource contract. Assert exactly these invariants without reading any host environment file:

```js
assert.equal(compose.name, 'tidebot-webui');
assert.equal(service.container_name, 'tidebot-open-webui');
assert.equal(service.ports[0], '127.0.0.1:${TIDEBOT_OPEN_WEB_UI_PORT:-3102}:8080');
assert.equal(compose.volumes.tidebot_data.external.name, 'tidebot-webui_tidebot-open-webui');
assert.equal(compose.volumes.tidebot_computer.external.name, 'tidebot-webui_tidebot-computer');
assert.equal(compose.networks.tidebot_net.external.name, 'tidebot-net');
assert.doesNotMatch(await readFile(envExample, 'utf8'), /(?:sk-|Bearer |refresh_token|WEBUI_SECRET_KEY=.{20,})/i);
```

The test must also assert that `docker-compose.live.yml` contains no `env_file`, no `container_name` collision other than the known legacy names, no `ports` value exposed on all interfaces, and no Docker `volume` with `external: false`.

Run: `node --test scripts/validate-tide-bot-live-compose.test.mjs`

Expected: FAIL because the overlay and migration utility do not exist.

**Step 2: Implement the Compose overlay with explicit external resources**

Create the application service with a source-root build context and an image tag selected by the updater. Use an exact explicit binding and external aliases so Compose cannot create replacement storage:

```yaml
name: tidebot-webui

services:
  tidebot-open-webui:
    build:
      context: ../..
      dockerfile: Dockerfile
      args:
        BUILD_HASH: ${TIDE_BOT_COMMIT:?TIDE_BOT_COMMIT is required}
    image: tidebot-open-webui:${TIDE_BOT_COMMIT:?TIDE_BOT_COMMIT is required}
    container_name: tidebot-open-webui
    ports:
      - '127.0.0.1:${TIDEBOT_OPEN_WEB_UI_PORT:-3102}:8080'
    volumes:
      - tidebot_data:/app/backend/data
      - tidebot_computer:/root/.open-webui
    networks:
      - tidebot_net

volumes:
  tidebot_data:
    external: true
    name: tidebot-webui_tidebot-open-webui
  tidebot_computer:
    external: true
    name: tidebot-webui_tidebot-computer
networks:
  tidebot_net:
    external: true
    name: tidebot-net
```

Port the legacy terminal and provider environment *names* by first parsing the legacy Compose source and old host environment file without printing values. Include only the approved names in the new service or a named companion service; preserve the current defaults and no public terminal/CPTR exposure. The resulting `.env.live.example` lists each required key as `NAME=` with a prose comment explaining the expected value class. It must never contain a copied value.

Keep the local development Compose file unchanged. Update the two production docs to prescribe:

```powershell
docker compose --project-directory C:\ProgramData\Tide-Bot\repo `
  --env-file C:\ProgramData\Tide-Bot\production.env `
  -f deploy\tide-stack\docker-compose.live.yml config --quiet
```

**Step 3: Implement protected environment initialization and test it without secrets**

`initialize-tide-bot-production-environment.ps1` accepts a mandatory `-SourceEnvFile` and optional `-DestinationPath`, creates `C:\ProgramData\Tide-Bot`, copies the source without writing its contents to the pipeline, verifies only required variable *names*, and applies an ACL that grants the scheduled-task identity and Administrators read access while removing inherited broad read access. It must refuse a source under the repository, leave the source file intact, and use `-WhatIf` for dry-run verification.

The PowerShell test creates a temporary fixture with non-secret sentinel values, runs `-WhatIf`, and asserts the script does not output a sentinel or persist it in the repository. It also asserts that source-path refusal and a missing required name terminate before writes.

**Step 4: Run focused verification**

Run:

```powershell
node --test scripts/validate-tide-bot-live-compose.test.mjs
pwsh -NoProfile -File scripts/test-initialize-tide-bot-production-environment.ps1
docker compose -f deploy/tide-stack/docker-compose.live.yml --env-file deploy/tide-stack/.env.live.example config --quiet
git diff --check
```

Expected: PASS. The Compose parser sees the existing external volume and network names; no command reads or prints production values.

**Step 5: Commit**

```powershell
git add deploy/tide-stack/docker-compose.live.yml deploy/tide-stack/.env.live.example scripts/validate-tide-bot-live-compose.test.mjs scripts/initialize-tide-bot-production-environment.ps1 scripts/test-initialize-tide-bot-production-environment.ps1 deploy/tide-stack/PRODUCTION.md deploy/tide-stack/README.md .gitignore
git commit -m "deploy: add Tide-Bot live compose overlay"
```

## Task 2: Add a sanitized in-container ChatGPT subscription health verifier

**Files:**

- Create: `backend/open_webui/cli/verify_chatgpt_subscription.py`
- Create: `backend/tests/test_verify_chatgpt_subscription_cli.py`
- Modify: `backend/open_webui/routers/openai.py`
- Modify: `backend/tests/test_chatgpt_subscription.py`

**Step 1: Write failing unit tests for the safe result contract**

Add tests that mock configuration and network calls for five outcomes: no configured connection, decryptable unexpired credentials, decryptable expired credentials refreshed successfully, decrypt failure, and refresh failure/revocation. Assert the CLI result has exactly these safe fields and never contains the encrypted value, access token, refresh token, account ID, email, raw exception detail, URL, or provider key:

```py
assert result == {
    'connection_present': True,
    'credential_decryptable': True,
    'credential_state': 'connected',
    'model_catalog_available': True,
    'model_count': 2,
}
```

Add a serialization test that scans stdout for fixture secret markers and fails if a marker appears. Run:

```powershell
pytest -q backend/tests/test_verify_chatgpt_subscription_cli.py backend/tests/test_chatgpt_subscription.py
```

Expected: FAIL because the CLI contract is absent.

**Step 2: Extract a reusable, non-HTTP catalog probe**

Refactor the existing OpenAI router only enough to expose an internal helper that receives the resolved ChatGPT connection and uses the same `get_headers_and_cookies` and model-list request path as the existing refresh endpoint. The helper returns an integer model count, never model IDs. It must retain the current API endpoints and authorization rules unchanged.

Use a typed result that permits only these states:

```py
CredentialState = Literal['connected', 'disconnected', 'reconnect_required', 'refresh_failed', 'catalog_unavailable']

class ChatGPTSubscriptionHealth(TypedDict):
    connection_present: bool
    credential_decryptable: bool
    credential_state: CredentialState
    model_catalog_available: bool
    model_count: int
```

The helper decrypts using `decrypt_credentials`, validates/refreshes only through `get_valid_chatgpt_credentials`, and maps errors to the safe state names. It never stores secrets in a result, log message, exception text, or CLI exit line.

**Step 3: Implement the CLI**

Implement `python -m open_webui.cli.verify_chatgpt_subscription` as an async module that loads the application configuration, locates the stored ChatGPT connection with `get_openai_runtime_config()` and `_find_chatgpt_connection()`, runs the reusable safe probe, and prints one JSON object created with `json.dumps(result, sort_keys=True)`. Exit `0` for `connected`; exit `20` for `reconnect_required`; exit `21` for a missing connection; and exit `22` for a sanitized operational failure.

The deployment updater treats the last three cases as an OAuth warning state, not a service rollback condition. This preserves availability if a user must reconnect ChatGPT while ensuring the state record never claims it is working.

**Step 4: Run focused verification**

Run:

```powershell
pytest -q backend/tests/test_verify_chatgpt_subscription_cli.py backend/tests/test_chatgpt_subscription.py backend/tests/test_responses_streaming.py
python -m compileall -q backend/open_webui/cli/verify_chatgpt_subscription.py
git diff --check
```

Expected: PASS. Existing administrator device-login, encrypted persistence, refresh, model refresh, and streaming behavior remains covered.

**Step 5: Commit**

```powershell
git add backend/open_webui/cli/verify_chatgpt_subscription.py backend/tests/test_verify_chatgpt_subscription_cli.py backend/open_webui/routers/openai.py backend/tests/test_chatgpt_subscription.py
git commit -m "test: add sanitized ChatGPT subscription health probe"
```

## Task 3: Build the locked production updater, backup, recovery, and safe state record

**Files:**

- Create: `scripts/tide-bot-production-update.ps1`
- Create: `scripts/test-tide-bot-production-update.ps1`
- Create: `scripts/tide-bot-production-health.ps1`
- Create: `scripts/test-tide-bot-production-health.ps1`
- Create: `scripts/tide-bot-production-update.schema.json`
- Modify: `.gitignore`
- Modify: `deploy/tide-stack/PRODUCTION.md`

**Step 1: Write failing PowerShell tests around injected command runners**

Keep Docker and Git side effects behind an injectable `Invoke-TideBotCommand` function so the tests can use a fake runner and an isolated temporary root. Cover: deployable tag already recorded, tag not reachable from `origin/main`, successful backup/build/recreate/verify, build failure before replacement, local health failure after replacement, public health failure, Socket.IO failure, OAuth reconnect warning, state-write failure, and rollback failure.

Each test must assert command ordering. The primary successful sequence is:

```text
fetch tag -> validate tag ancestry -> inspect current image ID -> archive volume -> build candidate -> up --detach --force-recreate -> local health -> public health -> Socket.IO handshake -> OAuth CLI -> write state
```

The failed post-deploy sequence must be:

```text
compose down (without -v) -> restore known archive into known volume -> start recorded prior image -> verify local health -> write failed-deployment record
```

Run: `pwsh -NoProfile -File scripts/test-tide-bot-production-update.ps1`

Expected: FAIL because the updater functions do not exist.

**Step 2: Implement candidate selection, locking, and safe state**

Implement these functions with named parameters and no implicit working-directory dependence:

```powershell
function Get-TideBotDeployableCommit { param([string] $RepositoryPath) }
function Test-TideBotCandidateIsOnMain { param([string] $RepositoryPath, [string] $Commit) }
function Enter-TideBotDeploymentLock { param([string] $Name = 'Global\TideBot-Upstream-Deploy') }
function Read-TideBotDeploymentState { param([string] $StatePath) }
function Write-TideBotDeploymentState { param([string] $StatePath, [hashtable] $State) }
```

`Get-TideBotDeployableCommit` resolves `origin/tide-bot-deployable^{commit}` after a quiet fetch. `Test-TideBotCandidateIsOnMain` uses `git merge-base --is-ancestor $Commit origin/main`; a failure is terminal and does not build. State contains only `schema_version`, `commit`, `upstream_sha`, `image_id`, `deployed_at_utc`, `local_health`, `public_health`, `socketio_health`, and the safe OAuth result fields.

Acquire the global mutex before touching the checkout, release it in `finally`, and make a concurrent invocation return success with `status: already_running` rather than overlap a deployment.

**Step 3: Implement backup and restore against exact named resources**

Before replacing the service, inspect only the running container image ID and labels, archive `tidebot-webui_tidebot-open-webui` with the known current image, and write a manifest with a SHA-256 digest of the archive. Use a Docker helper container with explicit volume mounts; never inspect its environment and never mount an arbitrary path.

The archive file name must be UTC sortable:

```text
C:\ProgramData\Tide-Bot\backups\$($UtcTimestamp)-$($CandidateCommit.Substring(0, 12))-tidebot-data.tar.zst
```

Validate the manifest's volume name, file hash, and archive listing before restore. On post-deploy failure, run `docker compose down` without `-v`, restore only that exact named data volume from the immediately preceding archive, recreate the recorded prior image with the same protected environment file, and verify `http://127.0.0.1:3102/health`. Write a sanitized `failed-deployment-*.json` record that includes `data_written_after_backup_discarded: true`.

Do not restore when the candidate build fails before service replacement. Do not delete an archive in either success or failure paths.

**Step 4: Implement health checks**

`tide-bot-production-health.ps1` must perform the following bounded checks:

```powershell
$local = Invoke-RestMethod 'http://127.0.0.1:3102/health' -TimeoutSec 20
$public = Invoke-WebRequest 'https://tide-bot.com/health' -UseBasicParsing -TimeoutSec 30
$socket = Invoke-WebRequest 'http://127.0.0.1:3102/socket.io/?EIO=4&transport=polling' -UseBasicParsing -TimeoutSec 20
```

Require `$local.status -eq $true`, a successful public response, and a Socket.IO polling payload beginning with `0{`. Execute the in-container Python health module with `docker exec tidebot-open-webui python -m open_webui.cli.verify_chatgpt_subscription`; parse exactly one JSON line, redact all command stderr before recording it, and record a reconnect state as an explicit warning. Local/public/Socket.IO failures return non-zero; a reconnect warning returns zero with `oauth_healthy: false`.

**Step 5: Run focused verification**

Run:

```powershell
pwsh -NoProfile -File scripts/test-tide-bot-production-health.ps1
pwsh -NoProfile -File scripts/test-tide-bot-production-update.ps1
pwsh -NoProfile -File scripts/tide-bot-production-update.ps1 -WhatIf -RepositoryPath C:\Tide-Bot\production -StateRoot $env:TEMP\tide-bot-plan-fixture
git diff --check
```

Expected: PASS. The dry run outputs operations and safe metadata only; it does not read a production environment file, create a Docker archive, build an image, or contact the public service.

**Step 6: Commit**

```powershell
git add scripts/tide-bot-production-update.ps1 scripts/test-tide-bot-production-update.ps1 scripts/tide-bot-production-health.ps1 scripts/test-tide-bot-production-health.ps1 scripts/tide-bot-production-update.schema.json .gitignore deploy/tide-stack/PRODUCTION.md
git commit -m "deploy: automate Tide-Bot backup and rollback"
```

## Task 4: Bootstrap the controlled checkout and install the guarded Windows schedule

**Files:**

- Create: `scripts/install-tide-bot-production-schedule.ps1`
- Create: `scripts/test-install-tide-bot-production-schedule.ps1`
- Create: `scripts/bootstrap-tide-bot-production-checkout.ps1`
- Create: `scripts/test-bootstrap-tide-bot-production-checkout.ps1`
- Modify: `deploy/tide-stack/PRODUCTION.md`

**Step 1: Write failing schedule and checkout tests**

Test that the bootstrap script rejects a checkout inside a user/developer worktree, clones only `https://github.com/kolbick/Tide-Bot.git`, configures `upstream` as `https://github.com/open-webui/open-webui.git`, checks out the immutable deployable commit, and writes no secret-bearing file.

Test that the schedule script creates exactly `TideBot-Upstream-Deploy`, runs as the designated local deployment account once per day, has `MultipleInstances = IgnoreNew`, and calls the updater by absolute path with `-NoProfile -ExecutionPolicy Bypass`. Add a `-Disable` switch that unregisters only this exact task after confirming its task path and name.

Run:

```powershell
pwsh -NoProfile -File scripts/test-bootstrap-tide-bot-production-checkout.ps1
pwsh -NoProfile -File scripts/test-install-tide-bot-production-schedule.ps1
```

Expected: FAIL because the scripts are absent.

**Step 2: Implement the controlled checkout bootstrap**

Use `C:\ProgramData\Tide-Bot\repo` as the default checkout, which is outside all developer worktrees. Require an explicit `-RepositoryPath` only when it resolves under `C:\ProgramData\Tide-Bot`. Clone with `--origin origin`, fetch tags/prune, add or update `upstream`, and verify that `origin` exactly resolves to `https://github.com/kolbick/Tide-Bot.git` before checkout. The script must reject a dirty repository rather than discarding changes.

The first manual run receives the exact `tide-bot-deployable` commit from the updater; later runs fetch it. The script must not switch the legacy repository or modify `C:\Users\sshkolby\tide-bot-live`.

**Step 3: Implement the schedule installer**

Register a task with `New-ScheduledTaskAction`, `New-ScheduledTaskTrigger -Once` plus a one-day repetition interval, `New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable`, and a task description that states it deploys only a tested Git marker. Record the execution account name in the task definition and grant that identity read access to `production.env` during environment initialization.

The default mode is `-Disabled`: it validates all inputs and creates no task. `-Enable` is permitted only after the initial manual cutover task has written a successful state record and the caller confirms the state record commit equals `tide-bot-deployable`.

**Step 4: Run focused verification**

Run:

```powershell
pwsh -NoProfile -File scripts/test-bootstrap-tide-bot-production-checkout.ps1
pwsh -NoProfile -File scripts/test-install-tide-bot-production-schedule.ps1
pwsh -NoProfile -File scripts/bootstrap-tide-bot-production-checkout.ps1 -WhatIf
pwsh -NoProfile -File scripts/install-tide-bot-production-schedule.ps1 -WhatIf
git diff --check
```

Expected: PASS. No Scheduled Task is installed during tests or dry runs.

**Step 5: Commit**

```powershell
git add scripts/install-tide-bot-production-schedule.ps1 scripts/test-install-tide-bot-production-schedule.ps1 scripts/bootstrap-tide-bot-production-checkout.ps1 scripts/test-bootstrap-tide-bot-production-checkout.ps1 deploy/tide-stack/PRODUCTION.md
git commit -m "deploy: add Tide-Bot production task bootstrap"
```

## Task 5: Add repeatable upstream and deployable-marker test gates

**Files:**

- Create: `.github/workflows/tide-bot-upstream-main.yml`
- Create: `.github/workflows/tide-bot-deployable.yml`
- Create: `scripts/run-tide-bot-update-gate.mjs`
- Create: `scripts/record-upstream-integration.mjs`
- Create: `scripts/validate-tide-bot-upstream-workflows.test.mjs`
- Modify: `package.json`
- Modify: `docs/UPSTREAM.md`
- Modify: `docs/UPSTREAM_SYNC.md`

**Step 1: Write a failing workflow-structure test**

Parse both workflow YAML files in a Node test. Assert the upstream job has hourly cron, `workflow_dispatch`, `contents: write`, and `issues: write`; pins Node 22.18.0 and Python 3.11 or 3.12; fetches `upstream/main`; creates a branch named with the resolved 40-character SHA; does not use `git merge -s ours`, `git checkout --theirs`, `git reset --hard`, or a force push to `main`; and opens an issue on conflict/gate failure.

Assert the marker workflow runs after the common gate succeeds on `main`, moves only the annotated `tide-bot-deployable` tag to `GITHUB_SHA`, and force-updates only `refs/tags/tide-bot-deployable`. Assert neither workflow uploads `.env`, Docker archives, database files, or test data as artifacts.

Run: `node --test scripts/validate-tide-bot-upstream-workflows.test.mjs`

Expected: FAIL because the workflows and common gate are absent.

**Step 2: Implement the shared update gate**

Expose this deterministic npm command:

```json
"test:update-gate": "node scripts/run-tide-bot-update-gate.mjs"
```

The script checks the exact Node major/minor, runs focused frontend companion/voice tests and backend ChatGPT subscription and Responses streaming tests, runs `npm run audit:branding`, performs `npm run build`, runs the disposable-stack smoke defined by the repository, and ends with `git diff --check`. It writes only summarized test status and exact Git commit/SHA; it redacts strings matching known credential shapes before output.

Do not run a bare global `npm run check` as an all-clear gate because it has an inherited upstream diagnostic baseline. Record its result separately when an affected change warrants it.

**Step 3: Implement the hourly upstream workflow**

The upstream workflow executes this control flow with the resolved SHA stored in `UPSTREAM_SHA`:

```bash
git remote add upstream https://github.com/open-webui/open-webui.git 2>/dev/null || git remote set-url upstream https://github.com/open-webui/open-webui.git
git fetch --no-tags upstream main
UPSTREAM_SHA="$(git rev-parse upstream/main^{commit})"
git merge-base --is-ancestor "$UPSTREAM_SHA" origin/main && exit 0
git switch --create "automation/upstream-main-${UPSTREAM_SHA:0:12}" origin/main
git merge --no-ff --no-commit "$UPSTREAM_SHA"
```

On a conflict, capture only `git diff --name-only --diff-filter=U`, abort the merge, create a GitHub issue containing the SHA and conflicting paths, and exit non-zero. On a clean merge, run the common gate, run `record-upstream-integration.mjs --upstream-sha "$UPSTREAM_SHA"` to update `docs/UPSTREAM.md`, commit the merge and record, push the review branch, then merge it into `main` using the repository’s GitHub CLI path. Direct push to `main` is permitted only after a clean merge and passing gate; it must never bypass required status checks.

**Step 4: Implement the deployable marker workflow**

On an eligible `main` push or successful upstream integration, rerun the shared gate in a clean runner. Only on success create/update the annotated tag:

```bash
git tag -fa tide-bot-deployable "$GITHUB_SHA" -m "Tide-Bot deployable $GITHUB_SHA"
git push origin refs/tags/tide-bot-deployable --force
```

Never move the tag on a failed workflow, pull request, workflow from a fork, or non-main ref. Document that the production updater deploys the tag commit only after verifying it is an ancestor of `origin/main`.

**Step 5: Run focused verification**

Run:

```powershell
node --test scripts/validate-tide-bot-upstream-workflows.test.mjs
npm run test:update-gate
git diff --check
```

Expected: PASS. A controlled `workflow_dispatch` dry run with no new upstream commit exits without changing `main` or the marker.

**Step 6: Commit**

```powershell
git add .github/workflows/tide-bot-upstream-main.yml .github/workflows/tide-bot-deployable.yml scripts/run-tide-bot-update-gate.mjs scripts/record-upstream-integration.mjs scripts/validate-tide-bot-upstream-workflows.test.mjs package.json docs/UPSTREAM.md docs/UPSTREAM_SYNC.md
git commit -m "ci: track Open WebUI main behind Tide-Bot gate"
```

## Task 6: Integrate the current Open WebUI `main` SHA without losing Tide-Bot behavior

**Files:**

- Modify: every conflict-resolved product file required by the merge, including `backend/open_webui/`, `src/`, `deploy/tide-stack/`, `desktop/tide-bot/`, and test files
- Modify: `docs/UPSTREAM.md`
- Modify: `docs/UPSTREAM_SYNC.md`
- Create only focused regression tests required by actual conflict resolutions

**Step 1: Establish the exact upstream point and a clean integration branch**

From the isolated Tide-Bot worktree, add/update the official remote, fetch it, and create a branch from current canonical `main`:

```powershell
git remote add upstream https://github.com/open-webui/open-webui.git 2>$null
if ($LASTEXITCODE -ne 0) { git remote set-url upstream https://github.com/open-webui/open-webui.git }
git fetch --no-tags upstream main
$upstreamSha = (git rev-parse upstream/main^{commit}).Trim()
git switch -c "integration/open-webui-main-$($upstreamSha.Substring(0, 12))" origin/main
git merge --no-ff --no-commit $upstreamSha
```

If Git reports conflicts, inventory only filenames, resolve each one deliberately, and add a regression test for every preserved Tide-Bot boundary. If the conflicts cannot be reconciled while preserving the invariants, abort the merge and create the sanitized issue format from Task 5. Never prefer either side wholesale.

**Step 2: Preserve named feature seams during every conflict resolution**

Use this merge decision table:

| Area | Required result |
| --- | --- |
| Branding | Keep Tide-Bot copy, assets, app name, and `npm run audit:branding` gate while incorporating compatible upstream accessibility/security fixes. |
| ChatGPT subscription | Keep device login, encrypted storage, status API, refresh, model discovery, Responses streaming, and the safe production probe. |
| Voice | Keep the existing ElevenLabs `CallOverlay` path and non-voice STT/chat/TTS fallback; do not substitute undocumented ChatGPT Realtime behavior. |
| Companion/desktop | Keep `/companion`, presence socket handlers, compact chat surface, Tauri origin restrictions, and their source-contract/Cargo tests. |
| Browser extension | Keep pairing and authorization restrictions, static download build, and extension workflow. |
| Deploy/security | Keep external-volume production overlay, local-only public binding, no public terminal/CPTR exposure, and no upstream telemetry/signup/workflow inheritance. |

The result must contain an explicit merge commit whose first parent is Tide-Bot and second parent is the exact fetched upstream SHA. Update `docs/UPSTREAM.md` with that SHA, merge commit, date, and a concise preserved-customizations summary.

**Step 3: Add and run conflict-specific tests before completing the merge**

Write failing focused tests before each custom conflict resolution. At minimum run:

```powershell
npm run test:frontend -- src/lib/ted-bot src/lib/components/ted-bot src/lib/components/chat
pytest -q backend/tests/test_chatgpt_subscription.py backend/tests/test_responses_streaming.py backend/open_webui/socket/test_companion_presence.py
node --test scripts/validate-ted-bot-windows-workflow.test.mjs scripts/validate-tide-bot-live-compose.test.mjs scripts/validate-tide-bot-upstream-workflows.test.mjs
npm run audit:branding
npm run build
git diff --check
```

Run the repository’s isolated disposable-stack smoke after the frontend build, with a fresh permitted run identifier, and never against live resources. Report inherited `npm run check` diagnostics separately rather than treating them as introduced failures.

**Step 4: Commit, review, and mark deployable**

Commit the integration with the recorded SHA only after the focused gate passes:

```powershell
Stage each conflict-resolved file by its exact pathname, plus `docs/UPSTREAM.md` and `docs/UPSTREAM_SYNC.md`; do not use a wildcard or broad pathspec. Commit with:

```powershell
git commit -m "chore: integrate Open WebUI main $($upstreamSha.Substring(0, 12))"
```
```

Request code review, resolve only confirmed findings, rerun the gate, merge the reviewed branch into canonical `main`, and let the Task 5 marker workflow create `tide-bot-deployable`. Do not manually move the marker except from the protected workflow.

## Task 7: Perform the observed initial cutover and enable automatic updates

**Files:**

- Modify: `deploy/tide-stack/PRODUCTION.md`
- Modify: `docs/TIDE_BOT_HANDOFF.md`
- Create: `docs/superpowers/2026-08-25-tide-bot-live-cutover-acceptance.md`

**Step 1: Record a pre-cutover, secret-free baseline**

Before touching the live service, run read-only commands that record: the active Cloudflared Windows service state, its `tide-bot.com -> localhost:3102` mapping, live container name/image ID, exact external volume names, exact terminal container/service status, and public/local health responses. Save only the values allowed by the deployment state schema in the acceptance record; do not include headers, environment values, container configuration, database rows, or logs.

Verify the controlled checkout path is outside all developer worktrees, the `production.env` file exists with the correct ACL, and its *required names* are present. Leave the old host environment file and `tide-bot-live` untouched.

**Step 2: Bootstrap and dry-run without enabling the schedule**

Run, in order:

```powershell
pwsh -NoProfile -File scripts/initialize-tide-bot-production-environment.ps1 -SourceEnvFile C:\Users\sshkolby\tide-bot-live\.env
pwsh -NoProfile -File scripts/bootstrap-tide-bot-production-checkout.ps1 -RepositoryPath C:\ProgramData\Tide-Bot\repo
pwsh -NoProfile -File scripts/tide-bot-production-update.ps1 -RepositoryPath C:\ProgramData\Tide-Bot\repo -WhatIf
pwsh -NoProfile -File scripts/install-tide-bot-production-schedule.ps1 -Disabled
```

Inspect the dry-run plan: candidate must equal `tide-bot-deployable`, its Git ancestry must end at canonical `main`, the Compose file must bind `127.0.0.1:3102`, and its external names must be the existing two volumes plus `tidebot-net`.

**Step 3: Execute the one manually observed deployment**

Run the updater once without `-WhatIf` using the exact controlled checkout. It must build before replacement, archive the existing application data volume, recreate the live service without `-v`, and run all four verifier classes. Personally observe, after the script reports success:

1. `https://tide-bot.com` loads the current Tide-Bot branding and existing account data.
2. A normal authenticated chat completes.
3. `/companion` establishes presence and sends/stops a test chat as the existing feature tests prescribe.
4. Administrator settings show the saved ChatGPT subscription state, and model refresh succeeds if the credential state is `connected`; if it reports `reconnect_required`, record that truthfully and do not claim OAuth preserved until the administrator reconnects.
5. Existing terminal access works only through its intended private route; no new public endpoint is exposed.

If any health check fails, allow the updater to complete its recorded automatic restoration, then verify restored local and public health. Do not enable the schedule in this state.

**Step 4: Enable scheduling only after acceptance passes**

Compare `last-successful-deployment.json` to the current `tide-bot-deployable` commit, archive path, image ID, and verifier booleans. When all required checks and manual observations pass, install and start the exact task:

```powershell
pwsh -NoProfile -File scripts/install-tide-bot-production-schedule.ps1 -Enable
Start-ScheduledTask -TaskName TideBot-Upstream-Deploy
```

Verify its first run exits as `already_current`; it must not build or recreate a service. Add the task identity, controlled checkout path, safe state path, backup root, latest upstream SHA, production commit, observed checks, and rollback test result to the acceptance record and handoff document.

**Step 5: Security follow-up and final verification**

After the cutover has been stable for an agreed observation period, rotate the exposed provider and service credentials one at a time through the host-only environment file, verify the corresponding provider, and record completion without values. Do not rotate OAuth/database encryption inputs in this task. A future explicitly approved migration must decrypt/re-encrypt protected configuration and perform a fresh ChatGPT device login before changing them.

Run the final evidence set:

```powershell
node --test scripts/validate-tide-bot-live-compose.test.mjs scripts/validate-tide-bot-upstream-workflows.test.mjs
pwsh -NoProfile -File scripts/test-tide-bot-production-health.ps1
pwsh -NoProfile -File scripts/test-tide-bot-production-update.ps1
npm run audit:branding
git diff --check
```

Expected: all automated checks pass, `tide-bot.com` is served from the canonical controlled checkout, the legacy worktree remains untouched as a rollback reference, and the first scheduled run is a no-op when no deployable marker changed.

**Step 6: Commit operational evidence**

```powershell
git add deploy/tide-stack/PRODUCTION.md docs/TIDE_BOT_HANDOFF.md docs/superpowers/2026-08-25-tide-bot-live-cutover-acceptance.md
git commit -m "docs: record Tide-Bot live cutover"
```

## Final integration checklist

- [ ] The canonical remote is `https://github.com/kolbick/Tide-Bot.git`; the official Open WebUI remote is named `upstream` and resolves to `https://github.com/open-webui/open-webui.git`.
- [ ] `tide-bot-deployable` points to a tested commit that is an ancestor of canonical `main`; its upstream parent SHA is recorded.
- [ ] The production overlay uses only external `tidebot-webui_tidebot-open-webui`, `tidebot-webui_tidebot-computer`, and `tidebot-net` resources and binds only localhost port 3102.
- [ ] The first volume archive has a verified digest and the updater’s automatic restore path has been exercised in a non-production test fixture.
- [ ] The ChatGPT verifier emits only its fixed safe JSON schema; production state files and workflow logs contain no secret material or account identifiers.
- [ ] Cloudflared continues to route `tide-bot.com` to `localhost:3102`; no routing or public-terminal change was made.
- [ ] A clean compatible `upstream/main` change merges, gates, marks, and deploys automatically; a conflict or failed gate changes neither `main` nor production and creates a visible sanitized issue.
