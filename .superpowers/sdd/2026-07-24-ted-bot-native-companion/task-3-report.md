# Task 3 report: authorized active-chat presence

## Status

DONE. Task 3 is implemented without changing Task 4 or later files. Tide-Bot remains the authenticated product backend; Ted-Bot presence reuses the existing Socket.IO session identity and chat-read authorization.

## Files changed

- `backend/open_webui/utils/chat_access.py`
  - Extracts the existing owner, admin/internal-chat, shared-chat grant, and shared-folder read branches into `get_readable_chat`.
- `backend/open_webui/routers/chats.py`
  - Routes GET `/chats/{id}` through the shared authorization helper.
- `backend/open_webui/socket/companion_presence.py`
  - Adds the strict frozen presence record, validation, one-worker memory store, Redis Lua store, per-user emission ordering, focus arbitration, TTL expiry, rate limiting, room-scoped service, and lifespan task helpers.
- `backend/open_webui/socket/main.py`
  - Initializes the configured store, registers only `companion:presence:update` and `companion:presence:subscribe`, and removes presence before deleting the socket session.
- `backend/open_webui/main.py`
  - Runs the multi-worker topology guard before startup, stores the expiry task on app state, and cancels/awaits it during shutdown.
- `backend/open_webui/socket/test_companion_presence.py`
  - Covers strict validation, memory arbitration/expiry/isolation, topology selection, Redis atomic revision/expiry claims, and task cancellation.
- `backend/open_webui/socket/test_companion_presence_handlers.py`
  - Covers shared authorization branches, unauthenticated/malformed/unauthorized updates, canonical titles, user-room emission, rate limiting, subscription, disconnect promotion, expiry, and monotonic concurrent emission.
- `backend/open_webui/socket/test_companion_presence_redis_integration.py`
  - Exercises real signup/signin/chat creation, direct WebSocket connections to two independent workers, actual handlers, actual Redis Lua updates, disconnect promotion, authorization/isolation, and namespace cleanup.
- `deploy/tide-stack/docker-compose.presence-integration.yml`
  - Defines isolated Redis, two Tide-Bot workers, a shared test-only database volume, and a one-shot integration service.
- `scripts/run-companion-presence-redis-integration.mjs`
  - Enforces safe run IDs, rejects caller Compose source selection, uses one isolated Compose function with explicit file/env/project flags, creates a private mode-0600 environment, inventories live Tide-Bot resources, and performs unconditional namespaced teardown.

## Red-green evidence

1. Initial presence tests:
   - Red command: `PYTHONPATH=backend /tmp/tedbot-presence-task3-venv/bin/python -m pytest backend/open_webui/socket/test_companion_presence.py backend/open_webui/socket/test_companion_presence_handlers.py -q`
   - Red result: two collection errors, both exactly `ModuleNotFoundError: No module named 'open_webui.socket.companion_presence'`.
   - First green result: `21 passed in 0.20s`.
2. Shared chat authorization extraction:
   - Red command: focused handler test file.
   - Red result: `ImportError: cannot import name 'chat_access' from 'open_webui.utils'`.
   - Green result after helper extraction: `22 passed in 0.21s`.
3. Cross-worker emission ordering:
   - The first complete integration run passed all assertions.
   - A fresh Node 22 rerun exposed a real race at `assert stream == sorted(stream)`: Redis revisions were atomic, but concurrent workers could publish revision 2 before revision 1. Cleanup still passed.
   - A focused regression reproduced the defect as `[2, 1]`.
   - After adding a short per-user emission lock and latest-state coalescing, the focused regression passed (`1 passed`) and the full unit suite passed (`23 passed in 0.22s`).

No `uv run` command was used and `uv.lock` was not modified.

## Final verification

- Focused Pytest:
  - `PYTHONPATH=backend /tmp/tedbot-presence-task3-venv/bin/python -m pytest backend/open_webui/socket/test_companion_presence.py backend/open_webui/socket/test_companion_presence_handlers.py -q`
  - Result: `23 passed`.
- New-file Ruff check and format check:
  - Result: all checks passed; all five new Python files formatted.
- Python compilation:
  - Compiled the presence service, integration test, authorization helper, Socket.IO main, and FastAPI main successfully.
- Node/Compose/static checks:
  - Prettier passed for the wrapper and Compose file.
  - `node --check` passed.
  - Explicit Compose rendering passed with test-only values and `/dev/null` as the env file.
  - `git diff --check` passed.
