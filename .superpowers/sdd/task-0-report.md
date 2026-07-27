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

## Final Task 0 review correction: release-gate completeness

- Pet release QA now continues after v2 atlas validation/contact-sheet creation
  with the Hatch Pet direction QA sheet, continuity JSON, randomized blind
  sheet/answer key, three independent blind verdicts, consensus, and validation.
  All evidence is SHA-bound to the exact tracked atlas. The plan requires a
  16-direction semantic record with expected direction, observed behavior,
  pass/fail/ambiguous, and reason; missing/failing/ambiguous blind cardinals,
  semantic failures, and unassessed continuity warnings block release. This is
  a future release gate, not a claim that bundled-runtime evidence now exists.
- Replaced the pure lifecycle-guard acceptance proposal with the narrow
  `chatLifecycleBinding.ts` seam used by `Chat.svelte` itself. Deferred load,
  completion, stop, and queue tests now reset/navigate/destroy through that
  same binding, prove stale real mutations are suppressed, and prove the real
  pending `eventCallback` receives `false`. A Chat source/contract test covers
  the real continuation entry points and navigation/destroy reset paths without
  duplicating canonical Chat behavior.
- The Compose-owned fake OpenAI fixture now has a deterministic slow-stream
  barrier. Cypress observes its first delta/status, sees and clicks Stop, then
  proves server-observed abort, zero final completion, and no duplicate proxy
  request. Web Search denial is explicitly type prompt, toggle, dialog, deny,
  and zero fixture completion count.
- Desktop origins now use the required non-secret
  `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` and optional strict-loopback
  `TIDE_BOT_DESKTOP_DEV_ORIGIN` through a checked-in template and one generated
  capability source consumed by both Tauri build and test. Windows CI must
  provision repository variables and record resolved origin, generated SHA,
  capability result, and actual artifact proof. The real production origin is
  not known, so production desktop release acceptance remains external/pending;
  no domain was invented.

## Final review-correction verification

- Documentation changes are confined to the native-companion plan, binding
  amendments, baseline status, and this Task 0 report.
- `git diff --check` is required before the single focused docs commit. No
  product, dependency, runtime configuration, secret, or user-owned file is in
  scope for this correction.

## Final Task 0 review correction: blind-evidence provenance

- Added the owned tracked-verifier contract for blind direction evidence.
  `verify-ted-bot-direction-evidence.mjs` creates a redacted, self-hashed
  atlas/sheet/key manifest; reviewers see only that manifest and the blind
  sheet, and attest schema version, unique reviewer ID, artifact hashes, and
  pair votes. Before Hatch consensus/validation, it recomputes actual hashes,
  verifies the answer key's atlas hash and three distinct attestations, and
  writes a hard-gate verifier result JSON.
- Task 2 owns a Node-built-in fixture test that proves mismatched attested
  hashes fail. The final acceptance record now requires the manifest, reviewer
  IDs/verdict hashes, and passing verifier result alongside the existing blind
  consensus/validation. This documents a future release gate only; it does not
  claim the verifier or Hatch QA ran in this Task 0 docs correction.

## Final Task 0 review correction: atomic evidence and settlement authority

- Replaced the vulnerable verify-then-raw-combine sequence with owned atomic
  `verify-and-combine`. It re-hashes and validates every attested input, seals
  verified votes, invokes the required Hatch combine and validation scripts in
  the same call, and writes a source-hash-linked consensus envelope. The test matrix mutates
  atlas, blind sheet, key, manifest, and each verdict after manifest creation;
  every mutation must fail without accepted consensus. Direct raw Hatch combine
  is prohibited for release evidence.
- The lifecycle binding now has a one-shot normal settlement contract. All five
  real `eventCallback` assignments register its wrapper; dialog confirm/cancel
  and normal execute call `settle`, which clears before invoking. Tests cover
  normal confirmation/input/execute/both embedded settlements followed by reset
  or destroy, and the Chat source contract checks every assignment and cleanup.
- Task 6 now makes `configured_companion_url()` the sole Webview URL authority.
  It reads only resolver-generated `companion.json`, returns the approved
  production origin plus `/companion`, and rejects missing/stale/invalid source
  and runtime overrides. The new Cargo integration target proves that linkage
  and is included in task/final acceptance commands. Production provisioning
  remains external/pending; no host was invented.

## Final Task 0 review correction: freshness and transactional publication

- The blind-evidence test contract now separately proves semantic answer-key
  binding: a freshly self-consistent key/manifest/reviewer fixture with only a
  wrong `answer_key.atlas_sha256` must fail with no published output. Evidence
  uses a required unique `BLIND_RUN_ID`; the verifier writes only a mode-0700
  pending directory, atomically publishes after both Hatch stages/envelope
  succeed, refuses an existing final ID, and leaves no accepted current-run
  output on failure.
- Desktop origin generation now writes separate capability and provenance files.
  The tracked launcher creates a fresh nonce, passes it only to `build.rs`, and
  build verification emits that nonce into Rust. The installed app compile-time
  embeds both files and rejects stale nonce, digest/config linkage, or missing
  provenance without consulting source/cwd/runtime environment. Cargo tests and
  Windows evidence cover this binding; actual production provisioning remains
  pending rather than claimed.

## Final Task 0 review correction: whole pet-QA run scope

- The blind transaction is now nested in the required outer `PET_QA_RUN_ID`
  transaction. All release QA artifacts, including atlas validation, contact
  sheet, direction/continuity, blind material, semantics, and final metadata,
  live only in the 0700 outer pending run. `publish-pet-qa-run` revalidates the
  complete artifact/hash chain and atomically publishes the entire run; root
  evidence receives only the run root. Pending paths are explicitly nonaccepted
  diagnostics and cannot be cited as acceptance. `PET_QA_RUN_ID` and
  `BLIND_RUN_ID` share `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`; the verifier validates
  either ID before resolve/join, containment, `exists`, `mkdir`, `rm`, `rename`,
  or any filesystem operation. Only a valid ID may derive contained exact
  sibling paths and then check collisions without changing existing directories.
- The existing Node verifier test contract additionally covers outer publish,
  mutation/no-current-final, existing-final refusal, and malformed shared
  run-ID/traversal/pending-collision refusals. Injected path/filesystem spies
  must show each invalid ID makes zero resolve/filesystem calls, while a valid
  ID derives contained exact siblings before collision checks. Acceptance must
  name the current published `PET_QA_RUN_ID` path, not an inner blind or pending
  path. This remains a future release gate, not a claim of completed QA.
