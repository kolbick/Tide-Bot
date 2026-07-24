# Ted-Bot Native Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Deliver a macOS and Windows Ted-Bot companion that remains usable when Tide-Bot is minimized and provides typed, authenticated access to the current Tide-Bot conversation.

**Architecture:** Add a Tauri 2 package with separate main and companion windows, then add a focused /companion Svelte route that uses the existing Tide-Bot chat and authorization paths. An authenticated, user-scoped Socket.IO presence service selects the active conversation; the companion never owns a second backend, credential store, or privileged action path.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Vitest, FastAPI, python-socketio, pytest, Tauri 2, Rust, Node 22.18.0, npm 10.9.3.

> **Implementation amendments:** The current-code compatibility and security
> decisions in
> [`2026-07-24-ted-bot-native-companion-amendments.md`](../2026-07-24-ted-bot-native-companion-amendments.md)
> are binding for this plan.

## Global Constraints

- Tide-Bot is the product; Ted-Bot is its black-goldendoodle companion.
- Ship typed chat first. Push-to-talk, read-aloud, browser Picture-in-Picture, and autonomous pet actions are excluded.
- Preserve Tide-Bot authentication, authorization, confirmation, terminal, CPTR, and destructive-action safeguards without a companion bypass.
- Presence is ephemeral and user-scoped. Its only fields are client ID, chat ID, chat title, device label, focus flag, and focus timestamp.
- Do not persist or log presence payloads, message content, tokens, or credentials.
- Preserve untracked tide-bot-pet/ and teddy-v2-upgrade/. Use only the tracked sprite at static/tide-bot/ted-bot/spritesheet.webp.
- Use an existing or temporary Python environment for focused pytest runs; do not use uv run.
- Treat repository-wide npm run check diagnostics as inherited unless a changed-path check identifies a new Tide-Bot regression.

---

## File structure

| Path | Responsibility |
| --- | --- |
| src/lib/components/ted-bot/TedBotPet.svelte | Accessible atlas renderer with idle and reduced-motion states. |
| src/lib/components/ted-bot/CompanionPanel.svelte | Compact transcript, typed composer, status, and full-app action. |
| static/tide-bot/ted-bot/pet.json | Tracked Ted-Bot v2 package metadata beside the validated spritesheet. |
| src/lib/ted-bot/presence.ts | Browser presence publisher, subscriber, and wire-payload guards. |
| src/lib/ted-bot/routes.ts | The single exact `/companion` route predicate used by root and app layouts. |
| src/routes/(app)/companion/+page.svelte | Authenticated companion route. |
| backend/open_webui/socket/companion_presence.py | Ephemeral registry, parser, limiter, and Socket.IO service. |
| backend/open_webui/utils/chat_access.py | One chat-read authorization helper for routes and presence. |
| desktop/tide-bot/ | Tauri 2 package, native windows, tray, placement, and capabilities. |

## Task 1: Establish a guarded recovery baseline

**Files:**
- Create: docs/superpowers/2026-07-24-ted-bot-companion-baseline.md
- Reference only: backup/pre-tide-bot-product-recovery-2026-07-23

**Interfaces:**
- Consumes: the approved native companion design.
- Produces: current baseline evidence and an explicit boundary against wholesale restoration of the old companion branch.

- [ ] **Step 1: Record current verification**

Create a table with these exact rows: npm run audit:branding, npm run test:frontend -- --run, npm run build, docker compose -f deploy/tide-stack/docker-compose.yml config --quiet, and curl -fsS http://127.0.0.1:3102/health. Record command, exit status, date, and whether the local stack was running. Do not print secrets.

- [ ] **Step 2: Prove the old detour is not being restored**

Run:

~~~
git diff --name-only backup/pre-tide-bot-product-recovery-2026-07-23..HEAD -- desktop src/lib/components/companion backend/open_webui/socket/companion_presence.py
test ! -e desktop/tide-companion
test ! -e src/lib/components/companion
~~~

Expected: the current checkout has no old companion path. Inspect individual backup files only when a planned interface needs comparison.

- [ ] **Step 3: Commit**

~~~
git add docs/superpowers/2026-07-24-ted-bot-companion-baseline.md
git commit -m 'docs: record ted-bot companion baseline'
~~~

## Task 2: Replace the decorative mascot with a reusable pet renderer

**Files:**
- Create: src/lib/components/ted-bot/TedBotPet.svelte
- Create: src/lib/components/ted-bot/TedBotPet.test.ts
- Create: static/tide-bot/ted-bot/pet.json
- Create: scripts/validate-ted-bot-pet.mjs
- Create: scripts/validate-ted-bot-pet.test.mjs
- Modify: src/lib/components/branding/TedBotMascot.svelte
- Modify: package.json
- Modify: package-lock.json

**Interfaces:**
- Produces: TedBotPet props state: 'idle' | 'working' | 'offline', label: string, interactive: boolean.
- Consumes: BRAND.tedBotSpritePath.

- [ ] **Step 1: Add the narrow DOM test foundation and write the failing test**

Keep Vitest's default Node environment. Add the required DOM-test-only
development dependencies and lockfile entries; do not change the global Vitest
environment:

~~~
npm install --save-dev @testing-library/svelte @testing-library/jest-dom jsdom
~~~

Start the new component test with the per-file environment and matcher setup:

~~~ts
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import { expect, test } from 'vitest';
import TedBotPet from './TedBotPet.svelte';

test('provides one labelled image and a decorative sprite', () => {
	const { getByRole, getAllByRole } = render(TedBotPet, {
		state: 'idle',
		label: 'Ted-Bot ready'
	});
	expect(getByRole('img', { name: 'Ted-Bot ready' })).toBeInTheDocument();
	expect(getAllByRole('img')).toHaveLength(1);
});
~~~

- [ ] **Step 2: Verify the test fails**

Run: npx vitest run src/lib/components/ted-bot/TedBotPet.test.ts

Expected: FAIL because TedBotPet.svelte does not exist.

- [ ] **Step 3: Implement the renderer**

~~~svelte
<script lang="ts">
	import { BRAND } from '$lib/branding';
	export let state: 'idle' | 'working' | 'offline' = 'idle';
	export let label = 'Ted-Bot';
	export let interactive = false;
</script>

<div class:working={state === 'working'} class:offline={state === 'offline'} class="ted-bot-pet" role="img" aria-label={label} data-interactive={interactive}>
	<img src={BRAND.tedBotSpritePath} alt="" />
</div>
~~~

Add a 6rem by 6.5rem clipped atlas viewport, 4-second stepped idle animation, faster working animation, grayscale offline state, and a prefers-reduced-motion rule that disables animation. Replace the body of TedBotMascot with TedBotPet state="idle" so existing login and empty-chat uses retain their behavior. Create `static/tide-bot/ted-bot/pet.json` beside the existing tracked `spritesheet.webp` with complete Codex v2 metadata:

