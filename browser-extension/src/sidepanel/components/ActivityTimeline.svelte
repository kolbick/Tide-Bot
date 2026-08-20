<script lang="ts">
	import type { ActivityItem } from '../state';
	export let items: ActivityItem[] = [];
</script>

{#if items.length}
	<section class="activity" aria-label="Browser activity">
		<p class="eyebrow">Browser activity</p>
		{#each items.slice(-6) as item (item.id)}
			<div>
				<span class:complete={item.status === 'complete'}></span>
				<p>{item.label}</p>
				<small>{item.status}</small>
			</div>
		{/each}
	</section>
{/if}
