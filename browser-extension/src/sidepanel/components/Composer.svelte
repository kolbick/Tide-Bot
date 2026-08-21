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

	// Grow with the text instead of scrolling inside a fixed box. Measured off
	// scrollHeight, so the height transition has a real target to animate to.
	const autoGrow = () => {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
	};

	$: if (textarea && value !== undefined) autoGrow();

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
			aria-label={voiceActive ? 'Stop voice' : 'Use voice'}
			aria-pressed={voiceActive}
			on:click={onVoice}
			{disabled}
		>
			<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<rect x="5.5" y="1.5" width="5" height="8" rx="2.5" stroke="currentColor" stroke-width="1.4" />
				<path
					d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15"
					stroke="currentColor"
					stroke-width="1.4"
					stroke-linecap="round"
				/>
			</svg>
		</button>
		<button
			class="send-button"
			type="submit"
			aria-label="Send message"
			disabled={disabled || generating || !value.trim()}
		>
			<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="M8 13V3M8 3 3.5 7.5M8 3l4.5 4.5"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	</div>
</form>
