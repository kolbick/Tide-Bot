import { describe, expect, it, vi } from 'vitest';

import { installLifecycle } from './lifecycle';
import { BrowserTransport, computeReconnectDelay } from './transport';
import { createChromeMock, FakeSocket } from '../testing/chrome';

const command = (changes: Record<string, unknown> = {}) => ({
	version: 1,
	id: 'command-a',
	type: 'command.request',
	deviceId: 'device-a',
	userId: 'user-a',
	sessionId: 'session-a',
	timestamp: 1_000,
	deadlineAt: 31_000,
	nonce: 'nonce-a',
	sequence: 1,
	payload: {
		name: 'browser_observe',
		args: {},
		mutating: false
	},
	...changes
});

const auth = () => ({
	getAccessToken: vi.fn().mockResolvedValue('short-lived-access-token'),
	restore: vi.fn().mockResolvedValue(true),
	status: vi.fn().mockReturnValue({
		paired: true,
		serverOrigin: 'https://tide-bot.com',
		deviceId: 'device-a'
	})
});

describe('BrowserTransport', () => {
	it('authenticates the paired device room and handles a strict command acknowledgement', async () => {
		const socket = new FakeSocket();
		socket.acks.set('browser:device:join', () => ({
			ok: true,
			userId: 'user-a',
			deviceId: 'device-a'
		}));
		const executor = vi.fn().mockResolvedValue({ title: 'Example' });
		const transport = new BrowserTransport({
			auth: auth(),
			socketFactory: () => socket,
			executeCommand: executor,
			clock: () => 2_000
		});

		await transport.connect();
		expect(socket.emitted[0]).toEqual({
			event: 'browser:device:join',
			args: [
				{
					accessToken: 'short-lived-access-token',
					origin: 'https://tide-bot.com'
				}
			]
		});

		let acknowledged: unknown;
		await socket.trigger('browser:command:request', command(), (value: unknown) => {
			acknowledged = value;
		});

		expect(executor).toHaveBeenCalledWith(command());
		expect(acknowledged).toMatchObject({
			version: 1,
			id: 'command-a',
			type: 'command.result',
			deviceId: 'device-a',
			userId: 'user-a',
			sessionId: 'session-a',
			payload: { ok: true, value: { title: 'Example' }, nonce: 'nonce-a', sequence: 1 }
		});
	});

	it('opens and closes exactly one server-side browser session', async () => {
		const socket = new FakeSocket();
		socket.acks.set('browser:device:join', () => ({
			ok: true,
			userId: 'user-a',
			deviceId: 'device-a'
		}));
		socket.acks.set('browser:session:open', () => ({ ok: true, sessionId: 'session-a' }));
		socket.acks.set('browser:session:close', () => ({ ok: true }));
		const transport = new BrowserTransport({ auth: auth(), socketFactory: () => socket });
		await transport.connect();

		await transport.openSession({
			sessionId: 'session-a',
			tabId: 7,
			tabOrigin: 'https://example.com',
			actionMode: 'autonomous',
			tabPolicy: 'locked'
		});
		await transport.closeSession('session-a');

		expect(socket.emitted.slice(1)).toEqual([
			{
				event: 'browser:session:open',
				args: [
					{
						sessionId: 'session-a',
						tabId: 7,
						tabOrigin: 'https://example.com',
						actionMode: 'autonomous',
						tabPolicy: 'locked'
					}
				]
			},
			{ event: 'browser:session:close', args: [{ sessionId: 'session-a' }] }
		]);
	});

	it('rejects malformed, expired, cross-device, and oversized inbound envelopes', async () => {
		const socket = new FakeSocket();
		socket.acks.set('browser:device:join', () => ({
			ok: true,
			userId: 'user-a',
			deviceId: 'device-a'
		}));
		const executor = vi.fn();
		const transport = new BrowserTransport({
			auth: auth(),
			socketFactory: () => socket,
			executeCommand: executor,
			clock: () => 50_000
		});
		await transport.connect();

		for (const invalid of [
			command({ deadlineAt: 49_999 }),
			command({ deviceId: 'device-b' }),
			command({ secret: 'unknown-field' }),
			command({
				payload: {
					name: 'browser_observe',
					args: { value: 'x'.repeat(1_100_000) },
					mutating: false
				}
			})
		]) {
			let result: any;
			await socket.trigger(
				'browser:command:request',
				invalid,
				(value: unknown) => (result = value)
			);
			expect(result.payload).toMatchObject({ ok: false, error: { code: 'invalid_envelope' } });
		}
		expect(executor).not.toHaveBeenCalled();
	});

	it('returns a typed offline error when no connected executor is available', async () => {
		const transport = new BrowserTransport({
			auth: auth(),
			socketFactory: () => new FakeSocket(),
			clock: () => 2_000
		});

		const result = await transport.handleInboundCommand(command());

		expect(result.payload).toMatchObject({
			ok: false,
			error: { code: 'offline' }
		});
	});

	it('rejects duplicate command IDs and out-of-order sequence numbers', async () => {
		const socket = new FakeSocket();
		socket.acks.set('browser:device:join', () => ({
			ok: true,
			userId: 'user-a',
			deviceId: 'device-a'
		}));
		const executor = vi.fn().mockResolvedValue({ observed: true });
		const transport = new BrowserTransport({
			auth: auth(),
			socketFactory: () => socket,
			executeCommand: executor,
			clock: () => 2_000
		});
		await transport.connect();

		const first = await transport.handleInboundCommand(command());
		const replay = await transport.handleInboundCommand(command());
		const outOfOrder = await transport.handleInboundCommand(
			command({ id: 'command-b', nonce: 'nonce-b', sequence: 1 })
		);

		expect(first.payload.ok).toBe(true);
		expect(replay.payload).toMatchObject({
			ok: false,
			error: { code: 'replayed_command' }
		});
		expect(outOfOrder.payload).toMatchObject({
			ok: false,
			error: { code: 'out_of_order' }
		});
		expect(executor).toHaveBeenCalledTimes(1);
	});

	it('uses bounded exponential reconnect with jitter and never leaks the access token in status', async () => {
		expect(computeReconnectDelay(1, () => 0.5)).toBe(1_000);
		expect(computeReconnectDelay(2, () => 0.5)).toBe(2_000);
		expect(computeReconnectDelay(20, () => 0.5)).toBe(30_000);
		expect(computeReconnectDelay(1, () => 0)).toBe(500);
		expect(computeReconnectDelay(1, () => 1)).toBe(1_500);

		const socket = new FakeSocket();
		socket.acks.set('browser:device:join', () => ({
			ok: true,
			userId: 'user-a',
			deviceId: 'device-a'
		}));
		const reconnect = vi.fn();
		const disconnected = vi.fn();
		const transport = new BrowserTransport({
			auth: auth(),
			socketFactory: () => socket,
			random: () => 0.5,
			onReconnectNeeded: reconnect,
			onDisconnected: disconnected
		});
		await transport.connect();
		expect(JSON.stringify(transport.status())).not.toContain('short-lived-access-token');
		await socket.trigger('disconnect', 'transport close');
		expect(reconnect).toHaveBeenCalledWith(1_000);
		expect(disconnected).toHaveBeenCalledOnce();
	});

	it('schedules a reconnect when the initial socket connection fails', async () => {
		const socket = new FakeSocket();
		socket.connect = () => {
			queueMicrotask(() => void socket.trigger('connect_error', new Error('offline')));
			return socket;
		};
		const reconnect = vi.fn();
		const transport = new BrowserTransport({
			auth: auth(),
			socketFactory: () => socket,
			random: () => 0.5,
			onReconnectNeeded: reconnect
		});

		await expect(transport.connect()).rejects.toThrow('offline');
		expect(reconnect).toHaveBeenCalledWith(1_000);
	});

	it('uses Chrome alarms to restore, reconnect, and heartbeat after worker suspension', async () => {
		const mock = createChromeMock();
		const authSession = auth();
		const transport = {
			connect: vi.fn().mockResolvedValue(undefined),
			heartbeat: vi.fn().mockResolvedValue(true),
			status: vi.fn().mockReturnValue({ connected: true })
		};
		const lifecycle = installLifecycle({ auth: authSession, transport, chromeApi: mock.chrome });

		expect(mock.alarms.get('tide-bot-heartbeat')).toEqual({ periodInMinutes: 0.5 });
		await lifecycle.start();
		expect(authSession.restore).toHaveBeenCalled();
		expect(transport.connect).toHaveBeenCalled();
		authSession.restore.mockClear();
		transport.connect.mockClear();
		await mock.chrome.runtime.onStartup.fire();
		expect(authSession.restore).toHaveBeenCalled();
		expect(transport.connect).toHaveBeenCalled();

		await mock.fireAlarm('tide-bot-heartbeat');
		expect(transport.heartbeat).toHaveBeenCalled();
		await mock.fireAlarm('tide-bot-reconnect');
		expect(transport.connect).toHaveBeenCalledTimes(2);
	});
});
