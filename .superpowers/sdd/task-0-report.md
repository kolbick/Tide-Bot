# Task 0 report: companion implementation amendments

## Implemented

Added a binding amendment document and linked it from the approved plan. The
document records the current-code decisions for the canonical chat surface,
route chrome, user-scoped presence, Redis/multi-worker behavior, runtime
package, tests, and desktop capability boundary.

## Verification

- `git diff --check` passed before commit.
- The amendment cites the actual runtime seams found in the current source;
  no product code, secrets, or user-owned artifacts were changed.

## Files changed

- `docs/superpowers/2026-07-24-ted-bot-native-companion-amendments.md`
- `docs/superpowers/plans/2026-07-24-ted-bot-native-companion.md`

## Self-review

The document strengthens existing product and security requirements without
expanding Ted-Bot into a separate backend or broadening its first typed-chat
release.

## Review fix: shared route and canonical chat plan

- Defined the exact shared route helper source as
  `src/lib/ted-bot/routes.ts` with
  `isCompanionRoute(pathname) => pathname === '/companion'`. Both root and app
  layouts import it; the root suppresses app-shell chrome, while the app layout
  suppresses compact-route chrome and returns before global shortcut handling.
- Replaced the Task 3 Boolean `can_read_chat` plan contract with
  `get_readable_chat(...) -> ChatModel | None`, using the existing
  `backend.open_webui.models.chats.ChatModel` and canonical title.
- Removed the Task 5 `chatController` plan. The companion now reuses
  `Chat.svelte` through `surface="companion"`; the plan identifies the
  canonical lifecycle, completion, confirmation, stop, and event ownership.

## Review-fix verification

- `rg` confirmed no remaining Task 3 `can_read_chat` or Task 5
  `chatController` implementation instruction.
- `git diff --check` passed.
- Focused documentation commit: `f49ac1575 docs: clarify companion implementation contracts`.

## Review fix: narrow DOM test foundation

- Task 2 now explicitly adds `@testing-library/svelte`,
  `@testing-library/jest-dom`, and `jsdom` as development dependencies with
  `package-lock.json` updates. It keeps the global Vitest environment as Node.
- Task 2 and Task 5 component examples use the per-file
  `// @vitest-environment jsdom` directive and
  `@testing-library/jest-dom/vitest` matcher setup.
- Corrected the Task 5 `MessageInput` test and canonical Chat wiring to use
  `mode="companion"`, not a nonexistent `surface` prop.
- Focused documentation commit: `dcba01541 docs: specify companion DOM test setup`.

## Review-fix verification

- `git diff --check` passed before the corrective commit.
- No dependencies, lockfile, package files, product code, or user assets were
  modified in this documentation-only task.

## Review fix: test boundaries and v2 pet metadata

- `CompanionPanel.test.ts` is now a default-Node source/contract test. It reads
  the Svelte source to assert canonical `Chat.svelte` import and
  `surface="companion"` rendering, while rejecting duplicate completion/tool
  API imports. Only DOM-rendering tests use per-file jsdom.
- `MessageInput.test.ts` remains the Task 5 per-file jsdom and Testing Library
  test for typed controls.
- Task 2 now creates and stages
  `static/tide-bot/ted-bot/pet.json` with `spriteVersionNumber: 2` beside the
  existing tracked spritesheet.
- Focused documentation commit: `ad71e06b1 docs: refine companion test boundaries`.

## Review-fix verification

- `git diff --check` passed before the corrective commit.
- No dependencies, package files, lockfile, product code, or user assets were
  modified in this documentation-only task.

## Final plan hardening audit

- Task 2 now specifies all tracked Ted-Bot v2 manifest fields: id, display
  name, Tide-Bot black-goldendoodle description, sprite version, and relative
  spritesheet path.
- Task 3 now specifies one-worker memory eligibility, Redis atomic shared
  revision behavior, multi-worker startup rejection, disconnect ordering,
  lifespan task shutdown, and focused topology/atomic/shutdown pytest coverage.
- Task 4 now publishes existing `chatId`/`chatTitle` store state and tests
  reconnect revision reset before a fresh subscription snapshot.
- Task 5 adds a pure canonical Chat lifecycle guard and explicit Node coverage
  for stale load/completion/stop/queue continuations, pending callback denial,
  and empty/nullish chat-ID reset.
- Task 5a adds a tracked credential-safe Cypress preflight wrapper, test, and
  required-mode release gate for authenticated companion smoke coverage.
- Task 6 adds reproducible Tauri metadata/scripts, build permission
  registration, companion-only command/capability scope, exact remote origins,
  and capability inspection gates without `core:default`.
- Task 7 makes the open-main helper SSR-safe and adds browser fallback,
  GitHub Windows artifact, and required manual Windows acceptance evidence.
- Focused documentation commit: `3b535a218 docs: harden companion delivery plan`.

## Final plan-hardening verification

- `git diff --check` passed before the corrective commit.
- All seven reviewer findings were audited against the amended plan's files,
  implementation steps, focused tests, and final gates.
- No product, package, dependency, lockfile, secret, or user-asset file was
  modified in this documentation-only task.

