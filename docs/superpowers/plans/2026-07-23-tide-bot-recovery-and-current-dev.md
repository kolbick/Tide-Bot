# Tide-Bot Recovery and Current Dev Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the companion-first detour without touching user assets, then establish Tide-Bot on the current official Open WebUI `dev` commit.

**Architecture:** Preserve the current local state under a named backup reference, reset only the active branch to the published Tide-Bot baseline, retain the approved recovery specification through a clean cherry-pick, and merge `upstream/dev` as a reviewable Tide-Bot merge. No companion, pet, desktop, or connected-stack code remains on the active branch after the reset. The next plan will build the Tide-Bot brand layer on that clean current-dev base.

**Tech Stack:** Git, Open WebUI upstream `dev`, Node 22.18.0, npm 10.9.3, Docker Compose.

## Global Constraints

- Do not push to `origin` or `upstream`.
- Preserve `AGENTS.md`, `tide-bot-pet/`, `teddy-v2-upgrade/`, and `/Users/kolbyunderwood/Desktop/Teddy-desktop-pet.zip` exactly as user-owned assets.
- Never run `git clean`, delete Docker volumes, or touch the unrelated `cptr` container.
- Stop only the wrong Tide-Bot Compose containers before changing the active source branch.
- Keep Open WebUI license files and history; merge `upstream/dev` at `ca11bd90a7a23106f4267fdb79fee4b80af0ee9d`.
- Use Node `v22.18.0` and npm `10.9.3`; never use the installed Node 25 runtime.
- Treat a red repository-wide `npm run check` as a baseline to measure, not an error to hide.

---

### Task 1: Preserve the detour and user-owned state

**Files:**
- Preserve: `AGENTS.md`
- Preserve: `tide-bot-pet/`
- Preserve: `teddy-v2-upgrade/`
- Preserve: `/Users/kolbyunderwood/Desktop/Teddy-desktop-pet.zip`
- Create Git ref: `backup/pre-tide-bot-product-recovery-2026-07-23`

**Interfaces:**
- Consumes: `origin/main`, current `HEAD`, and the explicitly allowed untracked asset paths.
- Produces: a recoverable Git reference at the exact pre-reset commit and stopped Tide-Bot containers with their named volumes intact.

- [ ] **Step 1: Assert the only untracked project paths are user-owned assets**

Run:

```bash
git status --short
test -f AGENTS.md
test -f tide-bot-pet/pet.json
test -f tide-bot-pet/spritesheet.webp
test -d teddy-v2-upgrade
test -f /Users/kolbyunderwood/Desktop/Teddy-desktop-pet.zip
```

Expected: the status output lists only `AGENTS.md`, `tide-bot-pet/`, and `teddy-v2-upgrade/` as untracked paths. Stop if any tracked modification or other untracked path appears.

- [ ] **Step 2: Record the exact detour range before changing refs**

Run:

```bash
git log --reverse --format='%H %s' origin/main..HEAD
git rev-parse HEAD
git rev-parse origin/main
```

Expected: the range begins with `b678375e8` and ends with the current recovery-plan commit; `origin/main` remains `25e124602`.

- [ ] **Step 3: Create a local backup reference**

Run:

```bash
git branch backup/pre-tide-bot-product-recovery-2026-07-23 HEAD
git show -s --format='%H%n%s' backup/pre-tide-bot-product-recovery-2026-07-23
```

Expected: the branch points to the current `HEAD`. It is a local rollback reference only and is never pushed.

- [ ] **Step 4: Stop only Tide-Bot stack containers without deleting data**

Run:

```bash
docker compose -f deploy/tide-stack/docker-compose.yml -f deploy/tide-stack/docker-compose.terminal.yml -f deploy/tide-stack/docker-compose.cptr.yml stop
docker ps --format '{{.Names}}	{{.Status}}'
```

Expected: `tide-bot-tide-bot-1`, `tide-bot-tide-terminal-1`, and `tide-bot-tide-cptr-gateway-1` are stopped or absent; the unrelated `cptr` container is not stopped; no volume is removed.

