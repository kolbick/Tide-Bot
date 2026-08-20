# Tide-Bot Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Check off each step only after its stated test passes. Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before integration.

**Goal:** Add a downloadable, Tide-Bot-branded Chrome extension that connects to a user's Tide-Bot account, keeps normal chat history and local-model selection, controls one browser tab, accepts text and hands-free voice, records workflows, and runs browser schedules while Chrome is open.

**Architecture:** A Manifest V3 extension owns the side panel, tab-scoped browser capabilities, voice capture, Chrome alarms, and an authenticated Socket.IO device connection. Tide-Bot owns user authorization, pairing, device tokens, chats, encrypted workflow and schedule definitions, model tool injection, and sanitized audit records. Every browser command passes through both a server-side capability broker and an extension-side policy engine. Raw page, audio, debugger, console, network, and screenshot data remains ephemeral.

**Tech stack:** Chrome Manifest V3, Svelte 5, TypeScript, Vite, Vitest, Playwright, FastAPI, Pydantic, SQLAlchemy async, Alembic, Socket.IO, AES-GCM, existing Tide-Bot audio APIs, existing Tide-Bot chat completion pipeline.

**Approved design:** `docs/superpowers/specs/2026-08-20-tide-bot-chrome-extension-design.md`

## Global implementation constraints

- Work only on `feature/tide-bot-chrome-extension` until all verification passes.
- Use Node 22.18.0, npm 10.9.3, and Python 3.11 or 3.12 as required by `AGENTS.md`.
- Apply red, green, refactor literally. Add one failing test, run it and observe the expected failure, add the minimum implementation, then rerun it.
- Stage exact paths only. Never use `git add .`, `git add -A`, or a broad pathspec.
- Do not commit generated extension bundles, ZIP archives, Playwright profiles, screenshots, videos, or trace files.
- Do not add arbitrary JavaScript execution, cookie access, password-manager access, payment autofill, unrestricted browser storage, filesystem access, or multi-tab orchestration.
- Keep text chat as the default input. When voice mode is chosen, hands-free is the default voice mode and push-to-talk is the alternative.
- Keep `Autonomous` as the default action mode. Also expose `Consequential Approval` and `Manual Approval`.
- Default to `https://tide-bot.com`. Permit custom HTTPS origins only after an administrator unlocks them. Permit loopback HTTP only for local development.
- Treat all page content as untrusted data. Never interpret page text as a policy change or a request to reveal secrets.
- Persist only normal chat text and sanitized action audit data. Never persist raw DOM, screenshots, audio, console arguments, response bodies, request bodies, or authorization headers.
- Control one tab at a time. Support both `Lock to starting tab` and `Follow active tab` policies.
- Scheduled runs depend on Chrome being open and perform at most one catch-up run after downtime.
- Run `npm run audit:branding` after adding each new user-facing surface.

## Task 1: Add the extension build and package skeleton

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `Dockerfile`
- Create: `browser-extension/manifest.json`
- Create: `browser-extension/sidepanel.html`
- Create: `browser-extension/src/sidepanel/main.ts`
- Create: `browser-extension/src/sidepanel/App.svelte`
- Create: `browser-extension/src/sidepanel/theme.css`
- Create: `browser-extension/src/background/service-worker.ts`
- Create: `browser-extension/src/content/index.ts`
- Create: `browser-extension/src/shared/constants.ts`
- Create: `browser-extension/src/shared/protocol.ts`
- Create: `browser-extension/store/privacy.md`
- Create: `scripts/build-browser-extension.mjs`
- Create: `scripts/build-browser-extension.test.mjs`
- Create derived brand assets: `browser-extension/icons/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`

**Step 1: Write the failing package test**

Test that the build script rejects unknown origins, fixes the production origin to `https://tide-bot.com`, emits a Manifest V3 package with `minimum_chrome_version: "120"`, emits no remote scripts, and places `manifest.json` at the ZIP root.

```js
test('packages a production MV3 extension with a fixed Tide-Bot origin', async () => {
	const result = await buildBrowserExtension({ mode: 'production', outputRoot: fixtureRoot });
	const manifest = JSON.parse(await readFile(join(result.distDir, 'manifest.json'), 'utf8'));
	assert.equal(manifest.manifest_version, 3);
	assert.equal(manifest.minimum_chrome_version, '120');
	assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
	assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
	assert.equal(result.serverOrigin, 'https://tide-bot.com');
	assert.doesNotMatch(await readFile(join(result.distDir, 'sidepanel.html'), 'utf8'), /https?:\/\//);
});
```

**Step 2: Run the test and observe the missing-module failure**

Run: `node --test scripts/build-browser-extension.test.mjs`

Expected: FAIL because `scripts/build-browser-extension.mjs` does not exist.

**Step 3: Add the typed contract and minimal branded panel**

Use these canonical values in `constants.ts`:

```ts
export const PRODUCT_NAME = 'Tide-Bot Browser Control';
export const DEFAULT_SERVER_ORIGIN = 'https://tide-bot.com';
export const ACTION_MODES = ['autonomous', 'consequential-approval', 'manual-approval'] as const;
export const TAB_POLICIES = ['locked', 'follow-active'] as const;
export const VOICE_MODES = ['hands-free', 'push-to-talk'] as const;
export const PROTOCOL_VERSION = 1 as const;
```

Define discriminated unions for `hello`, `session.open`, `session.close`, `command.request`, `command.result`, `command.cancel`, `approval.request`, `approval.result`, `workflow.sync`, `schedule.sync`, and `heartbeat`. Each message must contain `version`, `id`, `type`, `deviceId`, `userId`, `sessionId`, and an ISO timestamp where applicable.

