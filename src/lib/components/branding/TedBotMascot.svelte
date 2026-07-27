<script lang="ts">
	import TedBotPet from '$lib/components/ted-bot/TedBotPet.svelte';

	export let label = 'Ted-Bot, Tide-Bot mascot';
</script>

<TedBotPet state="idle" {label} />
