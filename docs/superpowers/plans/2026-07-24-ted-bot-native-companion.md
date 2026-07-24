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
- Create: scripts/verify-ted-bot-direction-evidence.mjs
- Create: scripts/verify-ted-bot-direction-evidence.test.mjs
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
node --test scripts/verify-ted-bot-direction-evidence.test.mjs
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
HATCH_PET_SKILL_DIR="/Users/kolbyunderwood/.codex/skills/hatch-pet"
PET_QA_RUN_ID="release-<unique-lowercase-id>" # required; no generated fallback
PET_QA_RUNS_ROOT="$EVIDENCE_DIR/pet-qa-runs"
node scripts/verify-ted-bot-direction-evidence.mjs prepare-pet-qa-run \
  --run-id "$PET_QA_RUN_ID" --runs-root "$PET_QA_RUNS_ROOT" --atlas "$ATLAS"
PET_QA_PENDING_DIR="$PET_QA_RUNS_ROOT/.${PET_QA_RUN_ID}.pending"
PET_QA_RUN_DIR="$PET_QA_RUNS_ROOT/$PET_QA_RUN_ID"
BLIND_RUN_ID="$PET_QA_RUN_ID-blind"
BLIND_RUNS_ROOT="$PET_QA_PENDING_DIR/blind-runs"
REVIEW_INBOX="$PET_QA_PENDING_DIR/.blind-review-inbox/$BLIND_RUN_ID"
install -d -m 700 "$REVIEW_INBOX"
"$PYTHON" "$HATCH_PET_SKILL_DIR/scripts/validate_atlas.py" "$ATLAS" \
  --require-v2 --json-out "$PET_QA_PENDING_DIR/ted-bot-atlas-validation.json"
"$PYTHON" "$HATCH_PET_SKILL_DIR/scripts/make_contact_sheet.py" "$ATLAS" \
  --output "$PET_QA_PENDING_DIR/ted-bot-atlas-contact-sheet.png"
"$PYTHON" "$HATCH_PET_SKILL_DIR/scripts/make_direction_qa_sheet.py" "$ATLAS" \
  --output "$PET_QA_PENDING_DIR/ted-bot-direction-qa-sheet.png"
"$PYTHON" "$HATCH_PET_SKILL_DIR/scripts/measure_direction_continuity.py" "$ATLAS" \
  --json-out "$PET_QA_PENDING_DIR/ted-bot-direction-continuity.json"
"$PYTHON" "$HATCH_PET_SKILL_DIR/scripts/make_direction_blind_qa_sheet.py" "$ATLAS" \
  --output "$PET_QA_PENDING_DIR/ted-bot-direction-blind-sheet.png" \
  --answer-key "$PET_QA_PENDING_DIR/ted-bot-direction-blind-answer-key.json"
node scripts/verify-ted-bot-direction-evidence.mjs prepare-blind-run \
  --run-id "$BLIND_RUN_ID" \
  --runs-root "$BLIND_RUNS_ROOT" \
  --atlas "$ATLAS" \
  --blind-sheet "$PET_QA_PENDING_DIR/ted-bot-direction-blind-sheet.png" \
  --answer-key "$PET_QA_PENDING_DIR/ted-bot-direction-blind-answer-key.json"
# The verifier alone creates "$BLIND_RUNS_ROOT/.${BLIND_RUN_ID}.pending" mode
# 0700. Each independent reviewer receives only its blind-sheet.png and
# blind-review-manifest.json, never the answer key, labeled direction sheet,
# atlas, prompts, another verdict, or the final run directory.
node scripts/verify-ted-bot-direction-evidence.mjs verify-and-combine \
  --python "$PYTHON" \
  --combine-script "$HATCH_PET_SKILL_DIR/scripts/combine_direction_blind_verdicts.py" \
  --validate-script "$HATCH_PET_SKILL_DIR/scripts/validate_direction_blind_verdicts.py" \
  --run-id "$BLIND_RUN_ID" \
  --runs-root "$BLIND_RUNS_ROOT" \
  --verdict "$REVIEW_INBOX/ted-bot-direction-blind-verdict-1.json" \
  --verdict "$REVIEW_INBOX/ted-bot-direction-blind-verdict-2.json" \
  --verdict "$REVIEW_INBOX/ted-bot-direction-blind-verdict-3.json"
# An independent visual reviewer writes the required 16-entry semantics JSON
# only to "$PET_QA_PENDING_DIR/ted-bot-direction-semantics.json".
node scripts/verify-ted-bot-direction-evidence.mjs publish-pet-qa-run \
  --run-id "$PET_QA_RUN_ID" --runs-root "$PET_QA_RUNS_ROOT" --atlas "$ATLAS"
~~~

`scripts/verify-ted-bot-direction-evidence.mjs` uses Node built-ins only and
owns this provenance boundary. It requires a unique conservative
`BLIND_RUN_ID` (lowercase letters, digits, and hyphens; begins/ends
alphanumeric) and rejects an existing final run ID. `prepare-blind-run` hashes
the exact atlas, blind sheet, and answer key and creates only the sibling
`$BLIND_RUNS_ROOT/.${BLIND_RUN_ID}.pending` directory with mode 0700. It writes
a redacted manifest with `schemaVersion`, `atlasSha256`, `blindSheetSha256`,
`answerKeySha256`, and `manifestSha256`; the self hash is over the canonical
manifest payload with that field omitted. It copies the review sheet and keeps
the key private. The blind sheet plus redacted manifest are the only reviewer
material; they never receive a final directory.

