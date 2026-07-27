<script lang="ts">
	import Chat from '$lib/components/chat/Chat.svelte';
	import { openMainWindow } from '$lib/ted-bot/openMainWindow';

	export let chatId: string;

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

	function showMainWindow() {
		return openMainWindow({ invoke, navigate });
	}
</script>

<div class="relative h-full min-h-0 w-full">
	<button
		class="absolute right-2 top-2 z-20 rounded-md border border-gray-300 bg-white/90 px-2 py-1 text-xs text-gray-700 shadow-sm transition hover:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-100 dark:hover:bg-gray-800"
		type="button"
		aria-label="Open main Tide-Bot window"
		on:click={showMainWindow}
	>
		Open Tide-Bot
	</button>
	<Chat chatIdProp={chatId} surface="companion" />
</div>
