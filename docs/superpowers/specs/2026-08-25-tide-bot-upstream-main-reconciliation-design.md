# Tide-Bot Upstream Main Reconciliation and Auto-Deployment Design

## Status

Approved design awaiting user review before implementation planning.

## Goal

Consolidate Tide-Bot into the `kolbick/Tide-Bot` repository, preserve its
Tide-specific functionality and existing live data (including the
administrator-managed ChatGPT OAuth connection), and automatically deploy
tested updates derived from Open WebUI `upstream/main` to `tide-bot.com`.

## Current-state finding

The live application is built from `C:\Users\sshkolby\tide-bot-live`, a linked
worktree of the older `kolb-bot-ui` repository. Its deployed `tidebot-open-webui`
container was built from July 2 source. `C:\Users\sshkolby\tide-bot-new` is a
separate checkout of `https://github.com/kolbick/Tide-Bot.git`; it contains the
newer Tide-Bot work, including companion, desktop, browser-extension,
ElevenLabs voice, and ChatGPT subscription changes.

The two repositories must not be merged by combining their unrelated working
directories or copying a database. The canonical source will instead be
`kolbick/Tide-Bot`; selected operational settings from the old live stack are
ported as reviewed, secret-free deployment code.

## Scope

Included:

- Add the official Open WebUI repository as the `upstream` remote in the
  canonical Tide-Bot repository and integrate `upstream/main` continuously.
- Retain Tide-Bot product commits, the ChatGPT subscription OAuth feature, the
  companion/desktop work, browser extension, and Tide-Bot branding whenever an
  upstream integration conflicts with them.
- Move the live Compose topology into the canonical repository without moving
  any secret values into Git.
- Deploy using the existing Tide-Bot Docker data and terminal volumes so chats,
  users, uploads, settings, and encrypted OAuth configuration persist.
- Add automated synchronization, test gates, backup, deployment, health
  verification, failure notification, and recovery behavior.
- Make one manually observed initial cutover, then enable scheduled updates.

Excluded:

- Copying the live `.env`, database, logs, or Docker volume into source control
  or a development environment.
- Replacing Cloudflare routing. The Windows `Cloudflared` service continues to
  route `tide-bot.com` to the Tide-Bot service on `localhost:3102`.
- Automatically forcing a Git merge conflict through production.
- Automatically rotating encryption material during the first migration.

## Canonical source and upstream synchronization

`main` in `kolbick/Tide-Bot` becomes the only product-source branch. The old
`Tide-Bot` branch in the `kolb-bot-ui` repository is retained only as a
read-only rollback reference after cutover; no new product change is made
there.

The canonical repository gains an `upstream` remote pointing to
`https://github.com/open-webui/open-webui.git`. An hourly GitHub Actions
workflow fetches `upstream/main`, detects whether its commit has already been
integrated, and creates an integration branch when it has not. It merges the
exact upstream SHA with a merge commit, never a moving branch reference. The
commit and upstream SHA are recorded in `docs/UPSTREAM.md`.

The workflow runs the full update gate on the integration branch. A clean
merge with a passing gate is fast-forwarded or merged into Tide-Bot `main` and
marked deployable. A conflict or failed gate leaves `main` and the live site
unchanged, records the upstream SHA and failure, and creates a visible GitHub
issue. This means Tide-Bot follows upstream main automatically whenever the
customizations are compatible, while an incompatible upstream change is never
silently deployed.

The automated updater also runs on direct Tide-Bot `main` changes. That keeps
product fixes and upstream-derived updates on the same tested deployment path.

## Feature-preservation invariants

Every upstream integration must preserve the following Tide-Bot behavior:

- Tide-Bot branding and the branding audit allowlist.
- Companion presence, `/companion`, and the Tauri desktop shell.
- The paired browser extension and its authorization boundaries.
- Existing ElevenLabs voice integration until explicitly replaced.
- ChatGPT subscription administration, device login, encrypted credential
  persistence, refresh, model discovery, and Responses streaming.
- Existing live provider, terminal, and Cloudflare connectivity configured
  outside the repository.

ChatGPT subscription credentials live in the existing application data as an
encrypted connection configuration. The migration preserves both the existing
data volume and the exact encryption-related runtime inputs (`WEBUI_SECRET_KEY`
and `OAUTH_CLIENT_INFO_ENCRYPTION_KEY` when configured). No test, log, status
file, or workflow output may print an access token, refresh token, account ID,
or provider secret.

## Production deployment boundary

