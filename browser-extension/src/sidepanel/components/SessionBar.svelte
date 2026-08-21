<script lang="ts">
	import type { ActionMode, TabPolicy } from '../../shared/constants';

	export let connected = false;
	export let session: any | null = null;
	export let actionMode: ActionMode = 'autonomous';
	export let tabPolicy: TabPolicy = 'locked';
	export let onStart: () => void;
	export let onStop: () => void;
</script>

<section class="session-bar" aria-label="Browser session">
	<div class="policy-row">
		<label>
			<span>Action mode</span>
			<select aria-label="Action mode" bind:value={actionMode} disabled={Boolean(session)}>
				<option value="autonomous">Autonomous</option>
				<option value="consequential-approval">Consequential approval</option>
				<option value="manual-approval">Manual approval</option>
			</select>
		</label>
		<label>
			<span>Tab policy</span>
			<select aria-label="Tab policy" bind:value={tabPolicy} disabled={Boolean(session)}>
				<option value="locked">Lock to starting tab</option>
				<option value="follow-active">Follow active tab</option>
			</select>
		</label>
	</div>
	{#if session}
		<div class="tab-detail">
			<span>{session.url ?? 'Controlled tab'}</span><button type="button" on:click={onStop}
				>Stop</button
			>
		</div>
	{:else}
		<button class="session-button" type="button" on:click={onStart} disabled={!connected}
			>Start controlling tab</button
		>
	{/if}
</section>
