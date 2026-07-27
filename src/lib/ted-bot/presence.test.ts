import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
	PRESENCE_HEARTBEAT_MS,
	createCompanionPresenceSubscriber,
	createMainPresencePublisher,
	type CompanionPresenceState
} from './presence';
import { isCompanionRoute } from './routes';

type Listener = (() => void) | ((value: CompanionPresenceState) => void);

const createFakeSocket = (connected = true) => {
	const listeners = new Map<string, Set<Listener>>();
	const emissions: Array<{ event: string; payload: unknown }> = [];

	return {
		connected,
		emit(event: string, payload?: unknown) {
			emissions.push({ event, payload });
		},
		on(event: string, listener: Listener) {
			const eventListeners = listeners.get(event) ?? new Set();
			eventListeners.add(listener);
			listeners.set(event, eventListeners);
		},
		off(event: string, listener: Listener) {
			listeners.get(event)?.delete(listener);
		},
		connect() {
			this.connected = true;
			for (const listener of listeners.get('connect') ?? []) {
				(listener as () => void)();
			}
		},
		emitted(event: string) {
			return emissions.filter((emission) => emission.event === event);
		}
	};
};

const createBufferingFakeSocket = () => {
	const listeners = new Map<string, Set<Listener>>();
	const buffered: Array<{ event: string; payload: unknown }> = [];
	const delivered: Array<{ event: string; payload: unknown }> = [];

	return {
		connected: false,
		emit(event: string, payload?: unknown) {
			const emission = { event, payload };
			if (this.connected) {
				delivered.push(emission);
			} else {
				buffered.push(emission);
			}
		},
		on(event: string, listener: Listener) {
			const eventListeners = listeners.get(event) ?? new Set();
			eventListeners.add(listener);
			listeners.set(event, eventListeners);
		},
		off(event: string, listener: Listener) {
			listeners.get(event)?.delete(listener);
		},
		connect() {
			this.connected = true;
			delivered.push(...buffered);
			buffered.length = 0;
			for (const listener of listeners.get('connect') ?? []) {
				(listener as () => void)();
			}
		},
		buffered(event: string) {
			return buffered.filter((emission) => emission.event === event);
		},
		delivered(event: string) {
			return delivered.filter((emission) => emission.event === event);
		}
	};
};

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

test('publishes chat selection, focus, and heartbeat with only presence metadata', () => {
	const socket = createFakeSocket();
	const publisher = createMainPresencePublisher({
		socket,
		clientId: 'main-1',
		deviceLabel: 'Tide-Bot Browser',
		now: () => 100
	});

	publisher.setChat('chat-1', 'Treatment notes');
	publisher.setFocused(true);
	vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS);

	expect(socket.emitted('companion:presence:update')).toEqual([
		{
			event: 'companion:presence:update',
			payload: {
				clientId: 'main-1',
				chatId: 'chat-1',
				chatTitle: 'Treatment notes',
				deviceLabel: 'Tide-Bot Browser',
				isFocused: false,
				focusedAt: 0
			}
		},
		{
			event: 'companion:presence:update',
			payload: {
				clientId: 'main-1',
				chatId: 'chat-1',
				chatTitle: 'Treatment notes',
				deviceLabel: 'Tide-Bot Browser',
				isFocused: true,
				focusedAt: 100
			}
		},
		{
			event: 'companion:presence:update',
			payload: {
				clientId: 'main-1',
				chatId: 'chat-1',
				chatTitle: 'Treatment notes',
				deviceLabel: 'Tide-Bot Browser',
				isFocused: true,
				focusedAt: 100
			}
		}
	]);

	publisher.destroy();
});

test('republishes on reconnect and publishes unfocused state on destroy', () => {
	const socket = createFakeSocket();
	const publisher = createMainPresencePublisher({
		socket,
		clientId: 'main-1',
		deviceLabel: 'Tide-Bot Browser',
		now: () => 200
	});

	publisher.setChat('chat-1', 'Treatment notes');
	publisher.setFocused(true);
	socket.connect();
	publisher.destroy();
	vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS);

	const updates = socket.emitted('companion:presence:update');
	expect(updates).toHaveLength(4);
	expect(updates.at(-1)?.payload).toEqual({
		clientId: 'main-1',
		chatId: 'chat-1',
		chatTitle: 'Treatment notes',
		deviceLabel: 'Tide-Bot Browser',
		isFocused: false,
		focusedAt: 200
	});
});