The canonical repository owns a production Compose overlay under
`deploy/tide-stack/`. It reproduces the current Tide-Bot service names,
localhost:3102 binding, internal terminal connectivity, and persistent Docker
resources. It attaches the existing `tidebot-webui_tidebot-open-webui` data
volume and `tidebot-webui_tidebot-computer` terminal volume as explicit external
resources rather than creating replacement volumes.

Runtime secrets are placed in a host-only environment file at
`C:\ProgramData\Tide-Bot\production.env`, readable only by the account that
runs the deployment task and Docker. The migration copies the existing values
without placing them in Git. The old `.env` is left intact until the first
deployment and recovery verification have succeeded.

A controlled production checkout, separate from a developer checkout but
linked to the canonical Tide-Bot repository, is the only checkout the
deployment task may update. It deploys only a commit marked deployable by the
test gate and records the Tide-Bot commit, upstream SHA, image ID, and update
timestamp in `C:\ProgramData\Tide-Bot\state\last-successful-deployment.json`.

## Scheduled deployment flow

A Windows Scheduled Task named `TideBot-Upstream-Deploy` runs every fifteen
minutes and has a single-instance lock. Its script performs these steps:

1. Fetch the canonical repository and identify the newest deployable commit.
2. Exit successfully without building when that commit is already recorded as
   live.
3. Archive the exact current Tide-Bot data volume and write the current image,
   Compose revision, Tide-Bot commit, and upstream SHA beside the archive.
4. Build the selected commit from source and recreate the Tide-Bot Compose
   services with the existing external volumes and protected environment file.
5. Verify local HTTP health, the public `https://tide-bot.com` response,
   Socket.IO reachability, and the ChatGPT subscription configuration without
   outputting credentials.
6. Persist the deployment state only after all checks pass.

The initial migration executes the same script manually with a specified,
tested commit. The first successful cutover is manually observed at
`tide-bot.com` before the Scheduled Task is enabled.

## Test and verification gate

The upstream synchronization workflow and initial migration run with Node
22.18.0 and the repository's supported Python version. The gate includes:

- focused frontend unit and contract tests, including companion and voice
  boundaries;
- backend tests for `test_chatgpt_subscription.py` and Responses streaming;
- `npm run audit:branding`;
- a production frontend build;
- `git diff --check`;
- an isolated disposable-stack smoke test that never uses production data,
  credentials, or the public site.

The production verifier checks only safe OAuth state: the connection exists,
its stored credential blob can be decrypted by the running application, it can
refresh when required, and the configured model catalog is available. It
returns booleans and sanitized error categories only. An expired or revoked
ChatGPT session is reported as `reconnect_required`; deployment succeeds only
when application health is good, but the post-deploy record explicitly marks
OAuth reconnection as required rather than claiming it works.

## Failure handling and recovery

There are three failure boundaries:

1. **Synchronization failure:** merge conflict or test failure. Do not change
   Tide-Bot `main`, do not deploy, and open a GitHub issue with the upstream
   SHA and sanitized failure summary.
2. **Build failure on the production host:** do not replace the running
   container; retain the pre-deployment backup and emit a sanitized failure
   record.
3. **Post-deployment health failure:** stop the failed replacement, restore the
   prior image and the immediately preceding volume archive, then verify the
   restored service. This deliberately discards data written between the
   pre-deploy backup and the failed deployment; the update task must state that
   fact in its alert.

Database migrations can be one-way. Full volume restoration, rather than
image-only rollback, is the required automatic recovery for a failed migrated
deployment. Backup archives are never automatically deleted in the first
iteration.

## Security follow-up

Provider and service credentials observed during the original live-stack audit
must be rotated after the first stable cutover. Do not rotate the application
encryption inputs during the migration: changing them without a controlled
decrypt-and-reencrypt procedure would invalidate the saved ChatGPT OAuth
connection. A later credential-rotation task will preserve the encryption key
until it has explicitly re-encrypted stored protected configuration and
verified a fresh ChatGPT device login.

## Acceptance criteria

- `tide-bot.com` is built from a controlled checkout of
  `kolbick/Tide-Bot`, not `kolb-bot-ui`.
- The running service retains its existing chats, users, uploads, settings,
  Tide-Bot data volume, terminal volume, and encrypted ChatGPT OAuth
  connection.
- The current upstream main SHA, Tide-Bot merge commit, and deployed image are
  traceable from Git and the host deployment state file.
- A compatible upstream main update is automatically tested and deployed.
- An incompatible upstream update cannot alter production and produces a
  visible, sanitized failure record.
- Each deployment has a volume archive and can restore the previous working
  application and data state after a failed health check.
- No secret value is committed, logged, added to a workflow artifact, or shown
  in a test report.
