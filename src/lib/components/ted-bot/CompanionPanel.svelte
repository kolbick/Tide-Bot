<script lang="ts">
	import Chat from '$lib/components/chat/Chat.svelte';

	export let chatId: string;
</script>

<div class="h-full min-h-0 w-full">
	<Chat chatIdProp={chatId} surface="companion" />
</div>