~~~json
{
	"id": "ted-bot",
	"displayName": "Ted-Bot",
	"description": "Tide-Bot's black-goldendoodle companion.",
	"spriteVersionNumber": 2,
	"spritesheetPath": "spritesheet.webp"
}
~~~

- [ ] **Step 4: Add a tracked structural package validator**

Create `scripts/validate-ted-bot-pet.mjs`, using only Node built-ins so CI does
not depend on the external Hatch runtime. It must read
`static/tide-bot/ted-bot/pet.json` and the WebP file resolved from its
`spritesheetPath`, reject a missing, non-string, absolute, escaping, or
non-`spritesheet.webp` path, and reject missing, extra, or mistyped v2 manifest
fields. The required manifest contract is exactly `id`, `displayName`,
`description`, `spriteVersionNumber`, and `spritesheetPath`, with the values
shown above and `spriteVersionNumber === 2`. Parse the WebP container enough to
reject an unreadable or non-1536-by-2288 image, and assert the 8-by-11 atlas
contract: 192-by-208 cells, exact divisibility, and the resulting
1536-by-2288 sheet. Exit nonzero with a specific diagnostic for every mismatch.

Create `scripts/validate-ted-bot-pet.test.mjs` with Node's built-in test
runner. It invokes the validator against the tracked package and temporary
fixture copies that prove rejection of every manifest-field failure, a bad
`spritesheetPath`, an absent atlas, wrong dimensions, and an invalid
8-by-11/cell-size relationship. Clean up fixtures at the end.

- [ ] **Step 5: Verify, visually inspect, and commit**

Run:

~~~
npx vitest run src/lib/components/ted-bot/TedBotPet.test.ts
node --test scripts/validate-ted-bot-pet.test.mjs
node scripts/validate-ted-bot-pet.mjs
~~~

Expected: PASS.

The Node validator is required in CI and at staging, but release acceptance has
an additional, required Hatch Pet v2 QA invocation. Before that invocation,
call Codex's `load_workspace_dependencies`, set `PYTHON` to the exact bundled
runtime it returns, and never substitute bare system `python`. Validate the
tracked file itself, not a copied or generated asset: set `ATLAS` to the
absolute path of `static/tide-bot/ted-bot/spritesheet.webp`, record
`shasum -a 256 "$ATLAS"` immediately before and after the checks, and require
both hashes to match the SHA-256 recorded in acceptance evidence. The same
absolute `ATLAS` path is the input to every release-only command:

~~~
SKILL_DIR="$HOME/.codex/skills/hatch-pet"
"$PYTHON" "$SKILL_DIR/scripts/validate_atlas.py" "$ATLAS" \
  --require-v2 --json-out "$EVIDENCE_DIR/ted-bot-atlas-validation.json"
"$PYTHON" "$SKILL_DIR/scripts/make_contact_sheet.py" "$ATLAS" \
  --output "$EVIDENCE_DIR/ted-bot-atlas-contact-sheet.png"
~~~

The Hatch validator's JSON is the deterministic alpha/transparency result: it
must pass its alpha-channel, used-cell, unused-cell-fully-transparent,
transparent-RGB-residue, and v2 geometry checks. Store both JSON and the
rendered contact sheet under the tracked acceptance-evidence directory and
visually inspect that contact sheet. The acceptance record must name the
absolute tracked input path, pre/post SHA-256, bundled-runtime path, validator
command/result, contact-sheet path, inspector/date, and a pass/fail rubric for
black-goldendoodle identity, 8-by-11/cell alignment, all look-direction
continuity, and unused-cell transparency. A missing bundled Hatch runtime,
hash mismatch, absent evidence artifact, or failed rubric leaves release
acceptance **pending**; it must never be reported as a pass. This is
independent of the Node structural validator. Do not stage user-owned
`teddy-v2-upgrade/` QA or provenance, and do not stage the root
`tide-bot-pet/` Cyborg package.

~~~
git add src/lib/components/ted-bot src/lib/components/branding/TedBotMascot.svelte static/tide-bot/ted-bot/pet.json scripts/validate-ted-bot-pet.mjs scripts/validate-ted-bot-pet.test.mjs docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md docs/superpowers/evidence/2026-07-24-ted-bot-native-companion/
git add package.json package-lock.json
git commit -m 'feat: add ted-bot companion renderer'
~~~

## Task 3: Add authorized active-chat presence

**Files:**
- Create: backend/open_webui/utils/chat_access.py
- Create: backend/open_webui/socket/companion_presence.py
- Create: backend/open_webui/socket/test_companion_presence.py
- Create: backend/open_webui/socket/test_companion_presence_handlers.py
- Create: backend/open_webui/socket/test_companion_presence_redis_integration.py
- Create: deploy/tide-stack/docker-compose.presence-integration.yml
- Create: scripts/run-companion-presence-redis-integration.mjs
- Modify: backend/open_webui/routers/chats.py
- Modify: backend/open_webui/socket/main.py
- Modify: backend/open_webui/main.py

**Interfaces:**
- Produces: get_readable_chat(user_id, role, chat_id, db) -> ChatModel | None,
  where `ChatModel` is `backend.open_webui.models.chats.ChatModel`.
- Produces: CompanionPresenceSocketService.update(sid, data), subscribe(sid), disconnect(sid), and expire().
- Consumes: SESSION_POOL, user:{id} Socket.IO rooms, Chats, AccessGrants, and Folders.

- [ ] **Step 1: Write the failing security tests**

~~~py
import asyncio
import pytest

@pytest.mark.asyncio
async def test_update_rejects_another_users_chat_before_registry_mutation():
	service, get_readable_chat = make_service(readable_chat=None)
	result = await service.update('sid-1', payload(chatId='other-user-chat'))
	assert result == {'ok': False, 'error': 'chat_access_denied'}
	get_readable_chat.assert_awaited_once()
	assert service.registry.state('user-1', now=0).active is None

@pytest.mark.asyncio
async def test_state_is_emitted_only_to_the_authenticated_user_room():
	service, sio = make_service()
	assert await service.update('sid-1', payload()) == {'ok': True, 'revision': 1}
	sio.emit.assert_awaited_once_with(
		'companion:presence:state',
		{'active': payload(), 'revision': 1},
		room='user:user-1',
	)

@pytest.mark.asyncio
async def test_multiworker_without_redis_fails_before_presence_service_starts():
	with pytest.raises(RuntimeError, match='requires Redis'):
		await start_presence(worker_count=2, websocket_manager='memory')

