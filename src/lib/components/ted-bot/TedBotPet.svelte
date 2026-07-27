<script lang="ts">
	import { BRAND } from '$lib/branding';

	export let state: 'idle' | 'working' | 'offline' = 'idle';
	export let label = 'Ted-Bot';
	export let interactive = false;
</script>

<div
	class:working={state === 'working'}
	class:offline={state === 'offline'}
	class="ted-bot-pet"
	role="img"
	aria-label={label}
	data-interactive={interactive}
>
	<img src={BRAND.tedBotSpritePath} alt="" />
</div>

<style>
	.ted-bot-pet {
		width: 6rem;
		height: 6.5rem;
		overflow: hidden;
		flex: none;
		border-bottom: 1px solid rgb(83 216 236 / 25%);
	}

	.ted-bot-pet img {
		display: block;
		width: 48rem;
		height: 71.5rem;
		max-width: none;
		transform: translate(-0.1rem, -0.1rem);
		animation: ted-bot-idle 4s steps(8, end) infinite;
	}

	.ted-bot-pet.working img {
		animation-duration: 2s;
	}

	.ted-bot-pet.offline img {
		filter: grayscale(1);
	}

	@keyframes ted-bot-idle {
		to {
			transform: translateX(-42rem) translateY(-0.1rem);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ted-bot-pet img {
			animation: none;
		}
	}
</style>