Each reviewer verdict JSON must have the same schema version, a unique
`reviewerId`, `atlasSha256`, `blindSheetSha256`, `manifestSha256`, and complete
pair votes. Release evidence must invoke only the owned atomic
`verify-and-combine` command, never a raw external
`combine_direction_blind_verdicts.py` call. In one invocation it re-reads and
hashes the actual atlas, blind sheet, answer key, manifest, and all three source
verdicts; checks that the answer key's `atlas_sha256` names the actual atlas;
validates every attestation and reviewer-ID uniqueness; parses the verified
votes; writes sealed private verified-vote copies; and calls the required Hatch
combine script with the explicit bundled `PYTHON` and script path on those
sealed copies only. It must not pass mutable reviewer files to Hatch after
verification.

The wrapper writes sealed source copies, plain Hatch-compatible consensus,
validation, and `ted-bot-direction-blind-consensus-envelope.json` only inside
that private pending directory. Before calling the required Hatch validator in
the same wrapper invocation, it re-hashes the generated plain consensus and
checks its linkage to the envelope; it passes explicit bundled `PYTHON`,
validator-script, answer-key, and consensus paths. The envelope contains the
atlas/sheet/key/manifest SHA-256s, exact SHA-256 of every source verdict, the
sealed-copy hashes, Hatch combine result/hash, plain-consensus hash, and Hatch
validation result/hash. Only after both required Hatch scripts and envelope
verification succeed does it atomically rename the whole pending directory to
`$BLIND_RUNS_ROOT/$BLIND_RUN_ID`; that inner directory is eligible only and is
not accepted evidence until the outer pet-QA run publishes. On any error it removes only that exact pending directory, leaving no
final directory for the current run ID. It fails closed on a
missing or mismatched input/hash, malformed vote, missing reviewer, duplicate
ID, unverifiable manifest, replaced verdict, failed Hatch combine, or envelope
mismatch. Direct raw Hatch combine is prohibited for release evidence.

The same verifier owns the outer pet-QA transaction. It requires the distinct
conservative `PET_QA_RUN_ID` and creates only
`$PET_QA_RUNS_ROOT/.${PET_QA_RUN_ID}.pending` mode 0700, refusing an existing
`$PET_QA_RUNS_ROOT/$PET_QA_RUN_ID`. All release QA output belongs there:
validator JSON, contact sheet, direction QA sheet, continuity JSON, blind
sheet/key/manifest/reviewer material, the published blind subdirectory,
semantic-review JSON, and final run metadata. After the independent semantic
review writes `ted-bot-direction-semantics.json` in that outer pending
directory, invoke `publish-pet-qa-run`. It rehashes the atlas and expected
artifacts, verifies their run metadata and blind envelope linkage, and
atomically renames the **entire** outer pending directory to the final run
directory only on success. On error it leaves no final outer directory; it may
leave only that exact `.pending` directory as clearly nonaccepted diagnostic
state, which must never be cited as acceptance. No artifact may be written to
the root evidence directory other than the `pet-qa-runs/` run root.

Create focused `scripts/verify-ted-bot-direction-evidence.test.mjs` fixtures
for a passing atomic run plus a mutation-after-manifest matrix: mutate the
atlas, blind sheet, answer key, manifest, and each of the three individual
verdict files in turn. Every mutation must fail and leave no accepted consensus
or success envelope. Add a distinct semantic-key fixture where the answer key's
`atlas_sha256` is wrong but its file hash, manifest `answerKeySha256`, reviewer
manifest hash, and all reviewer attestations are freshly regenerated and
consistent; `verify-and-combine` must still reject it with no published output.
Also prove successful publication; a failure after a different prior successful
run cannot publish the current run; a failure/mutation leaves no current-run
final directory; and an existing same-run final directory is refused. Extend
the same focused Node test with outer `publish-pet-qa-run` fixtures for complete
publish, expected-artifact/hash mutation rejection with no current final run,
and existing-final refusal; a `.pending` fixture is never accepted. Run:

~~~
node --test scripts/verify-ted-bot-direction-evidence.test.mjs
~~~

The Hatch validator's JSON is the deterministic alpha/transparency result: it
must pass its alpha-channel, used-cell, unused-cell-fully-transparent,
transparent-RGB-residue, and v2 geometry checks. Store both JSON and the
rendered contact sheet only under the outer pending run directory and visually
inspect that contact sheet before outer publication. The acceptance record must name the
absolute tracked input path, pre/post SHA-256, bundled-runtime path, validator
command/result, contact-sheet path, inspector/date, and a pass/fail rubric for
black-goldendoodle identity, 8-by-11/cell alignment, all look-direction
continuity, and unused-cell transparency. In addition, save
`ted-bot-direction-semantics.json` with exactly these 16 expected directions:
`000 up`, `022.5 up-right`, `045 up-right`, `067.5 up-right`, `090 right`,
`112.5 down-right`, `135 down-right`, `157.5 down-right`, `180 down`,
`202.5 down-left`, `225 down-left`, `247.5 down-left`, `270 left`, `292.5
up-left`, `315 up-left`, and `337.5 up-left`. Each entry records its expected
direction, observed behavior, `pass`/`fail`/`ambiguous` verdict, and reason;
diagonals include both horizontal and vertical landmark evidence. Record every
continuity warning from `ted-bot-direction-continuity.json` and the visual
assessment that accepts or rejects it.

