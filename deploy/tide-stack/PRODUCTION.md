# Tide-Bot production operation

This document is for an operator deploying the private Tide-Bot instance at
`https://tide-bot.com`. It is deliberately separate from the local testing
stack: the Compose port is a loopback upstream, never the public security
boundary. Production uses only `docker-compose.live.yml`; do not combine it
with the local development Compose files.

## Production environment and Compose validation

The host-only environment file is `C:\ProgramData\Tide-Bot\production.env`.
Initialize it once from the environment used by the active public stack at
`C:\Users\sshkolby\tide-bot-new\deploy\tide-stack\.env`; do not print or copy its values into
documentation or version control:

```powershell
pwsh -NoProfile -File C:\ProgramData\Tide-Bot\repo\scripts\initialize-tide-bot-production-environment.ps1 `
  -SourceEnvFile C:\Users\sshkolby\tide-bot-new\deploy\tide-stack\.env
```

The initializer copies the source without printing its values, leaves the
source intact, removes only an empty `OAUTH_CLIENT_INFO_ENCRYPTION_KEY=`
declaration so the backend continues to fall back to `WEBUI_SECRET_KEY`, and
protects the destination ACL for Administrators and the scheduled task
identity. The optional `-ScheduledTaskIdentity` must name the same specific
service or user account Task 4 registers; broad Windows groups are rejected.
It defaults to `NT AUTHORITY\SYSTEM`. Do not place a production environment
file in this repository.

The updater supplies an immutable `TIDE_BOT_COMMIT` for each build. Its
last-successful state is `C:\ProgramData\Tide-Bot\state\last-successful-deployment.json`.
Task 3 validates the stored image ID and creates a private ignored one-use Compose
override for a no-build recovery. Before a deployment, validate the canonical
overlay with a non-secret placeholder interpolation value:

```powershell
$env:TIDE_BOT_COMMIT = '0000000000000000000000000000000000000000'
docker compose --project-directory C:\ProgramData\Tide-Bot\repo `
  --env-file C:\ProgramData\Tide-Bot\production.env `
  -f deploy\tide-stack\docker-compose.live.yml config --quiet
Remove-Item Env:TIDE_BOT_COMMIT
```

## Controlled checkout and guarded schedule

The production checkout is only `C:\ProgramData\Tide-Bot\repo`; it is not a
developer worktree. On the initial manual cutover, pass the exact full commit
resolved from the tested `tide-bot-deployable` marker to the bootstrap script.
It clones only `https://github.com/kolbick/Tide-Bot.git` as `origin`, configures
`https://github.com/open-webui/open-webui.git` as `upstream`, rejects a dirty
existing checkout, and detaches HEAD at that immutable commit. It neither
migrates nor changes `C:\Users\sshkolby\tide-bot-live`.

```powershell
pwsh -NoProfile -File scripts\bootstrap-tide-bot-production-checkout.ps1 `
  -Commit <40-lowercase-hex-commit>
```

The schedule installer is disabled by default and its dry run creates no task.
It uses explicit LocalSystem semantics (`SYSTEM`, documented ACL identity
`NT AUTHORITY\SYSTEM`) so the identity must match the one supplied to
`initialize-tide-bot-production-environment.ps1`. Enable it only after the
manual updater has written a successful state record whose `commit` exactly
matches the current `tide-bot-deployable` commit. The registered task is exactly
`\TideBot-Upstream-Deploy`, runs once per day with `IgnoreNew`, and launches
the updater through an absolute `pwsh.exe -NoProfile -ExecutionPolicy Bypass`
action. Its description restricts deployment to a tested Git marker.

```powershell
pwsh -NoProfile -File scripts\install-tide-bot-production-schedule.ps1 -WhatIf
pwsh -NoProfile -File scripts\install-tide-bot-production-schedule.ps1 -Enable
```

To remove only that task, use the explicit disable action. It reads back and
confirms both the exact task name and task path before unregistering it.

```powershell
pwsh -NoProfile -File scripts\install-tide-bot-production-schedule.ps1 -Disable
```

This overlay targets only the active Compose project, service, and container
named `tide-bot`. It attaches the existing `tide-bot-data` volume and
`tide-bot-network` network as external resources and binds only
`127.0.0.1:3102` by default. Never create replacements or run a
volume-removing command against them. The legacy `tidebot-open-webui` container
and its volumes are unrouted historical resources; this procedure neither
stops, replaces, archives, restores, nor removes them.

## Public proxy

The existing Windows `Cloudflared` service remains the production ingress. Its
service registration, `C:\ProgramData\cloudflared\config.yml`, hostname rules,
WebSocket forwarding, and established loopback routing are retained unchanged;
this Compose/update procedure does not replace Cloudflared with Nginx or rewrite
its routes. Keep the application port loopback-only and verify the existing
Cloudflared target before any separately reviewed port change.

Do not configure a trusted-authentication header until the identity proxy and
signature verification have been reviewed together. Do not publish CPTR or
Tide Terminal ports; their overlays remain opt-in internal services.

## Backup and restore

Use `scripts\tide-bot-production-update.ps1` for production deployments. It
force-refreshes only the exact `refs/tags/tide-bot-deployable` tag ref plus
`origin/main`, rejects tagged commits outside refreshed `origin/main`, and
builds the candidate before stopping the application writer. While the service
is stopped it uses the already-local immutable predecessor image (with pulls
disabled) to take a consistent archive of exactly `tide-bot-data`, records that
exact volume name and a SHA-256 archive digest in the manifest, and writes a
sanitized deployment state record. Backups are UTC-sortable files below
`C:\ProgramData\Tide-Bot\backups`; they are never deleted by the updater. The
production root and backup tree use protected SYSTEM/Administrators-only ACLs.

The updater acquires the global `TideBot-Upstream-Deploy` mutex. A concurrent
run exits successfully with `status: already_running`. Use the dry run before a
maintenance window; it performs no checkout, Docker, environment-file, or
network access:

```powershell
pwsh -NoProfile -File scripts\tide-bot-production-update.ps1 -WhatIf
```

On a post-replacement failure it runs Compose `down` without `-v`, validates the
immediately preceding archive manifest and listing, restores only the named data
volume, and starts the recorded prior image through a private ignored one-use
Compose override. The override is removed in all outcomes. It does not accept
an image reference from the environment or an operator argument.

## Release and rollback

1. Run the updater from the approved checkout and review its sanitized state
   record against `scripts/tide-bot-production-update.schema.json`.
2. It verifies loopback `/health`, public HTTPS `/health`, and the local
   Socket.IO polling handshake. A ChatGPT OAuth reconnect state is recorded as a
   warning rather than causing a service rollback.
3. If service health fails after replacement, let the updater finish recovery;
   do not remove volumes or supply an image override manually.
