# Tide-Bot Chrome Extension Design

## Status

Approved in conversation on 2026-08-20. This document defines the product,
security, data, release, and acceptance requirements for implementation. It
does not claim that the extension already exists.

## Goal

Add a downloadable, Tide-Bot-branded Chrome extension that lets a signed-in
user continue normal Tide-Bot conversations beside the current webpage and
ask the selected locally hosted model to inspect and control one browser tab.
Text chat is the default interface. When the user enters voice mode,
hands-free conversation is the default and push-to-talk remains available.

The extension must feel like part of `tide-bot.com`, use normal Tide-Bot chat
history and model selection, support recorded and scheduled browser workflows,
and ship as both an authenticated ZIP download and a Chrome Web Store-ready
package.

## Product boundaries

- Tide-Bot remains the only AI product, account system, chat store, model
  gateway, and administrative surface. The extension is a Tide-Bot client and
  browser-control executor, not a separate assistant or AI service.
- All model inference, speech transcription, and speech synthesis use the
  services configured by the user's Tide-Bot deployment. The extension must
  not call an external browser-agent or speech service directly.
- All ordinary Tide-Bot chats, selected models, permissions, and user/group
  authorization rules continue to apply.
- Browser control is available to users by default, with an administrator able
  to disable it for a user or group.
- No website category is intentionally blocked. Chrome-protected pages and
  other surfaces that Chrome extensions cannot access remain unsupported.
- The agent controls one tab at a time. Users can choose to lock a task to its
  starting tab or follow the active tab. Multi-tab orchestration is out of
  scope.
- Scheduled workflows require Chrome to be open. Running them through a native
  desktop helper while Chrome is closed is out of scope.
- Publishing to the Chrome Web Store is a separate owner-authorized action.
  This project produces a submission-ready package and documentation only.
- This feature does not create or imply a HIPAA certification or compliance
  determination. Deployment, policy, access, and operational compliance remain
  the operator's responsibility.

## User experience

### Side panel

The extension uses a Manifest V3 Chrome side panel that remains available as
the user browses. The toolbar action opens the panel. The panel contains:

- Tide-Bot lockup and supporting Ted-Bot imagery;
- connection and paired-browser status;
- the title and origin of the controlled tab;
- the selected Tide-Bot model;
- the normal synced chat transcript;
- compact browser-action and approval cards;
- a text composer, microphone control, attachment control, workflow control,
  send control, and task Stop control;
- control-mode and tab-binding selectors; and
- an optional developer-inspection drawer.

The panel reuses Tide-Bot's navy, ocean blue, aqua, typography, iconography,
and supplied identity assets. Ted-Bot remains a supporting mascot and is not
presented as a separate assistant.

### Text and voice

Text chat is the default whenever the side panel opens. Selecting the
microphone enters voice mode. Within voice mode:

- hands-free conversation is selected by default;
- push-to-talk is an immediately available alternative;
- clear Listening, Thinking, and Speaking states are visible;
- the user can mute, interrupt speech, stop the task, switch to push-to-talk,
  or leave voice mode;
- voice activity detection segments hands-free input;
- captured audio is sent only to Tide-Bot's configured speech-to-text route;
- assistant speech uses Tide-Bot's configured text-to-speech route; and
- audio blobs are not persisted in extension storage, chat history, workflow
  definitions, application logs, or the Tide-Bot database.

Microphone capture starts only after Chrome has granted permission and the
user has explicitly entered voice mode. Closing the side panel ends capture.

### Browser control modes

The composer exposes three modes:

1. **Autonomous**, the default. All supported actions execute without an
   approval prompt.
2. **Consequential Approval**. Routine observation and navigation proceed,
   while submissions, messages, deletions, purchases, uploads, downloads, and
   permission changes pause for approval.
3. **Manual Approval**. Every page-changing action pauses for approval;
   read-only page observation remains automatic.

Approval enforcement lives in the extension executor. Neither a model tool
call nor a server response can bypass it. All modes retain an immediate Stop
control, one command at a time, command deadlines, bounded action counts, and
visible progress. A suspected prompt-injection event pauses the task in every
mode, including Autonomous.

