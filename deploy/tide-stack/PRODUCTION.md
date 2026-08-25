# Tide-Bot production operation

This document is for an operator deploying the private Tide-Bot instance at
`https://tide-bot.com`. It is deliberately separate from the local testing
stack: the Compose port is a loopback upstream, never the public security
boundary. Production uses only `docker-compose.live.yml`; do not combine it
with the local development Compose files.

## Production environment and Compose validation

The host-only environment file is `C:\ProgramData\Tide-Bot\production.env`.
Initialize it once from the approved legacy source with
`scripts\initialize-tide-bot-production-environment.ps1`; the initializer
copies the source without printing its values, leaves the source intact, and
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

This overlay attaches the existing `tidebot-webui_tidebot-open-webui` and
`tidebot-webui_tidebot-computer` volumes plus the `tidebot-net` network as
external resources. Never create replacements or run a volume-removing
command against them.

## Public proxy

Terminate TLS at a managed reverse proxy. Forward WebSocket upgrades and keep
the origin allow-list exact. The application should be reachable only from the
proxy network or loopback interface.

```nginx
server {
    listen 443 ssl http2;
    server_name tide-bot.com www.tide-bot.com;

    # Configure these certificate paths with your certificate provider.
    ssl_certificate /etc/letsencrypt/live/tide-bot.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tide-bot.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
        proxy_pass http://127.0.0.1:3102;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600;
    }
}
```

Do not configure a trusted-authentication header until the identity proxy and
signature verification have been reviewed together. Do not publish CPTR or
Tide Terminal ports; their overlays remain opt-in internal services.

## Backup and restore

Use `scripts\tide-bot-production-update.ps1` for production deployments. It
fetches only `origin/tide-bot-deployable`, rejects commits outside `origin/main`,
takes a helper-container archive of exactly
`tidebot-webui_tidebot-open-webui`, records a SHA-256 manifest, and writes a
sanitized deployment state record. Backups are UTC-sortable files below
`C:\ProgramData\Tide-Bot\backups`; they are never deleted by the updater.

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