This is a hard release gate: all generated artifacts and each reviewer verdict
are SHA-bound to the pre/post-identical atlas SHA-256; the attestation verifier
must produce a linked atomic-consensus envelope and `publish-pet-qa-run` must
publish the complete outer run; no blind cardinal may be missing, failing, or
ambiguous; no semantic verdict may fail; and every
continuity warning must be assessed and recorded. An ambiguous intermediate
semantic verdict requires explicit labeled-loop rationale but never overrides a
blind-cardinal gate. A missing bundled Hatch runtime, hash mismatch, absent
evidence artifact, failed attestation verifier, failed blind validation,
semantic failure, failed outer publish, a pending-path reference, or unassessed
continuity warning leaves release acceptance **pending**; it must never be
reported as a pass. This is independent of the Node structural validator. Do not stage user-owned
`teddy-v2-upgrade/` QA or provenance, and do not stage the root
`tide-bot-pet/` Cyborg package.

~~~
git add src/lib/components/ted-bot src/lib/components/branding/TedBotMascot.svelte static/tide-bot/ted-bot/pet.json scripts/validate-ted-bot-pet.mjs scripts/validate-ted-bot-pet.test.mjs scripts/verify-ted-bot-direction-evidence.mjs scripts/verify-ted-bot-direction-evidence.test.mjs docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md docs/superpowers/evidence/2026-07-24-ted-bot-native-companion/
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
env -i PATH="$PATH" TMPDIR="$RUN_TMPDIR" \
  DOCKER_CONFIG="$RUN_TMPDIR/docker-config" \
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
- Create: src/lib/components/chat/chatLifecycleBinding.ts
- Create: src/lib/components/chat/chatLifecycleBinding.test.ts
- Create: src/lib/components/chat/Chat.lifecycle-contract.test.ts
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

The lifecycle tests are default-Node tests, but they must test the narrow
binding `Chat.svelte` actually uses rather than an isolated epoch abstraction.
Use four deferred promises (load, completion, stop, and queue), supply the
same real mutation callbacks that the source wires after each await, call
`resetForNavigation()` or `destroy()` before resolving each promise, and assert
that no stale mutation is applied. Register a real `eventCallback` setter with
the binding before the reset/destroy and assert it is invoked once with
`false`. `Chat.lifecycle-contract.test.ts` must read `Chat.svelte` and reject a
change that leaves any of `navigateHandler`/`loadChat`, completion settlement,
`stopResponse`, or `processNextInQueue` outside the capture/check seam.
It must also cover normal settlement: confirmation, input, execute, and both
embedded confirm-prompt callback paths settle normally once, then a later reset
or destroy cannot call them again.

- [ ] **Step 2: Verify the tests fail**

Run: npx vitest run src/lib/components/ted-bot/CompanionPanel.test.ts src/lib/components/chat/MessageInput/CompanionTextComposer.test.ts src/lib/components/chat/MessageInput.companion-contract.test.ts src/lib/components/chat/chatLifecycleBinding.test.ts src/lib/components/chat/Chat.lifecycle-contract.test.ts

Expected: FAIL because the canonical companion surface, compact input mode, and
the real-Chat lifecycle binding/contracts do not exist.

- [ ] **Step 3: Reuse the canonical, epoch-protected Chat surface**

~~~ts
type ChatSurface = 'full' | 'note' | 'companion';
export let surface: ChatSurface = 'full';
~~~

Replace the proposed pure guard with the intentionally narrow
`src/lib/components/chat/chatLifecycleBinding.ts` seam. `Chat.svelte` creates
the binding and is its only consumer; the binding must **not** contain a second
Chat controller, completion builder, event handler, or state model. It owns
only an epoch, destruction/reset state, and the pending `eventCallback`
settlers. Its API accepts the real Chat continuation as a callback, for example
`capture('load' | 'completion' | 'stop' | 'queue', continueCurrent)` returns a
token whose `continueIfCurrent()` executes that supplied continuation exactly
once only while the token is current. Thus the existing `Chat.svelte`
continuations retain their actual mutations (including `loading`, `history`,
`generating`, `generationController`, queue state, scroll work, and existing
`eventCallback` handling); the binding merely decides whether that real
continuation may run after an await.

