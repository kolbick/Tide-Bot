<script lang="ts">
	import type { PanelMessage } from '../state';
	export let messages: PanelMessage[] = [];
	export let generating = false;
</script>

<section class="transcript" aria-label="Chat transcript" aria-live="polite">
	{#if messages.length === 0}
		<div class="empty-chat">
			<h2>Ask about this page</h2>
			<p>Or start a session and Tide-Bot can work in the tab for you.</p>
		</div>
	{:else}
		{#each messages as message (message.id)}
			<article class:assistant={message.role === 'assistant'} class:user={message.role === 'user'}>
				<span class="sr-only">{message.role === 'assistant' ? 'Tide-Bot' : 'You'}</span>
				<p>
					{message.content}{message.role === 'assistant' && generating && !message.done ? ' ▍' : ''}
				</p>
			</article>
		{/each}
	{/if}
</section>
