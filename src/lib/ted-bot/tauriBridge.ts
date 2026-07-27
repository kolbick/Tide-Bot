// Direct, same-process window-to-window sync for the desktop app.
//
// The browser-only companion surface has no choice but to go through the
// server (socket.io presence, companion_presence.py), which arbitrates
// "which window is active" by comparing isFocused across independent
// clients — unreliable across two separate OS windows in the same Tauri
// app, where document.hasFocus() doesn't behave like it does across browser
// tabs. Inside the desktop app, main and companion are two windows of the
// same process; Tauri's own event bus delivers this instantly with no
// server round-trip and no focus-arbitration ambiguity. This module is that
// direct path. It's additive: the socket presence path is untouched and
// still runs for the plain-browser /companion surface.

export type MainPresenceEvent = {
	chatId: string | null;
	chatTitle: string | null;
	isGenerating: boolean;
};

const EVENT_NAME = 'tide-bot://main-presence';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const emitMainPresence = async (payload: MainPresenceEvent): Promise<void> => {
	if (!isTauri()) {
		return;
	}
	const { emit } = await import('@tauri-apps/api/event');
	await emit(EVENT_NAME, payload);
};

export const listenMainPresence = (
	callback: (payload: MainPresenceEvent) => void
): (() => void) => {
	if (!isTauri()) {
		return () => {};
	}
	let unlisten: (() => void) | null = null;
	let cancelled = false;
	import('@tauri-apps/api/event').then(({ listen }) => {
		if (cancelled) {
			return;
		}
		listen<MainPresenceEvent>(EVENT_NAME, (event) => callback(event.payload)).then((fn) => {
			if (cancelled) {
				fn();
				return;
			}
			unlisten = fn;
		});
	});
	return () => {
		cancelled = true;
		unlisten?.();
	};
};

export const isRunningInTauri = isTauri;