### Tab behavior

Every task has one of two user-selectable tab modes:

- **Lock to tab** keeps the task bound to the tab on which it started and
  pauses if that tab closes or becomes inaccessible.
- **Follow active tab** rebinds observation and action to the active tab after
  an explicit active-tab change.

The extension never controls multiple tabs concurrently. A scheduled workflow
may open one dedicated execution tab, control only that tab, and close it when
the workflow definition requests cleanup.

## Supported browser abilities

### Observation

- cleaned accessibility and DOM snapshot;
- visible page text and current selection;
- viewport screenshot;
- current URL, title, origin, viewport, focus, and loading state;
- labelled interactive-element inventory;
- console messages and JavaScript errors; and
- network request, response, timing, and error details through an approved
  Chrome Debugger Protocol subset.

Observation removes scripts, styles, comments, irrelevant hidden content,
password values, payment values, authentication material, and oversized
payloads before model use. Network credentials and sensitive headers are
redacted. Response bodies may be inspected only on demand, are size bounded,
are redacted before model use, and remain ephemeral.

### Action

- navigate to a URL, go back, reload, and wait for navigation;
- click, double-click, hover, focus, and activate an element;
- type, replace, or clear ordinary input values;
- choose select options and supported controls;
- press keys and keyboard shortcuts;
- scroll the page or an element;
- perform supported drag-and-drop interactions;
- submit a form;
- start a download;
- upload a file that the user explicitly supplied through Tide-Bot; and
- wait for an element, text, URL, loading state, or bounded delay.

The model receives named, schema-validated actions rather than an arbitrary
JavaScript or unrestricted DevTools execution interface. The extension does
not provide tools for reading cookies, authentication headers, local storage,
password-manager contents, payment autofill values, or unrelated local files.

## Recorded workflows and schedules

### Recording

The user can start recording, perform a sequence in the controlled tab, stop
recording, review the captured steps, name the workflow, replace values with
variables, and save it to Tide-Bot.

Recorded steps use semantic targets such as accessible role, label, text,
stable attributes, and nearby structure rather than relying only on screen
coordinates or fragile generated selectors. Secret input values are never
recorded. Sensitive or changeable values become runtime variables. A workflow
can define its starting URL, tab mode, approval mode, completion condition,
and whether its dedicated execution tab should close.

### Account sync

Workflows and schedules are stored in the user's Tide-Bot account and assigned
to a specific paired browser. They are not stored only in a Chrome profile.
Workflow definitions are encrypted at rest with versioned authenticated
encryption derived from Tide-Bot's persistent server secret.

### Scheduling

Schedules support daily, weekly, monthly, annual, and explicit recurrence
rules with an IANA timezone. The assigned extension mirrors enabled schedules
into Chrome alarms. When due, it opens or reuses one execution tab and creates
a normal Tide-Bot chat for the run.

Chrome must be open when a schedule is due. If Chrome was closed, the assigned
browser performs at most one catch-up run when it reconnects. It does not replay
every missed occurrence. The user receives a Chrome notification when a run
finishes, fails, pauses, or needs approval.

## Architecture

### Extension package

`browser-extension/` contains a self-contained Manifest V3 application with a
minimum supported Chrome version of 120. It includes:

- a Svelte side-panel application;
- a background service worker;
- a content script for semantic observation, recording, and ordinary DOM
  actions;
- a strict Chrome Debugger Protocol adapter for screenshots, developer
  inspection, and actions that require browser-level input;
- an approval and action-policy engine;
- a single-tab session controller;
- a workflow recorder and runner;
- Chrome alarm and notification adapters;
- a voice-session controller; and
- a typed, versioned command protocol.

All executable code and dependencies are bundled in the extension package.
No code is loaded from a CDN or fetched for execution. Build output is
reproducible and contains no source maps, credentials, environment files, or
development-only endpoints.