- [ ] **Step 5: Commit**

No commit is created for a local safety branch or stopped containers. Confirm the backup reference is present before continuing to Task 2.

### Task 2: Remove the companion-first detour from the active branch

**Files:**
- Remove from active branch: every tracked change in `b678375e8..a48880d7c`
- Retain on active branch: `docs/superpowers/specs/2026-07-23-tide-bot-product-recovery-design.md`
- Retain on active branch: `docs/superpowers/plans/2026-07-23-tide-bot-recovery-and-current-dev.md`

**Interfaces:**
- Consumes: the backup branch from Task 1 and published `origin/main`.
- Produces: an active branch equal to `origin/main` plus the approved recovery design, with all companion, pet renderer, Tauri, and detour Compose code absent from tracked source.

- [ ] **Step 1: Reset only tracked active-branch content to `origin/main`**

Run:

```bash
git reset --hard origin/main
git status --short
```

Expected: tracked files exactly match `origin/main`; the three user-owned untracked asset paths remain present. `git reset --hard` must not be followed by `git clean`.

- [ ] **Step 2: Restore the approved recovery specification only**

Run:

```bash
git cherry-pick 2e3e6a8be
git checkout backup/pre-tide-bot-product-recovery-2026-07-23 -- docs/superpowers/plans/2026-07-23-tide-bot-recovery-and-current-dev.md
git add docs/superpowers/plans/2026-07-23-tide-bot-recovery-and-current-dev.md
git commit -m 'docs: retain tide-bot recovery plan'
git show --stat --oneline HEAD
```

Expected: two clean documentation commits recreate the approved recovery design and this execution plan only.

- [ ] **Step 3: Prove companion and desktop code are absent from the active branch**

Run:

```bash
test ! -e src/lib/components/companion
test ! -e src/lib/components/pet
test ! -e desktop/tide-companion
test ! -e static/pets/tide-bot
test ! -e deploy/tide-stack/docker-compose.terminal.yml
test ! -e deploy/tide-stack/docker-compose.cptr.yml
! git log --oneline origin/main..HEAD | rg 'companion|pet|desktop|connected tide stack'
```

Expected: every `test !` succeeds and the final `rg` has no output. The recovery design and execution plan are intentionally the only local commits above `origin/main` at this point.

- [ ] **Step 4: Commit**

The cherry-pick and plan-retention commit in Step 2 are the commits for this task. Do not create a duplicate cleanup commit because the active branch no longer contains the detour content.

### Task 3: Merge current official Open WebUI dev

**Files:**
- Modify: `docs/UPSTREAM.md`
- Modify: `README.md` only if the merge updates upstream content; preserve Tide-Bot product framing and required upstream attribution.
- Modify: `docs/UPSTREAM_SYNC.md` to record the exact reviewed dev commit for this recovery merge while retaining its release-pin procedure for future production updates.

**Interfaces:**
- Consumes: active branch from Task 2 and `upstream/dev` at `ca11bd90a7a23106f4267fdb79fee4b80af0ee9d`.
- Produces: a non-fast-forward Tide-Bot merge whose first parent is the recovered product branch and whose second parent is current Open WebUI dev.

- [ ] **Step 1: Verify the official upstream ref before merging**

Run:

```bash
git fetch upstream dev --tags --prune
test "$(git rev-parse upstream/dev)" = ca11bd90a7a23106f4267fdb79fee4b80af0ee9d
git show -s --format='%H%n%cI%n%s' upstream/dev
```

Expected: the ref is exactly `ca11bd90a7a23106f4267fdb79fee4b80af0ee9d`. If it moved, stop and record the new ref for renewed review instead of silently merging a different commit.

- [ ] **Step 2: Create a no-commit merge for review**

Run:

```bash
git merge --no-ff --no-commit upstream/dev
git status --short
git diff --name-only --diff-filter=U
```

