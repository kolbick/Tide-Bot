# Tide-Bot Product Handoff

## What Tide-Bot is

Tide-Bot is the private, branded Open WebUI deployment for Changing Tides Treatment Center. It is not a generic pet page and it is not a public Open WebUI community instance. Ted-Bot is the product mascot and appears as part of the Tide-Bot visual system.

## Current reality as of 2026-07-23

There are two distinct environments:

| Environment                | Address                 | State                                                                                                  |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Local Docker testing stack | `http://localhost:3102` | The current checkout. This is where source changes are verified.                                       |
| Public production site     | `https://tide-bot.com`  | A separate live deployment and the accepted visual reference for the authenticated Tide-Bot workspace. |

The public site does not update when the local testing stack is rebuilt. It needs a deliberate production deployment using the current checkout and the production Compose overlay.

## Product work in this checkout

- Open WebUI is pinned to the current upstream development baseline used by this checkout.
- Tide-Bot identity, favicon, manifest, auth/onboarding, and private deployment defaults are present.
- Ted-Bot uses the supplied sprite atlas in the product interface, rather than launching as a separate site.
- The authenticated public Tide-Bot workspace is the visual baseline: Archivo typography, ocean-blue palette, pale-blue sidebar, signal line, and restrained controls. That presentation layer is captured in `src/app.css` without replacing current Open WebUI layout or behavior.
- Do not replace the application shell wholesale without reviewing the authenticated live product first.
- Public Open WebUI community review/sharing exits are disabled in deployment and removed from the relevant product UI paths.
- Upstream attribution remains in the About surface and license materials.

## Local testing

The testing stack is intentionally left running. Do not use it as production.

```sh
cd /Users/kolbyunderwood/Desktop/Projects/Tide-Bot/deploy/tide-stack
docker compose ps
curl -fsS http://127.0.0.1:3102/health
```

Expected health response:

```json
{ "status": true }
```

To rebuild the local application after source changes:

```sh
cd /Users/kolbyunderwood/Desktop/Projects/Tide-Bot/deploy/tide-stack
docker compose up -d --build
```

To stop or restart it:

```sh
docker compose stop
docker compose up -d
```

## Private Tailscale access

The running local stack is available only to devices signed into this tailnet:

```text
https://kolbys-mac-mini.tail756dc8.ts.net:3102/
```

Use an existing Tide-Bot account. No test account or credential was created for this proxy. This is
Tailscale Serve, not Funnel, so it is not publicly reachable from the internet. The Tide routes on
the main tailnet hostname are intentionally left unchanged.

The proxy survives Tailscale restarts and can be checked or restored with:

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=3102 http://127.0.0.1:3102
```

To disable remote Tide-Bot access without stopping the local Docker stack:

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --https=3102 off
```

The `tide-bot` Docker container uses the `unless-stopped` restart policy. The Mac must remain awake
and Docker Desktop must be running for remote access to work.

## Production deployment boundary

Production must be deployed from the approved server/CI path; do not copy a local database, `.env`, logs, or user data. The production Compose overlay limits browser origins to `https://tide-bot.com` and `https://www.tide-bot.com`.

```sh
cd /path/to/Tide-Bot/deploy/tide-stack
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
```

Before an actual production release, verify the server has the required production secrets and the reverse proxy serves the domain with a valid TLS certificate. Detailed backup, rollback, and proxy instructions are in [PRODUCTION.md](PRODUCTION.md).

## Safeguards

- Do not commit secrets, databases, logs, or user data.
- Preserve the user-owned untracked `AGENTS.md`, `tide-bot-pet/`, and `teddy-v2-upgrade/` directories.
- Do not claim the public site is updated until the live domain is rechecked in an authenticated browser after deployment.
- A local authenticated review still needs an approved local test account; do not use a production session or copy production data into the test stack.