The initial panel must show the Tide-Bot mark, connection state, a disabled text composer, and a `Pair browser` button. Its CSS must use the existing Tide-Bot palette: navy `#0b1b36`, ocean `#124d78`, aqua `#29c9e8`, and gold `#d6a34a`.

**Step 4: Implement the deterministic build**

`buildBrowserExtension()` must run three Vite builds: Svelte side panel, ES module service worker, and IIFE content script. It must copy the manifest and icons, scan emitted HTML and JavaScript for remote-hosted code, create a deterministic ZIP, copy the signed-in download artifact to `backend/open_webui/static/browser-extension/tide-bot-browser-extension.zip`, and return paths without printing secrets.

Add scripts:

```json
"build:browser-extension": "node scripts/build-browser-extension.mjs",
"test:browser-extension:unit": "vitest run browser-extension scripts/build-browser-extension.test.mjs --passWithNoTests"
```

Prepend `npm run build:browser-extension` to the root production build. In the final Docker stage, copy `/app/backend/open_webui/static/browser-extension` from the frontend build stage after copying backend sources.

**Step 5: Run the focused tests and build**

Run:

```bash
node --test scripts/build-browser-extension.test.mjs
npm run build:browser-extension
unzip -l backend/open_webui/static/browser-extension/tide-bot-browser-extension.zip
```

Expected: PASS. `manifest.json` is at the archive root and no generated artifact is tracked.

**Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore Dockerfile browser-extension/manifest.json browser-extension/sidepanel.html browser-extension/src/sidepanel/main.ts browser-extension/src/sidepanel/App.svelte browser-extension/src/sidepanel/theme.css browser-extension/src/background/service-worker.ts browser-extension/src/content/index.ts browser-extension/src/shared/constants.ts browser-extension/src/shared/protocol.ts browser-extension/store/privacy.md browser-extension/icons/icon-16.png browser-extension/icons/icon-32.png browser-extension/icons/icon-48.png browser-extension/icons/icon-128.png scripts/build-browser-extension.mjs scripts/build-browser-extension.test.mjs
git commit -m "build: package Tide-Bot Chrome extension"
```

## Task 2: Add browser-control authorization with explicit deny overrides

**Files:**

- Modify: `backend/open_webui/config.py`
- Modify: `backend/open_webui/routers/users.py`
- Modify: `backend/open_webui/utils/access_control/__init__.py`
- Modify: `src/lib/constants/permissions.ts`
- Modify: `src/lib/components/admin/Users/Groups/Permissions.svelte`
- Create: `backend/open_webui/utils/access_control/test_browser_extension_permission.py`
- Create: `src/lib/components/admin/Users/Groups/Permissions.browser-extension.test.ts`

**Step 1: Write failing permission tests**

Cover these cases:

| Global default | Explicit group values | Effective result |
|---|---|---|
| true | none | allow |
| true | false | deny |
| true | true | allow |
| false | none | deny |
| false | true | allow |
| true | true and false | deny |
| any | admin role | allow |

The deny-wins rule applies only to `features.browser_extension`; do not alter additive semantics for existing permissions.

**Step 2: Run tests and observe failure**

Run: `pytest -q backend/open_webui/utils/access_control/test_browser_extension_permission.py`

Expected: FAIL because the specialized resolver is missing.

**Step 3: Add the permission field and resolver**

Add `USER_PERMISSIONS_FEATURES_BROWSER_EXTENSION`, defaulting to `True`, then add `browser_extension: bool = True` to backend and frontend permission schemas.

Implement:

```py
async def has_browser_extension_permission(user_id: str, default_permissions: dict, db=None) -> bool:
    groups = await Groups.get_groups_by_member_id(user_id, db=db)
    explicit = [
        group.permissions['features']['browser_extension']
        for group in groups
        if isinstance(group.permissions, dict)
        and isinstance(group.permissions.get('features'), dict)
        and 'browser_extension' in group.permissions['features']
    ]
    if False in explicit:
        return False
    if True in explicit:
        return True
    return bool((default_permissions.get('features') or {}).get('browser_extension', True))
