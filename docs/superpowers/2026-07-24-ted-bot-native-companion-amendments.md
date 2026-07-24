# Ted-Bot Native Companion Implementation Amendments

These amendments resolve compatibility and security gaps discovered while
reviewing the approved native-companion plan against Tide-Bot at
`605f7c687`. They are binding where they differ from the earlier plan.

## Product package and mascot

- Tide-Bot remains the product; Ted-Bot remains its black-goldendoodle
  companion.
- `static/tide-bot/ted-bot/` is the canonical tracked Ted-Bot package. It
  contains the already validated `spritesheet.webp` and will gain the matching
  v2 `pet.json` metadata. The web app continues to load that sprite directly.
- Do not stage the root `tide-bot-pet/` directory: it is a different Cyborg
  Captain package. Do not stage `teddy-v2-upgrade/`: it is local generation
  and QA provenance, not runtime source.

## Companion surface and canonical chat flow

- `/companion` is an authenticated route inside the existing `(app)` route
  group. Create `src/lib/ted-bot/routes.ts` as the single route source with
  `export const isCompanionRoute = (pathname: string) => pathname ===
  '/companion';`. `src/routes/+layout.svelte` and
  `src/routes/(app)/+layout.svelte` must both import it and derive
  `isCompanionRoute($page.url.pathname)` from the SvelteKit page store. The
  root layout uses it to suppress its app-shell chrome; the app layout uses it
  to suppress its sidebar and global overlays and to return before evaluating
  any global shortcut. Do not use `includes`, `startsWith`, or a duplicate
  local pathname check: only the exact `/companion` route is the compact
  surface. Authentication, model, socket, tool, terminal, and CPTR setup stay
  active.
- Do not create a parallel `chatController` or duplicate completion payload,
  event, confirmation, queue, tool, terminal, or stop logic. Extend the
  canonical `Chat.svelte` with a typed `surface: 'full' | 'note' |
  'companion'` prop and use its existing completion engine.
- `Chat.svelte` must make lifecycle resets safe before companion reuse: an
  epoch invalidates stale load, completion, stop, and queue continuations; a
  pending confirmation or input callback resolves `false` before reset or
  destroy; and a cleared `chatIdProp` is handled as a route switch.
- `MessageInput.svelte` receives a companion mode that exposes only typed
  input, send, and stop. It removes attachment, audio, web-search, tool,
  terminal, and other optional controls from the compact surface without
  changing server-side permissions or confirmations.
- Active chat state comes from the existing `chatId` and `chatTitle` stores,
  not URL navigation. The main-window publisher mounts only outside
  `/companion`, so the compact route cannot publish a null focus state over
  the active main chat.

## Presence security and deployment behavior

- The service authorizes from `SESSION_POOL[sid]` only. Presence payloads
  never carry a user ID, role, credential, or chat title accepted as truth.
- Extract `get_readable_chat(user_id, role, chat_id, db) -> ChatModel | None`
  from the existing chat GET route. It returns the existing
  `backend.open_webui.models.chats.ChatModel`, not a Boolean, and preserves the exact owner,
  admin-enabled-or-internal, shared-chat-grant, and inherited shared-folder
  rules. Presence uses the returned chat title rather than client input.
- Presence data is ephemeral and limited to client ID, authorized chat ID,
  canonical chat title, device label, focus flag, and focus timestamp. It is
  never logged or persisted in Tide-Bot's application database.
- A memory store is allowed only for one worker without a Redis Socket.IO
  manager. With `WEBSOCKET_MANAGER=redis`, use the existing async Redis
  connection and atomic per-user updates with a shared revision. Multiple
  workers without Redis fail startup rather than silently diverging.
- Disconnect removes its socket before session cleanup. The TTL loop has a
  stored FastAPI lifespan task that is cancelled and awaited on shutdown.
  Reconnect resets the browser revision before accepting a fresh snapshot.

## Tests and native boundary

- Keep focused browser-independent Vitest coverage for lifecycle and
  presence. The current test configuration is Node-only, so component tests
  use source/contract tests unless a DOM test environment is deliberately
  added and configured.
- Add authenticated Cypress smoke coverage for companion routing, chrome
  suppression, typed send/stop, confirmation denial, chat synchronization,
  and no duplicate completion request.
- The desktop shell permits only a companion-scoped `show_main_window` native
  command. It uses a release HTTPS Tide-Bot origin and an explicitly separate
  loopback development origin, with no filesystem, shell, credential bridge,
  or arbitrary navigation capability. Browser detection is SSR-safe.
- A macOS debug build does not establish Windows acceptance. Both platform
  builds and their manual sign-in/minimize/session checks remain required
  release evidence.
