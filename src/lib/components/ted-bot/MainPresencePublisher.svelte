<script lang="ts">
	import { onMount } from 'svelte';
	import type { Socket } from 'socket.io-client';
	import { v4 as uuidv4 } from 'uuid';

	import { chatId, chatTitle, socket } from '$lib/stores';
	import { createMainPresencePublisher } from '$lib/ted-bot/presence';

	const CLIENT_ID_STORAGE_KEY = 'ted-bot-main-presence-client-id';

	onMount(() => {
		let clientId = sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
		if (!clientId) {
			clientId = uuidv4();
			sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
		}

		let currentChatId = '';
		let currentChatTitle = '';
		let hasChatId = false;
		let hasChatTitle = false;
		let currentSocket: Socket | null = null;
		let publisher: ReturnType<typeof createMainPresencePublisher> | null = null;

		const publishChat = () => {
			if (!publisher || !hasChatId || !hasChatTitle) {
				return;
			}
			publisher.setChat(currentChatId || null, currentChatId ? currentChatTitle || null : null);
		};
		const publishFocus = () => {
			publisher?.setFocused(document.hasFocus() && document.visibilityState === 'visible');
		};

		const unsubscribeChatId = chatId.subscribe((value) => {
			currentChatId = value;
			hasChatId = true;
			publishChat();
		});
		const unsubscribeChatTitle = chatTitle.subscribe((value) => {
			currentChatTitle = value;
			hasChatTitle = true;
			publishChat();
		});
		const unsubscribeSocket = socket.subscribe((value) => {
			if (value === currentSocket) {
				return;
			}
			publisher?.destroy();
			currentSocket = value;
			publisher = value
				? createMainPresencePublisher({
						socket: value,
						clientId,
						deviceLabel: 'Tide-Bot Browser'
					})
				: null;
			publishChat();
			publishFocus();
		});

		window.addEventListener('focus', publishFocus);
		window.addEventListener('blur', publishFocus);
		document.addEventListener('visibilitychange', publishFocus);

		return () => {
			window.removeEventListener('focus', publishFocus);
			window.removeEventListener('blur', publishFocus);
			document.removeEventListener('visibilitychange', publishFocus);
			unsubscribeSocket();
			unsubscribeChatId();
			unsubscribeChatTitle();
			publisher?.destroy();
		};
	});
</script>
