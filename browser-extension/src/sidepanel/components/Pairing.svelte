<script lang="ts">
	export let busy = false;
	export let code = '';
	export let error = '';
	export let onPair: () => void;
</script>

<section class="pairing-card">
	<h2>Connect this browser</h2>
	<p>Pair once to use your Tide-Bot chats and models here. Your session stays on your server.</p>
	{#if code}<p class="pair-code">Enter this code on the page that opened <strong>{code}</strong></p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<button type="button" on:click={onPair} disabled={busy}>
		{busy ? 'Connecting…' : 'Connect'}
	</button>
</section>
