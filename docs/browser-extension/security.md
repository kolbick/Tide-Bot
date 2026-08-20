# Tide-Bot Browser Control security

## Security boundary

Tide-Bot authorizes the user, models, chat, devices, workflows, schedules, and server-side browser tool calls. The Chrome extension is a paired, single-tab executor. Both sides enforce identity, origin, session, command schema, deadlines, sequence, and size limits. The extension applies the selected action policy locally, so a model or server response cannot bypass an approval prompt.

Pairing grants are short lived and single use. Tide-Bot stores keyed hashes of refresh credentials; the extension stores one opaque device credential in `chrome.storage.local`. Access tokens are short lived and memory only. Refresh credentials rotate, and reuse of an already rotated credential triggers replay detection and revocation.

Pairing has two paths that end in the same scoped, revocable device credential. When the browser already holds a signed-in Tide-Bot session, the packaged extension claims a device directly from that session, so no verification tab is needed; the session authorizes that one request and is never stored by the extension. Only the pinned extension origin may claim, which is what stops another installed extension from minting a device against the same session. Anything else — a session that is not signed in, or a build whose origin does not match — falls back to the device-code flow, where approval happens on a Tide-Bot page the user can see.

The runtime accepts a fixed allowlist of browser commands. DOM actions use semantic handles or bounded accessible targets, not raw CSS selectors from the model. Debugger access is limited to `Page.enable`, `Runtime.enable`, `Network.enable`, and `Page.captureScreenshot`. `Runtime.evaluate` and arbitrary Chrome DevTools Protocol methods are denied.

## Chrome permission explanations

The manifest requests broad website access because Tide-Bot is meant to work on ordinary HTTP and HTTPS sites without a category block. Runtime controls then narrow that access to one explicitly started session and one controlled tab at a time.

| Permission      | Why it is required                                                                                                                           | Runtime limit                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `activeTab`     | Identifies the tab selected when the user starts a browser session.                                                                          | A session cannot start on Chrome-protected or non-HTTP(S) pages.                                   |
| `alarms`        | Wakes reconnect and heartbeat work and runs user-created schedules.                                                                          | Alarms are device scoped; Chrome must be open.                                                     |
| `debugger`      | Captures screenshots and sanitized console and network metadata through a small DevTools allowlist.                                          | It attaches lazily to the controlled tab, forbids evaluation, and detaches when the session stops. |
| `downloads`     | Starts an HTTP(S) download requested through a validated browser action.                                                                     | Every download requires approval, the URL is validated, and filenames are sanitized.               |
| `notifications` | Reports completion or interruption of an extension-owned download.                                                                           | Notifications contain a generic status and no page or credential data.                             |
| `sidePanel`     | Hosts the Tide-Bot chat and approval interface beside the current webpage.                                                                   | The panel is packaged with the extension and has a restrictive extension CSP.                      |
| `storage`       | Persists the paired device credential and non-secret extension preferences.                                                                  | Access tokens, audio, screenshots, and page observations are never written there.                  |
| `tabs`          | Opens the pairing approval page, reads the active tab identity, locks one tab, and performs validated navigation, back, forward, and reload. | No multi-tab orchestration occurs.                                                                 |
| `<all_urls>`    | Loads the packaged semantic content script on user-selected HTTP(S) pages and permits the paired Tide-Bot origin.                            | Chrome-protected schemes remain unavailable; the session policy permits only one tab.              |

Chrome Web Store review should revalidate that every declared permission is exercised by the submitted version. Remove a permission before release if its implementation is not present in that version.

## Data retention

| Data class                                                                            | Persists where                                                | Retention / deletion                                                                                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device ID, label, allowed origin, token-family state, last seen, and revocation state | Tide-Bot database                                             | Until the device is revoked or application data is removed under operator policy.                                                                   |
| Opaque device refresh credential                                                      | `chrome.storage.local`; only a keyed hash is held by Tide-Bot | Rotated on refresh; removed on sign-out or failed identity validation; invalid after revocation.                                                    |
| Short-lived access token and pending pairing verifier                                 | Extension service-worker memory                               | Lost on worker shutdown or expiry; never stored in extension storage.                                                                               |
| Normal chat text and selected model                                                   | Tide-Bot chat history                                         | Follows the user's normal Tide-Bot chat deletion and retention policy.                                                                              |
| Encrypted workflow definition and schedule metadata                                   | Tide-Bot database                                             | Until the owner deletes it; workflow definitions use AES-GCM with authenticated ownership and version data.                                         |
| Sanitized browser action audit                                                        | Tide-Bot audit/chat metadata                                  | Follows the operator's Tide-Bot retention policy; no raw page snapshot or typed value is included.                                                  |
| DOM snapshot, visible text, screenshot bytes, console summaries, and network metadata | Memory for the current command/model turn                     | Ephemeral; bounded, redacted, and discarded after the turn.                                                                                         |
| Microphone audio and synthesized speech blobs                                         | Side-panel memory and the configured Tide-Bot audio request   | Ephemeral; never written to extension storage, workflow definitions, or chat history.                                                               |
| Typed field value                                                                     | Controlled webpage                                            | Never returned to the server in the action result and never recorded in workflows; the page itself may retain it according to that site's behavior. |
| Downloaded file and Chrome download history                                           | User-selected Chrome environment                              | Controlled by Chrome and the user, not retained by the extension database.                                                                          |

