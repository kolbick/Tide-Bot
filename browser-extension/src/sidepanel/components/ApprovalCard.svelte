<script lang="ts">
	import type { ApprovalNotice } from '../api';
	export let approval: ApprovalNotice;
	export let onResolve: (approved: boolean) => void;
</script>

<section class="approval-card" aria-live="assertive">
	<div>
		<span>Approval needed</span><strong>{approval.summary}</strong>
		<p>{approval.reason.replaceAll('_', ' ')}</p>
	</div>
	<div class="approval-actions">
		<button type="button" class="deny" aria-label="Deny action" on:click={() => onResolve(false)}
			>Deny</button
		>
		<button type="button" aria-label="Allow action" on:click={() => onResolve(true)}>Allow</button>
	</div>
</section>