- Wrapper boundary checks:
  - Injected `COMPOSE_*` environment rejected before resources.
  - Wrapper Compose/source arguments rejected before resources.
  - Unsafe `RUN_ID` rejected before resources.
- Real Redis/two-worker runtime:
  - Command: `RUN_ID=ordered-$(date +%s) npx -y -p node@22.18.0 node scripts/run-companion-presence-redis-integration.mjs`
  - Result: exit 0.
  - Assertions: shared cross-worker monotonic revision stream PASS; user-room isolation PASS; disconnect promotion PASS; real-handler chat authorization PASS; presence namespace empty PASS; namespaced resource teardown PASS; pre-existing Tide-Bot containers, networks, and volumes untouched PASS.

## Commit

- Planned scoped commit: `feat: synchronize ted-bot active chat presence`
- Base: `1b75bda7446f923efc74cb1cf08e9b09bf5815b8`
- The resulting commit hash is returned in the task handoff because a commit cannot include its own hash in its contents.

## Remaining concerns

- None blocking Task 3.
- The real worker processes take several minutes to become healthy on the current machine, but the harness uses a bounded 300-second wait and completed successfully.
- The repository-wide diagnostic baseline was intentionally not used as a Task 3 regression signal; verification remained scoped per `AGENTS.md`.

## Fix round 1 of 5

### Review findings addressed

1. Made wrapper cleanup unconditional after the private temporary directory is created.
   - All setup, inventory, Compose execution, teardown, and inspection now run inside an outer `try/finally`.
   - Compose down, project-resource inspection, and post-run Tide-Bot inventory failures are captured independently.
   - The primary integration/startup failure remains the thrown error when cleanup also fails.
   - Private temporary files are removed in the outer guaranteed cleanup even when initial inventory, Compose, teardown, or later inspection fails.
   - Added `scripts/run-companion-presence-redis-integration.test.mjs` with injected inventory and multi-cleanup failures.
2. Strengthened the real two-worker shared-stream assertion.
   - The test waits until both authenticated clients have received the expected two events.
   - It compares both complete revision/payload sequences for equality.
   - It accepts only the documented normal `[1, 2]` or coalesced `[2, 2]` forms, with duplicate payload equality required for coalescing.
   - It asserts the final canonical revision-2 payload in full, so missing, differing, forged-title, or wrong-active-client events fail.

### Red evidence

- Wrapper cleanup:
  - Command: `node --test scripts/run-companion-presence-redis-integration.test.mjs`
  - Result: `0 passed, 2 failed`.
  - Inventory failure left `tedbot-presence-it-cleanup-inventory-*` behind.
  - Combined primary/cleanup failure surfaced `inspect container resources failed with exit 43` instead of `start isolated presence stack failed`.
- Shared stream:
  - Command: `PYTHONPATH=backend /tmp/tedbot-presence-task3-venv/bin/python -m pytest backend/open_webui/socket/test_companion_presence_redis_integration.py -q`
  - Result: `2 failed`; `_assert_shared_presence_sequences` did not exist, so the reviewed runtime assertions had no exact shared-sequence contract.

### Green and final verification

- `node --test scripts/run-companion-presence-redis-integration.test.mjs`
  - Result: `2 passed`.
- `PYTHONPATH=backend /tmp/tedbot-presence-task3-venv/bin/python -m pytest backend/open_webui/socket/test_companion_presence_redis_integration.py -q`
  - Result: `2 passed`.
- `RUN_ID=review1-$(date +%s) npx -y -p node@22.18.0 node scripts/run-companion-presence-redis-integration.mjs`
  - Result: exit 0.
  - Assertions: exact shared cross-worker revision/payload stream PASS; user-room isolation PASS; disconnect promotion PASS; real-handler authorization PASS; namespace empty PASS; namespaced teardown PASS; pre-existing Tide-Bot resources untouched PASS.
- Prettier, Ruff format, Node syntax, and `git diff --check`
  - Result: PASS.

### Fix-round commits

- Planned scoped fix commit: `fix: harden presence integration cleanup`
- The resulting hash is returned in the task handoff.

### Remaining concerns after fix round 1

- None blocking.
- The integration workers still require several minutes for a cold health start on this machine; the bounded harness completed successfully.
