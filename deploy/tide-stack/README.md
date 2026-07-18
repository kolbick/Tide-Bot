# Tide-Bot connected stack

This is the first Tide-Bot deployment package. It starts the application, a shared multi-user Tide Terminal, and an internal CPTR gateway with no manual connection setup inside the web UI.

## What it does

- The first Tide-Bot account is the Open WebUI admin. That account can immediately use Tide Terminal and CPTR.
- Tide Terminal uses Open Terminal multi-user mode. Every Tide-Bot user receives a separate Unix account and persistent home directory under the `tide-terminal-homes` volume.
- CPTR is hidden from unapproved users and rejects guessed requests. The gateway allows Tide-Bot admins automatically and allows non-admin users only when their email is listed in `TIDE_CPTR_APPROVED_EMAILS`.
- CPTR itself stays on the host computer. Its management interface is not published by this Compose stack.

## First start

1. Start CPTR on the host and create a gateway API key in CPTR Settings > Gateway.
2. Copy `.env.example` to `.env`, add fresh secrets, then set `CPTR_GATEWAY_API_KEY`.
3. From this directory, run `docker compose up -d --build`.
4. Open Tide-Bot at `http://localhost:3102`, create the first account, and use it as the admin account.

## Approving a user for CPTR

Add their Tide-Bot login email to `TIDE_CPTR_APPROVED_EMAILS` in `.env`, then run:

```bash
docker compose up -d --no-deps tide-cptr-gateway
```

Remove their email and run the same command to revoke CPTR access. Tide Terminal access is available to all approved Tide-Bot accounts, but their files remain under their own home directory.

## Important boundary

This uses shared-container multi-user mode because that is the requested tradeoff. It separates user files with Unix accounts and permissions, but it is not a hard container boundary between users. Do not give accounts to people you would not trust to share the same terminal host.

The CPTR gateway runs agent requests with the privileges of the CPTR host workspace. Treat approval for CPTR as privileged access.
