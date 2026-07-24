# Ted-Bot Native Companion Implementation Amendments

These amendments resolve compatibility and security gaps discovered while
reviewing the approved native-companion plan against Tide-Bot at
`605f7c687`. They are binding where they differ from the earlier plan.

## Product package and mascot

- Tide-Bot remains the product; Ted-Bot remains its black-goldendoodle
  companion.
- `static/tide-bot/ted-bot/` is the canonical tracked Ted-Bot package. It
  contains the already validated `spritesheet.webp` and must gain `pet.json`
  with `id: "ted-bot"`, `displayName: "Ted-Bot"`, a description identifying
  Tide-Bot's black-goldendoodle companion, `spriteVersionNumber: 2`, and
  `spritesheetPath: "spritesheet.webp"`. The web app continues to load that
  tracked sprite directly.
- Do not stage the root `tide-bot-pet/` directory: it is a different Cyborg
  Captain package. Do not stage `teddy-v2-upgrade/`: it is local generation
  and QA provenance, not runtime source.
- Task 2 must add a tracked Node-only structural validator and Node test for
  this exact package. They validate every required v2 manifest field and the
  exact `spritesheetPath`, require a 1536-by-2288 WebP, and enforce the 8-by-11,
  192-by-208 atlas contract while rejecting all mismatches. Both run at staging
  and final release gates; Hatch is not a CI dependency. Release acceptance
  additionally requires the established Hatch Pet `validate_atlas.py
  --require-v2` invocation against the exact tracked static atlas, using only
  the bundled runtime returned by `load_workspace_dependencies` (never bare
  system Python), deterministic alpha/transparency JSON, and a rendered contact
  sheet. Record a pre/post SHA-256 for that exact input path and require it to
  match the inspected tracked file and evidence entry. Store the validator JSON,
  contact sheet, command/runtime, inspector/date, and pass/fail rubric for
  identity, cell alignment, direction continuity, and unused-cell transparency
  in tracked acceptance evidence. A missing bundled runtime, hash mismatch, or
  missing/failed evidence leaves release acceptance pending, not passed.
  Neither the root Cyborg package nor user-owned `teddy-v2-upgrade/` provenance
  may be staged for that evidence.
- Release QA is not complete after the atlas validator/contact sheet. With
  `HATCH_PET_SKILL_DIR="/Users/kolbyunderwood/.codex/skills/hatch-pet"`, and
  using the bundled `PYTHON` plus the exact SHA-bound tracked atlas, run
  `make_direction_qa_sheet.py`, `measure_direction_continuity.py --json-out`,
  and `make_direction_blind_qa_sheet.py --answer-key`. Three independent blind
  reviewers receive only the randomized blind sheet, then their three verdict
  files are atomically verified-and-combined by the owned verifier using the
  required Hatch `combine_direction_blind_verdicts.py` on sealed verified copies
  and checked by `validate_direction_blind_verdicts.py`. Save a per-direction semantic record
  for all 16 directions with expected direction, observed behavior,
  `pass`/`fail`/`ambiguous`, and reason (including horizontal/vertical landmark
  evidence for diagonals). The hard gate rejects a missing/failing/ambiguous
  blind cardinal, any semantic failure, or an unassessed continuity warning.
  Every artifact and reviewer verdict must identify the exact atlas SHA-256.
  This has not run: lack of a bundled runtime/evidence is a pending release
  gate, not a passing claim.
- Hatch consensus alone does not attest which atlas a reviewer saw. Task 2 must
  therefore add tracked Node-built-in
  `scripts/verify-ted-bot-direction-evidence.mjs` and its focused Node test.
  After blind-sheet/key generation, it writes a redacted manifest containing
  atlas SHA, blind-sheet SHA, answer-key SHA, and a canonical self-hash. Blind
  reviewers receive only that manifest plus the blind sheet. Every verdict must
  attest schema version, distinct reviewer ID, atlas/sheet/manifest hashes, and
  pair votes. Release evidence invokes only its atomic `verify-and-combine`
  command, never raw Hatch combine/validation: it re-reads/re-hashes atlas, sheet, key,
  manifest, and all verdicts immediately; checks the key's `atlas_sha256`; then
  passes sealed parsed verified votes to the required Hatch combine script and
  invokes the required Hatch validation script in the same invocation using
  explicit bundled-Python/script paths. Its envelope links every source-verdict
  hash plus atlas/sheet/key/manifest and both Hatch results to the plain
  consensus. Any mismatch is a hard pending release gate. The focused
  fixture test must mutate each of atlas/sheet/key/manifest/verdicts after
  manifest creation and prove every run fails with no accepted consensus; this
  evidence has not run.
