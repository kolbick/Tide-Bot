# Tide-Bot Browser Control privacy notice

Tide-Bot Browser Control is a Chrome side panel for a user's paired Tide-Bot server. It lets the selected Tide-Bot model chat with the user and, only after the user starts a browser session, inspect and control one browser tab.

## Data the extension uses

- Normal Tide-Bot chat text, chat IDs, and selected model.
- A revocable paired-device identifier and opaque refresh credential.
- Ephemeral visible page structure and text needed for a requested browser action.
- Ephemeral screenshot bytes and sanitized console or network metadata when requested.
- Ephemeral microphone audio after the user explicitly enters voice mode.
- Workflow steps reviewed by the user and schedule metadata created by the user.

Normal chat text, encrypted workflow definitions, schedules, paired-device metadata, and sanitized action outcomes may be stored in the user's Tide-Bot account under the operator's retention policy. The opaque device credential is stored in `chrome.storage.local`; Tide-Bot stores only its keyed hash.

Raw page snapshots, screenshots, microphone audio, synthesized speech, access tokens, pairing verifiers, raw console arguments, network bodies, authorization headers, and typed values remain ephemeral and are not stored by the extension. Typed secret values are not recorded in workflows or returned in browser-action results.

The extension does not sell data, use data for advertising, or send prompts to an independent browser-agent service. Model inference, speech transcription, and speech synthesis use the services configured by the paired Tide-Bot operator. Those services and the websites a user visits may have their own privacy practices.

Users can stop a browser session at any time, delete chats, delete workflows and schedules, and Revoke a paired browser from Tide-Bot settings. Revocation prevents the device credential from reconnecting. Removing the extension or its Chrome profile removes its local credential, but does not automatically delete server-side chats or workflows.

For permission explanations, the full retention table, and Incident recovery guidance, see `docs/browser-extension/security.md` in the Tide-Bot repository. For questions about a deployed instance, contact the operator identified by that Tide-Bot service.
