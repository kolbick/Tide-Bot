# Tide-Bot deployment stack

This package starts Tide-Bot alone by default. Tide Terminal and the CPTR
gateway are privileged integrations and require explicit Compose overlays.

## Canonical production overlay

The local files in this directory remain development-only. Production uses the
canonical `docker-compose.live.yml` overlay, which attaches the existing
`tidebot-webui_tidebot-open-webui` data volume,
`tidebot-webui_tidebot-computer` terminal volume, and `tidebot-net` network as
explicit external resources. It never publishes a terminal or CPTR port.

Copy only reviewed variable names from the approved legacy environment source
into the host-only `C:\ProgramData\Tide-Bot\production.env` file using
`scripts\initialize-tide-bot-production-environment.ps1`. The tracked
`.env.live.example` contains no usable values. The scheduled updater sets the
immutable `TIDE_BOT_COMMIT`. Task 3 validates a recorded image ID and creates a
private ignored one-use Compose override for a no-build recovery.

Validate the production configuration from the controlled checkout before an
update:

```powershell
docker compose --project-directory C:\ProgramData\Tide-Bot\repo `
  --env-file C:\ProgramData\Tide-Bot\production.env `
  -f deploy\tide-stack\docker-compose.live.yml config --quiet
```

See [`PRODUCTION.md`](PRODUCTION.md) for the protected environment, backup,
release, and recovery procedures. Do not use the local commands below for a
production deployment.

## Local development-only application

1. Copy `.env.example` to `.env` and set a fresh `WEBUI_SECRET_KEY`.
2. Start the base app:

   ```bash
   docker compose up -d --build
   ```

3. Open `http://localhost:3102`, create the first account, and keep that
   account as the Tide-Bot administrator.

The base stack has a dedicated `tide-bot-data` volume and a private
`tide-bot-network`. Public signup is disabled. Its CORS and Socket.IO defaults
allow only `localhost:3102` and `127.0.0.1:3102` for local testing. These local
commands are never a production deployment path: production uses only the
canonical live-overlay command above, including its loopback binding and
external legacy resources. Do not combine `docker-compose.yml` or
`docker-compose.production.yml` with production commands.

Do not use a wildcard origin. Put the published endpoint behind an HTTPS
reverse proxy before using `tide-bot.com`. A safe Nginx reference and
backup/release checklist are in [`PRODUCTION.md`](PRODUCTION.md).

## Local development Tide Terminal overlay

Set a fresh `TIDE_TERMINAL_API_KEY` in `.env`, then run:

```bash
docker compose -f docker-compose.yml -f docker-compose.terminal.yml up -d --build
```

The overlay builds Tide Terminal from official Open Terminal source pinned to
`v0.11.34` / `9162e808c3aaf8dba38745cea55204a42bbb348d`. It verifies that
revision during the build, replaces the public API identity with Tide Terminal,
and retains the upstream MIT license in the resulting image. The service has no
published host port, Docker socket, or host-filesystem bind mount.

Tide Terminal uses shared-container multi-user mode. Users receive separate
Unix homes in `tide-terminal-homes`, but this is not a hard container boundary
between users. Do not grant access to people you would not trust to share the
same terminal host.

## Local development CPTR overlay

CPTR is optional and has host-level implications. Start CPTR on the host,
create a gateway API key, then set `TIDE_CPTR_GATE_TOKEN`,
`CPTR_GATEWAY_URL`, and `CPTR_GATEWAY_API_KEY` in `.env`.

```bash
docker compose -f docker-compose.yml -f docker-compose.cptr.yml up -d --build
```

The CPTR management UI is not published by this stack. The gateway permits
Tide-Bot administrators and explicitly listed non-admin email addresses only.
To approve or revoke a non-admin user, update `TIDE_CPTR_APPROVED_EMAILS` and
restart just the gateway:

```bash
docker compose -f docker-compose.yml -f docker-compose.cptr.yml up -d --no-deps tide-cptr-gateway
```

To run both optional integrations, add both overlay files in the shown order.
Treat CPTR approval as privileged host access.
