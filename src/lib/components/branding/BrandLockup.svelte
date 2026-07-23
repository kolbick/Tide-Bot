<script lang="ts">
	import { BRAND } from '$lib/branding';

	export let compact = false;
</script>

<div class:compact class="brand-lockup" aria-label={`${BRAND.name}, ${BRAND.organization}`}>
	<img src={BRAND.logoPath} alt="{BRAND.name} logo" class="brand-mark" />
	<div class="brand-copy">
		<p class="brand-name">{BRAND.name}</p>
		<p class="brand-organization">{BRAND.organization}</p>
	</div>
</div>

<style>
	.brand-lockup {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: #d9e5e9;
	}
	.brand-mark {
		width: 3rem;
		height: 3rem;
		object-fit: cover;
		border-radius: 0.5rem;
		box-shadow: 0 0 0 1px rgb(83 216 236 / 32%);
	}
	.brand-copy {
		min-width: 0;
		text-align: left;
	}
	.brand-name,
	.brand-organization {
		margin: 0;
	}
	.brand-name {
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		line-height: 1.05;
	}
	.brand-organization {
		margin-top: 0.2rem;
		font-size: 0.625rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #83cddd;
	}
	.compact {
		gap: 0.5rem;
	}
	.compact .brand-mark {
		width: 2.25rem;
		height: 2.25rem;
	}
	.compact .brand-name {
		font-size: 0.75rem;
	}
	.compact .brand-organization {
		font-size: 0.5rem;
	}
</style>