`Chat.svelte` must call the same binding at every real deferred entry point:
`navigateHandler`/`loadChat`, completion submission and stream settlement,
`stopResponse`, and `processNextInQueue`. Capture before each relevant await
and route the existing post-await mutation through `continueIfCurrent()`.
Expose `registerPendingEventCallback(callback)` and one-shot `settle(value)` on
the binding. Registration returns the wrapper assigned to `eventCallback`; its
first normal dialog/async settlement clears the binding registration **before**
calling the underlying callback, so reset/destroy can only resolve callbacks
that remain pending. Every real assignment site must use that wrapper:
confirmation, input, execute, and both embedded confirm-prompt paths (the five
current `eventCallback = ...` sites). Both dialog confirm/cancel paths and the
normal async execute resolution call `settle`, never the raw callback.
`resetForNavigation()` and `destroy()` increment the epoch and resolve each
still-pending callback with `false` exactly once.
Call `resetForNavigation()` on every chat-ID transition, including `''`,
`null`, and `undefined`, and call `destroy()` from `onDestroy`. Preserve the
canonical submit, stop, confirmation, event, and queue semantics; no
continuation may be reimplemented inside the binding.

Create `chatLifecycleBinding.test.ts` and
`Chat.lifecycle-contract.test.ts` in the same directory. The binding test
creates real deferred promises for load, completion, stop, and queue, starts
each through the same `capture(..., continuation)` shape used by `Chat.svelte`,
then resets for navigation and destroys before resolving. It proves none of the
real mutation callbacks run and that the actual registered `eventCallback`
receives `false`. It separately tests normal resolution followed by reset and
destroy for confirmation, input, execute, and both embedded paths, proving the
underlying callback receives only its normal value. The source/contract test
reads `Chat.svelte` and asserts all four real continuation entry points
import/use the binding, capture/check their post-await continuation, every one
of the five real `eventCallback` registration sites uses the wrapper, dialog
confirm/cancel and normal execute settlement use `settle`, and reset occurs on
both navigation and `onDestroy`. Run them with:

~~~
npx vitest run src/lib/components/chat/chatLifecycleBinding.test.ts src/lib/components/chat/Chat.lifecycle-contract.test.ts
~~~

The old standalone `lifecycleGuard.ts` proposal is removed: a pure test that
does not exercise the binding used by `Chat.svelte` is insufficient release
evidence.
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

Run: npx vitest run src/lib/components/ted-bot/CompanionPanel.test.ts src/lib/components/chat/MessageInput/CompanionTextComposer.test.ts src/lib/components/chat/MessageInput.companion-contract.test.ts src/lib/components/chat/chatLifecycleBinding.test.ts src/lib/components/chat/Chat.lifecycle-contract.test.ts

Expected: PASS with Node source/contract evidence of canonical-surface reuse
and no duplicate completion/tool API import, Node parent-delegation evidence
that companion mode hides every optional control, jsdom evidence of the small
typed-only child, and lifecycle-binding evidence for stale load/completion/stop/
queue, pending callback denial, cleared chat ID reset, destruction, and source
coverage of the actual `Chat.svelte` deferred continuations, plus one-shot
normal callback settlement across confirmation/input/execute/embedded paths.

~~~
git add src/lib/components/ted-bot/CompanionPanel.svelte src/lib/components/ted-bot/CompanionPanel.test.ts src/routes/'(app)'/companion/+page.svelte src/lib/components/chat/Chat.svelte src/lib/components/chat/MessageInput.svelte src/lib/components/chat/MessageInput/CompanionTextComposer.svelte src/lib/components/chat/MessageInput/CompanionTextComposer.test.ts src/lib/components/chat/MessageInput.companion-contract.test.ts src/lib/components/chat/chatLifecycleBinding.ts src/lib/components/chat/chatLifecycleBinding.test.ts src/lib/components/chat/Chat.lifecycle-contract.test.ts
git commit -m 'feat: add ted-bot typed companion chat'
~~~

## Task 5a: Add authenticated companion Cypress smoke coverage

**Files:**
- Create: cypress/e2e/ted-bot-companion.cy.ts
- Create: deploy/tide-stack/docker-compose.cypress-companion.yml
- Create: deploy/tide-stack/cypress-fake-openai/Dockerfile
- Create: deploy/tide-stack/cypress-fake-openai/server.mjs
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

The Compose file owns a `fake-openai` service built only from
`deploy/tide-stack/cypress-fake-openai/Dockerfile` and `server.mjs`; it has a
health check for its local health route. Tide-Bot can reach its model API only
on the isolated Compose network. The wrapper may publish the fixture's status
route on one generated `127.0.0.1` port for Cypress `cy.request`; that port is
never caller-configurable, is not an application origin, and is torn down with
the named project. The service never mounts a host credential/configuration
file, does not log request bodies or headers, and is removed with the named
test project. Its deterministic OpenAI-compatible API returns exactly one model,
`tedbot-cypress-model`, from `GET /v1/models`. `POST /v1/chat/completions`
returns a fixed successful non-stream completion, and ordinary `stream: true`
requests return a fixed valid SSE delta/finish sequence followed by `[DONE]`.
One test-only slow-stream marker in the request body selects a barrier scenario:
the fixture sends exactly one first SSE delta, records `requestCount: 1` and
`streamStarted: true`, then waits for the client to abort the HTTP stream. It
sets `aborted: true` only after the server observes the aborted/closed request,
never emits a finish delta or `[DONE]` for that scenario, never increments
`completedCount`, and must not time out into normal completion.

The generated loopback fixture status endpoint is exactly
`GET /__fixture/status` and returns only `requestCount`, `streamStarted`,
`aborted`, and `completedCount`. It reveals no prompt, header, token, or other
request data; has clean in-memory state for each named Compose project; cannot
be reset by Cypress; and disappears with the stack. The runner waits for fixture
health before Cypress begins, and its unconditional cleanup tears down the
named project and private env directory even if a barrier is still open.