- The test matrix also needs a semantic answer-key case: regenerate a consistent
  key-file hash, manifest key hash, reviewer manifest hash, and verdicts around
  a key whose `atlas_sha256` is wrong. Atomic verification must reject it and
  publish no output. Blind evidence is transactional per required unique
  `BLIND_RUN_ID`: pending output is mode 0700, only the fully linked
  combine/validate/envelope directory is atomically published, failed current
  runs have no final directory, and an existing final run ID is refused.
- The blind transaction is nested inside the required outer `PET_QA_RUN_ID`
  transaction. The verifier creates only a 0700 outer pending run directory;
  every pet QA artifact (validator/contact/direction/continuity/blind/semantic/
  final metadata) is written there, never at evidence root. An owned
  `publish-pet-qa-run` revalidates expected artifact/hash linkage and atomically
  renames the entire outer directory only after the blind subdirectory and
  semantic review succeed. Pending paths are explicitly nonaccepted diagnostic
  state. Acceptance cites the published outer run path only; outer publish
  fixtures cover success, mutation/no-current-final, existing-final refusal.

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
- `Chat.svelte` must use an intentionally narrow
  `src/lib/components/chat/chatLifecycleBinding.ts` integration seam rather
  than a standalone epoch-only guard. The binding owns only token validity and
  pending `eventCallback` settlement, accepts the existing post-await Chat
  mutation as a callback, and never duplicates completion, event, queue, stop,
  or controller logic. `Chat.svelte` captures/checks that same binding around
  actual `navigateHandler`/`loadChat`, completion settlement, `stopResponse`,
  and `processNextInQueue` continuations. Reset on navigation and destroy
  invalidates the epoch and resolves the actual pending callback `false` once;
  empty (`''`) and nullish `chatIdProp` transitions are navigation resets.
  Deferred-operation tests must reset/navigate/destroy through that same
  binding before load/completion/stop/queue resolution and prove no stale real
  mutation plus `eventCallback(false)`. Its one-shot
  `registerPendingEventCallback`/`settle` API clears registration before
  invoking the real callback. All five assignment sites (confirmation, input,
  execute, and two embedded confirm-prompts) use that wrapper, while dialog
  confirm/cancel and normal execute settlement use `settle`. Tests cover normal
  settlement followed by reset/destroy for each path; the source contract
  asserts all five sites plus dialog use/cleanup. Preserve canonical
  submit/stop/confirmation semantics.
- `MessageInput.svelte` receives a companion mode that mounts the presentation-
  only `MessageInput/CompanionTextComposer.svelte` as an early branch. That
  child has only a textarea plus dispatched send/stop events; `MessageInput`
  forwards those through its existing parent dispatch and `stopResponse`
  wiring. Companion mode guards the full
  input's `onMount` dictation/drop-zone setup and removes attachment, audio,
  web-search, tool, terminal, and other optional controls without changing
  server-side permissions or confirmations. Its DOM test renders only this
  small child; a Node source/contract test proves `MessageInput` delegation and
  guards rather than rendering the large component with fake context.
- The companion surface hides only Chat's Navbar, side controls, and placeholder
  while retaining canonical Messages, confirmation, and submit behavior.
  `Chat.svelte` must not call its `history.replaceState` route change when the
  surface is companion.
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
- A memory store is allowed only with exactly one worker and no Redis Socket.IO
  manager. Read `UVICORN_WORKERS` from `backend.open_webui.env`; with
  `WEBSOCKET_MANAGER=redis`, use existing async `socket.main.REDIS` for atomic
  per-user updates with a shared revision, while authorization reads synchronous
  `SESSION_POOL` RedisDict. Startup fails when multiple workers run without
  Redis rather than silently diverging. Cluster expiry uses a Redis leader lock
  or atomic claim/delete so only one worker promotes/emits an expired state.
