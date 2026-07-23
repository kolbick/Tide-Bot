# Tide-Bot product recovery design

## Purpose

Replace the misdirected companion-first work with the actual Tide-Bot product:
a private, source-built, current Open WebUI `dev` fork for `tide-bot.com`.
Tide-Bot is the product name. Changing Tides Treatment Center is the visible
organization line on entry, install, and About surfaces. Ted-Bot is the
black-goldendoodle mascot, not a second product or the primary application
identity.

## Recovery boundary

The 14 local commits after `origin/main` are the companion/desktop detour and
will be removed from the active branch after a local backup reference is made:

`b678375e8..a48880d7c`.

This removal must not modify, delete, stage, or package user-owned untracked
files:

- `AGENTS.md`
- `tide-bot-pet/`
- `teddy-v2-upgrade/`
- `/Users/kolbyunderwood/Desktop/Teddy-desktop-pet.zip`

The prior local Docker test stack will be stopped without deleting named
volumes. The unrelated `cptr` container remains outside scope.

## Upstream foundation

After recovery, Tide-Bot will merge official Open WebUI `dev` at the reviewed
commit `e64acf1c0a532c7a87c5f6666cb88ba02f8fe237`, then retain an explicit
upstream merge record and repeatable sync process. Upstream functionality,
license files, and attribution remain intact. Tide-Bot changes live in a
small, maintainable brand layer rather than broad scattered substitutions.

## Brand architecture

Create a single Tide-Bot brand module that defines product names, domain,
descriptions, logo and icon paths, visual tokens, Tide Terminal, Tide
Computer, and Ted-Bot metadata. All application-facing branding consumes that
module.

The supplied cyborg-pirate Tide-Bot master mark is the primary identity.
Its restrained deep navy, electric cyan, icy blue, silver, and white palette
sets the application tokens. The mark appears prominently on entry surfaces,
PWA metadata, About, and operator material. Everyday navigation uses a
legible compact Tide-Bot lockup so the workspace stays professional and
focused rather than decorative.

Changing Tides Treatment Center appears as the organization line on login,
signup, install/PWA, About, and other identity surfaces. It is not repeated
as marketing copy in normal chat workspaces.

## Ted-Bot mascot

Ted-Bot is the named black-goldendoodle mascot. It supports the brand through
welcome, empty, loading, offline, and help states, while never replacing
normal chat controls or implying autonomous actions.

`Teddy-desktop-pet.zip` is retained untouched as an older source package. It
lacks a v2 manifest declaration and is not installed directly. The existing
`teddy-v2-upgrade/` output is a candidate only: before adoption, validate its
v2 atlas independently and create Tide-Bot-owned Ted-Bot metadata with a
stable package identifier. The user-provided original package and QA folder
remain unmodified.

## Product surfaces and audit

The rebrand covers every user-facing frontend, PWA, backend-generated, and
operator surface required by `docs/BUILD_SPECIFICATION.md`: login and
onboarding, navigation, settings, admin, dialogs, notifications, metadata,
manifests, icons, mobile layouts, accessibility text, default labels, and
user-facing integration names. It removes unintended Open WebUI promotional
identity while preserving required source attribution and license material.

A production-aware branding audit with a narrow documented allowlist will
scan source, localized strings, static assets, manifests, generated build
output, Docker metadata, and public application documentation. CI fails on
unapproved upstream branding or any Kolb-Bot identity.

## Integrations and operations

Tide Terminal remains a separately built internal service named Tide Terminal.
CPTR remains a configurable internal adapter displayed as Tide Computer. Both
remain disabled or unavailable without disrupting ordinary chat. The final
Compose stack uses Tide-Bot-only names, volumes, browser-storage keys,
secrets, network, and host port. It is documented for Cloudflare-backed HTTPS
at `tide-bot.com`, while DNS, Cloudflare credentials, and public acceptance
remain external deployment work.

## Verification

Completion requires an actual current-dev source build, brand-unit tests,
production-bundle audit, frontend and integration tests, validated Ted-Bot
package, branded light/dark and desktop/mobile review, fresh Docker startup,
authentication, chat, settings, terminal/CPTR enabled and disabled behavior,
data persistence, backup-restore, and public HTTPS/WebSocket acceptance when
deployment authority is available.