Only the Tide-Bot service in this Cypress Compose file receives the supported
fixture settings: `OPENAI_API_BASE_URLS=http://fake-openai:8081/v1`, a fixed
inert `OPENAI_API_KEYS` fixture value that is not a credential,
`ENABLE_SIGNUP=true`, `DEFAULT_USER_ROLE=user`, and
`DEFAULT_MODELS=tedbot-cypress-model`. It also receives
`ENABLE_WEB_SEARCH=true` and `ENABLE_WEB_SEARCH_CONFIRMATION=true` solely to
exercise Tide-Bot's existing confirmation UI. The Compose file must explicitly
clear/omit every external model, search, OAuth, terminal, and CPTR integration
instead of inheriting root or host environment settings. Tide-Bot depends on
the healthy fake-model service; Cypress starts only after Tide-Bot is healthy.
No service has an external API, credential, or host-network path.

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
companion slow-stream case verifies compact chrome/shortcut suppression, types
the special marker, and intercepts exactly one Tide-Bot completion-proxy
request. It waits for `GET /__fixture/status` to show `requestCount === 1` and
`streamStarted === true`, asserts Stop is visible after the first delta, clicks
Stop, and waits for `aborted === true`. It then proves `completedCount === 0`,
no final completion UI state, and no duplicate Tide-Bot completion-proxy
request. This is the abort proof, not a normal stream-completion assertion.

The full canonical chat case follows this exact confirmation flow: type prompt
→ toggle Web Search → assert dialog → deny → assert fixture
`completedCount` remains zero. It does not submit before the dialog and does
not add or pretend that the
companion exposes a hidden optional control. `CompanionPanel.test.ts` remains a
separate source/route contract: it must prove the panel renders canonical
`Chat.svelte` with `surface="companion"` and that canonical Chat retains its
existing confirmation dialog, rather than attempting to expose the full-chat
web-search toggle in companion mode. Do not assert cross-client active-chat or
presence synchronization here: the real-Redis/two-worker Socket.IO integration
harness is the sole gate for that proof. Redact request bodies and auth headers
in Cypress logging.

- [ ] **Step 2: Verify and commit**

Run:

~~~
node --test scripts/run-companion-cypress.test.mjs
RUN_ID=cypress-local-$(date +%s) npm run test:companion:e2e
git diff --check
~~~

Expected: PASS only against the wrapper-created disposable loopback stack and
account. The runner test must cover the fixture build/configuration, generated
loopback-only status port, explicit service dependency/health conditions,
fixture-only Tide-Bot env, and rejection of external configuration in addition
to the existing isolation checks. Attach the isolated project name, loopback
origins, redacted result, fixture model/count assertions, canonical confirmation
denial, and safe-teardown verification to acceptance evidence. Missing
isolation, runtime, or test prerequisites are a failed/pending release gate,
never an optional credential skip.

~~~
git add cypress/e2e/ted-bot-companion.cy.ts deploy/tide-stack/docker-compose.cypress-companion.yml deploy/tide-stack/cypress-fake-openai/Dockerfile deploy/tide-stack/cypress-fake-openai/server.mjs scripts/run-companion-cypress.mjs scripts/run-companion-cypress.test.mjs src/lib/components/ted-bot/CompanionPanel.test.ts package.json
git commit -m 'test: add companion smoke coverage'
~~~

## Task 6: Add the Tauri desktop shell

**Files:**
- Create: desktop/tide-bot/package.json
- Create: desktop/tide-bot/src-tauri/Cargo.toml
- Create: desktop/tide-bot/src-tauri/build.rs
- Create: desktop/tide-bot/src-tauri/tauri.conf.json
- Create: desktop/tide-bot/src-tauri/templates/companion.capability.template.json
- Generate (ignored): desktop/tide-bot/src-tauri/capabilities/companion.json
- Generate (ignored): desktop/tide-bot/src-tauri/generated/desktop-origin-provenance.json
- Create: desktop/tide-bot/src-tauri/permissions/companion.toml
- Create: desktop/tide-bot/src-tauri/src/main.rs
- Create: desktop/tide-bot/src-tauri/src/lib.rs
- Create: desktop/tide-bot/src-tauri/src/origin.rs
- Create: desktop/tide-bot/src-tauri/src/placement.rs
- Create: desktop/tide-bot/src-tauri/tests/placement_test.rs
- Create: desktop/tide-bot/src-tauri/tests/capabilities_test.rs
- Create: desktop/tide-bot/src-tauri/tests/companion_url_test.rs
- Create: desktop/tide-bot/scripts/desktop-origins.mjs
- Create: desktop/tide-bot/scripts/build-desktop.mjs
- Create: desktop/tide-bot/README.md

**Interfaces:**
- Produces: main and companion windows, show_main_window command, tray actions, and non-sensitive placement persistence.
- Consumes: required `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` build/CI input and
  optional `TIDE_BOT_DESKTOP_DEV_ORIGIN` loopback build input, plus the
  `/companion` route.

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

Run:

~~~
cd desktop/tide-bot && npm run test:tauri:generated
~~~

