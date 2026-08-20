<script lang="ts">
	import type { PanelChatSummary, PanelModel } from '../api';

	export let models: PanelModel[] = [];
	export let chats: PanelChatSummary[] = [];
	export let selectedModel = '';
	export let selectedChat = '';
	export let disabled = false;
	export let onChatChange: (id: string) => void;
</script>

<div class="picker-row">
	<label>
		<span>Model</span>
		<select aria-label="Model" bind:value={selectedModel} {disabled}>
			{#each models as model}
				<option value={model.id}>{model.name ?? model.id}</option>
			{/each}
		</select>
	</label>
	<label>
		<span>Chat</span>
		<select
			aria-label="Chat"
			bind:value={selectedChat}
			on:change={(event) => onChatChange((event.currentTarget as HTMLSelectElement).value)}
			{disabled}
		>
			<option value="">New chat</option>
			{#each chats as chat}
				<option value={chat.id}>{chat.title ?? 'Untitled chat'}</option>
			{/each}
		</select>
	</label>
</div>
