<script lang="ts">
	import { onMount } from 'svelte';
	import type { Socket } from 'socket.io-client';

	import { socket } from '$lib/stores';
	import CompanionPanel from '$lib/components/ted-bot/CompanionPanel.svelte';
	import TedBotPet from '$lib/components/ted-bot/TedBotPet.svelte';
	import {
		createCompanionPresenceSubscriber,
		type CompanionPresenceState
	} from '$lib/ted-bot/presence';
	import { isRunningInTauri, listenMainPresence } from '$lib/ted-bot/tauriBridge';

	let activeChatId: string | null = null;
	let isConnected = false;
	let isGenerating = false;

	$: petState = !isConnected ? 'offline' : isGenerating ? 'working' : 'idle';

	onMount(() => {
		let currentSocket: Socket | null = null;
		let subscriber: ReturnType<typeof createCompanionPresenceSubscriber> | null = null;
		const inTauri = isRunningInTauri();

		const markConnected = () => {
			isConnected = true;
		};
		const markDisconnected = () => {
			isConnected = false;
		};
		const applyPresence = (state: CompanionPresenceState) => {
			// The direct Tauri bridge is the source of truth once it has fired
			// at least once (see unlistenBridge below) — socket presence stays
			// authoritative only for plain-browser access with no desktop app.
			if (inTauri && bridgeHasFired) {
				return;
			}
			activeChatId = state.active?.chatId ?? null;
		};
		const unsubscribeSocket = socket.subscribe((value) => {
			subscriber?.destroy();
			currentSocket?.off('connect', markConnected);
			currentSocket?.off('disconnect', markDisconnected);

			currentSocket = value;
			isConnected = value?.connected ?? false;
			if (!value) {
				if (!inTauri) activeChatId = null;
				subscriber = null;
				return;
			}

			value.on('connect', markConnected);
			value.on('disconnect', markDisconnected);
			subscriber = createCompanionPresenceSubscriber(value, applyPresence);
		});

		let bridgeHasFired = false;
		const unlistenBridge = listenMainPresence((payload) => {
			bridgeHasFired = true;
			activeChatId = payload.chatId;
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

<main class="flex h-screen max-h-[100dvh] min-h-0 flex-col bg-white dark:bg-gray-950">
	<div
		class="flex h-8 shrink-0 items-center justify-end border-b border-gray-100 px-3 text-xs text-gray-500 dark:border-gray-900 dark:text-gray-400"
		role="status"
		aria-live="polite"
	>
		{isConnected ? 'Connected' : 'Reconnecting'}
	</div>

	<div class="min-h-0 flex-1">
		{#if activeChatId}
			<CompanionPanel chatId={activeChatId} state={petState} />
		{:else}
			<div class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
				<TedBotPet state={petState} interactive={false} />
				<p class="max-w-xs text-sm text-gray-500 dark:text-gray-400" role="status">
					Open a Tide-Bot chat in the main window to continue it with Ted-Bot.
				</p>
			</div>
		{/if}
	</div>
</main>
