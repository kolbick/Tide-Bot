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
- Modify: src/lib/components/branding/TedBotMascot.svelte

**Interfaces:**
- Produces: TedBotPet props state: 'idle' | 'working' | 'offline', label: string, interactive: boolean.
- Consumes: BRAND.tedBotSpritePath.

- [ ] **Step 1: Write the failing tests**

~~~ts
import { render } from '@testing-library/svelte';
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

Add a 6rem by 6.5rem clipped atlas viewport, 4-second stepped idle animation, faster working animation, grayscale offline state, and a prefers-reduced-motion rule that disables animation. Replace the body of TedBotMascot with TedBotPet state="idle" so existing login and empty-chat uses retain their behavior.

- [ ] **Step 4: Verify and commit**

Run: npx vitest run src/lib/components/ted-bot/TedBotPet.test.ts

Expected: PASS.

~~~
git add src/lib/components/ted-bot src/lib/components/branding/TedBotMascot.svelte
git commit -m 'feat: add ted-bot companion renderer'
~~~

## Task 3: Add authorized active-chat presence

**Files:**
- Create: backend/open_webui/utils/chat_access.py
- Create: backend/open_webui/socket/companion_presence.py
- Create: backend/open_webui/socket/test_companion_presence.py
- Create: backend/open_webui/socket/test_companion_presence_handlers.py
- Modify: backend/open_webui/routers/chats.py
- Modify: backend/open_webui/socket/main.py

**Interfaces:**
- Produces: get_readable_chat(user_id, role, chat_id, db) -> ChatModel | None,
  where `ChatModel` is `backend.open_webui.models.chats.ChatModel`.
- Produces: CompanionPresenceSocketService.update(sid, data), subscribe(sid), disconnect(sid), and expire().
- Consumes: SESSION_POOL, user:{id} Socket.IO rooms, Chats, AccessGrants, and Folders.

- [ ] **Step 1: Write the failing security tests**

~~~py
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
companion:presence:update and companion:presence:subscribe handlers, call
service.disconnect from the existing disconnect handler, and run one expiry
coroutine from startup through shutdown.

- [ ] **Step 4: Verify and commit**

Run: pytest backend/open_webui/socket/test_companion_presence.py backend/open_webui/socket/test_companion_presence_handlers.py -q

Expected: PASS with malformed, unauthorized, cross-user, rate-limit, expiry, and disconnect-promotion coverage.

~~~
git add backend/open_webui/utils/chat_access.py backend/open_webui/socket backend/open_webui/routers/chats.py
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
- Consumes: the existing socket store and active chat route.

- [ ] **Step 1: Write the failing fake-timer tests**

~~~ts
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

Store a per-window client ID in sessionStorage. Derive focus from document.hasFocus() and document.visibilityState === 'visible'. Publish unfocused state at destroy. In `src/lib/ted-bot/routes.ts`, define exactly `export const isCompanionRoute = (pathname: string) => pathname === '/companion';`. Both root and app layouts import this helper and derive their route state from `$page.url.pathname`: the root layout suppresses `AppSidebar` when it is true; the app layout suppresses `Sidebar`, Settings/Changelog/Account-Pending overlays, and returns from the keydown handler before calling `matchKeybinding`. Mount MainPresencePublisher only when the predicate is false; pass the active /c/[id] route chat ID and null on the new-chat route. The subscriber must request companion:presence:subscribe on connect and ignore any state at or below its latest revision.

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

~~~ts
test('uses the canonical Chat surface for the companion route', async () => {
	render(CompanionPanel, { chatId: 'chat-1' });
	expect(Chat).toHaveBeenCalledWith(expect.objectContaining({
		chatIdProp: 'chat-1',
		surface: 'companion'
	}), expect.anything());
});

test('companion input leaves typed send and stop available while hiding optional controls', () => {
	render(MessageInput, { surface: 'companion' });
	expect(screen.getByRole('textbox')).toBeVisible();
	expect(screen.queryByLabelText(/attach/i)).not.toBeInTheDocument();
	expect(screen.queryByLabelText(/microphone/i)).not.toBeInTheDocument();
});
~~~

- [ ] **Step 2: Verify the tests fail**

Run: npx vitest run src/lib/components/ted-bot/CompanionPanel.test.ts src/lib/components/chat/MessageInput.test.ts

Expected: FAIL because the companion canonical surface and compact input mode do not exist.

- [ ] **Step 3: Reuse the canonical, epoch-protected Chat surface**

~~~ts
type ChatSurface = 'full' | 'note' | 'companion';
export let surface: ChatSurface = 'full';
~~~

Extend `Chat.svelte` directly rather than introducing a controller. Its existing
epoch/token protection applies before and after every awaited load,
completion, stop, and queued operation; reset resolves a pending confirmation
or input callback with `false`, and a cleared `chatIdProp` switches route state.
The companion page obtains the active authorized chat ID from presence and
renders `CompanionPanel`, which renders `<Chat chatIdProp={chatId}
surface="companion" />`. Companion presentation retains the canonical
transcript, typed send, stop, connection state, and confirmation UI. Pass
`surface` to `MessageInput.svelte`; in companion mode hide attachments, audio,
web search, tools, terminal, and other optional controls while retaining only
typed input, send, and stop. Do not alter server permissions or confirmation
behavior, and do not add a second completion request, stream attachment, or
event handler.

- [ ] **Step 4: Verify and commit**

Run: npx vitest run src/lib/components/ted-bot/CompanionPanel.test.ts src/lib/components/chat/MessageInput.test.ts