```

Add a clearly labeled `Browser control extension` group switch and explain that an explicit off value denies the feature for that group.

**Step 4: Run focused tests and branding audit**

Run:

```bash
pytest -q backend/open_webui/utils/access_control/test_browser_extension_permission.py
npm run test:frontend -- src/lib/components/admin/Users/Groups/Permissions.browser-extension.test.ts
npm run audit:branding
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/open_webui/config.py backend/open_webui/routers/users.py backend/open_webui/utils/access_control/__init__.py backend/open_webui/utils/access_control/test_browser_extension_permission.py src/lib/constants/permissions.ts src/lib/components/admin/Users/Groups/Permissions.svelte src/lib/components/admin/Users/Groups/Permissions.browser-extension.test.ts
git commit -m "feat: authorize Tide-Bot browser control"
```

## Task 3: Add durable device, workflow, schedule, and audit models

**Files:**

- Create: `backend/open_webui/models/browser_extension.py`
- Create: `backend/open_webui/migrations/versions/b8e4d6f7a901_add_browser_extension_tables.py`
- Create: `backend/open_webui/models/test_browser_extension.py`
- Create: `backend/open_webui/utils/browser_extension_crypto.py`
- Create: `backend/open_webui/utils/test_browser_extension_crypto.py`

**Step 1: Write failing model and crypto tests**

Test owner-scoped retrieval, device revocation, one-use pairing grants, unique device labels per user, schedule device assignment, audit retention trimming, AES-GCM authenticated encryption, key separation, and redaction of bearer tokens, cookies, passwords, API keys, and card-like values.

**Step 2: Run tests and observe missing imports**

Run: `pytest -q backend/open_webui/models/test_browser_extension.py backend/open_webui/utils/test_browser_extension_crypto.py`

Expected: FAIL because the modules do not exist.

**Step 3: Add the schema**

Create these tables and indexes:

| Table | Required fields |
|---|---|
| `browser_pairing_grant` | id, user_id nullable until approval, device_code_hash, verifier_hash, requested_origin, status, expires_at, consumed_at, created_at |
| `browser_paired_device` | id, user_id, label, refresh_token_hash, token_family_id, allowed_origin, extension_version, last_seen_at, revoked_at, created_at, updated_at |
| `browser_workflow` | id, user_id, name, encrypted_definition, definition_nonce, version, created_at, updated_at |
| `browser_schedule` | id, user_id, workflow_id, device_id, name, rrule, timezone, is_active, last_run_at, next_run_at, catch_up_pending, created_at, updated_at |
| `browser_action_audit` | id, user_id, device_id, session_id, chat_id, command_id, action, origin, outcome, risk, summary, created_at |

Use text IDs, nanosecond timestamps, owner and due-run indexes, and foreign-key-independent cleanup consistent with existing Tide-Bot models. The migration must revise the repository's actual Alembic head and be safe on SQLite and PostgreSQL.

**Step 4: Add crypto and redaction helpers**

Derive separate 256-bit keys for workflow encryption and keyed token hashing from `WEBUI_SECRET_KEY` using HKDF-SHA256 and fixed Tide-Bot context strings. Encrypt definitions with AES-GCM and authenticate `user_id:workflow_id:version` as additional data. Never log plaintext, nonce, device code, verifier, or refresh token.

**Step 5: Run focused tests and migration checks**

Run:

```bash
pytest -q backend/open_webui/models/test_browser_extension.py backend/open_webui/utils/test_browser_extension_crypto.py
cd backend && alembic heads && alembic upgrade head && alembic downgrade -1 && alembic upgrade head
```

Expected: one Alembic head and all tests pass.

**Step 6: Commit**

```bash
git add backend/open_webui/models/browser_extension.py backend/open_webui/migrations/versions/b8e4d6f7a901_add_browser_extension_tables.py backend/open_webui/models/test_browser_extension.py backend/open_webui/utils/browser_extension_crypto.py backend/open_webui/utils/test_browser_extension_crypto.py
git commit -m "feat: persist secure browser extension state"
```

## Task 4: Implement pairing, rotating device tokens, and origin policy

**Files:**

- Create: `backend/open_webui/routers/browser_extension.py`
- Create: `backend/open_webui/routers/test_browser_extension_pairing.py`
- Create: `backend/open_webui/utils/browser_extension_auth.py`
- Create: `backend/open_webui/utils/test_browser_extension_auth.py`
- Modify: `backend/open_webui/main.py`

**Step 1: Write failing API tests**

Cover pairing start, signed-in approval, polling before approval, one-time verifier exchange, short-lived access token claims, refresh rotation, replay revocation of the token family, device revoke, global permission denial, group denial, origin rejection, custom-origin admin lock, and loopback development origin handling.

**Step 2: Run tests and observe 404 or import failures**

Run: `pytest -q backend/open_webui/routers/test_browser_extension_pairing.py backend/open_webui/utils/test_browser_extension_auth.py`

Expected: FAIL.

**Step 3: Implement the device authorization flow**

Expose:

```text
POST /api/v1/browser-extension/pairing/start
POST /api/v1/browser-extension/pairing/{grant_id}/approve
POST /api/v1/browser-extension/pairing/token
POST /api/v1/browser-extension/token/refresh
GET  /api/v1/browser-extension/devices
POST /api/v1/browser-extension/devices/{device_id}/revoke
```

Pairing start returns a short human code and a high-entropy verifier. Store only keyed hashes. Approval requires the normal authenticated Tide-Bot session. Token exchange consumes the verifier exactly once and returns an opaque refresh credential plus a 10-minute JWT containing `id`, `device_id`, `token_family_id`, `scope: browser-extension`, `aud: tide-bot-browser-extension`, and `origin`.

Refresh credentials must rotate on every use. A reused credential revokes its entire family. Apply rate limits by grant, IP, and device without echoing secret material.

**Step 4: Run focused tests**

Run: `pytest -q backend/open_webui/routers/test_browser_extension_pairing.py backend/open_webui/utils/test_browser_extension_auth.py`

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/open_webui/routers/browser_extension.py backend/open_webui/routers/test_browser_extension_pairing.py backend/open_webui/utils/browser_extension_auth.py backend/open_webui/utils/test_browser_extension_auth.py backend/open_webui/main.py
git commit -m "feat: pair browser extension devices"
```

## Task 5: Add the user-scoped browser command broker and Socket.IO transport

**Files:**

- Create: `backend/open_webui/utils/browser_extension_broker.py`
- Create: `backend/open_webui/utils/test_browser_extension_broker.py`
- Create: `backend/open_webui/socket/browser_extension.py`
- Create: `backend/open_webui/socket/test_browser_extension_handlers.py`
- Modify: `backend/open_webui/socket/main.py`

**Step 1: Write failing broker tests**

Test device registration, strict user/device/session routing, command timeouts, cancellation, one in-flight mutating command per device, parallel read-only observations, late-result rejection, disconnect cleanup, result size limits, and cross-user denial.

