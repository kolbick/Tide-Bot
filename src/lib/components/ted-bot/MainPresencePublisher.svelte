<script lang="ts">
	import { onMount } from 'svelte';
	import type { Socket } from 'socket.io-client';
	import { v4 as uuidv4 } from 'uuid';

	import { chatId, chatTitle, socket } from '$lib/stores';
	import { createMainPresencePublisher } from '$lib/ted-bot/presence';
	import { emitMainPresence } from '$lib/ted-bot/tauriBridge';

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
		let isGenerating = false;
		let currentSocket: Socket | null = null;
		let publisher: ReturnType<typeof createMainPresencePublisher> | null = null;

		const publishTauriBridge = () => {
			emitMainPresence({
				chatId: currentChatId || null,
				chatTitle: currentChatId ? currentChatTitle || null : null,
				isGenerating
			});
		};
		const publishChat = () => {
			publishTauriBridge();
			if (!publisher || !hasChatId || !hasChatTitle) {
				return;
			}
			publisher.setChat(currentChatId || null, currentChatId ? currentChatTitle || null : null);
		};
		// Independent of Chat.svelte's internal `generating` state — reuses the
		// same 'chat:active' socket event Chat.svelte itself listens to, so this
		// needs no changes to that file at all.
		const handleSocketEvent = (event: { chat_id?: string; data?: { type?: string; data?: { active?: boolean } } }) => {
			if (event?.data?.type !== 'chat:active' || event.chat_id !== currentChatId) {
				return;
			}
			const nextGenerating = Boolean(event.data?.data?.active);
			if (nextGenerating === isGenerating) {
				return;
			}
			isGenerating = nextGenerating;
			publishTauriBridge();
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
			currentSocket?.off('events', handleSocketEvent);
			currentSocket = value;
			currentSocket?.on('events', handleSocketEvent);
			publisher = value
				? createMainPresencePublisher({
						socket: value,
						clientId,
						deviceLabel: 'Tide-Bot Browser'
					})
				: null;
			isGenerating = false;
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
			currentSocket?.off('events', handleSocketEvent);
			publisher?.destroy();
		};
	});
</script>