Expected: FAIL because the Tauri package does not exist.

- [ ] **Step 3: Implement narrow native windows and capabilities**

~~~rust
fn companion_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
	WebviewWindowBuilder::new(app, "companion", WebviewUrl::External(configured_companion_url()?))
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
`allow-show-main-window`, and `remote.urls` equals the resolved production
origin plus the optional resolved development origin only when development was
configured. The test reads the exact generated capability file that the Tauri
build consumes; it must not reconstruct expected origins independently.
`companion_url_test.rs` additionally exercises the exported generated-source
reader and `companion_window` URL construction, so a capability test cannot
pass while the actual companion Webview URL uses another authority.
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

`desktop/tide-bot/package.json` declares reproducible `tauri`,
`test:tauri:generated`, `build:debug`, and `build:windows` scripts plus pinned
Tauri CLI/API dependencies. The generated-test/debug/Windows scripts all call
`build-desktop.mjs`; direct Cargo/Tauri invocation is not a supported package
workflow. Set the app
product name, bundle identifier, version, and build metadata in
`tauri.conf.json`/Cargo metadata. Add the checked-in
`src-tauri/templates/companion.capability.template.json` and a single resolver,
`desktop/tide-bot/scripts/desktop-origins.mjs`. Before **every** Tauri build or
capability test, the tracked `desktop/tide-bot/scripts/build-desktop.mjs`
launcher runs that resolver and atomically materializes both the ignored
`src-tauri/capabilities/companion.json` and separate ignored
`src-tauri/generated/desktop-origin-provenance.json`. The capability JSON has
no provenance-only unknown fields. The provenance JSON records schema version,
SHA-256 digests of the tracked resolver and template, capability SHA-256,
normalized-origins hash, and a cryptographically random per-prepare
`generationNonce`. No hand-edited fallback capability, provenance, or invented
runtime origin is allowed.

The resolver requires `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN`. It parses and
normalizes it to an absolute canonical HTTPS origin, rejects a missing host,
wildcard, credentials, query, fragment, or any path other than an optional
trailing `/`, and writes no credential to output. It accepts
`TIDE_BOT_DESKTOP_DEV_ORIGIN` only when supplied and only as an absolute `http`
origin with an exact loopback host (`127.0.0.1`, `localhost`, or `::1`), no
wildcard, credentials, query, fragment, or non-root path. Invalid or absent
required production input fails before Cargo/Tauri work begins. The generated
JSON records the resolved non-secret origins and uses them as its `remote.urls`
array: production first and optional development second.

The launcher reads the freshly written provenance and passes only its exact
nonce as build-only `TIDE_BOT_DESKTOP_GENERATION_NONCE` to Cargo/Tauri; it does
not pass any runtime origin URL. `build.rs` fails if that environment binding is
missing, verifies the provenance's resolver/template/capability/origin digests
against the generated capability and tracked inputs, compares the nonce, and
emits the accepted nonce into compiled Rust with `cargo:rustc-env`. Package
build/test commands must use this launcher, not `cargo` or `tauri` directly.
Raw runtime environment variables never influence the installed app URL; the
build-only nonce only binds that compilation to freshly generated input.

`src-tauri/src/origin.rs` defines `configured_companion_url()`. It reads **only**
compile-time embeds **both** the generated capability and provenance using
`include_str!` (or equivalent), verifies their linkage, expected compiled nonce,
and resolver/template digests, then parses `remote.urls`, selects the required
first resolved production origin, and safely appends exactly `/companion`. It
never reads a source path, current working directory, arbitrary runtime URL, or
origin environment variable. It rejects missing/unreadable generated source at
build time, invalid/stale provenance, nonce/digest/config mismatch, an
empty/malformed remote list, any noncanonical external origin, or a result not
exactly equal to one approved generated `remote.urls` origin plus `/companion`.
`companion_window` must call this helper; no `app_url`, duplicate origin
resolver, or fallback host is permitted.

Export the read-only URL/config helper from `src/lib.rs` solely for executable
integration tests; its fixture parser accepts supplied document bytes, while
the production `configured_companion_url()` calls it only with compile-time
embedded bytes and compiled nonce. `companion_url_test.rs` proves the returned external
`WebviewUrl` has the generated approved production origin and `/companion`,
cannot diverge from `remote.urls`, and rejects missing provenance, invalid
resolver/template digest, invalid capability/provenance link, and a
syntactically valid old fixture with old nonce/provenance via controlled fixture
paths. It also proves external runtime environment values cannot affect the
result. Run it with the placement and
capability tests through `npm run test:tauri:generated`.

There is currently no confirmed canonical production deployment origin. Do not
invent one or hardcode a plausible domain. Until a deployment owner provisions
the required production input, production desktop release acceptance is
external/pending, not passed.