@pytest.mark.asyncio
async def test_redis_update_is_atomic_per_user_and_increments_shared_revision():
	store = RedisPresenceStore(redis=fake_redis())
	first, second = await asyncio.gather(store.update('user-1', payload()), store.update('user-1', payload()))
	assert sorted([first.revision, second.revision]) == [1, 2]

@pytest.mark.asyncio
async def test_lifespan_cancels_and_awaits_the_expiry_task_on_shutdown():
	app = make_app_with_presence()
	async with app_lifespan(app):
		assert app.state.companion_presence_expiry_task.done() is False
	assert app.state.companion_presence_expiry_task.cancelled()
~~~

- [ ] **Step 2: Verify the tests fail**

Run: pytest backend/open_webui/socket/test_companion_presence.py backend/open_webui/socket/test_companion_presence_handlers.py -q

Expected: FAIL because the presence module does not exist.

- [ ] **Step 3: Implement one authorization definition and the strict service**

Extract the existing owner, admin, shared-chat-grant, and shared-folder checks from the GET /chats/{id} handler into:

~~~py
async def get_readable_chat(
    user_id: str, role: str, chat_id: str, db: AsyncSession
) -> ChatModel | None:
	owned = await Chats.get_chat_by_id_and_user_id(chat_id, user_id, db=db)
	if owned:
		return owned
	# Retain the route's existing admin, AccessGrants, and shared-folder branches here.
	return None
~~~

Make the GET `/chats/{id}` route call that helper and build its response from
the returned model. The presence service calls the same helper and rejects
when it returns `None`; it takes the canonical title from the returned model,
never from the payload. In companion_presence.py define a frozen update record
with exactly clientId, chatId, chatTitle, deviceLabel, isFocused, and focusedAt.
Reject unknown keys, invalid types, oversized fields, and timestamps below
zero. Use a 30-second TTL, 30 updates per minute per socket, newest-focused
arbitration, and room=user:{user_id} emits. Wire only
companion:presence:update and companion:presence:subscribe handlers. In
`backend/open_webui/socket/main.py`, remove the socket from presence before
the existing disconnect handler clears `SESSION_POOL[sid]`.

Implement `MemoryPresenceStore` only when the configured worker count is
exactly one and `WEBSOCKET_MANAGER != 'redis'`. When
`WEBSOCKET_MANAGER == 'redis'`, implement `RedisPresenceStore` using the
existing async Redis connection `backend.open_webui.socket.main.REDIS`; use
one Redis Lua script (or `WATCH`/transaction retry) per user to read, expire,
arbitrate focus, write the state, and increment a shared revision atomically.
Read worker count from `backend.open_webui.env.UVICORN_WORKERS`; at FastAPI
startup in `backend/open_webui/main.py`, fail with a clear RuntimeError before
accepting traffic if worker count is greater than one without Redis. With
multiple Redis-backed workers, expiry uses a Redis leader lock or atomic
claim-and-delete so exactly one worker can promote/emit after an expiry; no
competing TTL loop may emit conflicting promotions. Authorization still reads
the synchronous `SESSION_POOL` RedisDict, while the presence store uses the
existing async `socket.main.REDIS` connection. Keep the handler surface exactly
`companion:presence:update` and `companion:presence:subscribe`, and remove a
socket from presence before its session is deleted on disconnect.
Store the expiry task as `app.state.companion_presence_expiry_task`; cancel and
await it during lifespan shutdown. Tests must cover malformed/unauthorized/
cross-user/rate-limit/expiry/disconnect promotion, the one-worker memory
topology, multi-worker no-Redis startup failure, Redis atomic revision updates,
disconnect-before-session-cleanup ordering, and task cancellation/awaiting.

- [ ] **Step 4: Add the real-Redis, two-worker integration harness**

Keep the focused pytest unit tests above, including their fake-Redis coverage,
but add a separate disposable integration harness that cannot substitute a fake
Redis client or an injected revision/count. Create
`deploy/tide-stack/docker-compose.presence-integration.yml` with a test Redis
service, two independently started Tide-Bot worker services
(`presence-worker-a` and `presence-worker-b`) configured for
`WEBSOCKET_MANAGER=redis`, and a one-shot `presence-integration` test service.
The workers expose separate Socket.IO endpoints to the test service while
sharing one real Redis instance; they use a generated ephemeral Redis key
namespace via exact test-only `REDIS_KEY_PREFIX=tedbot-presence-it-${RUN_ID}:`
and `WEBSOCKET_MANAGER=redis`, never default
application presence data. All database bind mounts and named volumes are
unique to this Compose project/run. The configuration uses only local test
values: it generates an ephemeral `WEBUI_SECRET_KEY` and test-only database,
Redis, and application settings in a private temporary env file. It must not
read the repository-root deployment `.env`, any production env file, or
production credentials, and it must never print credentials or secrets.

Create `scripts/run-companion-presence-redis-integration.mjs` as the only
wrapper for this harness. It requires `RUN_ID`; reject an empty value or one
that fails a documented conservative project-name-safe validation (lowercase
letters, digits, and hyphens, beginning and ending alphanumeric). Resolve the
repository root once, set `COMPOSE_FILE_PATH` to the exact absolute
`$REPO_ROOT/deploy/tide-stack/docker-compose.presence-integration.yml`, create
a private mode-0600 `RUN_ENV_FILE`, and derive exactly
`--project-name tedbot-presence-it-${RUN_ID}`. The wrapper must make every
Compose invocation through one `compose()` function that first changes to a
neutral temporary working directory (not the repository or any deployment
directory) and then runs only:

~~~
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$RUN_TMPDIR" \
  docker compose --file "$COMPOSE_FILE_PATH" --env-file "$RUN_ENV_FILE" \
  --project-name "tedbot-presence-it-${RUN_ID}" <up|ps|logs|run|down arguments>
~~~

Reject, before creating any resources, a caller environment containing
`COMPOSE_FILE`, `COMPOSE_PROJECT_NAME`, `COMPOSE_ENV_FILES`,
`COMPOSE_PATH_SEPARATOR`, or any other `COMPOSE_*` source-selection setting;
the wrapper does not forward any of them. Reject wrapper arguments that supply
another compose file, env file, project name, or source configuration. Thus
the harness cannot discover a root/live Compose file or `.env`; relative build
contexts remain intentionally resolved from the explicit absolute compose file.
Use the exact flags for **every** `up`, `ps`, `logs`, `run` (the one-shot test
service), and `down` invocation. Do not generate a fallback RUN_ID and never
invoke Compose outside this function or without all three explicit flags.
Before `up`, generate the private ephemeral env/config file and retain its path
only in process memory or a mode-0600 temporary directory. Start the composed
stack, wait for both worker health endpoints, run the test service, and collect
only redacted/non-sensitive worker and test evidence.

