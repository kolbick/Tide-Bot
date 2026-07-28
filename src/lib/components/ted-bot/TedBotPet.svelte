<script lang="ts">
	import { BRAND } from '$lib/branding';

	export let state: 'idle' | 'working' | 'waiting' | 'failed' | 'offline' = 'idle';
	export let label = 'Ted-Bot';
	export let interactive = false;

	// Row layout matches the OpenAI hatch-pet contract this atlas was built
	// against (8 cols x 192x208px cells): one row per state, with each row's
	// used-column count and per-frame durations documented there. `columns`
	// below is the state's used-column count from that contract; `durationMs`
	// sums its per-frame durations so the loop's overall pace roughly matches
	// the spec without needing a variable-frame-duration keyframe.
	const ROWS: Record<string, { row: number; columns: number; durationMs: number; grayscale?: boolean }> = {
		idle: { row: 0, columns: 6, durationMs: 1100 },
		working: { row: 7, columns: 6, durationMs: 820 },
		waiting: { row: 6, columns: 6, durationMs: 1010 },
		failed: { row: 5, columns: 8, durationMs: 1220 },
		offline: { row: 0, columns: 6, durationMs: 1100, grayscale: true }
	};

	$: config = ROWS[state] ?? ROWS.idle;
</script>

<div
	class="ted-bot-pet"
	class:offline={config.grayscale}
	role="img"
	aria-label={label}
	data-interactive={interactive}
	data-state={state}
	style:--tb-row={config.row}
	style:--tb-columns={config.columns}
	style:--tb-duration="{config.durationMs}ms"
>
	<img src={BRAND.tedBotSpritePath} alt="" />
</div>

<style>
	.ted-bot-pet {
		width: 6rem;
		height: 6.5rem;
		overflow: hidden;
		flex: none;
	}

	.ted-bot-pet img {
		display: block;
		width: 48rem;
		height: 71.5rem;
		max-width: none;
		transform: translate(calc(-0.1rem), calc(var(--tb-row) * -6.5rem - 0.1rem));
		animation-name: ted-bot-cycle;
		animation-duration: var(--tb-duration);
		animation-timing-function: steps(var(--tb-columns), end);
		animation-iteration-count: infinite;
	}

	.ted-bot-pet.offline img {
		filter: grayscale(1);
	}

	@keyframes ted-bot-cycle {
		from {
			transform: translate(-0.1rem, calc(var(--tb-row) * -6.5rem - 0.1rem));
		}
		to {
			transform: translate(
				calc(var(--tb-columns) * -6rem - 0.1rem),
				calc(var(--tb-row) * -6.5rem - 0.1rem)
			);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ted-bot-pet img {
			animation: none;
		}
	}
</style>