Use `build.rs` with the generated AppManifest/permission registration and add
only `permissions/companion.toml`, using one `[[permission]]` entry that
defines the single application permission identifier
`allow-show-main-window` with `commands.allow` exactly
`["show_main_window"]`. The resolver-generated `capabilities/companion.json` binds only
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
cd desktop/tide-bot && npm run test:tauri:generated && npm run build:debug
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
`desktop/tide-bot`'s Windows build command. The workflow receives the required
non-secret GitHub repository variable `TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN` as
the same-named environment input to `npm run build:windows`; that tracked
launcher prepares fresh capability/provenance output and passes its nonce to
Cargo. It may receive the optional non-secret repository variable
`TIDE_BOT_DESKTOP_DEV_ORIGIN` only for an intentionally loopback development
artifact; release workflow configuration normally omits it. The workflow must
fail before compilation if the required variable is absent or either resolver
validation fails. Provision these repository variables through the protected
release workflow/repository settings, never as a secret and never by placing an
origin in source.

Upload the signed/unsigned build artifact as appropriate; record workflow run
URL, commit SHA, artifact name, checksum, resolved non-secret production/dev
origin values, SHA-256 of the generated `companion.json`, and the parsed
capability-test result in acceptance evidence. A local macOS debug build is not
Windows acceptance. The actual downloaded Windows artifact must additionally
pass the manual procedure below; missing production-origin provisioning or
artifact proof leaves desktop release acceptance external/pending.

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
# Proves attestation/hash mismatches are rejected before blind consensus.
node --test scripts/verify-ted-bot-direction-evidence.test.mjs
# Release-only: call load_workspace_dependencies; set PYTHON to its exact bundled runtime.
ATLAS="$PWD/static/tide-bot/ted-bot/spritesheet.webp"; EVIDENCE_DIR="$PWD/docs/superpowers/evidence/2026-07-24-ted-bot-native-companion"; shasum -a 256 "$ATLAS"
HATCH_PET_SKILL_DIR="/Users/kolbyunderwood/.codex/skills/hatch-pet"
PET_QA_RUN_ID="release-<unique-lowercase-id>"; PET_QA_RUNS_ROOT="$EVIDENCE_DIR/pet-qa-runs"
node scripts/verify-ted-bot-direction-evidence.mjs prepare-pet-qa-run --run-id "$PET_QA_RUN_ID" --runs-root "$PET_QA_RUNS_ROOT" --atlas "$ATLAS"
PET_QA_PENDING_DIR="$PET_QA_RUNS_ROOT/.${PET_QA_RUN_ID}.pending"; PET_QA_RUN_DIR="$PET_QA_RUNS_ROOT/$PET_QA_RUN_ID"
BLIND_RUN_ID="$PET_QA_RUN_ID-blind"; BLIND_RUNS_ROOT="$PET_QA_PENDING_DIR/blind-runs"; REVIEW_INBOX="$PET_QA_PENDING_DIR/.blind-review-inbox/$BLIND_RUN_ID"; install -d -m 700 "$REVIEW_INBOX"
"$PYTHON" "$HATCH_PET_SKILL_DIR/scripts/validate_atlas.py" "$ATLAS" --require-v2 --json-out "$PET_QA_PENDING_DIR/ted-bot-atlas-validation.json"
"$PYTHON" "$HATCH_PET_SKILL_DIR/scripts/make_contact_sheet.py" "$ATLAS" --output "$PET_QA_PENDING_DIR/ted-bot-atlas-contact-sheet.png"
"$PYTHON" "$HATCH_PET_SKILL_DIR/scripts/make_direction_qa_sheet.py" "$ATLAS" --output "$PET_QA_PENDING_DIR/ted-bot-direction-qa-sheet.png"
"$PYTHON" "$HATCH_PET_SKILL_DIR/scripts/measure_direction_continuity.py" "$ATLAS" --json-out "$PET_QA_PENDING_DIR/ted-bot-direction-continuity.json"
"$PYTHON" "$HATCH_PET_SKILL_DIR/scripts/make_direction_blind_qa_sheet.py" "$ATLAS" --output "$PET_QA_PENDING_DIR/ted-bot-direction-blind-sheet.png" --answer-key "$PET_QA_PENDING_DIR/ted-bot-direction-blind-answer-key.json"
node scripts/verify-ted-bot-direction-evidence.mjs prepare-blind-run --run-id "$BLIND_RUN_ID" --runs-root "$BLIND_RUNS_ROOT" --atlas "$ATLAS" --blind-sheet "$PET_QA_PENDING_DIR/ted-bot-direction-blind-sheet.png" --answer-key "$PET_QA_PENDING_DIR/ted-bot-direction-blind-answer-key.json"
# Reviewers receive only "$BLIND_RUNS_ROOT/.${BLIND_RUN_ID}.pending/blind-sheet.png" and the redacted manifest.
# Release evidence must not invoke raw Hatch combine outside this atomic wrapper.
node scripts/verify-ted-bot-direction-evidence.mjs verify-and-combine --python "$PYTHON" --combine-script "$HATCH_PET_SKILL_DIR/scripts/combine_direction_blind_verdicts.py" --validate-script "$HATCH_PET_SKILL_DIR/scripts/validate_direction_blind_verdicts.py" --run-id "$BLIND_RUN_ID" --runs-root "$BLIND_RUNS_ROOT" --verdict "$REVIEW_INBOX/ted-bot-direction-blind-verdict-1.json" --verdict "$REVIEW_INBOX/ted-bot-direction-blind-verdict-2.json" --verdict "$REVIEW_INBOX/ted-bot-direction-blind-verdict-3.json"
# Independent visual review writes only "$PET_QA_PENDING_DIR/ted-bot-direction-semantics.json".
node scripts/verify-ted-bot-direction-evidence.mjs publish-pet-qa-run --run-id "$PET_QA_RUN_ID" --runs-root "$PET_QA_RUNS_ROOT" --atlas "$ATLAS"
shasum -a 256 "$ATLAS"
pytest backend/open_webui/socket/test_companion_presence.py backend/open_webui/socket/test_companion_presence_handlers.py -q
npx vitest run src/lib/ted-bot/presence.test.ts src/lib/components/ted-bot/CompanionPanel.test.ts src/lib/components/chat/MessageInput/CompanionTextComposer.test.ts src/lib/components/chat/MessageInput.companion-contract.test.ts src/lib/components/chat/chatLifecycleBinding.test.ts src/lib/components/chat/Chat.lifecycle-contract.test.ts src/lib/ted-bot/openMainWindow.test.ts
node --test scripts/run-companion-cypress.test.mjs
cd desktop/tide-bot && npm run test:tauri:generated && npm run build:debug
cd ../../.. && RUN_ID=release-$(date +%s) node scripts/run-companion-presence-redis-integration.mjs
RUN_ID=cypress-release-$(date +%s) npm run test:companion:e2e
~~~

