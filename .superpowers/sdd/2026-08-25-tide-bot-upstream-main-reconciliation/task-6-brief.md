## Task 6: Integrate current Open WebUI main without losing Tide-Bot behavior

### Scope

- Fetch the official Open WebUI remote and verify `v0.11.1` resolves to
  `d3e8bf3405e848cfba377814d0aa7ba7290e414d` and is ancestral to the fetched
  `upstream/main` candidate.
- Create a genuine explicit merge commit whose first parent is the reviewed
  Tide-Bot branch and whose second parent is the exact fetched upstream SHA.
- Resolve every conflict deliberately and add focused regression coverage for
  custom Tide-Bot boundaries affected by the merge.
- Reconcile the Alembic graph to one head so a database at either pre-merge
  branch can safely upgrade to the integrated schema.
- Update `docs/UPSTREAM.md`, `docs/UPSTREAM_SYNC.md`, and the Task 6 report with
  provenance, resolutions, and verification evidence.

### Constraints

- Preserve Tide-Bot branding and the branding audit.
- Preserve ChatGPT subscription device OAuth, encrypted credential storage,
  status and refresh, model discovery, Responses streaming, and the safe probe.
- Preserve ElevenLabs `CallOverlay` voice plus the STT/chat/TTS fallback.
- Preserve companion presence, compact chat, desktop origin restrictions,
  browser-extension pairing/authorization, and static extension delivery.
- Preserve external production volumes, localhost-only binding, disabled
  public signup, no telemetry, and no public terminal or CPTR exposure.
- Do not inherit unapproved upstream GitHub workflows or promotional sharing.
- Use Node 22.18.0 and Python 3.11–3.12 for acceptance evidence.
- Do not push, open or merge a pull request, modify canonical/origin `main`,
  move `tide-bot-deployable`, deploy, or access live resources.

### Acceptance

- `v0.11.1` and the fetched upstream SHA are recorded and verified.
- The explicit merge has Tide-Bot as first parent and exact upstream as second.
- Alembic exposes exactly one head, and a SQLite database upgraded to the
  custom pre-merge head can then upgrade to the integrated head with the new
  v0.11.1 schema columns and Tide browser-rotation columns intact.
- `.github/workflows` contains only the four approved Tide-Bot workflows, with
  a validator that rejects unapproved workflow introduction.
- Focused companion, voice, OAuth, Responses, migration, workflow, branding,
  production-build, deployment-safeguard, and whitespace checks pass, subject
  only to explicitly recorded environment limitations for disposable smoke.
- The task report contains RED/GREEN evidence and the final commits and status.
