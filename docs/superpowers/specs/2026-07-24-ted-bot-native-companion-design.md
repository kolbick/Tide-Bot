# Ted-Bot Native Companion Design

## Status

Approved design direction on 2026-07-24. This document defines the product
behavior to plan and implement; it does not claim that the desktop companion
already exists.

## Goal

Make Ted-Bot a fully integrated, Codex-style companion for Tide-Bot on macOS
and Windows. It remains usable when the main Tide-Bot window is minimized,
starts with typed chat, and uses the same signed-in user and conversation as
the main application.

## Product boundaries

- Tide-Bot remains the sole product and authenticated backend. Ted-Bot is its
  black-goldendoodle companion, never a separate product, account, or AI
  service.
- The first release is typed chat only. Push-to-talk and read-aloud are a
  later, separately planned phase after typed chat acceptance.
- The desktop companion is required on macOS and Windows. A browser-only
  pop-out is not an equivalent substitute because it cannot reliably remain
  available when the main app is minimized.
- Existing Tide-Bot protections continue to apply: user authorization,
  confirmations, tool permissions, terminal controls, CPTR controls, and
  destructive-action safeguards are never bypassed.

## Architecture

Tide-Bot gains a Tauri desktop shell with two native windows: the ordinary
main application window and a small, borderless Ted-Bot companion window. The
companion is shown after a signed-in session is established and has
always-on-top enabled by default. It includes a user control to reopen or
focus the main Tide-Bot window.

The companion renders a focused Svelte view containing the Ted-Bot sprite,
chat transcript, text input, send and stop controls, and connection state.
Its chat behavior reuses Tide-Bot's existing authenticated chat, completion,
tool, and confirmation paths. It must not create a second AI backend, a
parallel credential store, or a privileged shortcut around the main app.

The main window and companion synchronize active-chat state through an
authenticated, user-scoped presence channel. The newest focused client owns
the active-chat selection. The transmitted state is limited to client ID,
chat ID, chat title, device label, focus flag, and focus timestamp; it is not
stored in chat history, the application database, or logs. If no active chat
exists, the companion's first submitted message creates the conversation
through the normal Tide-Bot path.

## Lifecycle and failure handling

- Ted-Bot opens only for an authenticated user and locks or closes on sign-out,
  session expiry, or OS lock.
- Minimizing or hiding the main window does not close the companion. Closing
  the companion never closes the main Tide-Bot application.
- A lost connection visibly changes the companion to an offline state. Typed,
  unsent text remains local to the companion and reconnect attempts must not
  resend or duplicate submitted messages.
- If the companion cannot launch, Tide-Bot remains functional in its ordinary
  application window and reports the companion failure without exposing
  secrets or internal connection details.
- Browser-only Picture-in-Picture may be considered later as an optional
  convenience fallback, but it is not part of the macOS/Windows acceptance
  requirement.

## Security and privacy

Every request from the companion is authenticated as the normal signed-in
user and is authorized for the referenced chat before it is processed.
Presence updates reject malformed, cross-user, unauthorized, and rate-limited
payloads. Broadcasts are scoped to the owning user, disconnects promote the
newest remaining focused client, and stale clients expire automatically.

The companion must preserve all existing confirmation behavior. In particular,
it cannot approve terminal, CPTR, tool, or destructive operations on behalf of
the user. Error reporting must avoid messages, credentials, tokens, and other
sensitive payloads.

## Accessibility and visual behavior

Ted-Bot uses the existing validated sprite atlas and remains recognizable as
the Tide-Bot mascot. The UI provides labelled controls, keyboard navigation,
visible focus states, and a static reduced-motion presentation. The pet
animation must not block chat input, obscure transcript content, or prevent
screen-reader use of the conversation controls.

## Acceptance criteria

1. A signed-in macOS or Windows user can minimize the main Tide-Bot window and
   continue a typed conversation through Ted-Bot.
2. Ted-Bot and the main window show the same active conversation; opening a
   chat in either surface synchronizes the other without duplicate messages.
3. A user without access to a chat cannot select, receive, or send to it from
   the companion.
4. Existing confirmation and privileged-access flows behave identically when
   initiated through Ted-Bot.
5. Sign-out, session expiry, disconnect, reconnect, and OS-lock behavior
   preserve privacy and do not leak pending messages or active-chat metadata.
6. Focused unit, integration, and native smoke tests pass on macOS and
   Windows; manual accessibility and minimized-window checks are recorded.

## Deferred work

Push-to-talk, read-aloud, browser Picture-in-Picture, autonomous pet actions,
and a standalone Ted-Bot service are out of scope for the first typed-chat
release.
