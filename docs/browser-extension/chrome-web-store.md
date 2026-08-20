# Chrome Web Store release checklist

This repository produces a deterministic, Web Store-ready ZIP. Publishing is an owner-authorized external action that requires the repository owner's Chrome Web Store developer account, listing, policy declarations, and final approval. No automatic Chrome Web Store submission occurs.

## Build and verify

- [ ] Check out the exact reviewed commit on a clean machine.
- [ ] Use Node 22.18.0 and npm 10.9.3.
- [ ] Run `npm ci` from the lockfile.
- [ ] Run `npm run test:browser-extension:unit`.
- [ ] Run the focused backend browser-extension tests.
- [ ] Run `node --test scripts/build-browser-extension.test.mjs scripts/run-browser-extension-playwright.test.mjs`.
- [ ] Install Playwright Chromium and run `npm run test:browser-extension:e2e`.
- [ ] Run `node_modules/.bin/svelte-check --tsconfig browser-extension/tsconfig.json`.
- [ ] Run `npm run audit:branding`.
- [ ] Run `npm run build:browser-extension`.
- [ ] Verify `backend/open_webui/static/browser-extension/tide-bot-browser-extension.zip` with `unzip -t`.
- [ ] Compare the ZIP SHA-256 with `tide-bot-browser-extension.sha256`.
- [ ] Confirm `manifest.json` is at the archive root and the archive has no source maps, test endpoints, environment files, credentials, or remotely hosted code.

GitHub Actions runs the same release gates and uploads the ZIP plus checksum as a workflow artifact. It deliberately does not publish the artifact to the Chrome Web Store.

## Manifest and policy review

- [ ] Confirm the version in `browser-extension/manifest.json` is higher than the last submitted version.
- [ ] Reconcile every manifest permission with the explanations in [security.md](security.md).
- [ ] Remove any permission whose implementation is absent from the submitted version.
- [ ] Confirm the single purpose is: provide a Tide-Bot side-panel chat that can securely inspect and control one user-selected browser tab.
- [ ] Confirm the extension CSP permits only bundled code and no remotely hosted executable code.
- [ ] Confirm the production build contains only `https://tide-bot.com` as its Tide-Bot server origin.
- [ ] Verify the signed-in download remains behind `/api/v1/browser-extension/download`, not a public static URL.
- [ ] Review the privacy disclosure against the exact submitted build and the operator's real model and speech providers.

## Extension identity

The repository build pins a public `key` in `browser-extension/manifest.json` so
every **Load unpacked** install shares one extension id, and the server allows
session-based pairing only from that id (`BROWSER_EXTENSION_ID` in
`backend/open_webui/routers/browser_extension.py`).

The Chrome Web Store assigns its own item id instead. A store release therefore
changes the id, and one-click pairing silently degrades to the device-code flow
until the server constant is updated to match.

- [ ] Remove the `key` field before uploading to the Web Store.
- [ ] Record the store-assigned extension id from the developer dashboard.
- [ ] Update `BROWSER_EXTENSION_ID` to that id and redeploy before announcing the listing.
- [ ] Re-verify that pairing completes without opening the verification tab.

## Store listing assets

- [ ] Product name: **Tide-Bot Browser Control**.
- [ ] Short description accurately states secure, single-tab control for Tide-Bot.
- [ ] Use the packaged 128 px icon and prepare required listing images from the current on-brand UI.
- [ ] Provide screenshots of pairing, text chat, hands-free voice, an approval card, and workflow management without personal or sensitive data.
- [ ] Host the current privacy notice at a stable HTTPS URL and enter that URL in the listing.
- [ ] Provide support and contact URLs controlled by Changing Tides Treatment Center.
- [ ] Do not claim HIPAA certification, Chrome endorsement, or capabilities the submitted build does not provide.

## Chrome Web Store data-use answers

- [ ] Disclose website content only to the extent required for user-requested semantic observation and action.
- [ ] Disclose authentication information for the opaque paired-device credential; explain that passwords are not collected.
- [ ] Disclose user communications because normal Tide-Bot chat text is stored in the user's Tide-Bot account.
- [ ] Disclose audio only for user-initiated voice mode and state that microphone blobs remain ephemeral.
- [ ] State that data is not sold, not used for advertising, and not transferred to an unrelated browser-agent service.
- [ ] List the operator-configured Tide-Bot model and speech processors in the operator's hosted privacy policy when applicable.
- [ ] Ensure retention answers match the table in [security.md](security.md).

## Reviewer instructions

- [ ] Provide a dedicated permitted test account and a reachable Tide-Bot review environment if Chrome review requires sign-in.
- [ ] Explain the pairing code and approval flow.
- [ ] Explain that text is the initial default and hands-free is the voice default.
- [ ] Demonstrate Autonomous, Consequential approval, and Manual approval modes.
- [ ] Demonstrate that a download and Delete account test action pause for approval even in Autonomous mode.
- [ ] Demonstrate the one controlled tab at a time limit and immediate Stop control.
- [ ] Explain why Chrome must be open for schedules.
- [ ] Provide steps to Revoke the reviewer device after review.

## Owner submission

1. Sign in to the owner's Chrome Web Store Developer Dashboard.
2. Create or update the listing and upload the verified ZIP without repacking it.
3. Complete privacy, permissions, single-purpose, and remote-code declarations from the reviewed documentation.
4. Add listing assets, reviewer instructions, test access, support details, and the hosted privacy-policy URL.
5. Save a copy of the submitted version, checksum, commit SHA, declarations, and listing text in the release record.
6. Submit for review, respond to reviewer questions, and record the resulting listing URL and version after approval.

Store approval is not required for the authenticated ZIP download and manual **Load unpacked** installation, but those distribution methods must use the same reviewed package.