The extension does not sell data, use it for advertising, or share it with an independent browser-agent service. Model inference and speech use the services configured by the Tide-Bot operator. Operators remain responsible for their own deployment, provider, retention, access, and regulatory configuration.

## Origin and authorization policy

The production build embeds `https://tide-bot.com`. Pairing, token refresh, socket join, and command routing all compare the approved origin. Credentials in URLs, paths, queries, fragments, insecure production custom origins, and origin changes are rejected.

The extension's own identity is pinned too. `manifest.json` carries a fixed public `key`, so Chrome derives the same extension id for every install, and the server allows session claiming only from that `chrome-extension://` origin. The manifest key is a public key: it fixes the id and is not a signing secret. Changing it changes the extension id, which invalidates claiming until the server allowlist is updated to match.

The administrator setting for custom origins is locked by default, and custom origins are admin-only. When unlocked in production, a custom server must use HTTPS. Development and test builds may use loopback HTTP. Existing devices are checked against the current origin policy whenever they refresh.

Feature access follows Tide-Bot's effective user/group permission. Removing permission, deactivating an account, revoking a device, detecting rotated-token reuse, or changing the permitted origin prevents the browser from reconnecting.

## Action policy

- **Autonomous** permits ordinary supported mutations, but always asks for downloads, delete-like or payment-like actions, secret fields, and prompt-injection risk.
- **Consequential approval** pauses consequential actions and cross-origin navigation while ordinary actions proceed.
- **Manual approval** pauses every mutating command; read-only observation stays automatic.

Approval summaries contain the action and semantic target, not a typed secret. Denial produces a bounded error. Closing the session cancels pending approvals, clears page signals, and detaches debugger access.

## Incident recovery

Treat an unexpected pairing, repeated approval prompt, unexplained action, or token warning as a possible incident. Stop the session first, then use the matching recovery path.

### Lost device

Sign in from another trusted browser, open **Settings > Browser Control**, and select **Revoke** twice for the lost device. Delete its workflows or reassign schedules if needed. Change the Tide-Bot account credential and review account access when loss may include an active signed-in session.

### Replay detection

Reuse of an already rotated refresh credential revokes the token family. Do not try to restore the old extension storage. Revoke the listed device, inspect server access logs and device activity, remove the extension profile if it may be copied, then pair a clean browser again.

### Origin mismatch

Do not disable origin checks. Confirm that the installed package came from the expected Tide-Bot server. An administrator should verify the configured default origin and custom-origin setting, revoke the mismatched device, rebuild a production package if the server moved, and pair again.

### Offline model or server

An offline model produces a Tide-Bot chat error and does not authorize a fallback provider. Restore the local model/runtime on the Tide-Bot server, confirm `/api/models` works for the user, and retry. If the whole server is offline, restore HTTPS and Socket.IO reachability before selecting **Reconnect**.

### Worker suspension

Manifest V3 service workers may stop when idle. Chrome alarms restore heartbeat, reconnect, and due-schedule work. Reopen the side panel and select **Reconnect** if status remains Offline. Confirm Chrome is open for schedules; the extension cannot execute while Chrome is fully closed.

### Revoked browser access

A revoked browser access token cannot refresh or join the device room. The extension returns to pairing state. Confirm the revocation was intended and that user/group permission is still enabled before pairing a replacement. Never reactivate a copied credential.

## Reporting and containment

Preserve only sanitized server logs, device identifiers, timestamps, workflow IDs, schedule IDs, and audit outcomes needed for investigation. Do not add raw page content, screenshots, audio, refresh credentials, access tokens, verifier values, authorization headers, or typed secrets to tickets or logs. Rotate `WEBUI_SECRET_KEY` only as a planned whole-deployment recovery because it invalidates encrypted and signed browser-extension material.
