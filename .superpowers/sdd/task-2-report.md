# Task 2 report

## Summary

- Added the reusable `TedBotPet` renderer and replaced the decorative mascot body with it.
- Added a tracked Codex v2 pet manifest and Node-only structural package validator.
- Added Node-only release-evidence transaction tooling with private pending runs,
  sealed reviewer submissions, complete Hatch-output contracts, an atomic outer
  publish step, and a sealed human inspection record.

## Commit

- `eb2eb85ae feat(ted-bot): add native pet renderer and validation`
- `fc97667ae fix(ted-bot): seal reviewer evidence before combining`
- `1ba1cdaf7 test(ted-bot): verify sealed evidence flow`
- Final hardening commit pending independent review.

## Checks

- `npx -y -p node@22.18.0 node --test scripts/validate-ted-bot-pet.test.mjs scripts/verify-ted-bot-direction-evidence.test.mjs` passed: 17 tests.
- `npx -y -p node@22.18.0 node scripts/validate-ted-bot-pet.mjs` passed.
- `npx -y -p node@22.18.0 -p npm@10.9.3 npm exec -- vitest run src/lib/components/ted-bot/TedBotPet.test.ts` passed.
- `npx -y -p node@22.18.0 -p npm@10.9.3 npm run test:frontend -- --run` passed.
- `npx -y -p node@22.18.0 -p npm@10.9.3 npm run audit:branding` passed.
- `npx -y -p node@22.18.0 -p npm@10.9.3 npm run build` passed.

## Pending external gate

Live Hatch Pet v2 validation, contact/direction sheet generation, independent
blind/semantic reviews, and the resulting sealed inspection record remain
pending. They require the bundled workspace Python runtime and independent
reviewer artifacts; this task intentionally did not substitute a system Python
or create acceptance evidence.

## Follow-up review fix

- Added a private, atomic reviewer sealing operation. The combine operation now discovers and verifies exactly three sealed submissions and receipts, never consumes mutable external reviewer paths.
- Strengthened outer publish checks for complete Hatch atlas/continuity/blind contracts, PNG visual sheets, the full blind-key/cardinal schema, diagonal landmark evidence, blind run linkage, and a SHA-bound human inspection record before the final atomic rename.
- Kept the DOM-only Svelte test resolution local to Vitest and removed the application-wide browser resolve condition.

### Sealing CLI sequence

After reviewers submit their three inbox JSON files, invoke `seal-reviewer-submission` once for each file with the same blind run ID and runs root. Only then invoke `verify-and-combine`; it no longer accepts `--verdict` inputs, so Hatch receives only sealed private copies.
