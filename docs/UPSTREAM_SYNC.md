# Tide-Bot upstream sync procedure

Tide-Bot tracks the official Open WebUI repository through the read-only
`upstream` remote. Do not push to `upstream` and do not merge a moving branch
without recording its exact reviewed commit.

## Prepare

```bash
git status --short
git remote get-url upstream
git fetch --no-tags upstream main
git fetch upstream refs/tags/v0.11.1:refs/tags/v0.11.1
git rev-parse upstream/main^{commit}
git rev-parse refs/tags/v0.11.1^{commit}
git merge-base --is-ancestor refs/tags/v0.11.1^{commit} upstream/main
```

The expected remote is `https://github.com/open-webui/open-webui.git`. Preserve
or commit Tide-Bot work before starting a sync. Never use `git clean` to make
the tree appear clean. For the 2026-08-25 integration, both the official
`v0.11.1` tag and `upstream/main` resolved to
`d3e8bf3405e848cfba377814d0aa7ba7290e414d`; stop without merging if the tag
does not resolve exactly or is not ancestral to the fetched candidate.

## Automated main tracking

The hourly `Tide-Bot upstream main` workflow is the only automated path for
moving `main` from Open WebUI's moving `main` branch. It fetches and verifies
the binding `v0.11.1` baseline (`d3e8bf3`) as an ancestor of the candidate
before merging. It creates a review branch, runs the common update gate, and
uses the protected GitHub pull-request merge path. Conflicts and gate failures
create a sanitized issue; they never change `main`, deployment state, or the
deployable marker.

The common gate uses Node 22.18.x, focused companion/voice frontend checks,
ChatGPT subscription and Responses streaming backend tests, the branding
audit, production build, disposable isolated smoke, and `git diff --check`.
It deliberately does not treat the inherited global `npm run check` diagnostic
baseline as an all-clear signal. The `tide-bot-deployable` marker is annotated
and moves only after the same gate passes on an eligible `main` commit. The
production updater independently rejects a marker commit that is not ancestral
to `origin/main`.

## Select and review

Production syncs use an explicit upstream release tag. The 2026-07-23 recovery
is the documented exception: it merges reviewed `dev` commit
`e64acf1c0a532c7a87c5f6666cb88ba02f8fe237` before Tide-Bot branding begins.

```bash
git tag --list 'v*' --sort=-version:refname | head -20
git show --no-patch --format=fuller <tag>
git log --oneline <previous-upstream-sha>..<tag>
git diff --stat <previous-upstream-sha>..<tag>
```

Review authentication, authorization, database migrations, chat and Socket.IO
behavior, Docker/runtime settings, dependencies, license changes, static/PWA
assets, localization, and every user-visible upstream brand surface.

## Merge

Create a local backup reference before merging. Merge without committing,
preserve Tide-Bot security and branding decisions, then record the chosen tag
or SHA in `docs/UPSTREAM.md`. The completed integration must be an explicit
merge commit: first parent is the reviewed Tide-Bot branch and second parent is
the exact fetched upstream commit.

```bash
git branch backup/pre-open-webui-sync-<revision> HEAD
git merge --no-ff --no-commit <exact-upstream-sha>
git diff --check
git commit -m 'chore: integrate Open WebUI main <sha12>'
```

Do not inherit upstream workflows, telemetry, public-signup defaults, public
terminal or CPTR exposure, or upstream promotional material without an
explicit Tide-Bot review. Resolve each conflict deliberately. In particular,
retain Tide-Bot branding and its audit; ChatGPT subscription device OAuth,
encrypted persistence, refresh, model discovery, Responses streaming, and safe
probe; the ElevenLabs `CallOverlay` plus STT/chat/TTS fallback; companion and
desktop origin restrictions; browser-extension pairing and authorization; and
the local-only external-volume production overlay.

## Verify and roll back

Use Node 22.18.0 and npm 10.9.3 for frontend verification. Run the relevant
tests, production build, Tide-Bot branding audit, and Docker acceptance before
deployment. Keep the prior image and a tested data backup. If a merged sync
must be reverted, create a rollback branch and revert the merge commit with
the correct mainline parent instead of rewriting shared history.
