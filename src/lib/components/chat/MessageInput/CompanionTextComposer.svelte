<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let isGenerating = false;

	const dispatch = createEventDispatcher<{
		send: string;
		stop: void;
	}>();

	let text = '';

	const send = () => {
		if (!text.trim()) {
			return;
		}

		dispatch('send', text);
		text = '';
	};
</script>

<form
	class="mx-auto flex w-full max-w-[58rem] items-end gap-2 px-3 pb-2"
	on:submit|preventDefault={send}
>
	<label class="sr-only" for="companion-chat-input">Message Ted-Bot</label>
	<textarea
		id="companion-chat-input"
		class="min-h-11 max-h-40 flex-1 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-hidden transition focus:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500"
		rows="1"
		placeholder="Message Ted-Bot"
		bind:value={text}
	></textarea>
	{#if isGenerating}
		<button
			class="min-h-11 rounded-full border border-gray-200 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-hidden focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
			type="button"
			aria-label="Stop response"
			on:click={() => dispatch('stop')}
		>
			Stop
		</button>
	{/if}
	<button
		class="min-h-11 rounded-full bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-black focus:outline-hidden focus:ring-2 focus:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
		type="submit"
		aria-label="Send message"
		disabled={!text.trim()}
	>
		Send
	</button>
</form>