## Final review correction: executable tests and semantic capability checks

- Added explicit imports to every documented Vitest example, including the
  component/module under test and `test`/`expect`/`vi` where used.
- Split Cypress into reset anonymous redirect coverage before login and separate
  authenticated companion behavior cases.
- Replaced format-sensitive Tauri capability checks with parsed JSON/TOML,
  exact permission/origin assertions, forbidden-grant traversal, and
  AppManifest registration inspection using Rust dev dependencies.
- Focused documentation commit: `52ae42f7e docs: clarify companion verification`.

## Final verification

- `git diff --check` passed before the corrective commit.
- No product, package, dependency, lockfile, secret, or user-asset file was
  modified in this documentation-only task.

## Final review correction: Tauri permission and native-branch test

- Task 6 now defines the application permission identifier as exactly
  `allow-show-main-window`, with `commands.allow` exactly
  `["show_main_window"]`; the companion capability references that identifier
  directly, with the existing AppManifest restriction and remote URL scope
  retained.
- Task 7 now passes an explicit typed `windowRef` carrying
  `__TAURI_INTERNALS__` to `openMainWindow`, so the native test takes the
  native branch without stubbing a bare global. The SSR/browser navigation
  fallback remains covered.
- This correction changes documentation only; no product code or dependencies
  were modified.

## Final Task 0 review correction: executable harnesses

- Task 5 now lists and stages `src/lib/components/chat/MessageInput.test.ts`.
  Its jsdom example uses a realistic `@testing-library/svelte` render harness:
  `props` include `mode: 'companion'`, `history: { currentId: null, messages:
  {} }`, `selectedModels: ['']`, and callable `createMessagePair` and
  `stopResponse` mocks; `context` supplies the `i18n` translator. The test
  types into the textbox before asserting attachment and microphone controls
  are absent.
- Task 6 moves both Rust checks to executable Cargo integration-test targets:
  `desktop/tide-bot/src-tauri/tests/placement_test.rs` and
  `desktop/tide-bot/src-tauri/tests/capabilities_test.rs`. Both failure and
  verification gates run `cargo test --test placement_test` and `cargo test
  --test capabilities_test`. The plan requires public `src/lib.rs` exports and
  package-crate integration-test imports for the placement and parsed-config
  helpers, so neither test is a zero-test `src/` file.
- Task 7 removes the custom unimported `TauriWindowRef` annotation. Its native
  test passes `{ __TAURI_INTERNALS__: {} } as unknown as Window` directly as
  `windowRef`, matching the exported helper's `Window` input and exercising the
  `show_main_window` branch; the SSR/browser navigation fallback remains.

## Final Task 0 verification

- Documentation-only inspection confirmed the Task 5 file list and staging
  command include `MessageInput.test.ts`, both Task 6 test paths are Cargo
  integration targets with explicit `--test` commands, and the Task 7 native
  test uses the typed inline `Window` cast.
- `git diff --check` passed before the focused documentation commit.
- No product files, dependencies, lockfiles, secrets, or user assets were
  modified.

## Final Task 0 documentation safety cleanup

- Task 2 and the final release gate now assign
  `HATCH_PET_SKILL_DIR` to the explicit Hatch Pet skill path before invoking
  the validator or contact-sheet script; the plan does not rely on a home
  directory expansion.
- Task 3's isolated Compose example now uses only `PATH`, `TMPDIR`, and the
  run-specific `DOCKER_CONFIG` under `RUN_TMPDIR`; it does not preserve or
  reset a home-directory environment variable.

## Final Task 0 review correction: deterministic Cypress model and confirmation fixtures

- Task 5a now tracks a Compose-owned fake OpenAI fixture image and server
  (`deploy/tide-stack/cypress-fake-openai/Dockerfile` and `server.mjs`) beside
  the Cypress compose file, runner, runner test, Cypress spec, and package
  command. The fixture returns one fixed model and deterministic stream and
  non-stream completions, has a health check, exposes only a redacted in-memory
  completion count to Cypress, emits no secrets, and is removed with the
  isolated project.
- The isolated Tide-Bot service alone receives supported fixture model base
  URL/key configuration, enabled sign-up, user default role, and the selected
  fixture default model. It explicitly has no external model/search/OAuth/
  terminal/CPTR path. Compose dependency and health requirements prevent
  Cypress from racing model discovery or completion.
- Companion Cypress coverage now proves exactly one Tide-Bot completion proxy
  interception and exactly one fake-model receipt after a typed send/stop.
  Confirmation denial is deterministic but correctly scoped: the authenticated
  full canonical chat test toggles existing Web Search, submits, and denies its
  existing confirmation dialog under isolated web-search confirmation config.
  `CompanionPanel` source/route coverage separately proves it retains canonical
  Chat confirmation UI while not exposing the optional Web Search control.
- The Task 5a staging command and final gate evidence now list the fixture
  files, fixture health/dependency state, fixture model ID, exactly-one request
  assertions, canonical confirmation denial, no-secret fixture guarantee, and
  safe named-stack teardown.