test('keeps only the latest local state while disconnected and emits it once on reconnect', () => {
	const socket = createBufferingFakeSocket();
	const publisher = createMainPresencePublisher({
		socket,
		clientId: 'main-1',
		deviceLabel: 'Tide-Bot Browser',
		now: () => 300
	});

	publisher.setChat('chat-old', 'Old chat');
	publisher.setFocused(true);
	vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 31);
	publisher.setChat('chat-latest', 'Latest chat');

	expect(socket.buffered('companion:presence:update')).toHaveLength(0);

	socket.connect();

	expect(socket.delivered('companion:presence:update')).toEqual([
		{
			event: 'companion:presence:update',
			payload: {
				clientId: 'main-1',
				chatId: 'chat-latest',
				chatTitle: 'Latest chat',
				deviceLabel: 'Tide-Bot Browser',
				isFocused: true,
				focusedAt: 300
			}
		}
	]);

	publisher.destroy();
});

test('publishes an empty chat selection without inventing route-derived chat data', () => {
	const socket = createFakeSocket();
	const publisher = createMainPresencePublisher({
		socket,
		clientId: 'main-1',
		deviceLabel: 'Tide-Bot Browser',
		now: () => 100
	});

	publisher.setChat(null, null);

	expect(socket.emitted('companion:presence:update').at(-1)?.payload).toMatchObject({
		chatId: null,
		chatTitle: null
	});

	publisher.destroy();
});

test('keeps selected chat fields paired when a title has not loaded yet', () => {
	const socket = createFakeSocket();
	const publisher = createMainPresencePublisher({
		socket,
		clientId: 'main-1',
		deviceLabel: 'Tide-Bot Browser',
		now: () => 100
	});

	publisher.setChat('chat-1', null);

	expect(socket.emitted('companion:presence:update').at(-1)?.payload).toMatchObject({
		chatId: 'chat-1',
		chatTitle: ''
	});

	publisher.destroy();
});

test('ignores stale presence revisions', () => {
	const apply = vi.fn();
	const subscriber = createCompanionPresenceSubscriber(createFakeSocket(), apply);

	subscriber.onState({ active: null, revision: 2 });
	subscriber.onState({ active: null, revision: 1 });

	expect(apply).toHaveBeenCalledTimes(1);
	subscriber.destroy();
});

test('resets the browser revision on reconnect before accepting a fresh subscription snapshot', () => {
	const socket = createFakeSocket(false);
	const apply = vi.fn();
	const subscriber = createCompanionPresenceSubscriber(socket, apply);

	subscriber.onState({ active: null, revision: 8 });
	socket.connect();
	expect(socket.emitted('companion:presence:subscribe')).toHaveLength(1);
	subscriber.onState({ active: null, revision: 1 });
	subscriber.onState({ active: null, revision: 1 });

	expect(apply).toHaveBeenCalledTimes(2);
	subscriber.destroy();
});

test('renews a live companion subscription and stops renewing after destroy', () => {
	const socket = createFakeSocket();
	const subscriber = createCompanionPresenceSubscriber(socket, vi.fn());

	expect(socket.emitted('companion:presence:subscribe')).toHaveLength(1);
	vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 3);
	expect(socket.emitted('companion:presence:subscribe')).toHaveLength(4);

	subscriber.destroy();
	vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS);
	expect(socket.emitted('companion:presence:subscribe')).toHaveLength(4);
});

test('matches only the dedicated companion pathname', () => {
	expect(isCompanionRoute('/companion')).toBe(true);
	expect(isCompanionRoute('/companion/')).toBe(false);
	expect(isCompanionRoute('/c/companion')).toBe(false);
});
