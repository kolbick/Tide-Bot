import { io } from 'socket.io-client';

import type { BrowserAuth } from './auth';
import type { ActionMode, TabPolicy } from '../shared/constants';
import {
	commandResult,
	isCommandRequest,
	type CommandRequest,
	type CommandResult
} from '../shared/protocol';

const SOCKET_PATH = '/ws/socket.io';
const MAX_RECONNECT_DELAY_MS = 30_000;
const REPLAY_TTL_MS = 5 * 60_000;
const MAX_REPLAY_ENTRIES = 1_000;

interface SocketLike {
	connected: boolean;
	auth?: Record<string, unknown>;
	on(event: string, handler: (...args: any[]) => unknown): SocketLike;
	off?(event: string): SocketLike;
	emit(event: string, ...args: unknown[]): SocketLike;
	emitWithAck(event: string, payload: unknown): Promise<any>;
	connect(): SocketLike;
	disconnect(): SocketLike;
}

type SocketFactory = (origin: string, options: Record<string, unknown>) => SocketLike;
type CommandExecutor = (request: CommandRequest) => Promise<unknown>;

interface AuthLike {
	getAccessToken(): Promise<string>;
	restore(): Promise<boolean>;
	status(): { paired: boolean; serverOrigin: string; deviceId: string | null };
}

interface BrowserTransportOptions {
	auth: AuthLike | BrowserAuth;
	socketFactory?: SocketFactory;
	executeCommand?: CommandExecutor;
	clock?: () => number;
	random?: () => number;
	setTimer?: (callback: () => void, milliseconds: number) => unknown;
	clearTimer?: (timer: unknown) => void;
	onReconnectNeeded?: (delayMilliseconds: number) => void;
	onDisconnected?: () => Promise<void> | void;
}

interface OpenBrowserSession {
	sessionId: string;
	tabId: number;
	tabOrigin: string;
	actionMode: ActionMode;
	tabPolicy: TabPolicy;
}

const defaultSocketFactory: SocketFactory = (origin, options) =>
	io(origin, options as any) as unknown as SocketLike;

export function computeReconnectDelay(attempt: number, random: () => number = Math.random) {
	const base = Math.min(MAX_RECONNECT_DELAY_MS, 1_000 * 2 ** Math.max(0, attempt - 1));
	return Math.round(base * (0.5 + random()));
}

export class BrowserTransport {
	private readonly auth: AuthLike;
	private readonly socketFactory: SocketFactory;
	private readonly executeCommand?: CommandExecutor;
	private readonly clock: () => number;
	private readonly random: () => number;
	private readonly setTimer: (callback: () => void, milliseconds: number) => unknown;
	private readonly clearTimer: (timer: unknown) => void;
	private readonly onReconnectNeeded?: (delayMilliseconds: number) => void;
	private readonly onDisconnected?: () => Promise<void> | void;
	private socket: SocketLike | null = null;
	private userId: string | null = null;
	private joined = false;
	private stopped = false;
	private reconnectAttempt = 0;
	private reconnectTimer: unknown = null;
	private connecting: Promise<void> | null = null;
	private readonly seenCommands = new Map<string, number>();
	private readonly lastSequenceBySession = new Map<string, number>();

	constructor(options: BrowserTransportOptions) {
		this.auth = options.auth;
		this.socketFactory = options.socketFactory ?? defaultSocketFactory;
		this.executeCommand = options.executeCommand;
		this.clock = options.clock ?? Date.now;
		this.random = options.random ?? Math.random;
		this.setTimer =
			options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
		this.clearTimer =
			options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
		this.onReconnectNeeded = options.onReconnectNeeded;
		this.onDisconnected = options.onDisconnected;
	}

	status() {
		const auth = this.auth.status();
		return {
			connected: this.joined && Boolean(this.socket?.connected),
			paired: auth.paired,
			serverOrigin: auth.serverOrigin,
			deviceId: auth.deviceId
		};
	}

	async connect(): Promise<void> {
		if (this.joined && this.socket?.connected) return;
		if (this.connecting) return this.connecting;
		this.stopped = false;
		this.connecting = this.performConnect();
		try {
			await this.connecting;
		} catch (error) {
			if (!this.stopped) this.scheduleReconnect();
			throw error;
		} finally {
			this.connecting = null;
		}
	}