**Step 2: Run tests and observe failure**

Run: `pytest -q backend/open_webui/utils/test_browser_extension_broker.py backend/open_webui/socket/test_browser_extension_handlers.py`

Expected: FAIL.

**Step 3: Implement broker invariants and handlers**

Add device-authenticated handlers for `browser:device:join`, `browser:heartbeat`, `browser:session:open`, `browser:session:close`, `browser:command:result`, and `browser:approval:result`. Enter only `browser:user:{user_id}` and `browser:device:{device_id}` rooms after validating token scope, audience, device row, token family, origin, permission, and revocation state.

Use a bounded in-memory pending-command registry per process. Route through Socket.IO rooms so the existing Redis manager supports multiple Tide-Bot workers. Enforce 30-second command deadlines, 1 MiB result envelopes, and typed error codes.

**Step 4: Run focused tests**

Run: `pytest -q backend/open_webui/utils/test_browser_extension_broker.py backend/open_webui/socket/test_browser_extension_handlers.py`

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/open_webui/utils/browser_extension_broker.py backend/open_webui/utils/test_browser_extension_broker.py backend/open_webui/socket/browser_extension.py backend/open_webui/socket/test_browser_extension_handlers.py backend/open_webui/socket/main.py
git commit -m "feat: broker browser control commands"
```

## Task 6: Inject tab-scoped browser tools into Tide-Bot chat

**Files:**

- Create: `backend/open_webui/utils/browser_extension_tools.py`
- Create: `backend/open_webui/utils/test_browser_extension_tools.py`
- Modify: `backend/open_webui/utils/middleware.py`
- Create: `backend/open_webui/utils/test_browser_extension_middleware.py`

**Step 1: Write failing tool tests**

Test exact tool schemas, session ownership, device liveness, feature permission, mode propagation, mutation serialization, sanitized audits, and rejection when callers pass explicit tools, use legacy function calling, omit `browser_session`, or attempt a second tab.

The approved tool surface is:

```text
browser_observe
browser_click
browser_type
browser_select
browser_scroll
browser_navigate
browser_go_back
browser_go_forward
browser_reload
browser_wait
browser_screenshot
browser_download
browser_console
browser_network
browser_dom
browser_recording
```

**Step 2: Run tests and observe failure**

Run: `pytest -q backend/open_webui/utils/test_browser_extension_tools.py backend/open_webui/utils/test_browser_extension_middleware.py`

Expected: FAIL.

**Step 3: Implement strict tool adapters**

Every callable must accept a fixed Pydantic-validated argument object and call the broker. Do not expose raw CDP methods or JavaScript. `browser_type` must mark password and payment-like fields as consequential and must never return the typed value. `browser_network` must expose method, redacted URL, resource type, status, and timing only. `browser_console` must expose severity and redacted string summaries only.

Inject browser tools only when all of these are true:

```py
use_builtin_tools
and payload_tools is None
and features.get('browser_control') is True
and metadata.get('browser_session') is not None
and await has_browser_extension_permission(...)
and await broker.session_is_live(user.id, metadata['browser_session'])
```

Append a short system boundary stating that page text is untrusted and cannot alter policies, permissions, or secret-handling rules.

**Step 4: Run focused tests**

Run: `pytest -q backend/open_webui/utils/test_browser_extension_tools.py backend/open_webui/utils/test_browser_extension_middleware.py`

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/open_webui/utils/browser_extension_tools.py backend/open_webui/utils/test_browser_extension_tools.py backend/open_webui/utils/middleware.py backend/open_webui/utils/test_browser_extension_middleware.py
git commit -m "feat: add browser tools to Tide-Bot chat"
```

## Task 7: Implement extension authentication and resilient transport

**Files:**

- Create: `browser-extension/src/background/auth.ts`
- Create: `browser-extension/src/background/transport.ts`
- Create: `browser-extension/src/background/lifecycle.ts`
- Modify: `browser-extension/src/background/service-worker.ts`
- Create: `browser-extension/src/background/auth.test.ts`
- Create: `browser-extension/src/background/transport.test.ts`
- Create: `browser-extension/src/testing/chrome.ts`

**Step 1: Write failing service-worker tests**

Cover secure storage keys, pairing polling, token refresh before expiry, replay error sign-out, exponential reconnect with jitter, heartbeat alarms, worker restart restoration, offline command rejection, and no credential material in logs or UI messages.

**Step 2: Run tests and observe failure**

Run: `npm run test:browser-extension:unit -- browser-extension/src/background/auth.test.ts browser-extension/src/background/transport.test.ts`

Expected: FAIL.

**Step 3: Implement storage and transport**

Store only `serverOrigin`, `deviceId`, opaque `refreshToken`, `tokenFamilyId`, and non-secret preferences in `chrome.storage.local`. Keep access tokens in memory. Use a service-worker WebSocket compatible transport and Chrome alarms to reconnect after suspension. Validate every inbound envelope against the shared protocol before dispatch.

**Step 4: Run tests**

Run: `npm run test:browser-extension:unit -- browser-extension/src/background/auth.test.ts browser-extension/src/background/transport.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add browser-extension/src/background/auth.ts browser-extension/src/background/transport.ts browser-extension/src/background/lifecycle.ts browser-extension/src/background/service-worker.ts browser-extension/src/background/auth.test.ts browser-extension/src/background/transport.test.ts browser-extension/src/testing/chrome.ts
git commit -m "feat: connect Tide-Bot extension securely"
```

