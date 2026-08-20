<script lang="ts">
	import { onMount } from 'svelte';

	export let value = '';
	export let disabled = false;
	export let generating = false;
	export let voiceActive = false;
	export let onSubmit: () => void;
	export let onVoice: () => void;
	export let textarea: HTMLTextAreaElement | null = null;

	const keydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			onSubmit();
		}
	};

	onMount(() => {
		if (!disabled) textarea?.focus();
	});
</script>

<form class="composer" on:submit|preventDefault={() => onSubmit()}>
	<label for="message">Message Tide-Bot</label>
	<div class="composer-box">
		<textarea
			bind:this={textarea}
			bind:value
			on:keydown={keydown}
			id="message"
			rows="2"
			placeholder={disabled ? 'Connect to Tide-Bot to start' : 'Ask Tide-Bot to use this tab…'}
			{disabled}
		></textarea>
		<button
			class="voice-button"
			type="button"
			aria-label="Use voice"
			aria-pressed={voiceActive}
			on:click={onVoice}
			{disabled}>◉</button
		>
		<button
			class="send-button"
			type="submit"
			aria-label="Send message"
			disabled={disabled || generating || !value.trim()}
		>
			{generating ? 'Working' : 'Send'}
		</button>
	</div>
</form>