The one-shot test service creates two randomized, disposable users and their
authorized chats only in the isolated test database. It obtains each session
token by exercising Tide-Bot's supported sign-up/sign-in flow against an
isolated worker, or by a documented test-only bootstrap that creates the same
password/session records and is enabled solely by the private ephemeral test
configuration. It then connects one authenticated client to each distinct
worker and creates an unrelated second user's chat for isolation assertions.
The service passes credentials/tokens only through in-memory request headers or
environment variables internal to the Compose project; it never writes or logs
them. The tests retain the real-handler/real-Redis assertions: a shared,
monotonically ordered revision stream for concurrent cross-worker updates,
disconnect promotion of the remaining focused client, and no user-room state
or event crossing.

In an unconditional `finally`/trap, cleanup calls that same isolated
`compose()` function only with `down --volumes --remove-orphans`, deletes that
run's private temporary config, and verifies that only resources bearing this
exact project label/name were removed (the project containers, networks, and
volumes). It must inspect, but never stop, restart, recreate, or remove any
pre-existing Tide-Bot container, network, or volume; a live Tide-Bot Compose
stack is explicitly out of scope. Create
`backend/open_webui/socket/test_companion_presence_redis_integration.py` as
the test-service entrypoint. It connects authenticated test clients using
direct WebSocket transport (not polling/fallback or a load balancer) to both
independently started worker endpoints and exercises the actual Socket.IO handler and
`RedisPresenceStore` atomic update path. It proves concurrent updates from the
two workers result in one shared monotonically ordered revision stream,
disconnect cleanup promotes the remaining focused client, and no state/event
crosses from `user-a` into `user-b`'s room. Assert the ephemeral namespace is
empty at the end before namespaced teardown. No test is complete if it calls
`fake_redis`, directly patches a store count/revision, or runs both clients
through one worker.

- [ ] **Step 5: Verify and commit**

Run:

~~~
pytest backend/open_webui/socket/test_companion_presence.py backend/open_webui/socket/test_companion_presence_handlers.py -q
RUN_ID=local-$(date +%s) node scripts/run-companion-presence-redis-integration.mjs
~~~

Expected: PASS with malformed, unauthorized, cross-user, rate-limit, expiry,
disconnect-promotion, topology, Redis atomic revision, disconnect ordering, and
lifespan shutdown coverage, plus disposable real-Redis/two-worker
concurrent-revision, disconnect-promotion, and room-isolation evidence. The
wrapper output records the explicit project name, redacted worker endpoints,
assertion results, namespace-empty check, namespaced-resource teardown check,
and confirmation that no existing Tide-Bot service was stopped or restarted.

~~~
git add backend/open_webui/utils/chat_access.py backend/open_webui/socket backend/open_webui/routers/chats.py backend/open_webui/main.py deploy/tide-stack/docker-compose.presence-integration.yml scripts/run-companion-presence-redis-integration.mjs
git commit -m 'feat: synchronize ted-bot active chat presence'
~~~

## Task 4: Publish and consume presence in Svelte

**Files:**
- Create: src/lib/ted-bot/presence.ts
- Create: src/lib/ted-bot/presence.test.ts
- Create: src/lib/components/ted-bot/MainPresencePublisher.svelte
- Create: src/lib/ted-bot/routes.ts
- Modify: src/routes/+layout.svelte
- Modify: src/routes/(app)/+layout.svelte

**Interfaces:**
- Produces: createMainPresencePublisher and createCompanionPresenceSubscriber.
- Consumes: the existing socket store and `chatId`/`chatTitle` stores.

- [ ] **Step 1: Write the failing fake-timer tests**

~~~ts
import { expect, test, vi } from 'vitest';

test('publishes chat selection, focus, reconnect, and heartbeat', () => {
	const socket = createFakeSocket();
	const publisher = createMainPresencePublisher({
		socket,
		clientId: 'main-1',
		deviceLabel: 'Tide-Bot Browser',
		now: () => 100
	});
	publisher.setChat('chat-1', 'Treatment notes');
	publisher.setFocused(true);
	publisher.heartbeat();
	expect(socket.emitted('companion:presence:update')).toHaveLength(3);
});

test('ignores stale presence revisions', () => {
	const apply = vi.fn();
	const subscriber = createCompanionPresenceSubscriber(createFakeSocket(), apply);
	subscriber.onState({ active: null, revision: 2 });
	subscriber.onState({ active: null, revision: 1 });
	expect(apply).toHaveBeenCalledTimes(1);
});

test('resets the browser revision on reconnect before accepting a fresh subscription snapshot', () => {
	const socket = createFakeSocket();
	const apply = vi.fn();
	const subscriber = createCompanionPresenceSubscriber(socket, apply);
	subscriber.onState({ active: null, revision: 8 });
	socket.connect();
	expect(socket.emitted('companion:presence:subscribe')).toHaveLength(1);
	subscriber.onState({ active: null, revision: 1 });
	expect(apply).toHaveBeenCalledTimes(2);
});
~~~

- [ ] **Step 2: Verify the tests fail**

Run: npx vitest run src/lib/ted-bot/presence.test.ts

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement presence and mount it in the authenticated layout**

~~~ts
export const PRESENCE_HEARTBEAT_MS = 10_000;

export type CompanionPresenceUpdate = {
	clientId: string;
	chatId: string | null;
	chatTitle: string | null;
	deviceLabel: string;
	isFocused: boolean;
	focusedAt: number;
};
~~~

Store a per-window client ID in sessionStorage. Derive focus from document.hasFocus() and document.visibilityState === 'visible'. Publish unfocused state at destroy. Subscribe to the existing `chatId` and `chatTitle` stores in `MainPresencePublisher` and publish their values; do not derive active chat from `/c/[id]` or any URL route. In `src/lib/ted-bot/routes.ts`, define exactly `export const isCompanionRoute = (pathname: string) => pathname === '/companion';`. Both root and app layouts import this helper and derive their route state from `$page.url.pathname`: the root layout suppresses `AppSidebar` when it is true; the app layout suppresses `Sidebar`, Settings/Changelog/Account-Pending overlays, and returns from the keydown handler before calling `matchKeybinding`. Mount MainPresencePublisher only when the predicate is false. On socket reconnect, reset the subscriber revision before emitting `companion:presence:subscribe`; then reject only snapshots at or below the new current revision.

- [ ] **Step 4: Verify and commit**

Run: npx vitest run src/lib/ted-bot/presence.test.ts

Expected: PASS.

~~~
git add src/lib/ted-bot src/lib/components/ted-bot/MainPresencePublisher.svelte src/routes/+layout.svelte src/routes/'(app)'/+layout.svelte
git commit -m 'feat: publish tide-bot active chat presence'
~~~

## Task 5: Build the typed companion route

