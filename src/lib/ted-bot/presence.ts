export const PRESENCE_HEARTBEAT_MS = 10_000;

export type CompanionPresenceUpdate = {
	clientId: string;
	chatId: string | null;
	chatTitle: string | null;
	deviceLabel: string;
	isFocused: boolean;
	focusedAt: number;
};

export type CompanionPresenceState = {
	active: CompanionPresenceUpdate | null;
	revision: number;
};

type PresenceSocket = {
	connected?: boolean;
	emit(event: 'companion:presence:update', payload: CompanionPresenceUpdate): void;
	emit(event: 'companion:presence:subscribe'): void;
	on(event: 'connect', listener: () => void): void;
	on(event: 'companion:presence:state', listener: (state: CompanionPresenceState) => void): void;
	off(event: 'connect', listener: () => void): void;
	off(event: 'companion:presence:state', listener: (state: CompanionPresenceState) => void): void;
};

type MainPresencePublisherOptions = {
	socket: PresenceSocket;
	clientId: string;
	deviceLabel: string;
	now?: () => number;
};

export const createMainPresencePublisher = ({
	socket,
	clientId,
	deviceLabel,
	now = Date.now
}: MainPresencePublisherOptions) => {
	let presence: CompanionPresenceUpdate = {
		clientId,
		chatId: null,
		chatTitle: null,
		deviceLabel,
		isFocused: false,
		focusedAt: 0
	};
	let destroyed = false;

	const publish = () => {
		if (!socket.connected) {
			return;
		}
		socket.emit('companion:presence:update', { ...presence });
	};
	const handleConnect = () => {
		publish();
	};
	const heartbeatInterval = setInterval(publish, PRESENCE_HEARTBEAT_MS);

	socket.on('connect', handleConnect);

	return {
		setChat(chatId: string | null, chatTitle: string | null) {
			presence = {
				...presence,
				chatId,
				chatTitle: chatId === null ? null : (chatTitle ?? '')
			};
			publish();
		},
		setFocused(isFocused: boolean) {
			presence = {
				...presence,
				isFocused,
				focusedAt: isFocused ? now() : presence.focusedAt
			};
			publish();
		},
		heartbeat: publish,
		destroy() {
			if (destroyed) {
				return;
			}
			destroyed = true;
			clearInterval(heartbeatInterval);
			socket.off('connect', handleConnect);
			presence = {
				...presence,
				isFocused: false
			};
			publish();
		}
	};
};

export const createCompanionPresenceSubscriber = (
	socket: PresenceSocket,
	apply: (state: CompanionPresenceState) => void
) => {
	let revision = -1;

	const onState = (state: CompanionPresenceState) => {
		if (state.revision <= revision) {
			return;
		}
		revision = state.revision;
		apply(state);
	};
	const subscribe = () => {
		revision = -1;
		socket.emit('companion:presence:subscribe');
	};

	socket.on('connect', subscribe);
	socket.on('companion:presence:state', onState);
	if (socket.connected) {
		subscribe();
	}

	return {
		onState,
		destroy() {
			socket.off('connect', subscribe);
			socket.off('companion:presence:state', onState);
		}
	};
};