The service worker maintains an authenticated Socket.IO or WebSocket bridge
only while paired and needed. It sends a keepalive within Chrome's supported
service-worker lifecycle window. Scheduled alarms can wake the worker, which
then reconnects and revalidates device state before running.

### Tide-Bot frontend

The authenticated Tide-Bot application gains a `/browser-extension` surface
that provides:

- the protected ZIP download;
- version, checksum, compatibility, and installation instructions;
- pairing approval;
- paired-browser naming, status, last-seen information, and revocation;
- workflow and schedule management;
- administrator user/group permission management; and
- administrator-only custom-origin unlock controls.

The side panel uses Tide-Bot APIs to create, load, and update ordinary chats.
Extension conversations therefore appear in normal Tide-Bot history and can
be continued on `tide-bot.com` or another Tide-Bot client.

### Tide-Bot backend

The backend gains a dedicated browser-extension router, persistence models,
pairing service, device-token service, browser command broker, workflow
service, schedule synchronization service, and user-scoped socket handlers.

When a chat request includes a valid connected browser session, the backend
injects the browser tool schemas into Tide-Bot's existing tool execution path.
Native tool-calling models use their ordinary function-calling interface.
Models without native tool calling use Tide-Bot's existing structured legacy
fallback. There is no separate extension-only agent loop.

For each browser tool call, the command broker:

1. verifies the user, feature permission, device ownership, connection,
   browser session, tab binding, and command schema;
2. creates a unique command ID, nonce, monotonic sequence, and deadline;
3. sends the command only to the owning user's paired device room;
4. awaits one bounded result;
5. validates and redacts the result;
6. supplies ephemeral observation data to the current model turn; and
7. persists only a sanitized action audit item with the chat.

### Command protocol

Every command and result includes a protocol version, command ID, user-scoped
device ID, browser session ID, tab binding, sequence, issue time, deadline,
action type, typed arguments, and result status. The broker rejects duplicate,
expired, out-of-order, cross-user, cross-device, oversized, or unknown
messages. Completed command IDs remain in a short-lived replay cache.

Only one mutating command may be active for a browser session. Read-only
observation may not race with mutation; the executor establishes a fresh
post-action observation before another model decision.

## Authentication and authorization

### Pairing

Pairing uses a device-authorization flow that does not depend on a fixed
extension ID:

1. The extension generates a verifier and sends its challenge to Tide-Bot.
2. Tide-Bot returns a short-lived device code, user code, verification URL,
   polling interval, and expiry.
3. The extension opens the Tide-Bot verification page.
4. A signed-in, permitted user reviews and approves the browser name and
   requested capabilities.
5. The extension exchanges the one-use device code and verifier for a device
   credential and short-lived access token.
6. The consumed grant can never be exchanged again.

Pairing grants expire within five minutes, are rate limited, store only hashed
secrets, and are invalidated on success or denial. The extension never receives
or handles the user's Tide-Bot password.

### Device credentials

The extension stores one opaque, high-entropy device refresh credential in
`chrome.storage.local`. Tide-Bot stores only its keyed hash. The credential is
rotated on successful refresh and exchanged for short-lived user access
tokens. Reuse of a rotated credential revokes the device. Sign-out, user/group
permission removal, manual device revocation, account deactivation, or server
policy change terminates active browser sessions and invalidates refresh.

### Feature permission

The user permission schema gains a browser-extension feature flag. Its product
default is enabled. Administrators can disable it for an individual or group.
Every pairing, token refresh, socket connection, workflow read/write, schedule
sync, download, and command checks the current effective permission rather
than trusting the value present when the device first paired.

### Server origin policy

The packaged default is exactly `https://tide-bot.com`. The ordinary user UI
cannot edit it. A Tide-Bot administrator may unlock custom origins. A custom
remote origin must use HTTPS; loopback `localhost` and loopback IP origins may
use HTTP. Changing origins clears active access tokens and requires a new
pairing against the destination server. An unlock never transfers trust or
credentials between Tide-Bot deployments.

## Data model and retention

The backend stores the following user-scoped records:

- **Pairing grant:** hashed device code, PKCE-style challenge, expiry, state,
  polling limits, approval user, and consumption time; removed after a short
  retention window.
- **Paired device:** user, display name, keyed credential hash, credential
  generation, capabilities, approved origin policy, created time, last seen,
  and revocation state.
- **Workflow:** user, assigned device, name, description, encrypted versioned
  definition, default approval mode, default tab mode, timestamps, and enabled
  state.
- **Schedule:** workflow, recurrence, timezone, enabled state, next due time,
  last attempt, last result, and catch-up marker.
- **Sanitized action audit:** chat, message/run, device, domain, action class,
  outcome, timestamp, duration, approval state, and redacted summary.

Raw screenshots, DOM snapshots, page text, network bodies, console bodies,
audio, typed values, and browser tool results are never stored in these
records, normal chat messages, analytics, or server logs. Ephemeral payloads
are released after the current model turn completes or fails.

## Prompt-injection and secret defenses

All page-derived data is wrapped as untrusted observation and remains separate
from system instructions, user instructions, tool schemas, and executor
policy. The implementation uses local-only layered detection:

- deterministic indicators for common visible and hidden injection patterns;
- task-drift checks between the user's request and proposed action;
- optional classification by Tide-Bot's configured local task model; and
- origin, destination, field-type, and action-consistency checks.

Any layer can mark an observation suspicious. A suspicious result pauses the
task and shows the relevant reason without replaying the malicious text into
the persistent chat. Users may stop or explicitly resume after reviewing it.

DOM and network sanitizers remove password values, payment values, hidden
secret fields, authentication and cookie headers, access tokens, session IDs,
private keys, and common credential patterns. Audit summaries never include
the exact text typed into a field.

These measures reduce risk but do not make autonomous browser use risk-free.
The interface and documentation must say that Autonomous mode can act with the
user's browser permissions and that the user remains responsible for tasks
they start.

## Failure handling

- **Connection loss:** pause immediately, reconnect, reauthorize, and obtain a
  fresh observation before continuing. Never resend a completed command.
- **Service-worker restart:** restore only non-secret session metadata,
  reconnect, query in-flight command state, and either resume safely or pause.
- **Missing element:** rescan once using semantic alternatives, then pause with
  a clear explanation.
- **Uncertain mutation:** never automatically retry a submission, message,
  purchase, deletion, upload, or download if its outcome is unknown.
- **Model unavailable:** preserve the user task and unsent text, then allow a
  manual resume when the selected model returns.
- **Unsupported native tools:** use Tide-Bot's structured legacy tool-calling
  fallback.
- **Permission missing:** identify the exact Chrome permission and request it
  only through a user gesture.
- **Prompt injection suspected:** pause in every control mode.
- **Voice failure:** retain a completed transcript when available and fall back
  to text without retaining the audio blob.
- **Schedule missed:** perform at most one catch-up run after the assigned
  browser reconnects.
- **Device revoked:** terminate the bridge, clear local credentials, cancel
  local alarms, and require pairing.

## Accessibility

The side panel and Tide-Bot management surface provide keyboard navigation,
labelled controls, visible focus, sufficient contrast, screen-reader status
announcements, non-color-only state indicators, reduced-motion behavior, and
captions/transcripts for voice interaction. Recording and Autonomous mode are
always visibly indicated. Stop remains reachable by keyboard and pointer while
a task is active.

## Packaging and distribution

The build produces a deterministic
`tide-bot-chrome-extension-<version>.zip` with `manifest.json` at its root,
plus a SHA-256 checksum and build metadata. The protected Tide-Bot download
endpoint requires a currently permitted signed-in user. The repository may
contain source and store-preparation material, but production downloads use
the tested build artifact.

The package is Chrome Web Store-ready and includes:

- required Tide-Bot icon sizes;
- listing title, short description, full description, and category;
- actual product screenshots;
- privacy disclosure and single-purpose statement;
- explanations for every requested permission;
- reviewer setup and test instructions; and
- support and privacy URLs.