**Files:**
- Create: src/lib/components/ted-bot/CompanionPanel.svelte
- Create: src/lib/components/ted-bot/CompanionPanel.test.ts
- Create: src/routes/(app)/companion/+page.svelte
- Create: src/lib/components/chat/lifecycleGuard.ts
- Create: src/lib/components/chat/lifecycleGuard.test.ts
- Create: src/lib/components/chat/MessageInput/CompanionTextComposer.svelte
- Create: src/lib/components/chat/MessageInput/CompanionTextComposer.test.ts
- Create: src/lib/components/chat/MessageInput.companion-contract.test.ts
- Modify: src/lib/components/chat/Chat.svelte
- Modify: src/lib/components/chat/MessageInput.svelte

**Interfaces:**
- Produces: `Chat.svelte` surface prop `'full' | 'note' | 'companion'` and a
  compact companion presentation of that canonical surface.
- Consumes: the existing Chat load, completion, stop, event, tool, terminal,
  queue, and confirmation behavior.
- Constraint: canonical `Chat.svelte` remains the only completion-payload,
  lifecycle, event, confirmation, and stop owner. Do not create or retain a
  `chatController` or duplicate chat APIs/events for the companion.

- [ ] **Step 1: Write the failing canonical-surface tests**

Keep `CompanionPanel.test.ts` in Vitest's default Node environment. It is a
source/contract test, so it reads `CompanionPanel.svelte` and proves canonical
reuse without attempting to render or mock the canonical component. Do not
render the current large `MessageInput` with partial fake context: that test
would be brittle and unrepresentative. Instead, create the small dedicated
`MessageInput/CompanionTextComposer.svelte` child and give it the only DOM-rendering test
in this task; it uses the narrow jsdom foundation from Task 2 with the per-file
directive and matcher setup. Do not add a global jsdom setting.

