<script lang="ts">
	import type { VoiceMode } from '../../shared/constants';
	import type { VoiceStatus } from '../voice';

	export let status: VoiceStatus;
	export let onMode: (mode: VoiceMode) => void;
	export let onStop: () => void;
	export let onRetry: () => void;
	export let onPushStart: () => void;
	export let onPushEnd: () => void;

	$: statusLabel = status.processing
		? 'Transcribing'
		: status.recording
			? 'Listening to you'
			: status.listening
				? 'Listening'
				: 'Voice ready';

	const changeMode = (event: Event) => {
		onMode((event.currentTarget as HTMLSelectElement).value as VoiceMode);
	};

	const pressKey = (event: KeyboardEvent) => {
		if (event.repeat || ![' ', 'Enter'].includes(event.key)) return;
		event.preventDefault();
		onPushStart();
	};

	const releaseKey = (event: KeyboardEvent) => {
		if (![' ', 'Enter'].includes(event.key)) return;
		event.preventDefault();
		onPushEnd();
	};
</script>

<section class="voice-controls" aria-label="Voice controls">
	{#if status.error}
		<div class="voice-error">
			<div>
				<strong>Microphone access is blocked.</strong>
				<span>Allow microphone access in Chrome, then retry.</span>
			</div>
			<button type="button" aria-label="Try microphone again" on:click={onRetry}>Retry</button>
		</div>
	{:else}
		<div class="voice-state" role="status" aria-live="polite">
			<span class:recording={status.recording} class="voice-dot"></span>
			<div>
				<strong>{statusLabel}</strong>
				<small>{status.voiceMode === 'hands-free' ? 'Hands-free voice' : 'Push to talk'}</small>
			</div>
			<button type="button" aria-label="Stop voice" on:click={onStop}>Stop</button>
		</div>

		<div class="voice-actions">
			<label>
				<span>Voice mode</span>
				<select aria-label="Voice mode" value={status.voiceMode} on:change={changeMode}>
					<option value="hands-free">Hands-free</option>
					<option value="push-to-talk">Push to talk</option>
				</select>
			</label>
			{#if status.voiceMode === 'push-to-talk'}
				<button
					type="button"
					class="hold-button"
					class:active={status.recording}
					aria-label="Hold to talk"
					on:pointerdown={onPushStart}
					on:pointerup={onPushEnd}
					on:pointercancel={onPushEnd}
					on:pointerleave={onPushEnd}
					on:keydown={pressKey}
					on:keyup={releaseKey}
				>
					{status.recording ? 'Release to send' : 'Hold to talk'}
				</button>
			{:else}
				<p>Speak naturally. Tide-Bot sends after a short pause.</p>
			{/if}
		</div>
	{/if}
</section>
