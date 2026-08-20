# Tide-Bot Browser Control

Tide-Bot Browser Control is the Chrome side panel for Tide-Bot. It keeps normal Tide-Bot chat history and model selection while letting the selected model inspect and control one browser tab. Text chat is the initial input. When you choose voice, hands-free is the default and push-to-talk remains available.

## Install the signed-in download

1. Sign in to Tide-Bot and open **Settings > Browser Control**.
2. Select **Download extension**. Tide-Bot returns an authenticated ZIP and shows its SHA-256 checksum.
3. Extract the ZIP into a permanent folder. The selected folder must contain `manifest.json` at its top level.
4. In desktop Chrome, open `chrome://extensions`.
5. Turn on **Developer mode**.
6. Select **Load unpacked**, then select the extracted folder.
7. Pin **Tide-Bot Browser Control** from Chrome's Extensions menu if you want one-click access.

Do not select the ZIP itself at **Load unpacked**. Do not delete or move the extracted folder while the extension is installed. Chrome reads the unpacked extension from that folder.

Chrome 120 or newer is required. The authenticated ZIP is also produced by `npm run build:browser-extension` at `backend/open_webui/static/browser-extension/tide-bot-browser-extension.zip`, but the raw static path is intentionally denied by the application. Users download it through the signed-in API and settings screen.

## Pair the browser

1. Open the Tide-Bot toolbar action to show the side panel.
2. Select **Pair browser**. The extension opens the configured Tide-Bot approval page and shows a short-lived code.
3. Confirm the code and browser name while signed in to Tide-Bot.
4. Return to the side panel. It should show **Connected**.
5. Open the page you want to use, choose an action mode, and select **Start controlling tab**.

Pairing never asks the extension for your Tide-Bot password. The browser receives a revocable device credential. Administrators and the device owner can rename or Revoke a paired browser from **Settings > Browser Control**.

## Chat and browser control

The model menu uses the same models as Tide-Bot. In particular, local models run on your Tide-Bot server; the extension does not send model prompts to a separate browser-agent provider. Chats created in the panel are saved in normal Tide-Bot history.

The extension supports semantic page observation, click, type, select, scroll, same-tab navigation, back, forward, reload, bounded waits, screenshots, sanitized console and network inspection, user-approved downloads, workflow recording, and Chrome-open schedules. It controls one controlled tab at a time. It does not expose arbitrary JavaScript evaluation, cookies, password-manager data, payment autofill, authorization headers, or unrelated local files to the model.

### Action modes

- **Autonomous** is the default. Ordinary supported actions run without a prompt. Downloads, delete-like actions, password or payment-like fields, and suspected prompt injection still require approval.
- **Consequential approval** lets ordinary actions proceed but pauses consequential actions for a visible Allow or Deny decision.
- **Manual approval** pauses every page-changing action. Read-only observation remains automatic.

The **Stop** control closes the browser session and detaches any debugger access. A locked session stays with its starting tab even when another tab becomes active.

### Text and voice

Text is selected whenever the side panel opens. Select **Use voice** to enter voice mode. Voice starts in **Hands-free** mode, detects speech and a short pause, submits the transcript, and plays Tide-Bot's reply. You can switch to **Push to talk** or stop voice at any time. Microphone audio is sent only to the speech-to-text route configured on your Tide-Bot server and is not stored by the extension.

### Workflows and schedules

Start a browser session, open **Workflows**, and select **Start recording**. Perform the page actions yourself, stop, review every recorded semantic step, and give the workflow a name before saving. Typed values are not recorded; a type step becomes an input intent.

Schedules are assigned to one paired browser. Chrome must be open when the run is due. Chrome alarms can wake the extension service worker, but they cannot start Chrome or run after the browser has been fully closed. A run that requires a secret value or approval pauses safely.

## Administration

Browser control is enabled by default through the normal user and group feature permission. An administrator can disable it for a group or user. A signed-in user without the effective permission cannot download, pair, connect, or use browser tools.

The production package is bound to `https://tide-bot.com`. The setting that unlocks custom origins is visible only to administrators: custom origins are admin-only. Production custom origins must use HTTPS. Loopback HTTP is limited to development and test environments.

## Troubleshooting

- **Offline:** Confirm Tide-Bot is reachable, then select **Reconnect**. Reopen the panel if Chrome suspended the service worker.
- **Pair browser appears again:** The device was revoked, its permission changed, or credential refresh failed. Review devices in Tide-Bot before pairing again.
- **Could not control this tab:** Chrome-protected pages such as `chrome://` pages cannot be controlled. Open an ordinary HTTP or HTTPS page.
- **Local model unavailable:** Start or repair the model on the Tide-Bot server, then retry. Browser actions never fall back to an external model automatically.
- **Schedule did not run:** Confirm Chrome was open, the assigned browser is still paired, the workflow is valid, and no approval or runtime input is waiting.

See [security.md](security.md) for the permission, retention, and Incident recovery details. See [chrome-web-store.md](chrome-web-store.md) for owner-run store preparation.
