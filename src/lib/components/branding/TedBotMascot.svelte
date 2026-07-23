<script lang="ts">
	import { BRAND } from '$lib/branding';

	export let label = 'Ted-Bot, Tide-Bot mascot';
</script>

<div class="ted-bot" role="img" aria-label={label}>
	<img src={BRAND.tedBotSpritePath} alt="" />
</div>

<style>
	.ted-bot {
		width: 6rem;
		height: 6.5rem;
		overflow: hidden;
		flex: none;
		border-bottom: 1px solid rgb(83 216 236 / 25%);
	}
	.ted-bot img {
		display: block;
		width: 48rem;
		height: 71.5rem;
		max-width: none;
		transform: translate(-0.1rem, -0.1rem);
		animation: ted-bot-idle 4s steps(8, end) infinite;
	}
	@keyframes ted-bot-idle {
		to {
			transform: translateX(-42rem) translateY(-0.1rem);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ted-bot img {
			animation: none;
		}
	}
</style>