~~~ts
// CompanionPanel.test.ts: default Node environment
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('reuses the canonical companion Chat surface without duplicate APIs', async () => {
	const source = await readFile(
		fileURLToPath(new URL('./CompanionPanel.svelte', import.meta.url)),
		'utf8'
	);
	expect(source).toContain("from '$lib/components/chat/Chat.svelte'");
	expect(source).toMatch(/<Chat[\\s\\S]*surface=['\"]companion['\"]/);
	expect(source).not.toMatch(/from\s+['\"]\$lib\/apis\/(?:openai|tools)['\"]/);
});
~~~

~~~ts
// MessageInput/CompanionTextComposer.test.ts
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import CompanionTextComposer from './CompanionTextComposer.svelte';

test('typed composer sends entered text and exposes stop without optional controls', async () => {
	const send = vi.fn();
	const stop = vi.fn();
	const { component } = render(CompanionTextComposer, { props: { isGenerating: true } });
	component.$on('send', (event) => send(event.detail));
	component.$on('stop', stop);

	const input = screen.getByRole('textbox');
	await fireEvent.input(input, { target: { value: 'Hello Ted-Bot' } });
	expect(input).toHaveValue('Hello Ted-Bot');
	await fireEvent.click(screen.getByRole('button', { name: /send/i }));
	expect(send).toHaveBeenCalledWith('Hello Ted-Bot');
	await fireEvent.click(screen.getByRole('button', { name: /stop/i }));
	expect(stop).toHaveBeenCalledTimes(1);
	expect(screen.queryByLabelText(/attach/i)).not.toBeInTheDocument();
	expect(screen.queryByLabelText(/microphone/i)).not.toBeInTheDocument();
});
~~~

`CompanionTextComposer.svelte` is presentation-only: it owns only local
textarea text entry plus labelled send and stop controls. Its minimal typed API
is `isGenerating` plus dispatched `send(text)` and `stop()` events; it imports
no app stores, contexts, APIs, attachment,
audio, web-search, tool, or terminal control. Create the default-Node
`MessageInput.companion-contract.test.ts` to read `MessageInput.svelte` and
assert that it declares/receives `mode="companion"`, imports and delegates to
`CompanionTextComposer` only in that mode, passes the existing canonical send
event through its existing parent dispatch and stop event to `stopResponse`,
and gates attachment, audio, web-search, tool, terminal,
and other optional controls out of companion mode. This contract test is the
parent-delegation proof; it must not render `MessageInput` with fake context.

~~~ts
// lifecycleGuard.test.ts: default Node environment
import { expect, test, vi } from 'vitest';
import { createLifecycleGuard } from './lifecycleGuard';

test('drops stale load, completion, stop, and queue continuations after reset', async () => {
	const guard = createLifecycleGuard();
	const epoch = guard.capture();
	guard.reset();
	expect(guard.afterLoad(epoch)).toBe(false);
	expect(guard.afterCompletion(epoch)).toBe(false);
	expect(guard.afterStop(epoch)).toBe(false);
	expect(guard.afterQueue(epoch)).toBe(false);
});

test('resolves pending confirmation and input callbacks false on reset', () => {
	const confirmation = vi.fn();
	const input = vi.fn();
	const guard = createLifecycleGuard({ confirmation, input });
	guard.reset();
	expect(confirmation).toHaveBeenCalledWith(false);
	expect(input).toHaveBeenCalledWith(false);
});

test('resets when chatIdProp becomes empty or nullish', () => {
	const guard = createLifecycleGuard();
	const epoch = guard.capture();
	guard.onChatIdPropChange('');
	expect(guard.isCurrent(epoch)).toBe(false);
	const nullishEpoch = guard.capture();
	guard.onChatIdPropChange(null);
	expect(guard.isCurrent(nullishEpoch)).toBe(false);
});
~~~

- [ ] **Step 2: Verify the tests fail**

Run: npx vitest run src/lib/components/ted-bot/CompanionPanel.test.ts src/lib/components/chat/MessageInput/CompanionTextComposer.test.ts src/lib/components/chat/MessageInput.companion-contract.test.ts src/lib/components/chat/lifecycleGuard.test.ts

Expected: FAIL because the canonical companion surface, compact input mode, and
their test contracts do not exist.

- [ ] **Step 3: Reuse the canonical, epoch-protected Chat surface**

~~~ts
type ChatSurface = 'full' | 'note' | 'companion';
export let surface: ChatSurface = 'full';
~~~

Create the pure `lifecycleGuard.ts` module and use it from canonical
`Chat.svelte`, rather than creating a controller. The guard captures an epoch
before every awaited load, completion, stop, and queue operation, and Chat
checks `isCurrent(epoch)` after each await before mutating state. `reset()`
increments the epoch and resolves pending confirmation and input callbacks with
`false`; `onChatIdPropChange('')`, `onChatIdPropChange(null)`, and
`onChatIdPropChange(undefined)` call reset. The lifecycleGuard tests,
not component tests, are the required coverage for stale continuation and
callback-reset behavior.
The companion page obtains the active authorized chat ID from presence and
renders `CompanionPanel`, which renders `<Chat chatIdProp={chatId}
surface="companion" />`. Companion presentation retains the canonical
transcript, typed send, stop, connection state, and confirmation UI. Pass
`mode="companion"` to `MessageInput.svelte` when Chat's surface is companion.
`MessageInput` mounts `CompanionTextComposer` as its early companion-mode
branch, forwarding its send event through the existing parent dispatch and its
stop event to `stopResponse`. In companion
mode it guards the current full-mode `onMount` global dictation/drop-zone setup
and every attachment, audio, web search, tool, terminal, and other optional
control; the child has only typed input, send, and stop. The full-mode branch
continues to own its established controls. Do not alter server
permissions or confirmation behavior, and do not add a second completion
request, stream attachment, or event handler. In `Chat.svelte`, companion
surface hides only the Navbar, side controls, and placeholder while retaining
canonical Messages, confirmation, and submit behavior; it also must guard its
`history.replaceState` route change when `surface === 'companion'`.

- [ ] **Step 4: Verify and commit**

Run: npx vitest run src/lib/components/ted-bot/CompanionPanel.test.ts src/lib/components/chat/MessageInput/CompanionTextComposer.test.ts src/lib/components/chat/MessageInput.companion-contract.test.ts src/lib/components/chat/lifecycleGuard.test.ts

Expected: PASS with Node source/contract evidence of canonical-surface reuse
and no duplicate completion/tool API import, Node parent-delegation evidence
that companion mode hides every optional control, jsdom evidence of the small
typed-only child, and lifecycleGuard evidence for stale load/completion/stop/
queue, pending callback denial, and cleared chat ID reset.

~~~
git add src/lib/components/ted-bot/CompanionPanel.svelte src/lib/components/ted-bot/CompanionPanel.test.ts src/routes/'(app)'/companion/+page.svelte src/lib/components/chat/Chat.svelte src/lib/components/chat/MessageInput.svelte src/lib/components/chat/MessageInput/CompanionTextComposer.svelte src/lib/components/chat/MessageInput/CompanionTextComposer.test.ts src/lib/components/chat/MessageInput.companion-contract.test.ts src/lib/components/chat/lifecycleGuard.ts src/lib/components/chat/lifecycleGuard.test.ts
git commit -m 'feat: add ted-bot typed companion chat'
~~~

## Task 5a: Add authenticated companion Cypress smoke coverage

**Files:**
- Create: cypress/e2e/ted-bot-companion.cy.ts
- Create: deploy/tide-stack/docker-compose.cypress-companion.yml
- Create: scripts/run-companion-cypress.mjs
- Create: scripts/run-companion-cypress.test.mjs
- Modify: package.json

- [ ] **Step 1: Implement the disposable isolated UI smoke**

Add `test:companion:e2e` as `node scripts/run-companion-cypress.mjs`.
`run-companion-cypress.mjs` is the tracked, mandatory isolation wrapper, not a
preflight for a normal stack. It requires a nonempty conservative
project-name-safe `RUN_ID`, creates a private mode-0600 env file and test-only
database/volumes, and starts only
`deploy/tide-stack/docker-compose.cypress-companion.yml` under
`tedbot-companion-cypress-${RUN_ID}`. Every Compose `up`, `ps`, `logs`, and
`down` uses that exact absolute compose file, generated `--env-file`, and
explicit project name from a neutral temporary working directory. Reject
`COMPOSE_FILE`, `COMPOSE_PROJECT_NAME`, any other source-selecting
`COMPOSE_*` variable, alternate compose/env/project arguments, and every base
URL except an explicitly configured `http://127.0.0.1:<test-port>` or
`http://localhost:<test-port>` loopback origin. The wrapper must not run
against a production, live, or user-managed Tide-Bot stack and must not accept
user-supplied application credentials. It passes only the isolated loopback
origin to Cypress, disables screenshots/videos, and redacts process output.

The Cypress spec creates a randomized disposable account through Tide-Bot's
supported sign-up UI against that isolated stack, then signs in through the
normal UI. Account data and any test session remain in Cypress memory and the
isolated database only; never log credentials, tokens, request bodies, or auth
headers. The wrapper waits for the isolated health endpoint, runs only
`cypress/e2e/ted-bot-companion.cy.ts`, and uses an unconditional trap/finally
to run its exact isolated `down --volumes --remove-orphans`, remove the private
env directory, and verify only resources carrying the exact test project label
were removed. It must inspect but never stop, restart, recreate, or remove a
pre-existing Tide-Bot resource. `run-companion-cypress.test.mjs` injects
environment/spawn dependencies to prove rejection of live/external origins and
source Compose overrides, exact isolated invocation, redacted Cypress launch,
and safe-teardown path without starting Docker or a browser.

The spec uses separate cases and clears cookies, local storage, session storage,
and Cypress session cache in `beforeEach`. The anonymous case visits
`/companion` before any login and asserts redirect to `/auth`. The authenticated
cases verify compact companion chrome/shortcut suppression, typed send/stop,
confirmation denial, and an intercepted completion count of exactly one. Do
not assert cross-client active-chat or presence synchronization here: the
real-Redis/two-worker Socket.IO integration harness is the sole gate for that
proof. Redact request bodies and auth headers in Cypress logging.

- [ ] **Step 2: Verify and commit**

Run:

~~~
node --test scripts/run-companion-cypress.test.mjs
RUN_ID=cypress-local-$(date +%s) npm run test:companion:e2e
~~~

Expected: PASS only against the wrapper-created disposable loopback stack and
account. Attach the isolated project name, loopback origin, redacted result,
and safe-teardown verification to acceptance evidence. Missing isolation,
runtime, or test prerequisites are a failed/pending release gate, never an
optional credential skip.

~~~
git add cypress/e2e/ted-bot-companion.cy.ts deploy/tide-stack/docker-compose.cypress-companion.yml scripts/run-companion-cypress.mjs scripts/run-companion-cypress.test.mjs package.json
git commit -m 'test: add companion smoke coverage'
~~~

## Task 6: Add the Tauri desktop shell

**Files:**
- Create: desktop/tide-bot/package.json
- Create: desktop/tide-bot/src-tauri/Cargo.toml
- Create: desktop/tide-bot/src-tauri/build.rs
- Create: desktop/tide-bot/src-tauri/tauri.conf.json
- Create: desktop/tide-bot/src-tauri/capabilities/companion.json
- Create: desktop/tide-bot/src-tauri/permissions/companion.toml
- Create: desktop/tide-bot/src-tauri/src/main.rs
- Create: desktop/tide-bot/src-tauri/src/lib.rs
- Create: desktop/tide-bot/src-tauri/src/placement.rs
- Create: desktop/tide-bot/src-tauri/tests/placement_test.rs
- Create: desktop/tide-bot/src-tauri/tests/capabilities_test.rs
- Create: desktop/tide-bot/README.md

**Interfaces:**
- Produces: main and companion windows, show_main_window command, tray actions, and non-sensitive placement persistence.
- Consumes: production Tide-Bot HTTPS origin and /companion route.

- [ ] **Step 1: Write the failing placement and capability tests**

~~~rust
#[test]
fn clamps_a_saved_position_into_the_current_monitor_work_area() {
	let monitor = MonitorBounds { x: 0, y: 0, width: 1440, height: 900 };
	assert_eq!(clamp_to_monitor(&monitor, 9000, 9000, (380, 520)), (1060, 380));
}

#[test]
fn companion_capability_has_exact_remote_scope_and_one_custom_command() {
	let capability: serde_json::Value = serde_json::from_str(include_str!("../capabilities/companion.json")).expect("valid capability JSON");
	let permission: toml::Value = toml::from_str(include_str!("../permissions/companion.toml")).expect("valid companion permission TOML");
	assert_eq!(capability["windows"], serde_json::json!(["companion"]));
	assert_eq!(capability["permissions"], serde_json::json!(["allow-show-main-window"]));
	assert_eq!(capability["remote"]["urls"], configured_remote_urls_json());
	let entries = permission["permission"].as_array().expect("[[permission]] array");
	assert_eq!(entries.len(), 1);
	let entry = &entries[0];
	assert_eq!(entry["identifier"].as_str(), Some("allow-show-main-window"));
	let allowed = entry["commands"]["allow"].as_array().expect("command allow-list");
	assert_eq!(allowed.iter().map(toml::Value::as_str).collect::<Vec<_>>(), vec![Some("show_main_window")]);
	assert_no_forbidden_capabilities(&capability, entry);
	assert_build_rs_registers_only_show_main_window();
}
~~~

- [ ] **Step 2: Verify it fails**

Run: cd desktop/tide-bot/src-tauri && cargo test --test placement_test && cargo test --test capabilities_test

Expected: FAIL because the Tauri package does not exist.

- [ ] **Step 3: Implement narrow native windows and capabilities**

~~~rust
fn companion_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
	WebviewWindowBuilder::new(app, "companion", WebviewUrl::External(app_url("/companion")))
		.decorations(false)
		.always_on_top(true)
		.resizable(false)
		.skip_taskbar(true)
		.inner_size(380.0, 520.0)
		.build()
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> tauri::Result<()> {
	let main = app.get_webview_window("main").ok_or("main window missing")?;
	main.show()?;
	main.set_focus()
}
~~~

Add `serde_json` and `toml` to `desktop/tide-bot/src-tauri/Cargo.toml`
`[dev-dependencies]`; `capabilities_test.rs` parses JSON and TOML into values,
then asserts exact arrays rather than matching source formatting. Tauri 2
application permissions use `[[permission]]`, so the test must parse
`permission["permission"]` as exactly one array entry, then assert that entry
has identifier `allow-show-main-window` and `commands.allow` exactly
`["show_main_window"]`. It also asserts `windows == ["companion"]`, the sole
capability permission reference is the unprefixed
`allow-show-main-window`, and `remote.urls` equals the two configured origins only:
the production HTTPS origin and exact configured loopback development origin.
The parsed-value traversal rejects filesystem, shell, process, credential,
arbitrary-navigation, eval, and `core:default` grants. It also checks the
build registration/AppManifest contract exposes only `show_main_window` to the
companion permission.

Keep both checks as executable Cargo integration tests under
`desktop/tide-bot/src-tauri/tests/`, not `src/` files that Cargo can compile
without executing. Export the tested placement and capability helpers from the
public library interface in `src/lib.rs` (for example, `pub use
placement::{clamp_to_monitor, MonitorBounds};` plus the public parsed-config
helper functions), then import them from the integration tests with the package
crate name. The test files therefore use normal integration-test imports such
as `use tide_bot::{clamp_to_monitor, configured_remote_urls_json, MonitorBounds};`
rather than private `crate::` paths.

`desktop/tide-bot/package.json` declares reproducible `tauri`, `build:debug`,
and `build:windows` scripts plus pinned Tauri CLI/API dependencies. Set the app
product name, bundle identifier, version, and build metadata in
`tauri.conf.json`/Cargo metadata. Configure a required external production
`https://` Tide-Bot origin and an explicitly selected loopback development
origin; reject arbitrary origins and never embed credentials.

Use `build.rs` with the generated AppManifest/permission registration and add
only `permissions/companion.toml`, using one `[[permission]]` entry that
defines the single application permission identifier
`allow-show-main-window` with `commands.allow` exactly
`["show_main_window"]`. `capabilities/companion.json` binds only
`windows: ["companion"]`, references exactly `allow-show-main-window`, and explicitly scopes
`remote.urls` to the exact production HTTPS origin and configured loopback dev
origin. Do not use `core:default`: remote APIs otherwise need explicit scope,
and that default would grant broad path/window/tray APIs. Do not grant
filesystem, shell, process, credential bridge, arbitrary navigation, eval, or
other commands. Rust-internal tray/window behavior remains native code and is
not a webview permission.

Add a tray with Show Tide-Bot, Show or Hide Ted-Bot, Always on Top, Sign Out,
and Quit. Closing main hides it; closing companion hides only companion. Sign
Out clears both webviews and opens /auth. Persist only monitor ID, x/y
position, and expanded state.

- [ ] **Step 4: Verify and commit**

Run:

~~~
cd desktop/tide-bot/src-tauri && cargo test --test placement_test && cargo test --test capabilities_test && cargo build --verbose && cargo check
cd .. && npm run tauri build -- --debug
~~~

Expected: placement/capability tests, Rust compilation, semantic parsed-config
inspection, and the debug bundle pass. Inspect the generated/package manifest
from the verbose build to confirm AppManifest command registration remains only
`show_main_window` and no additional webview permission is packaged.

~~~
git add desktop/tide-bot
git commit -m 'feat: add ted-bot desktop companion shell'
~~~

## Task 7: Connect the native action and record release acceptance

**Files:**
- Modify: src/lib/components/ted-bot/CompanionPanel.svelte
- Create: src/lib/ted-bot/openMainWindow.ts
- Create: src/lib/ted-bot/openMainWindow.test.ts
- Create: .github/workflows/ted-bot-windows.yml
- Modify: desktop/tide-bot/README.md
- Modify: docs/TIDE_BOT_HANDOFF.md
- Modify: docs/IMPLEMENTATION_PLAN.md
- Create: docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md

**Interfaces:**
- Consumes: show_main_window only when running in Tauri.
- Produces: reproducible macOS and Windows acceptance evidence.

- [ ] **Step 1: Write the failing native-action test**

~~~ts
import { expect, test, vi } from 'vitest';
import { openMainWindow } from './openMainWindow';

test('uses the native show-main command only inside Tauri', async () => {
	const invoke = vi.fn();
	await openMainWindow({
		invoke,
		navigate: vi.fn(),
		windowRef: { __TAURI_INTERNALS__: {} } as unknown as Window
	});
	expect(invoke).toHaveBeenCalledWith('show_main_window');
});

test('falls back to Tide-Bot navigation outside Tauri and during SSR', async () => {
	const navigate = vi.fn();
	await openMainWindow({ invoke: vi.fn(), navigate, windowRef: undefined });
	expect(navigate).toHaveBeenCalledWith('/');
});
~~~

- [ ] **Step 2: Verify it fails**

Run: npx vitest run src/lib/ted-bot/openMainWindow.test.ts

Expected: FAIL until the native-or-browser action exists.

- [ ] **Step 3: Implement the action and acceptance record**

~~~ts
export async function openMainWindow({ invoke, navigate, windowRef = typeof window !== 'undefined' ? window : undefined }: {
	invoke: (command: string) => Promise<unknown>;
	navigate: (path: string) => void;
	windowRef?: Window;
}) {
	if (windowRef && '__TAURI_INTERNALS__' in windowRef) return invoke('show_main_window');
	navigate('/');
}
~~~

Add a GitHub-triggered Windows artifact build in
`.github/workflows/ted-bot-windows.yml` (manual dispatch and protected release
branch trigger) using `windows-latest`, the pinned Node version, and
`desktop/tide-bot`'s Windows build command. Upload the signed/unsigned build
artifact as appropriate; record workflow run URL, commit SHA, artifact name,
and checksum in acceptance evidence. A local macOS debug build is not Windows
acceptance.

The acceptance document records exact macOS and Windows build, OS, and result
for sign-in; minimizing the main window then continuing typed chat; active-chat
sync; denied chat; confirmation behavior; disconnect/reconnect; sign-out; OS
lock; tray actions; keyboard navigation; reduced motion; and uninstall. The
Windows manual procedure is required after the GitHub artifact is downloaded:
install the artifact on Windows, sign in using a non-production test account,
minimize/hide the main window, continue typed companion chat, lock/unlock the
Windows session, verify tray and sign-out, then record pass/fail with OS build
and artifact checksum. Missing manual results leave Windows acceptance pending.

- [ ] **Step 4: Run final gates**

~~~
npm run audit:branding
npm run test:frontend -- --run
npm run build
git diff --check
node --test scripts/validate-ted-bot-pet.test.mjs
node scripts/validate-ted-bot-pet.mjs
# Release-only: call load_workspace_dependencies; set PYTHON to its exact bundled runtime.
ATLAS="$PWD/static/tide-bot/ted-bot/spritesheet.webp"; EVIDENCE_DIR="$PWD/docs/superpowers/evidence/2026-07-24-ted-bot-native-companion"; shasum -a 256 "$ATLAS"
"$PYTHON" "$HOME/.codex/skills/hatch-pet/scripts/validate_atlas.py" "$ATLAS" --require-v2 --json-out "$EVIDENCE_DIR/ted-bot-atlas-validation.json"
"$PYTHON" "$HOME/.codex/skills/hatch-pet/scripts/make_contact_sheet.py" "$ATLAS" --output "$EVIDENCE_DIR/ted-bot-atlas-contact-sheet.png"
shasum -a 256 "$ATLAS"
pytest backend/open_webui/socket/test_companion_presence.py backend/open_webui/socket/test_companion_presence_handlers.py -q
npx vitest run src/lib/ted-bot/presence.test.ts src/lib/components/ted-bot/CompanionPanel.test.ts src/lib/components/chat/MessageInput/CompanionTextComposer.test.ts src/lib/components/chat/MessageInput.companion-contract.test.ts src/lib/components/chat/lifecycleGuard.test.ts src/lib/ted-bot/openMainWindow.test.ts
node --test scripts/run-companion-cypress.test.mjs
cd desktop/tide-bot/src-tauri && cargo test --test placement_test && cargo test --test capabilities_test && cargo check
cd ../../.. && RUN_ID=release-$(date +%s) node scripts/run-companion-presence-redis-integration.mjs
RUN_ID=cypress-release-$(date +%s) npm run test:companion:e2e
~~~

Expected: every focused local check passes. The Hatch commands use no bare
Python, consume the exact SHA-256-bound tracked atlas, produce passing
deterministic alpha/transparency JSON plus a rendered contact sheet, and leave
release acceptance pending if the bundled runtime or evidence is absent. The
required Cypress command provisions and tears down its own loopback-only stack;
it must never skip for missing user credentials or run against a live stack.
Record the inherited global npm run check result separately if it remains
non-clean.
The release acceptance record must include a current visual atlas-inspection
entry for the tracked black-goldendoodle asset and the exact successful
`RUN_ID=release-... node scripts/run-companion-presence-redis-integration.mjs`
command, explicit isolated Compose project name, worker-a/worker-b endpoint
evidence, direct-WebSocket shared ordered revisions, single-emitter expiry/
disconnect-promotion result, user-room-isolation result, namespace-empty
result, and confirmation that only the namespaced test resources were removed
without stopping or restarting an existing Tide-Bot service. Cypress evidence
must separately name its loopback origin, randomized supported-auth account
flow, one completion request, and safe teardown; it is not a cross-client sync
claim. A structural package check or single-worker/fake-Redis pytest does not
replace either gate.
Final release evidence additionally requires the green GitHub Windows artifact
build and the completed manual Windows procedure; neither is replaced by the
local macOS debug bundle.

- [ ] **Step 5: Commit acceptance documentation**

~~~
git add src/lib/components/ted-bot/CompanionPanel.svelte src/lib/ted-bot/openMainWindow.ts src/lib/ted-bot/openMainWindow.test.ts .github/workflows/ted-bot-windows.yml docs/TIDE_BOT_HANDOFF.md docs/IMPLEMENTATION_PLAN.md docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md docs/superpowers/evidence/2026-07-24-ted-bot-native-companion/ desktop/tide-bot/README.md
git commit -m 'docs: record ted-bot companion acceptance'
~~~

## Plan self-review

- The tasks cover the approved native architecture, typed current-chat behavior, session lifecycle, security, accessibility, and both-platform acceptance.
- Push-to-talk, read-aloud, browser Picture-in-Picture, autonomous actions, and a standalone Ted-Bot service are excluded.
- Presence supplies active-chat state, the canonical Chat surface supplies typed chat, and Tauri supplies the only native main-window command.
