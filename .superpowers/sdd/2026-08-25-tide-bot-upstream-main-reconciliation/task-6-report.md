# Task 6 report — Open WebUI main integration

## Scope and provenance

- Worktree: isolated reconciliation worktree only.
- Tide-Bot first parent: `cf3e495c3f3a551d6b90361b2e8f6df862201944`.
- Official remote: `https://github.com/open-webui/open-webui.git`.
- Fetched `upstream/main`: `d3e8bf3405e848cfba377814d0aa7ba7290e414d`.
- Official `v0.11.1` tag commit: `d3e8bf3405e848cfba377814d0aa7ba7290e414d`.
- Ancestry check: `v0.11.1` is an ancestor of fetched `upstream/main` (exit 0).
- Integration command: `git merge --no-commit --no-ff d3e8bf3405e848cfba377814d0aa7ba7290e414d`.
- Integration commit: this report is finalized after the explicit merge commit is created.

No push, pull request, canonical/origin `main` mutation, deployable-tag move,
deployment, or live-resource access occurred in this task.

## Conflict inventory

Git reported 36 conflicted files:

1. `backend/open_webui/config.py`
2. `backend/open_webui/env.py`
3. `backend/open_webui/main.py`
4. `backend/open_webui/routers/chats.py`
5. `backend/open_webui/routers/openai.py`
6. `backend/open_webui/socket/main.py`
7. `backend/open_webui/utils/access_control/__init__.py`
8. `backend/open_webui/utils/middleware.py`
9. `package-lock.json`
10. `src/app.html`
11. `src/lib/components/AddTerminalServerModal.svelte`
12. `src/lib/components/OnBoarding.svelte`
13. `src/lib/components/admin/Evaluations/Feedbacks.svelte`
14. `src/lib/components/admin/Functions.svelte`
15. `src/lib/components/admin/Functions/FunctionMenu.svelte`
16. `src/lib/components/admin/Settings/Authentication.svelte`
17. `src/lib/components/admin/Settings/General.svelte`
18. `src/lib/components/chat/Chat.svelte`
19. `src/lib/components/chat/MessageInput.svelte`
20. `src/lib/components/chat/ModelSelector/ModelItemMenu.svelte`
21. `src/lib/components/chat/Settings/About.svelte`
22. `src/lib/components/chat/Settings/General.svelte`
23. `src/lib/components/chat/Settings/SyncStatsModal.svelte`
24. `src/lib/components/chat/ShareChatModal.svelte`
25. `src/lib/components/chat/ToolServersModal.svelte`
26. `src/lib/components/layout/Sidebar.svelte`
27. `src/lib/components/layout/Sidebar/UserMenu.svelte`
28. `src/lib/components/workspace/Models.svelte`
29. `src/lib/components/workspace/Prompts.svelte`
30. `src/lib/components/workspace/Tools.svelte`
31. `src/lib/components/workspace/common/CommunityDiscover.svelte`
32. `src/lib/constants.ts`
33. `src/routes/(app)/+layout.svelte`
34. `src/routes/+layout.svelte`
35. `src/routes/auth/+page.svelte`
36. `static/opensearch.xml`

All conflict markers were removed and all unmerged index entries were resolved.
No file or feature area was resolved by choosing one side wholesale.

## Resolution record

- Branding: retained Tide-Bot names, assets, favicon, onboarding/auth copy, and
  the branding audit while accepting compatible upstream v0.11.1 UI and
  accessibility changes. Upstream promotional/community-sharing surfaces were
  not reintroduced.
- ChatGPT subscription: combined upstream OpenAI connection/access/codec changes
  with device OAuth, encrypted credential persistence, status and refresh,
  model discovery, Responses request sanitization and SSE streaming, and the
  safe catalog probe.
- Voice: retained the ElevenLabs `CallOverlay` and the STT/chat/TTS fallback;
  no undocumented ChatGPT Realtime replacement was added.
- Chat and companion: combined upstream ask-user, tool approval, variables,
  queue migration, stop-by-chat, and scroll behavior with the Tide-Bot
  one-shot lifecycle, companion surface, presence socket service, compact
  composer, abort behavior, and URL suppression.
- Desktop and browser extension: retained companion origin restrictions,
  Tauri boundaries, browser pairing/authorization policy, voice unit behavior,
  and the static extension build.
- Deployment/security: retained the external-volume, localhost-only production
  overlay and the no-public-terminal/CPTR, no-telemetry, no-public-signup, and
  no-upstream-workflow-inheritance boundaries.
- Upstream v0.11.1 UI: accepted current persistent OAuth configuration,
  mobile sidebar/resizer, terminal context/chat-upload settings, dependency
  lock, Pyodide lock, migrations, API changes, and localization updates where
  they did not weaken Tide-Bot boundaries.

## Conflict-specific test evidence

Existing focused tests already covered most named boundaries before conflict
resolution. The custom `Chat.svelte` lifecycle/ask-user seam required a source
contract update: the red run failed because five wrapped socket callbacks were
expected while the merged behavior required six; after wrapping
`request:user_input` in the one-shot lifecycle, the contract passed with six.

## Verification evidence

- Node runtime: `v22.18.0`; npm `10.9.3`.
- Focused companion/chat frontend: 6 files, 23 tests passed.
- Browser extension: 18 files, 96 tests passed, including voice.
- Backend ChatGPT subscription, Responses streaming, safe CLI, companion store,
  and companion handlers: 50 tests passed.
- Windows/live-compose/upstream-workflow validators: 24 tests passed.
- Production health, updater, and schedule safeguards: all three scripts passed.
- Branding audit: passed after removing inherited promotional comments/URLs
  from audited product surfaces.
- Production build: passed under Node 22.18.0 with an 8 GB Node heap; 6,409
  client modules transformed and the static site was written to `build/`.
- Global `npm run check`: inherited baseline remains 7,774 errors and 200
  warnings in 344 files; recorded separately and not represented as a clean gate.
- Disposable companion smoke: invoked after the build with fresh run ID
  `task6-20260825-2109`, but the hermetic runner stopped before Docker mutation
  because it could not find the Compose plugin in an approved fixed system
  location. `docker compose version` independently reports v5.3.0. The runner's
  location restriction was not weakened.
- Whitespace/conflict/index verification: finalized immediately before commit.

The first build attempt reached chunk rendering but exhausted Node's default
approximately 4 GB heap. A shell-default Node 25 rerun was stopped immediately
and is not counted as evidence. The successful build above used only the pinned
Node 22.18.0 runtime.