## Task 8: Implement single-tab control and the extension policy engine

**Files:**

- Create: `browser-extension/src/background/tab-controller.ts`
- Create: `browser-extension/src/background/policy.ts`
- Create: `browser-extension/src/background/approvals.ts`
- Create: `browser-extension/src/background/tab-controller.test.ts`
- Create: `browser-extension/src/background/policy.test.ts`
- Modify: `browser-extension/src/background/service-worker.ts`

**Step 1: Write failing policy tests**

Cover starting-tab lock, follow-active behavior, restricted Chrome URLs, file URLs, extension pages, tab replacement, tab close, navigation between origins, all three action modes, risky submit/purchase/send/delete/download actions, secret-bearing fields, prompt-injection indicators, and denial of second-tab targets.

**Step 2: Run tests and observe failure**

Run: `npm run test:browser-extension:unit -- browser-extension/src/background/tab-controller.test.ts browser-extension/src/background/policy.test.ts`

Expected: FAIL.

**Step 3: Implement deterministic decisions**

The policy result is one of `allow`, `ask`, or `deny`, plus a stable reason code. `Autonomous` allows ordinary actions and asks for consequential ones. `Consequential Approval` asks for consequential actions and cross-origin navigation. `Manual Approval` asks before every mutation. All modes deny forbidden capabilities and restricted URLs.

Bind a session to exactly one numeric tab ID. A follow-active change must close the old tab session before opening the new one, never leaving two active targets.

**Step 4: Run tests**

Run: `npm run test:browser-extension:unit -- browser-extension/src/background/tab-controller.test.ts browser-extension/src/background/policy.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add browser-extension/src/background/tab-controller.ts browser-extension/src/background/policy.ts browser-extension/src/background/approvals.ts browser-extension/src/background/tab-controller.test.ts browser-extension/src/background/policy.test.ts browser-extension/src/background/service-worker.ts
git commit -m "feat: enforce single-tab browser policy"
```

## Task 9: Implement safe page observation and interaction

**Files:**

- Create: `browser-extension/src/content/dom.ts`
- Create: `browser-extension/src/content/actions.ts`
- Create: `browser-extension/src/content/redaction.ts`
- Create: `browser-extension/src/content/injection-defense.ts`
- Create: `browser-extension/src/content/dom.test.ts`
- Create: `browser-extension/src/content/actions.test.ts`
- Modify: `browser-extension/src/content/index.ts`

**Step 1: Write failing DOM tests**

Using jsdom, test stable element handles, accessible-name extraction, viewport metadata, hidden-element exclusion, password and payment redaction, contenteditable, labels, selects, shadow-root boundaries, stale handles, trusted input events, prompt-injection marking, and bounded payload sizes.

**Step 2: Run tests and observe failure**

Run: `npm run test:browser-extension:unit -- browser-extension/src/content/dom.test.ts browser-extension/src/content/actions.test.ts`

Expected: FAIL.

**Step 3: Implement the content-script adapter**

Return a compact accessibility-oriented page snapshot with URL, title, viewport, headings, landmarks, forms, and visible interactive elements. Use generated opaque handles scoped to the current document revision. Never serialize full HTML. Redact sensitive values before they leave the isolated world.

Implement click, type, select, scroll, and wait using DOM APIs and trusted browser event sequences. Reject arbitrary selectors from the model unless they resolve through a previously observed handle. Re-observe after every mutation.

**Step 4: Run tests**

Run: `npm run test:browser-extension:unit -- browser-extension/src/content/dom.test.ts browser-extension/src/content/actions.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add browser-extension/src/content/dom.ts browser-extension/src/content/actions.ts browser-extension/src/content/redaction.ts browser-extension/src/content/injection-defense.ts browser-extension/src/content/dom.test.ts browser-extension/src/content/actions.test.ts browser-extension/src/content/index.ts
git commit -m "feat: control pages through safe DOM handles"
```

## Task 10: Add bounded debugger, screenshot, download, console, and network capabilities

**Files:**

- Create: `browser-extension/src/background/debugger.ts`
- Create: `browser-extension/src/background/downloads.ts`
- Create: `browser-extension/src/background/debugger.test.ts`
- Create: `browser-extension/src/background/downloads.test.ts`
- Modify: `browser-extension/src/background/service-worker.ts`

**Step 1: Write failing capability tests**

Test the CDP allowlist, debugger attach and detach cleanup, screenshot size cap, console redaction, network metadata filtering, download filename sanitization, notification behavior, and rejection of response bodies, request bodies, headers, cookies, storage, Runtime.evaluate, and non-session tabs.

**Step 2: Run tests and observe failure**

Run: `npm run test:browser-extension:unit -- browser-extension/src/background/debugger.test.ts browser-extension/src/background/downloads.test.ts`

Expected: FAIL.

**Step 3: Implement a strict CDP facade**

Allow only the exact methods required for `Page.captureScreenshot`, console event subscription, network lifecycle metadata, DOM inspection, and navigation observation. Use `chrome.downloads` for downloads and `chrome.notifications` for completion or approval-required notices. Detach debugger state on session close, tab close, transport loss, permission loss, or worker shutdown recovery.

**Step 4: Run tests**

Run: `npm run test:browser-extension:unit -- browser-extension/src/background/debugger.test.ts browser-extension/src/background/downloads.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add browser-extension/src/background/debugger.ts browser-extension/src/background/downloads.ts browser-extension/src/background/debugger.test.ts browser-extension/src/background/downloads.test.ts browser-extension/src/background/service-worker.ts
git commit -m "feat: inspect and download from controlled pages"
```