Expected: either a clean staged merge or conflicts limited to Tide-Bot root documentation. When `README.md` conflicts, retain Tide-Bot's product definition, its upstream attribution, and the current imported commit record; do not accept the upstream marketing README as the product guide.

- [ ] **Step 3: Record the current-dev merge in Tide-Bot documentation**

Add this recovery entry to `docs/UPSTREAM.md`:

```markdown
## 2026-07-23 current-dev recovery merge

| Item | Value |
| --- | --- |
| Upstream branch | `dev` |
| Reviewed commit | `ca11bd90a7a23106f4267fdb79fee4b80af0ee9d` |
| Commit date | 2026-07-23 |
| Reason | Replace the stale July 17 bootstrap with the current development baseline before Tide-Bot branding. |
```

Add this sentence to `docs/UPSTREAM_SYNC.md` after the production-tag rule:

```markdown
The 2026-07-23 recovery merge intentionally uses the reviewed current `dev`
commit above; later production syncs return to explicit release tags.
```

- [ ] **Step 4: Commit the upstream merge**

Run:

```bash
git add README.md docs/UPSTREAM.md docs/UPSTREAM_SYNC.md
git commit -m 'chore: sync Open WebUI dev ca11bd90'
git show --no-patch --format='%P%n%s' HEAD
```

Expected: the merge commit has two parents and a subject containing the exact eight-character upstream revision.

### Task 4: Verify the recovered current-dev foundation

**Files:**
- Verify: all tracked source and documentation
- Create: `docs/superpowers/2026-07-23-current-dev-recovery-baseline.md`

**Interfaces:**
- Consumes: the merge commit from Task 3.
- Produces: evidence that future Tide-Bot branding starts from current upstream code without the companion detour.

- [ ] **Step 1: Verify graph and removal boundary**

Run:

```bash
git log --graph --oneline --decorate -12
git merge-base --is-ancestor ca11bd90a7a23106f4267fdb79fee4b80af0ee9d HEAD
test ! -e src/lib/components/companion
test ! -e desktop/tide-companion
git status --short
```

Expected: current `upstream/dev` is an ancestor of `HEAD`; companion and desktop paths are absent; only the three preserved user-owned paths are untracked.

- [ ] **Step 2: Run source and configuration gates with the supported Node runtime**

Run:

```bash
npx -y -p node@22.18.0 -p npm@10.9.3 npm ci
npx -y -p node@22.18.0 -p npm@10.9.3 npm run test:frontend -- --run
npx -y -p node@22.18.0 -p npm@10.9.3 npm run build
npx -y -p node@22.18.0 -p npm@10.9.3 npm run check
```

Expected: frontend tests and production build pass. Record the exact repository-wide check error and warning counts as the new current-dev baseline; do not alter source merely to hide pre-existing diagnostics.

- [ ] **Step 3: Check recovered Docker source and working tree**

Run:

```bash
docker compose -f deploy/tide-stack/docker-compose.yml config --quiet
git diff --check
git status --short
```

Expected: the base Compose configuration parses, the diff check is clean, and no user asset is staged or modified.

- [ ] **Step 4: Commit verification record**

Create `docs/superpowers/2026-07-23-current-dev-recovery-baseline.md` with the commands above, tool versions, pass/fail status, exact diagnostics counts, and the explicit note that runtime Docker acceptance is deferred until the branded stack plan. Commit it with:

```bash
git add docs/superpowers/2026-07-23-current-dev-recovery-baseline.md
git commit -m 'docs: record current-dev recovery baseline'
```

## Self-review

- Spec coverage: Tasks 1 and 2 remove the entire identified detour while preserving user assets; Task 3 establishes the requested newest dev base; Task 4 proves the clean foundation before visual branding begins.
- Placeholder scan: the plan contains no unresolved implementation markers.
- Interface consistency: every later task consumes the exact branch state or commit produced by the preceding task; the upstream SHA is the same in all commands and documentation.
