<script lang="ts">
	import { onMount } from 'svelte';
	import type { Socket } from 'socket.io-client';

	import { socket } from '$lib/stores';
	import TedBotPet from '$lib/components/ted-bot/TedBotPet.svelte';
	import {
		createCompanionPresenceSubscriber,
		type CompanionPresenceState
	} from '$lib/ted-bot/presence';
	import { isRunningInTauri, listenMainPresence } from '$lib/ted-bot/tauriBridge';
	import { openMainWindow } from '$lib/ted-bot/openMainWindow';

	let isConnected = false;
	let isGenerating = false;

	$: petState = !isConnected ? 'offline' : isGenerating ? 'working' : 'idle';

	const invoke =
		typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
			? async (command: string) => {
					const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
					return tauriInvoke(command);
				}
			: undefined;

	function navigate(path: string) {
		window.location.assign(path);
	}

	function handleClick() {
		openMainWindow({ invoke, navigate });
	}

	// Dragging is driven explicitly rather than via `data-tauri-drag-region`.
	// That attribute is handled by a script Tauri injects into the webview,
	// and it did not take effect for this window — which loads a remote
	// production origin rather than the bundled frontend. Calling
	// startDragging() ourselves uses the same permission
	// (core:window:allow-start-dragging) and does not depend on that
	// injection.
	//
	// startDragging() hands the drag to the OS, and the webview never
	// delivers a click afterwards. So a press does not drag immediately:
	// it waits for the pointer to travel past a small threshold. A press
	// released without crossing it is a click (open the main window); a
	// press that crosses it becomes a window drag.
	const DRAG_THRESHOLD_PX = 4;
	let pressOrigin: { x: number; y: number } | null = null;
	let dragStarted = false;

	function handlePointerDown(event: PointerEvent) {
		if (event.button !== 0) {
			return;
		}
		pressOrigin = { x: event.screenX, y: event.screenY };
		dragStarted = false;
	}

	async function handlePointerMove(event: PointerEvent) {
		if (!pressOrigin || dragStarted) {
			return;
		}
		const travelled = Math.hypot(
			event.screenX - pressOrigin.x,
			event.screenY - pressOrigin.y
		);
		if (travelled < DRAG_THRESHOLD_PX) {
			return;
		}
		dragStarted = true;
		if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
			return;
		}
		const { getCurrentWindow } = await import('@tauri-apps/api/window');
		await getCurrentWindow().startDragging();
	}

	function handlePointerUp() {
		const wasDrag = dragStarted;
		pressOrigin = null;
		dragStarted = false;
		if (!wasDrag) {
			handleClick();
		}
	}

	// There is no title bar and the window is skip_taskbar, so right-click is
	// the only way to put the pet away from the pet itself. It stays
	// restorable from the tray ("Show or Hide Ted-Bot").
	async function handleHide(event: MouseEvent) {
		event.preventDefault();
		if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
			return;
		}
		const { getCurrentWindow } = await import('@tauri-apps/api/window');
		await getCurrentWindow().hide();
	}

	onMount(() => {
		let currentSocket: Socket | null = null;
		let subscriber: ReturnType<typeof createCompanionPresenceSubscriber> | null = null;
		const inTauri = isRunningInTauri();
		let bridgeHasFired = false;

		const markConnected = () => {
			isConnected = true;
		};
		const markDisconnected = () => {
			isConnected = false;
		};
		// The pet itself doesn't need to know *which* chatId is active — only
		// whether one is generating, to pick idle vs working. activeChatId is
		// still tracked so a click can bring the right chat to the front later
		// if that's ever wired up; for now it just focuses the main window.
		const applyPresence = (_state: CompanionPresenceState) => {
			if (inTauri && bridgeHasFired) {
				return;
			}
		};
		const unsubscribeSocket = socket.subscribe((value) => {
			subscriber?.destroy();
			currentSocket?.off('connect', markConnected);
			currentSocket?.off('disconnect', markDisconnected);

			currentSocket = value;
			isConnected = value?.connected ?? false;
			if (!value) {
				subscriber = null;
				return;
			}

			value.on('connect', markConnected);
			value.on('disconnect', markDisconnected);
			subscriber = createCompanionPresenceSubscriber(value, applyPresence);
		});

		const unlistenBridge = listenMainPresence((payload) => {
			bridgeHasFired = true;
			isGenerating = payload.isGenerating;
		});

		return () => {
			unsubscribeSocket();
			subscriber?.destroy();
			currentSocket?.off('connect', markConnected);
			currentSocket?.off('disconnect', markDisconnected);
			unlistenBridge();
		};
	});
</script>

<svelte:head>
	<!--
		app.css paints an opaque themed background via `.dark body` and
		`.light body, :root:not(.dark) body` — both with !important — plus a
		body::before texture overlay. A bare `body { background: transparent }`
		loses the specificity fight (class+element beats element), so these
		selectors have to match or exceed it. Without this the transparent
		Tauri window still shows a solid rectangle behind the sprite.
	-->
	<style>
		html,
		body,
		.dark body,
		.light body,
		:root:not(.dark) body {
			background: transparent !important;
			background-image: none !important;
		}

		body::before,
		body::after {
			display: none !important;
			content: none !important;
		}

		/*
			Keep presses off the sprite's own elements so every pointer event
			lands on the wrapper that carries the drag/click handlers, rather
			than on the <img> that covers the whole window.
		*/
		.ted-bot-pet,
		.ted-bot-pet * {
			pointer-events: none !important;
		}
	</style>
</svelte:head>

<main
	class="flex h-screen w-screen items-center justify-center bg-transparent"
	data-tauri-drag-region
>
	<!--
		Pointer handlers rather than on:click — a press that travels becomes a
		window drag and must not also fire a click. See the threshold logic in
		the script block. data-tauri-drag-region is kept as a harmless fallback
		in case the injected handler is available.
	-->
	<div
		class="flex cursor-pointer items-center justify-center bg-transparent"
		data-tauri-drag-region
		role="button"
		tabindex="0"
		on:pointerdown={handlePointerDown}
		on:pointermove={handlePointerMove}
		on:pointerup={handlePointerUp}
		on:pointerleave={() => {
			pressOrigin = null;
			dragStarted = false;
		}}
		on:keydown={(event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				handleClick();
			}
		}}
		on:contextmenu={handleHide}
		title="Drag to move · Click to open Tide-Bot · Right-click to hide"
		aria-label="Open Tide-Bot"
	>
		<TedBotPet state={petState} interactive={true} />
	</div>
</main>