- Keep only `companion:presence:update` and `companion:presence:subscribe`
  handlers. Disconnect removes its socket before session cleanup. The TTL loop
  has a stored FastAPI lifespan task that is cancelled and awaited on shutdown.
  Reconnect resets the browser revision before accepting a fresh snapshot.
- Retain focused pytest unit tests and add a disposable Docker integration
  harness with real Redis and two independently started Tide-Bot workers. It
  must drive actual Socket.IO handlers and the Redis atomic path, not
  `fake_redis` or injected revisions/counts; clients force direct WebSocket
  transport to the separate worker endpoints, prove concurrent cross-worker
  updates share revision ordering, disconnect cleanup promotes the remaining
  focused client, and user rooms are isolated. The wrapper requires a nonempty,
  project-name-safe `RUN_ID`, exact test-only
  `REDIS_KEY_PREFIX=tedbot-presence-it-${RUN_ID}:`, and
  `WEBSOCKET_MANAGER=redis`, then derives the explicit Compose project
  `tedbot-presence-it-${RUN_ID}`. Every Compose `up`, `ps`, `logs`, `run`, and
  `down` command executes from a neutral temporary working directory with the
  exact absolute `--file "$REPO_ROOT/deploy/tide-stack/docker-compose.presence-integration.yml"`,
  generated private `--env-file`, and project name. It rejects all `COMPOSE_*`
  source overrides and alternative compose/env/project inputs, so it cannot
  discover root/live Compose config or `.env`; relative build contexts resolve
  only from the explicit compose file. There is no default-project invocation
  or generated fallback ID. The run owns isolated volumes/database, an
  ephemeral Redis namespace, and a generated private test configuration
  including a fresh `WEBUI_SECRET_KEY`. It must not read root deployment `.env`
  files, production configuration, or production credentials.
- The one-shot test service creates randomized disposable users and authorized
  chats in that isolated database, gets session tokens through the supported
  Tide-Bot auth flow (or a documented test-only isolated bootstrap), and keeps
  credentials/tokens in-memory or internal environment channels only. It never
  logs them. Unconditional cleanup may target only
  `tedbot-presence-it-${RUN_ID}` resources; after teardown it verifies its
  labelled containers, network, and volumes are gone, and confirms no existing
  Tide-Bot service was stopped or restarted. The final Docker gate is
  `RUN_ID=release-$(date +%s) node scripts/run-companion-presence-redis-integration.mjs`;
  record the isolated project name, both worker endpoints, ordered revisions,
  promotion/isolation assertions, namespace-empty check, and safe teardown in
  acceptance evidence.

## Tests and native boundary

- Keep focused browser-independent Vitest coverage for lifecycle and
  presence. The current default test environment remains Node. Only
  DOM-rendering tests (`TedBotPet.test.ts` and
  `MessageInput/CompanionTextComposer.test.ts`) are the deliberate, narrow
  configured exception: add `@testing-library/svelte`,
  `@testing-library/jest-dom`, and `jsdom` as development dependencies, update
  `package-lock.json`, and put `// @vitest-environment jsdom` plus
  `import '@testing-library/jest-dom/vitest';` at the top of those files.
  `CompanionPanel.test.ts` remains a Node source/contract test that reads the
  Svelte source and verifies canonical Chat reuse without rendering it. Do not
  make jsdom the global Vitest environment.
