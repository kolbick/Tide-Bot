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
	</style>
</svelte:head>

<main
	class="flex h-screen w-screen items-center justify-center bg-transparent"
	data-tauri-drag-region
>
	<!--
		Not a <button>: Tauri's drag-region click-vs-drag distinction (a plain
		click still fires; a click-and-move drags the window instead) is
		unreliable on native interactive elements. A div with explicit a11y
		semantics avoids that conflict.
	-->
	<div
		class="flex cursor-pointer items-center justify-center bg-transparent"
		data-tauri-drag-region
		role="button"
		tabindex="0"
		on:click={handleClick}
		on:keydown={(event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				handleClick();
			}
		}}
		aria-label="Open Tide-Bot"
	>
		<TedBotPet state={petState} interactive={true} />
	</div>
</main>