## Task 11: Build the full branded side-panel chat experience

**Files:**

- Create: `browser-extension/src/sidepanel/api.ts`
- Create: `browser-extension/src/sidepanel/state.ts`
- Create: `browser-extension/src/sidepanel/components/Pairing.svelte`
- Create: `browser-extension/src/sidepanel/components/Chat.svelte`
- Create: `browser-extension/src/sidepanel/components/Composer.svelte`
- Create: `browser-extension/src/sidepanel/components/ModelPicker.svelte`
- Create: `browser-extension/src/sidepanel/components/SessionBar.svelte`
- Create: `browser-extension/src/sidepanel/components/ApprovalCard.svelte`
- Create: `browser-extension/src/sidepanel/components/ActivityTimeline.svelte`
- Modify: `browser-extension/src/sidepanel/App.svelte`
- Modify: `browser-extension/src/sidepanel/theme.css`
- Create: `browser-extension/src/sidepanel/App.test.ts`

**Step 1: Write failing component tests**

Test Tide-Bot identity, text-first focus, selected model loading, existing-chat loading, new-chat creation, streaming assistant text, tool activity, approval allow/deny, action mode default, tab policy, offline state, reconnect, paired-device state, keyboard accessibility, and no voice activation on initial load.

**Step 2: Run tests and observe failure**

Run: `npm run test:browser-extension:unit -- browser-extension/src/sidepanel/App.test.ts`

Expected: FAIL.

**Step 3: Connect normal Tide-Bot chat semantics**

Use the existing API shapes for `/api/models`, `/api/v1/chats/new`, `/api/v1/chats/{id}`, `/api/chat/completions`, and audio endpoints. Add `features.browser_control: true` and `browser_session` metadata only while a browser session is live. Store messages in the same Tide-Bot chat record and surface the same model names. Do not create a browser-only chat database.

The panel layout is: compact brand header, connection and tab session bar, model and chat selectors, scrolling transcript, action timeline, inline approval cards, text composer, voice toggle, and settings drawer. `Autonomous` and `Lock to starting tab` are the defaults.

**Step 4: Run tests and branding audit**

Run:

```bash
npm run test:browser-extension:unit -- browser-extension/src/sidepanel/App.test.ts
npm run audit:branding
```

Expected: PASS.

**Step 5: Commit**

```bash
git add browser-extension/src/sidepanel/api.ts browser-extension/src/sidepanel/state.ts browser-extension/src/sidepanel/components/Pairing.svelte browser-extension/src/sidepanel/components/Chat.svelte browser-extension/src/sidepanel/components/Composer.svelte browser-extension/src/sidepanel/components/ModelPicker.svelte browser-extension/src/sidepanel/components/SessionBar.svelte browser-extension/src/sidepanel/components/ApprovalCard.svelte browser-extension/src/sidepanel/components/ActivityTimeline.svelte browser-extension/src/sidepanel/App.svelte browser-extension/src/sidepanel/theme.css browser-extension/src/sidepanel/App.test.ts
git commit -m "feat: add Tide-Bot side-panel chat"
```

## Task 12: Add text-default, hands-free-default voice chat

**Files:**

- Create: `browser-extension/src/sidepanel/voice.ts`
- Create: `browser-extension/src/sidepanel/components/VoiceControls.svelte`
- Create: `browser-extension/src/sidepanel/voice.test.ts`
- Modify: `browser-extension/src/sidepanel/App.svelte`
- Modify: `browser-extension/src/sidepanel/api.ts`

**Step 1: Write failing voice tests**

Test that text is the initial input mode, selecting voice starts in hands-free mode, push-to-talk is opt-in, VAD segments audio, audio is submitted to Tide-Bot STT, transcripts require no extra tap in hands-free mode, assistant text uses Tide-Bot TTS, interruption stops playback, mic permission denial is recoverable, and no raw audio is written to extension storage.

**Step 2: Run tests and observe failure**

Run: `npm run test:browser-extension:unit -- browser-extension/src/sidepanel/voice.test.ts`

Expected: FAIL.

**Step 3: Reuse Tide-Bot audio endpoints**

Implement an in-memory `MediaRecorder` pipeline and Web Audio VAD. Send each completed segment as multipart audio to `/api/v1/audio/transcriptions`. Send assistant text to `/api/v1/audio/speech`. Revoke every object URL and clear every blob reference after use. Display a persistent recording indicator and a one-click stop control.

**Step 4: Run tests**

Run: `npm run test:browser-extension:unit -- browser-extension/src/sidepanel/voice.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add browser-extension/src/sidepanel/voice.ts browser-extension/src/sidepanel/components/VoiceControls.svelte browser-extension/src/sidepanel/voice.test.ts browser-extension/src/sidepanel/App.svelte browser-extension/src/sidepanel/api.ts
git commit -m "feat: add hands-free browser voice chat"
```

## Task 13: Add workflow recording, encrypted sync, and Chrome-open scheduling

**Files:**

- Create: `browser-extension/src/content/recording.ts`
- Create: `browser-extension/src/background/workflows.ts`
- Create: `browser-extension/src/background/schedules.ts`
- Create: `browser-extension/src/background/workflows.test.ts`
- Create: `browser-extension/src/background/schedules.test.ts`
- Modify: `backend/open_webui/routers/browser_extension.py`
- Create: `backend/open_webui/routers/test_browser_extension_workflows.py`
- Create: `browser-extension/src/sidepanel/components/WorkflowManager.svelte`
- Modify: `browser-extension/src/sidepanel/App.svelte`

