# Ted-Bot native companion handoff

## Snapshot

This is a deliberately paused, **incomplete** implementation snapshot prepared
on 2026-07-24 after the user requested a handoff. Do not describe this feature
as released, pushed, merged, or accepted. The local branch has not been pushed
or merged into `main`.

- Worktree: `/Users/kolbyunderwood/Desktop/Projects/.worktrees/ted-bot-native-companion`
- Branch: `agent/ted-bot-native-companion`
- Product remote: `origin` → `git@github.com:kolbick/Tide-Bot.git`
- Current committed HEAD: `59a239926 fix: reset companion chat-local state`
- Primary plan: `docs/superpowers/plans/2026-07-24-ted-bot-native-companion.md`
- SDD ledger: `.superpowers/sdd/2026-07-24-ted-bot-native-companion/progress.md`

The product requirement is a typed-first native Ted-Bot companion that is part
of Tide-Bot, uses the established authenticated chat semantics, remains useful
while minimized, and is eventually packaged in a Tauri 2 desktop shell. It is
not a separate pet site and it must not create a second chat controller or an
authentication/API bypass.

## What is committed and independently reviewed

Tasks 1 through 5 are committed locally. Task 5 has passed an independent
review and a repair re-review.

| Area | Commits | Current evidence |
| --- | --- | --- |
| Pet renderer, package validation, and release-evidence gate | `027f4cc16` through `1b75bda74` | Code and evidence checks accepted. A real Hatch Pet v2 visual/runtime acceptance remains an external pending gate. |
| Cross-window companion presence / real Redis lifecycle | `a4b7da348` through `8fe875f55` | The isolated two-worker real-Redis harness passed after the test stack was made offline. |
| Typed `/companion` route and canonical chat reuse | `cb8fa70b1`, `59a239926` | Task 4 + Task 5 focused suite passed at 7 files / 32 tests. Production Vite build passed. Independent re-review approved. |

The committed companion surface has these material properties:

- `src/routes/(app)/companion/+page.svelte` subscribes to the authorized
  presence state and renders a thin `CompanionPanel`.
- `CompanionPanel.svelte` renders canonical `Chat.svelte` with
  `surface="companion"`; it does not own completion, stop, confirmation, event,
  tool, or authorization logic.
- `MessageInput` uses a small local-only text composer in companion mode and
  delegates Send and Stop to the existing handlers.
- The Chat lifecycle binding guards navigation/load, completion/stream, stop,
  queue, callback registrations, and destruction against stale continuations.
- The review repair in `59a239926` clears an A-chat draft when the active chat
  switches to B and closes a stale pending confirmation dialog on navigation.

Do not regress those ownership boundaries. The source and tests under the Task
5 commits are the accepted baseline for the remaining work.

## Incomplete Task 5a: isolated Cypress smoke harness

Task 5a is partially implemented but **uncommitted**. Its complete requirement
is in:

`/Users/kolbyunderwood/Desktop/Projects/.worktrees/ted-bot-native-companion/.superpowers/sdd/2026-07-24-ted-bot-native-companion/task-5a-brief.md`

The intended harness is deliberately strict:

- It must start only a fresh, generated Compose project named
  `tedbot-companion-cypress-<RUN_ID>`.
- It must use generated loopback-only app and fixture ports, a private env
  file, an internal Compose network, a disposable database/volumes, a
  deterministic fake OpenAI service, and a disposable sign-up account.
- It must reject all caller `COMPOSE_*` source configuration, alternate
  origins/ports/project inputs, and supplied application credentials.
- It must never use, stop, rebuild, or read credentials from the normal
  `tide-bot` stack.
- It must prove anonymous `/companion` redirect, a real slow-stream Stop abort
  seen by the fixture, and a normal full-chat confirmation denial that sends no
  model request.

### Current uncommitted files

```text
 M package.json
 M src/lib/components/ted-bot/CompanionPanel.test.ts
 D static/pyodide/pyodide-lock.json
?? cypress/e2e/ted-bot-companion.cy.ts
?? deploy/tide-stack/cypress-fake-openai/Dockerfile
?? deploy/tide-stack/cypress-fake-openai/server.mjs
?? deploy/tide-stack/docker-compose.cypress-companion.yml
?? scripts/run-companion-cypress.mjs
?? scripts/run-companion-cypress.test.mjs
```

The deletion of `static/pyodide/pyodide-lock.json` is an interrupted
`npm run build` side effect, **not** a Task 5a change. Do not stage it. Restore
that exact file from `HEAD` before committing Task 5a, or finish a known-good
build that regenerates it byte-for-byte and verify that it disappears from
`git status`.

The partial implementation currently includes:

- `scripts/run-companion-cypress.mjs`: generated-run isolation wrapper,
  private env file, redacted command failure output, exact named Compose calls,
  resource-label inspection, and unconditional cleanup.
- `scripts/run-companion-cypress.test.mjs`: five injected runner/fixture tests
  for input rejection, exact Compose invocation and cleanup, redaction,
  Compose isolation, and fake-model abort behavior.
- `deploy/tide-stack/cypress-fake-openai/`: a deterministic fake model service
  exposing only one model, fixed completions/SSE, and a no-finish slow stream
  whose status shows whether the client aborted.
