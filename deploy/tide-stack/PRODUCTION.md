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

The updater supplies an immutable `TIDE_BOT_COMMIT` for each build. Task 3
validates the stored image ID and creates a private ignored one-use Compose
override for a no-build recovery. Before a deployment, validate the canonical
overlay with:

```powershell
docker compose --project-directory C:\ProgramData\Tide-Bot\repo `
  --env-file C:\ProgramData\Tide-Bot\production.env `
  -f deploy\tide-stack\docker-compose.live.yml config --quiet
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

The external `tidebot-webui_tidebot-open-webui` volume contains users, chats,
settings, uploads, and configuration. Stop writes before taking a consistent
backup.

```powershell
docker compose --project-directory C:\ProgramData\Tide-Bot\repo `
  --env-file C:\ProgramData\Tide-Bot\production.env `
  -f deploy\tide-stack\docker-compose.live.yml stop tidebot-open-webui
docker run --rm -v tidebot-webui_tidebot-open-webui:/data -v "${PWD}\backups:/backup" alpine `
  tar -C /data -czf /backup/tidebot-open-webui-$(Get-Date -Format yyyy-MM-dd).tgz .
docker compose --project-directory C:\ProgramData\Tide-Bot\repo `
  --env-file C:\ProgramData\Tide-Bot\production.env `
  -f deploy\tide-stack\docker-compose.live.yml up -d tidebot-open-webui
```

Encrypt and retain backups according to Changing Tides Treatment Center policy.
Test a restore on an isolated host before relying on it. To restore, stop the
service, archive the current volume first, extract the chosen backup into the
same named volume, then start the service and verify `/health` plus an
administrator sign-in.

## Release and rollback

1. Build and test the candidate with Node 22 and `docker compose config --quiet`.
2. Take the volume backup above and record the current image digest.
3. Build the candidate, start it, and verify `/health`, the signed-in flow,
   WebSocket connection, and the Tide-Bot/Ted-Bot assets through HTTPS.
4. If acceptance fails, redeploy the recorded image digest with the unchanged
   volume. Do not roll back by deleting the data volume.
5. Record the image digest, Open WebUI source commit, migration outcome, and
   operator approval in the release record.
