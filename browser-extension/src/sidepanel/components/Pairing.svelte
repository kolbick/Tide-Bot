<script lang="ts">
	export let busy = false;
	export let code = '';
	export let error = '';
	export let onPair: () => void;
</script>

<section class="pairing-card">
	<p class="eyebrow">Private browser assistant</p>
	<h2>Bring Tide-Bot into your browser.</h2>
	<p>Pair once to use your Tide-Bot chats and local models securely.</p>
	{#if code}<p class="pair-code">Code <strong>{code}</strong></p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<button type="button" on:click={onPair} disabled={busy}>
		{busy ? 'Waiting for approval…' : 'Pair browser'}
	</button>
</section>