- `deploy/tide-stack/docker-compose.cypress-companion.yml`: fake model plus
  Tide-Bot fixture configuration with external integrations explicitly
  cleared.
- `cypress/e2e/ted-bot-companion.cy.ts`: anonymous redirect, authenticated
  slow-stream Stop, and full-chat confirmation-denial cases.
- `package.json`: proposed `test:companion:e2e` command.
- `CompanionPanel.test.ts`: proposed narrow source contract retaining canonical
  confirmation ownership in `Chat`.

This partial code has not received an independent review, must not be treated
as accepted, and must not be broadly staged.

## Why the Task 5a runtime test stopped

The first full isolated runtime attempt was safe and failed before Cypress
started:

- Generated project: `tedbot-companion-cypress-cypress-local-1784946894`
- Generated origins during that attempt: app `http://127.0.0.1:57557`, fixture
  status `http://127.0.0.1:57558`
- Failure boundary: building the Tide-Bot image at Dockerfile line 1, before
  reading a project layer.
- Exact cause observed: BuildKit could not resolve
  `docker-image://docker.io/docker/dockerfile:1`; it ended with
  `DeadlineExceeded: context deadline exceeded`.

This was a Docker registry/frontend timeout, not an Open WebUI model download,
not Hugging Face, and not a Tide-Bot application failure. The fake-model image
built successfully and disposable Compose validation passed. The wrapper
teardown and the check that the pre-existing Tide-Bot stack was unchanged both
passed.

Two direct attempts to cache `docker/dockerfile:1` each hit the same roughly
27-second registry deadline. `docker image inspect docker/dockerfile:1` still
reported that the image was absent. Stop retrying the registry blindly.

No temporary `tedbot-companion-cypress-*` Docker resources were present when
this handoff was written. The only Tide-Bot containers visible were the
pre-existing user-managed `tide-bot` project, which was not touched.

## Partial fallback under evaluation

After the registry failure, an uncommitted test-first fallback was started:

1. Build the **current worktree** frontend before the disposable stack starts.
2. Use the already-local `tide-bot:local` image only as the Python/runtime
   layer.
3. Read-mount exactly the current `build/` at `/app/build` and the current
   `backend/open_webui/` at `/app/backend/open_webui`.

This follows the previously accepted presence-integration harness pattern and
avoids the unavailable Dockerfile frontend. It must be treated as a hypothesis,
not an accepted solution, until the next agent verifies all of the following:

- the mounted build is freshly produced from the Task 5 source, not stale;
- only those two source-artifact paths are mounted read-only, with no host
  configuration, credentials, databases, sockets, or network escape route;
- the Compose service still uses the test-only fake model and explicit inert
  fixture settings;
- the real Cypress cases pass against that isolated project; and
- cleanup removes only the exact generated project resources.

The interrupted implementer reported a post-fallback red/green cycle where a
missing fresh-build step or either mount caused a test failure, then five
runner tests passed with `git diff --check`. That result is not independently
verified and needs to be rerun under the project-required Node 22.18.0 / npm
10.9.3 toolchain.

The shell default on this machine is Node 25.9.0 / npm 11.17.0. Do not use it
as Task 5a acceptance evidence. Earlier pre-fallback evidence under Node
22.18.0 / npm 10.9.3 was:

- runner/fixture suite: 5 passed;
- `CompanionPanel` contract: 2 passed.

The full wrapper was interrupted by this handoff while it was rebuilding the
frontend for the fallback. All related processes have been stopped.

## Safe continuation checklist

1. Read the full Task 5a brief before editing the partial files.
2. Preserve the uncommitted Task 5a work. First inspect it with
   `git diff --no-index /dev/null <new-file>` or ordinary `git diff` rather
   than discarding it.
3. Restore or regenerate only the accidental Pyodide lock-file deletion; do
   not stage it.
4. Run the injected suite under Node 22.18.0 / npm 10.9.3, then review the
   exact Compose config with `docker compose -f deploy/tide-stack/docker-compose.cypress-companion.yml config`.
5. Confirm no caller `COMPOSE_*` variables are set, use a new conservative
   `RUN_ID`, and run the wrapper exactly once. It must be the wrapper-created
   loopback stack, never the existing `tide-bot` project.
6. If a runtime prerequisite fails, report the exact failure and preserve the
   isolation invariant. Do not point Cypress at localhost:3102, the Tailscale
   site, production, a user database, or a user credential.
7. Once runtime evidence passes, obtain an independent Task 5a review before
   accepting it and commit only the exact Task 5a files listed in the brief.

## Work that remains after Task 5a

Task 6 and Task 7 have not started:

- Task 6, beginning at plan line 1094, adds the Tauri desktop shell.
- Task 7, beginning at plan line 1316, connects the native action and records
  release acceptance.

The final release also needs an honest treatment of the outstanding real Hatch
Pet v2 visual/runtime acceptance. Do not claim native desktop acceptance until
there is fresh evidence from the actual Tauri application and the release
acceptance steps.

## Git and publication boundary

No push or pull request was created from this branch during this work. Stage
paths explicitly in this mixed worktree; never use broad staging. Keep the
hand-off document and partial Task 5a changes separate from the user-owned
worktree state until a reviewer has accepted them. Verify
`gh repo view kolbick/Tide-Bot` before any future publication and do not say
that `main` contains the feature until it is actually merged.