**Step 1: Write failing workflow and schedule tests**

Cover recording start/stop, semantic selector generation, secret-value omission, review before save, encrypted server round-trip, version conflicts, device assignment, RRULE validation, Chrome alarms, one catch-up run, no catch-up flood, disabled schedule, missing device, locked-tab loss, and approval-required pause.

**Step 2: Run tests and observe failure**

Run:

```bash
npm run test:browser-extension:unit -- browser-extension/src/background/workflows.test.ts browser-extension/src/background/schedules.test.ts
pytest -q backend/open_webui/routers/test_browser_extension_workflows.py
```

Expected: FAIL.

**Step 3: Add owner-scoped workflow APIs**

Expose list, create, update, delete, schedule create/update/delete, and device sync endpoints under `/api/v1/browser-extension`. Encrypt workflow definitions before persistence. Return decrypted definitions only to the owning signed-in user or paired device assigned by that user.

The extension records click, type-intent without sensitive values, select, navigation, and wait checkpoints. The user reviews and names the workflow before saving. Chrome alarms are the execution authority. On extension startup, compare `last_run_at` with the RRULE and execute only the latest missed occurrence.

**Step 4: Run focused tests**

Run the commands from Step 2 again. Expected: PASS.

**Step 5: Commit**

```bash
git add browser-extension/src/content/recording.ts browser-extension/src/background/workflows.ts browser-extension/src/background/schedules.ts browser-extension/src/background/workflows.test.ts browser-extension/src/background/schedules.test.ts backend/open_webui/routers/browser_extension.py backend/open_webui/routers/test_browser_extension_workflows.py browser-extension/src/sidepanel/components/WorkflowManager.svelte browser-extension/src/sidepanel/App.svelte
git commit -m "feat: record and schedule browser workflows"
```

## Task 14: Add authenticated download and device management to tide-bot.com

**Files:**

- Create: `src/lib/apis/browser-extension/index.ts`
- Create: `src/lib/components/browser-extension/BrowserExtensionSettings.svelte`
- Create: `src/lib/components/browser-extension/BrowserExtensionSettings.test.ts`
- Modify: `src/lib/components/chat/SettingsModal.svelte`
- Modify: `src/lib/components/layout/Sidebar/UserMenu.svelte`
- Modify: `backend/open_webui/routers/browser_extension.py`
- Modify: `scripts/audit-branding.mjs`

**Step 1: Write failing web and API tests**

Test that guests cannot download, denied users cannot download, verified allowed users receive a ZIP with safe headers, missing builds return 503 without filesystem disclosure, devices can be renamed and revoked, workflows and schedules are visible, custom origin controls are admin-only, and the UI gives Chrome load-unpacked instructions plus the Web Store-ready package status.

**Step 2: Run tests and observe failure**

Run:

```bash
pytest -q backend/open_webui/routers/test_browser_extension_pairing.py -k download
npm run test:frontend -- src/lib/components/browser-extension/BrowserExtensionSettings.test.ts
```

Expected: FAIL.

**Step 3: Implement the protected settings surface**

Add a `Browser extension` personal settings tab and a user-menu entry visible only to admins or users with effective browser-extension permission. The download endpoint serves only the fixed generated ZIP path with `application/zip`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, and a SHA-256 checksum header.

Extend the brand audit to require extension brand assets, product name, privacy copy, and absence of upstream visible branding in the new components.

**Step 4: Run focused tests and branding audit**

Run:

```bash
pytest -q backend/open_webui/routers/test_browser_extension_pairing.py -k download
npm run test:frontend -- src/lib/components/browser-extension/BrowserExtensionSettings.test.ts
npm run audit:branding
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/apis/browser-extension/index.ts src/lib/components/browser-extension/BrowserExtensionSettings.svelte src/lib/components/browser-extension/BrowserExtensionSettings.test.ts src/lib/components/chat/SettingsModal.svelte src/lib/components/layout/Sidebar/UserMenu.svelte backend/open_webui/routers/browser_extension.py scripts/audit-branding.mjs
git commit -m "feat: distribute Tide-Bot browser extension"
```

## Task 15: Add hermetic Playwright coverage and release CI

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `browser-extension/playwright.config.ts`
- Create: `browser-extension/e2e/browser-control.spec.ts`
- Create: `browser-extension/e2e/fixtures/fake-tide-bot.mjs`
- Create: `browser-extension/e2e/fixtures/test-page.html`
- Create: `scripts/run-browser-extension-playwright.mjs`
- Create: `scripts/run-browser-extension-playwright.test.mjs`
- Create: `.github/workflows/tide-bot-browser-extension.yml`

**Step 1: Write failing harness-isolation tests**

Reject caller-controlled production origins, browser profiles, extension paths, credentials, and output directories. Assert generated loopback ports, private temporary directories, fixed repository inputs, redacted failure logs, bounded timeouts, and cleanup of only the harness-owned profile.

**Step 2: Run the test and observe failure**

Run: `node --test scripts/run-browser-extension-playwright.test.mjs`

Expected: FAIL because the runner does not exist.

**Step 3: Add Playwright and the isolated harness**

Add `@playwright/test` as an exact dev dependency. Build a test-only extension into a private temporary directory with a generated loopback Tide-Bot origin. Launch bundled Chromium with only that unpacked extension enabled. Never point at an installed Chrome profile.

The end-to-end story must cover pairing, text chat, model selection, one-tab lock, observe/click/type/select/navigation, autonomous ordinary action, consequential approval, manual approval, screenshot metadata, sanitized console/network output, download, workflow record/replay, schedule alarm, hands-free transcript submission with a mocked media stream, offline recovery, and device revocation.

