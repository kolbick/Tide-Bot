<script lang="ts">
	import { BRAND } from '$lib/branding';

	export let label = 'Ted-Bot, Tide-Bot mascot';
	export let compact = false;
</script>

<div
	class:compact
	class="ted-bot"
	role="img"
	aria-label={label}
	style:background-image={`url(${BRAND.tedBotSpritePath})`}
></div>

<style>
	.ted-bot {
		width: 6rem;
		height: 6.5rem;
		overflow: hidden;
		flex: none;
		border-bottom: 1px solid rgb(83 216 236 / 25%);
		background-repeat: no-repeat;
		background-size: 800% 1100%;
		background-position: 0 0;
		animation: ted-bot-idle 5.6s steps(7, end) infinite;
	}
	.ted-bot.compact {
		width: 3rem;
		height: 3.25rem;
		border-bottom: 0;
	}
	@keyframes ted-bot-idle {
		to {
			background-position: 100% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ted-bot {
			animation: none;
		}
	}
</style>