- Add Cypress UI smoke coverage only through a disposable isolated Compose
  stack and loopback/test origin. The tracked wrapper creates its own private
  env, volumes, randomized account through the supported signup/signin flow,
  and `tedbot-companion-cypress-${RUN_ID}` project, rejects production/live or
  user-supplied origins/credentials and `COMPOSE_*` overrides, suppresses
  credential/token/request logging, and tears down only its labelled resources
  and data. The Compose file adds a tracked, Compose-owned local fake
  OpenAI-compatible service that returns exactly `tedbot-cypress-model` from
  `/v1/models` and fixed valid stream/non-stream responses from
  `/v1/chat/completions`. A special local slow-stream request sends one first
  delta, records request/stream-start receipt, then waits for the actual client
  abort rather than completing normally. Its generated loopback-only
  `GET /__fixture/status` exposes only redacted `requestCount`, `streamStarted`,
  `aborted`, and `completedCount`; the barrier must never emit a final delta or
  `[DONE]`. It emits no secrets, has a health check, accepts no external
  credentials, starts clean per named stack, and disappears with the stack. Only the isolated
  Tide-Bot service is configured with the supported fixture OpenAI base URL/key
  env, `ENABLE_SIGNUP=true`, `DEFAULT_USER_ROLE=user`, and
  `DEFAULT_MODELS=tedbot-cypress-model`; it also has
  `ENABLE_WEB_SEARCH=true` and `ENABLE_WEB_SEARCH_CONFIRMATION=true`. No
  external model, search, OAuth, terminal, or CPTR service may be inherited or
  reachable. Cypress proves anonymous redirect, authenticated compact UI,
  typed send/stop, and one intercepted Tide-Bot completion-proxy request. It
  waits for the fixture's first chunk/stream-start status, sees Stop, clicks it,
  then proves observed abort, no final completion, and no duplicate proxy
  request before teardown. Confirmation denial is tested separately on the
  full canonical chat UI in this exact order: type prompt, toggle Web Search,
  assert dialog, deny, assert `completedCount` remains zero. The test must not
  claim that companion exposes this intentionally omitted optional control.
  `CompanionPanel` source/route coverage separately proves canonical Chat and
  its confirmation UI remain in use. Cypress does not prove cross-client
  synchronization; the real Redis/two-worker integration gate owns that
  evidence. Release evidence requires a green isolated run and safe teardown
  verification.
- The desktop shell permits only a companion-scoped `show_main_window` native
  command. A checked-in capability template plus
  `desktop/tide-bot/scripts/desktop-origins.mjs` resolver requires
  `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` and accepts optional
  `TIDE_BOT_DESKTOP_DEV_ORIGIN`. It produces one ignored generated
  `src-tauri/capabilities/companion.json` used by both Tauri build and parsed
  capability test. Production must be absolute canonical HTTPS with no
  wildcard, credentials, query, fragment, or non-root path; development must
  be `http` loopback-only under the same no-ambiguity rules. Invalid/missing
  production input fails build. The Tauri 2 application permission TOML
  uses `[[permission]]`; its capability test parses `permission["permission"]`
  as exactly one entry and asserts that entry's identifier is
  `allow-show-main-window` and its `commands.allow` is exactly
  `["show_main_window"]`. The capability refers to that unprefixed identifier,
  while the generated AppManifest registration and remote scope remain
  explicitly tested. CI/Windows provisioning maps the non-secret repository
  variable `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` (and optional development
  variable only where intentional) into this resolver; release evidence records
  resolved origin, generated-config SHA, capability result, and actual Windows
  artifact/manual proof. No actual production origin is currently known, so the
  final release gate is external/pending. `configured_companion_url()` is the
  only companion URL authority: it reads that generated capability file,
  selects its production `remote.urls` entry, appends `/companion`, and rejects
  missing/stale/invalid source or any runtime environment override.
  `companion_window` calls it. A Cargo integration test proves the returned
  external URL is approved/generated and `/companion`, cannot diverge from
  `remote.urls`, and rejects fixture invalid/missing/stale generated sources.
  Browser detection is SSR-safe.

- The resolver writes a separate generated provenance JSON atomically with the
  capability JSON, never unknown capability fields. It records schema, tracked
  resolver/template digests, capability SHA, normalized-origin hash, and a
  cryptographic generation nonce. The tracked build launcher prepares both
  files, passes only that nonce as build-only input, and `build.rs` verifies all
  links before emitting the nonce into Rust. `origin.rs` compile-time embeds
  both files and checks nonce/digests/linkage, so installed artifacts do not
  read source/cwd or runtime environment. The URL test rejects old nonce,
  missing provenance, bad digest/config linkage, and proves external runtime
  environment invariance.
- A macOS debug build does not establish Windows acceptance. Both platform
  builds and their manual sign-in/minimize/session checks remain required
  release evidence.
