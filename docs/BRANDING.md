# Tide-Bot branding

Tide-Bot is the private AI workspace for **Changing Tides Treatment Center**.
Ted-Bot, the black goldendoodle, is Tide-Bot's product mascot. Ted-Bot is a
supporting visual identity, not a separate app, assistant, or authentication
surface.

## Source assets

- `static/tide-bot/tide-bot-master.png` is an unchanged copy of the supplied
  Tide-Bot master mark. The 96, 192, and 512 pixel files are deterministic
  resize derivatives for favicon and PWA use.
- `static/tide-bot/ted-bot/spritesheet.webp` is an unchanged release copy of
  the user-owned staged v2 atlas. The original ZIP and `teddy-v2-upgrade/`
  remain untouched outside product source control.

## Product defaults

The backend defaults to `WEBUI_NAME=Tide-Bot` and uses the local Tide-Bot
favicon. Deployments may override `WEBUI_NAME` or `WEBUI_FAVICON_URL`, but
production Tide-Bot deployments should preserve the supplied product identity.

Tide-Bot.com requires a reverse proxy with HTTPS termination, an explicit
public origin, durable application storage, and operator-managed authentication
before it can carry real treatment-center data. Do not expose a development
Compose configuration directly to the public internet.

## Upstream attribution

Tide-Bot remains derived from Open WebUI. Upstream names stay in licenses,
dependency metadata, source comments, and attribution records. The brand audit
checks the product shell and assets; it intentionally does not rewrite those
required attribution surfaces. It also guards the error, account-menu, user
about, and admin-general product surfaces against inherited upstream
promotional URLs. Broader workspace/community surfaces are intentionally
tracked as follow-up work rather than being represented as complete.
