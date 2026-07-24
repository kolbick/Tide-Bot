# Repository Guidelines

## Project Structure & Module Organization

Tide-Bot is a fork of Open WebUI. The SvelteKit frontend lives in `src/`, with pages in `src/routes` and shared UI, APIs, stores, and utilities in `src/lib`. Browser assets belong in `static/`. The FastAPI backend is under `backend/open_webui`; deployment files are at the root and in `deploy/tide-stack/`. Architecture and implementation notes live in `docs/`. Keep tests near covered code as `*.test.ts` or `test_*.py`.

## Build, Test, and Development Commands

- Use Node `v22.18.0` and npm `10.9.3` for Tide-Bot verification. The
  repository allows Node 18.13 through 22, but the current recovery and
  branding baseline was recorded with Node 22.18.0.
- `npm ci`: install locked frontend dependencies.
- `npm run dev`: fetch Pyodide and start Vite on the local network.
- `npm run build`: create the production frontend bundle.
- `npm run check`: run Svelte and TypeScript diagnostics.
- `npm run test:frontend -- --run`: run the frontend Vitest suite once.
- `npm run audit:branding`: check required Tide-Bot assets and protected
  user-facing product surfaces.
- `npm run lint`: run ESLint, type checks, and backend Pylint.
- `npm run format` and `npm run format:backend`: apply Prettier and Ruff.
- `cd backend && sh dev.sh`: start FastAPI with reload on port 8080.
- `cd deploy/tide-stack && docker compose up -d --build`: launch the connected stack.

`npm run check` has a large inherited upstream diagnostic baseline. For
Tide-Bot changes, run changed-path diagnostics, focused tests, the branding
audit, a production build, and `git diff --check`; report the global result
without presenting inherited errors as a new regression. Do not use `uv run`
for focused Python presence tests because it rewrites `uv.lock`; use an
existing environment or a temporary virtual environment instead.

## Coding Style & Naming Conventions

Prettier governs web files: use tabs, single quotes, no trailing commas, LF endings, and a 100-character width. Python uses Ruff, single quotes, and 120-character lines. Name Svelte components in `PascalCase`, TypeScript utilities in `camelCase`, and Python functions/modules in `snake_case`. Follow SvelteKit names such as `+page.svelte`.

## Testing Guidelines

Use `src/lib/shortcuts.test.ts` as the Vitest pattern. Add focused regression tests with behavior-oriented descriptions. Python tests use Pytest and `pytest-asyncio`; run focused tests from an existing or temporary environment so verification does not rewrite `uv.lock`. No coverage threshold is configured, so cover changed paths and critical authentication, authorization, and deployment flows. Before review, run checks, relevant tests, and a production build.

## Commit & Pull Request Guidelines

Recent commits use short, imperative Conventional Commit subjects, such as `deploy: add CPTR approval gateway`. Use `feat:`, `fix:`, `docs:`, `test:`, `chore:`, or another precise area prefix, and keep commits atomic. Pull requests should explain motivation and impact, link related work, list verification, document configuration changes, and include screenshots for UI changes. Preserve the PR template's CLA checklist.

## Security & Configuration

Copy settings from the provided `.env.example` files. Never commit secrets, databases, or user data. Treat CPTR and shared terminal access as privileged, and preserve upstream license and attribution files.