Expected: every focused local check passes. The Hatch commands use no bare
Python, consume the exact SHA-256-bound tracked atlas, produce passing
deterministic alpha/transparency JSON plus a rendered contact sheet, a labeled
direction QA sheet, continuity JSON, a randomized blind sheet/answer key,
redacted provenance manifest, three attested independent blind verdicts,
atomic source-hash-linked consensus envelope, consensus, and blind validation. Every item must
live only under one unique published `PET_QA_RUN_ID` directory (including its
blind subdirectory) and carry the
same pre/post atlas SHA-256. No blind cardinal may be missing,
failing, or ambiguous; every one of the 16 semantic entries must record
expected direction, observed behavior, pass/fail/ambiguous verdict, and reason;
semantic failures and unassessed continuity warnings block release. The gate
leaves acceptance pending if the bundled runtime or any required evidence is
absent. The
required Cypress command provisions and tears down its own loopback-only stack;
it must never skip for missing user credentials or run against a live stack.
Record the inherited global npm run check result separately if it remains
non-clean.
The release acceptance record must include a current visual atlas-inspection
entry for the tracked black-goldendoodle asset; the blind sheet, redacted
manifest, its canonical self-hash, three reviewer IDs/verdict hashes, and
passing atomic consensus envelope linking the required Hatch combine result to
the plain consensus; and the unique published `PET_QA_RUN_ID` path (with no
accepted outer or inner `.pending` path); and the exact successful
`RUN_ID=release-... node scripts/run-companion-presence-redis-integration.mjs`
command, explicit isolated Compose project name, worker-a/worker-b endpoint
evidence, direct-WebSocket shared ordered revisions, single-emitter expiry/
disconnect-promotion result, user-room-isolation result, namespace-empty
result, and confirmation that only the namespaced test resources were removed
without stopping or restarting an existing Tide-Bot service. Cypress evidence
must separately name its loopback origin, randomized supported-auth account
flow, fixed fixture model ID, fake-model health/dependency result, the one
intercepted Tide-Bot completion-proxy request, slow-stream first-delta/Stop/
observed-abort result, zero final completion, no duplicate proxy request, the
exact type-prompt/toggle-Web-Search/dialog/deny/zero-completion confirmation
result, and safe
teardown. It must confirm no fixture emitted secrets and that the fixture was
removed with the isolated stack; it is not a cross-client sync claim. A
structural package check or single-worker/fake-Redis pytest does not replace
either gate.
Final release evidence additionally requires the resolved non-secret desktop
origin, generated capability and separate provenance JSON SHA-256s,
generation nonce, parsed capability-test and
`companion_url_test` result proving the actual Webview URL is the generated
approved origin plus `/companion`, plus installed Windows artifact proof that
the compile-time embedded capability/provenance/nonce binding was used,
green GitHub Windows artifact build, and completed manual Windows procedure;
neither is replaced by the local macOS debug bundle. The unprovisioned real
production origin remains external/pending rather than being invented.

- [ ] **Step 5: Commit acceptance documentation**

~~~
git add src/lib/components/ted-bot/CompanionPanel.svelte src/lib/ted-bot/openMainWindow.ts src/lib/ted-bot/openMainWindow.test.ts .github/workflows/ted-bot-windows.yml docs/TIDE_BOT_HANDOFF.md docs/IMPLEMENTATION_PLAN.md docs/superpowers/2026-07-24-ted-bot-native-companion-acceptance.md docs/superpowers/evidence/2026-07-24-ted-bot-native-companion/ desktop/tide-bot/README.md
git commit -m 'docs: record ted-bot companion acceptance'
~~~

## Plan self-review

- The tasks cover the approved native architecture, typed current-chat behavior, session lifecycle, security, accessibility, and both-platform acceptance.
- Push-to-talk, read-aloud, browser Picture-in-Picture, autonomous actions, and a standalone Ted-Bot service are excluded.
- Presence supplies active-chat state, the canonical Chat surface supplies typed chat, and Tauri supplies the only native main-window command.
