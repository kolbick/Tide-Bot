<script lang="ts">
	import type { PanelMessage } from '../state';
	export let messages: PanelMessage[] = [];
	export let generating = false;
</script>

<section class="transcript" aria-label="Chat transcript" aria-live="polite">
	{#if messages.length === 0}
		<div class="empty-chat">
			<p class="eyebrow">Ready when you are</p>
			<h2>What should we do in this tab?</h2>
			<p>Ask Tide-Bot to research, navigate, fill forms, or handle a repeatable task.</p>
		</div>
	{:else}
		{#each messages as message (message.id)}
			<article class:assistant={message.role === 'assistant'} class:user={message.role === 'user'}>
				<span>{message.role === 'assistant' ? 'Tide-Bot' : 'You'}</span>
				<p>
					{message.content}{message.role === 'assistant' && generating && !message.done ? ' ▍' : ''}
				</p>
			</article>
		{/each}
	{/if}
</section>