**Step 4: Add CI**

The workflow must pin Node 22.18.0 and npm 10.9.3, run unit tests, backend focused tests, extension build, package inspection, Playwright Chromium installation, hermetic E2E, type checks, and branding audit. Upload the ZIP and checksum as workflow artifacts. Do not publish to the Chrome Web Store.

**Step 5: Run harness tests and E2E**

Run:

```bash
node --test scripts/run-browser-extension-playwright.test.mjs
npx playwright install chromium
npm run test:browser-extension:e2e
```

Expected: PASS with no leftover browser profile or live test server.

**Step 6: Commit**

```bash
git add package.json package-lock.json browser-extension/playwright.config.ts browser-extension/e2e/browser-control.spec.ts browser-extension/e2e/fixtures/fake-tide-bot.mjs browser-extension/e2e/fixtures/test-page.html scripts/run-browser-extension-playwright.mjs scripts/run-browser-extension-playwright.test.mjs .github/workflows/tide-bot-browser-extension.yml
git commit -m "test: verify Tide-Bot browser extension end to end"
```

## Task 16: Document installation, security, recovery, and administration

**Files:**

- Create: `docs/browser-extension/README.md`
- Create: `docs/browser-extension/security.md`
- Create: `docs/browser-extension/chrome-web-store.md`
- Modify: `README.md`
- Modify: `browser-extension/store/privacy.md`

**Step 1: Write the documentation contract test**

Add assertions to `scripts/build-browser-extension.test.mjs` requiring installation steps, local-model statement, exact permission explanation, data-retention table, mode descriptions, single-tab limitation, Chrome-open schedule behavior, device revocation, incident recovery, custom-origin admin lock, Web Store checklist, and the statement that no automatic store submission occurs.

**Step 2: Run the test and observe failure**

Run: `node --test scripts/build-browser-extension.test.mjs`

Expected: FAIL until the documentation is complete.

**Step 3: Write concise operator and user docs**

Document both signed-in ZIP installation and Chrome Web Store preparation. Include every requested Chrome permission with its user-facing justification. State exactly what persists and what remains ephemeral. Add recovery instructions for lost devices, replay detection, origin mismatch, offline models, worker suspension, and revoked browser access.

**Step 4: Run the documentation and brand tests**

Run:

```bash
node --test scripts/build-browser-extension.test.mjs
npm run audit:branding
```

Expected: PASS.

**Step 5: Commit**

```bash
git add docs/browser-extension/README.md docs/browser-extension/security.md docs/browser-extension/chrome-web-store.md README.md browser-extension/store/privacy.md scripts/build-browser-extension.test.mjs
git commit -m "docs: explain Tide-Bot browser control"
```

## Task 17: Run full verification and integrate to main

**Files:** Verification only unless a failure requires a test-first fix.

**Step 1: Confirm repository state and migration topology**

Run:

```bash
git status --short
cd backend && alembic heads
```

Expected: only intentional uncommitted verification artifacts, then one Alembic head.

**Step 2: Run backend verification**

Run:

```bash
pytest -q backend/open_webui/models/test_browser_extension.py backend/open_webui/utils/test_browser_extension_crypto.py backend/open_webui/utils/access_control/test_browser_extension_permission.py backend/open_webui/utils/test_browser_extension_auth.py backend/open_webui/utils/test_browser_extension_broker.py backend/open_webui/socket/test_browser_extension_handlers.py backend/open_webui/utils/test_browser_extension_tools.py backend/open_webui/utils/test_browser_extension_middleware.py backend/open_webui/routers/test_browser_extension_pairing.py backend/open_webui/routers/test_browser_extension_workflows.py
```

Expected: PASS.

**Step 3: Run frontend and extension verification**

Run:

```bash
npm run test:frontend
npm run test:browser-extension:unit
npm run check
npm run build:browser-extension
npm run build
npm run audit:branding
node --test scripts/build-browser-extension.test.mjs scripts/run-browser-extension-playwright.test.mjs
npm run test:browser-extension:e2e
```

Expected: PASS.

**Step 4: Inspect the release artifact**

Run:

```bash
unzip -t backend/open_webui/static/browser-extension/tide-bot-browser-extension.zip
unzip -l backend/open_webui/static/browser-extension/tide-bot-browser-extension.zip
git status --short
git diff --check
```

Expected: valid archive, manifest at root, no forbidden generated files tracked, clean whitespace.

**Step 5: Review security-sensitive diffs**

Inspect pairing, token rotation, permissions, broker routing, middleware injection, extension policy, debugger allowlist, redaction, download headers, build script, harness, and workflow. Search for secrets and prohibited capabilities:

```bash
rg -n "Runtime\.evaluate|chrome\.cookies|chrome\.storage\.managed|passwordsPrivate|payment|Authorization: Bearer|console\.log\(.*token|TODO|TBD|FIXME" browser-extension backend/open_webui scripts docs/browser-extension
```

Expected: only intentional test assertions or explanatory documentation, no unsafe implementation.

**Step 6: Use the verification and finishing skills**

Invoke `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`. Because the user explicitly authorized integration to `main`, merge the verified feature branch into the latest local `main`, rerun the required smoke checks after the merge, and push `main` to GitHub. Do not open a PR unless the user changes direction.

**Step 7: Report the outcome**

Provide the pushed commit hash, a concise capability summary, exact verification evidence, the authenticated Tide-Bot download location, and any Chrome Web Store action that still requires the user's own developer account.
