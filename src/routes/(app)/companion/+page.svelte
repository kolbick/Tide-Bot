<script lang="ts">
	import { onMount } from 'svelte';
	import type { Socket } from 'socket.io-client';

	import { socket } from '$lib/stores';
	import CompanionPanel from '$lib/components/ted-bot/CompanionPanel.svelte';
	import {
		createCompanionPresenceSubscriber,
		type CompanionPresenceState
	} from '$lib/ted-bot/presence';

	let activeChatId: string | null = null;
	let isConnected = false;

	onMount(() => {
		let currentSocket: Socket | null = null;
		let subscriber: ReturnType<typeof createCompanionPresenceSubscriber> | null = null;

		const markConnected = () => {
			isConnected = true;
		};
		const markDisconnected = () => {
			isConnected = false;
		};
		const applyPresence = (state: CompanionPresenceState) => {
			activeChatId = state.active?.chatId ?? null;
		};
		const unsubscribeSocket = socket.subscribe((value) => {
			subscriber?.destroy();
			currentSocket?.off('connect', markConnected);
			currentSocket?.off('disconnect', markDisconnected);

			currentSocket = value;
			isConnected = value?.connected ?? false;
			if (!value) {
				activeChatId = null;
				subscriber = null;
				return;
			}

			value.on('connect', markConnected);
			value.on('disconnect', markDisconnected);
			subscriber = createCompanionPresenceSubscriber(value, applyPresence);
		});

		return () => {
			unsubscribeSocket();
			subscriber?.destroy();
			currentSocket?.off('connect', markConnected);
			currentSocket?.off('disconnect', markDisconnected);
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
			<CompanionPanel chatId={activeChatId} />
		{:else}
			<div class="flex h-full items-center justify-center px-6 text-center">
				<p class="max-w-xs text-sm text-gray-500 dark:text-gray-400" role="status">
					Open a Tide-Bot chat in the main window to continue it with Ted-Bot.
				</p>
			</div>
		{/if}
	</div>
</main>