Expected: PASS with canonical-surface reuse, typed-only controls, Start New
race, denied confirmation, and no-duplicate completion coverage.

~~~
git add src/lib/components/ted-bot/CompanionPanel.svelte src/lib/components/ted-bot/CompanionPanel.test.ts src/routes/'(app)'/companion/+page.svelte src/lib/components/chat/Chat.svelte src/lib/components/chat/MessageInput.svelte
git commit -m 'feat: add ted-bot typed companion chat'
~~~

## Task 6: Add the Tauri desktop shell

**Files:**
- Create: desktop/tide-bot/package.json
- Create: desktop/tide-bot/src-tauri/Cargo.toml
- Create: desktop/tide-bot/src-tauri/tauri.conf.json
- Create: desktop/tide-bot/src-tauri/capabilities/companion.json
- Create: desktop/tide-bot/src-tauri/src/main.rs
- Create: desktop/tide-bot/src-tauri/src/lib.rs
- Create: desktop/tide-bot/src-tauri/src/placement.rs
- Create: desktop/tide-bot/src-tauri/src/placement_test.rs
- Create: desktop/tide-bot/README.md

**Interfaces:**
- Produces: main and companion windows, show_main_window command, tray actions, and non-sensitive placement persistence.
- Consumes: production Tide-Bot HTTPS origin and /companion route.

- [ ] **Step 1: Write the failing placement test**

~~~rust
#[test]
fn clamps_a_saved_position_into_the_current_monitor_work_area() {
	let monitor = MonitorBounds { x: 0, y: 0, width: 1440, height: 900 };
	assert_eq!(clamp_to_monitor(&monitor, 9000, 9000, (380, 520)), (1060, 380));
}
~~~

- [ ] **Step 2: Verify it fails**

Run: cd desktop/tide-bot/src-tauri && cargo test placement_test

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

Release URLs are HTTPS. Development loopback requires explicit development configuration. Allow only show_main_window to the companion; do not grant filesystem, shell, process, arbitrary evaluation, or credential bridge permissions. Add a tray with Show Tide-Bot, Show or Hide Ted-Bot, Always on Top, Sign Out, and Quit. Closing main hides it; closing companion hides only companion. Sign Out clears both webviews and opens /auth. Persist only monitor ID, x/y position, and expanded state.

- [ ] **Step 4: Verify and commit**

Run:

~~~
cd desktop/tide-bot/src-tauri && cargo test placement_test && cargo check
cd .. && npm run tauri build -- --debug
~~~

Expected: placement tests, Rust compilation, and the debug bundle pass.

~~~
git add desktop/tide-bot
git commit -m 'feat: add ted-bot desktop companion shell'
~~~

## Task 7: Connect the native action and record release acceptance

**Files:**
- Modify: src/lib/components/ted-bot/CompanionPanel.svelte
- Modify: desktop/tide-bot/README.md
- Modify: docs/TIDE_BOT_HANDOFF.md
- Modify: docs/IMPLEMENTATION_PLAN.md
- Create: docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md

**Interfaces:**
- Consumes: show_main_window only when running in Tauri.
- Produces: reproducible macOS and Windows acceptance evidence.

- [ ] **Step 1: Write the failing native-action test**

~~~ts
test('uses the native show-main command only inside Tauri', async () => {
	const invoke = vi.fn();
	vi.stubGlobal('__TAURI_INTERNALS__', {});
	await openMainWindow({ invoke, navigate: vi.fn() });
	expect(invoke).toHaveBeenCalledWith('show_main_window');
});
~~~

- [ ] **Step 2: Verify it fails**

Run: npx vitest run src/lib/components/ted-bot/CompanionPanel.test.ts

Expected: FAIL until the native-or-browser action exists.

- [ ] **Step 3: Implement the action and acceptance record**

~~~ts
export async function openMainWindow({ invoke, navigate }: {
	invoke: (command: string) => Promise<unknown>;
	navigate: (path: string) => void;
}) {
	if ('__TAURI_INTERNALS__' in window) return invoke('show_main_window');
	navigate('/');
}
~~~

The acceptance document records exact macOS and Windows build, OS, and result for sign-in; minimizing the main window then continuing typed chat; active-chat sync; denied chat; confirmation behavior; disconnect/reconnect; sign-out; OS lock; tray actions; keyboard navigation; reduced motion; and uninstall.

- [ ] **Step 4: Run final gates**

~~~
npm run audit:branding
npm run test:frontend -- --run
npm run build
git diff --check
pytest backend/open_webui/socket/test_companion_presence.py backend/open_webui/socket/test_companion_presence_handlers.py -q
cd desktop/tide-bot/src-tauri && cargo test && cargo check
~~~

Expected: every focused check passes. Record the inherited global npm run check result separately if it remains non-clean.

- [ ] **Step 5: Commit acceptance documentation**

~~~
git add src/lib/components/ted-bot/CompanionPanel.svelte docs/TIDE_BOT_HANDOFF.md docs/IMPLEMENTATION_PLAN.md docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md desktop/tide-bot/README.md
git commit -m 'docs: record ted-bot companion acceptance'
~~~

## Plan self-review

- The tasks cover the approved native architecture, typed current-chat behavior, session lifecycle, security, accessibility, and both-platform acceptance.
- Push-to-talk, read-aloud, browser Picture-in-Picture, autonomous actions, and a standalone Ted-Bot service are excluded.
- Presence supplies active-chat state, the canonical Chat surface supplies typed chat, and Tauri supplies the only native main-window command.