	private async performConnect() {
		const authStatus = this.auth.status();
		if (!authStatus.paired || !authStatus.deviceId) throw new Error('not_paired');
		const accessToken = await this.auth.getAccessToken();
		if (this.reconnectTimer !== null) {
			this.clearTimer(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.socket) {
			this.socket.off?.('connect');
			this.socket.off?.('disconnect');
			this.socket.disconnect();
		}

		const socket = this.socketFactory(authStatus.serverOrigin, {
			path: SOCKET_PATH,
			transports: ['websocket'],
			autoConnect: false,
			reconnection: false,
			auth: { token: accessToken }
		});
		this.socket = socket;
		this.joined = false;
		this.userId = null;

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const fail = (error: unknown) => {
				if (settled) return;
				settled = true;
				reject(error instanceof Error ? error : new Error('socket_connection_failed'));
			};
			socket.on('connect_error', fail);
			socket.on('connect', async () => {
				try {
					const joined = await socket.emitWithAck('browser:device:join', {
						accessToken,
						origin: authStatus.serverOrigin
					});
					if (
						!joined?.ok ||
						joined.deviceId !== authStatus.deviceId ||
						typeof joined.userId !== 'string'
					) {
						throw new Error(joined?.error ?? 'device_join_failed');
					}
					this.userId = joined.userId;
					this.joined = true;
					this.reconnectAttempt = 0;
					this.lastSequenceBySession.clear();
					if (!settled) {
						settled = true;
						resolve();
					}
				} catch (error) {
					fail(error);
				}
			});
			socket.on('disconnect', () => {
				this.joined = false;
				this.userId = null;
				void Promise.resolve(this.onDisconnected?.()).catch(() => undefined);
				if (!this.stopped) this.scheduleReconnect();
			});
			socket.on(
				'browser:command:request',
				async (value: unknown, acknowledge?: (value: unknown) => void) => {
					const result = await this.handleInboundCommand(value);
					if (typeof acknowledge === 'function') acknowledge(result);
					else socket.emit('browser:command:result', result);
				}
			);
			socket.connect();
		});
	}

	async handleInboundCommand(value: unknown): Promise<CommandResult> {
		if (!isCommandRequest(value, this.clock())) {
			return this.invalidResult(
				value,
				'invalid_envelope',
				'The browser command envelope is invalid.'
			);
		}
		const status = this.auth.status();
		if (!this.joined || !this.socket?.connected) {
			return commandResult(
				value,
				{ ok: false, code: 'offline', message: 'Browser executor is offline.' },
				this.clock()
			);
		}
		if (value.deviceId !== status.deviceId || value.userId !== this.userId) {
			return commandResult(
				value,
				{ ok: false, code: 'invalid_envelope', message: 'Browser command identity mismatch.' },
				this.clock()
			);
		}
		this.pruneReplayCache();
		if (this.seenCommands.has(value.id)) {
			return commandResult(
				value,
				{ ok: false, code: 'replayed_command', message: 'Browser command was already handled.' },
				this.clock()
			);
		}
		const lastSequence = this.lastSequenceBySession.get(value.sessionId) ?? 0;
		if (value.sequence <= lastSequence) {
			return commandResult(
				value,
				{ ok: false, code: 'out_of_order', message: 'Browser command sequence is out of order.' },
				this.clock()
			);
		}
		this.seenCommands.set(value.id, this.clock());
		this.lastSequenceBySession.set(value.sessionId, value.sequence);
		if (!this.executeCommand) {
			return commandResult(
				value,
				{ ok: false, code: 'executor_unavailable', message: 'Browser executor is unavailable.' },
				this.clock()
			);
		}
		try {
			const result = await this.executeCommand(value);
			return commandResult(value, { ok: true, value: result }, this.clock());
		} catch (error) {
			const code =
				typeof error === 'object' && error !== null && typeof (error as any).code === 'string'
					? (error as any).code
					: 'executor_error';
			return commandResult(
				value,
				{ ok: false, code, message: 'The browser command could not be completed.' },
				this.clock()
			);
		}
	}

	async heartbeat(): Promise<boolean> {
		if (!this.joined || !this.socket?.connected) return false;
		const response = await this.socket.emitWithAck('browser:heartbeat', {});
		return response?.ok === true;
	}

	async openSession(session: OpenBrowserSession): Promise<void> {
		if (!this.joined || !this.socket?.connected) throw new Error('offline');
		const response = await this.socket.emitWithAck('browser:session:open', session);
		if (!response?.ok || response.sessionId !== session.sessionId) {
			throw new Error(response?.error ?? 'session_open_failed');
		}
	}

	async closeSession(sessionId: string): Promise<void> {
		if (!this.joined || !this.socket?.connected) return;
		const response = await this.socket.emitWithAck('browser:session:close', { sessionId });
		if (!response?.ok) throw new Error(response?.error ?? 'session_close_failed');
	}

	stop() {
		this.stopped = true;
		this.joined = false;
		this.userId = null;
		if (this.reconnectTimer !== null) this.clearTimer(this.reconnectTimer);
		this.reconnectTimer = null;
		this.socket?.disconnect();
		this.socket = null;
	}

	private scheduleReconnect() {
		this.reconnectAttempt += 1;
		const delay = computeReconnectDelay(this.reconnectAttempt, this.random);
		if (this.onReconnectNeeded) {
			this.onReconnectNeeded(delay);
			return;
		}
		this.reconnectTimer = this.setTimer(() => {
			void this.connect().catch(() => undefined);
		}, delay);
	}

	private pruneReplayCache() {
		const cutoff = this.clock() - REPLAY_TTL_MS;
		for (const [commandId, seenAt] of this.seenCommands) {
			if (seenAt < cutoff || this.seenCommands.size > MAX_REPLAY_ENTRIES) {
				this.seenCommands.delete(commandId);
			}
		}
	}

	private invalidResult(value: unknown, code: string, message: string): CommandResult {
		const record =
			typeof value === 'object' && value !== null ? (value as Record<string, any>) : {};
		const bounded = (candidate: unknown, fallbackValue: string) =>
			typeof candidate === 'string' && candidate ? candidate.slice(0, 128) : fallbackValue;
		const fallback: CommandRequest = {
			version: 1,
			id: bounded(record.id, 'invalid-command'),
			type: 'command.request',
			deviceId: bounded(record.deviceId, 'unknown-device'),
			userId: bounded(record.userId, 'unknown-user'),
			sessionId: bounded(record.sessionId, 'unknown-session'),
			timestamp: this.clock(),
			deadlineAt: this.clock(),
			nonce: bounded(record.nonce, 'invalid-nonce'),
			sequence: Number.isSafeInteger(record.sequence) ? record.sequence : 1,
			payload: { name: 'browser_observe', args: {}, mutating: false }
		};
		return commandResult(fallback, { ok: false, code, message }, this.clock());
	}
}