The ZIP is not automatically submitted. Web Store authentication, developer
registration, submission, visibility selection, and publication require a
separate owner-authorized action.

## Testing strategy

### Extension unit tests

Unit tests cover command parsing, approval classification, tab binding,
redaction, DOM cleaning, action execution, workflow normalization, secret
variable replacement, schedule catch-up, service-worker state restoration,
voice state, and custom-origin policy.

### Backend tests

Pytest coverage includes pairing expiry and one-use behavior, verifier checks,
poll rate limits, token rotation and reuse detection, revocation, current
permission checks, cross-user and cross-device rejection, command replay and
ordering, payload limits, workflow encryption, schedule ownership, catch-up,
and ephemeral-data persistence guards.

### Browser integration tests

Playwright launches its bundled Chromium in a persistent context with the
built extension loaded. A hermetic fake Tide-Bot/local-model fixture exercises:

- signed-in download and package integrity;
- pairing, refresh, restart, and revocation;
- normal synced text chat;
- entry to hands-free and push-to-talk voice with mocked media devices;
- observation and each supported browser action;
- Autonomous, Consequential Approval, and Manual Approval behavior;
- lock-to-tab and follow-active modes;
- prompt-injection pause and secret redaction;
- developer console and network inspection;
- workflow record, replay, schedule, notification, and one catch-up run;
- connection loss and service-worker restart; and
- proof that raw browser observations are absent from persisted chat and
  backend records.

The browser runner must use generated loopback origins, synthetic credentials,
an isolated database, and a fake local model. It must reject production,
Tailscale, ordinary local development, real user credentials, and caller-set
base URLs.

### Repository gates

Focused unit, backend, and browser tests; Tide-Bot's branding audit; extension
packaging validation; production frontend build; changed-path diagnostics; and
`git diff --check` must pass before release. The inherited global Svelte
diagnostic baseline is reported accurately rather than represented as a new
regression.

## Acceptance criteria

1. A permitted signed-in user can download, install, and pair the extension
   without giving it a Tide-Bot password.
2. The side panel opens in text chat and shows normal synced Tide-Bot chats and
   model selection.
3. Entering voice mode defaults to hands-free, supports push-to-talk, and does
   not persist audio.
4. The selected local model can observe and operate one permitted webpage tab
   through the supported action schemas.
5. Autonomous is the initial control mode, and the other two modes enforce
   their approval rules in the extension executor.
6. Lock-to-tab and follow-active behavior work without concurrent multi-tab
   control.
7. Page observation, console, and network data are redacted and ephemeral;
   only sanitized action audits persist.
8. Passwords, payment values, cookies, authentication headers, browser storage,
   and unrelated local files are not available to the model.
9. Suspected prompt injection pauses every control mode.
10. A user can record, review, save, run, schedule, pause, and delete an
    account-synced workflow assigned to a paired browser.
11. Scheduled workflows run while Chrome is open and perform no more than one
    catch-up execution after downtime.
12. Administrators can revoke devices, disable the feature for a user or group,
    and unlock custom server origins; those decisions take effect immediately.
13. Device credentials rotate, stale credential reuse revokes the device, and
    cross-user or cross-device commands are rejected.
14. Service-worker restart, lost connection, changed DOM, model outage, and
    uncertain mutation recover or pause without duplicating consequential
    actions.
15. The exact downloadable ZIP passes unit, backend, integration, security,
    branding, packaging, and build gates.
16. The same ZIP and listing materials satisfy Chrome Web Store packaging and
    disclosure requirements without being automatically submitted.

## Explicitly deferred work

- concurrent multi-tab reasoning or action;
- scheduled execution while Chrome is closed;
- a native messaging host or desktop helper;
- arbitrary model-authored JavaScript or unrestricted DevTools commands;
- direct access to cookies, browser storage, password managers, payment
  autofill, or the general file system;
- an external hosted browser-agent, transcription, synthesis, or safety
  service; and
- automatic Chrome Web Store submission or publication.
