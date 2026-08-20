import { describe, expect, it, vi } from 'vitest';

import { BrowserApiProxy, isAllowedBrowserApiRequest } from './api-proxy';

const response = (body: BodyInit, init: ResponseInit = {}) => new Response(body, init);

describe('BrowserApiProxy', () => {
	it('allows only the chat, model, and audio routes required by the side panel', () => {
		expect(isAllowedBrowserApiRequest('GET', '/api/models')).toBe(true);
		expect(isAllowedBrowserApiRequest('GET', '/api/v1/chats/?page=1')).toBe(true);
		expect(isAllowedBrowserApiRequest('POST', '/api/v1/chats/new')).toBe(true);
		expect(
			isAllowedBrowserApiRequest('GET', '/api/v1/chats/123e4567-e89b-12d3-a456-426614174000')
		).toBe(true);
		expect(isAllowedBrowserApiRequest('POST', '/api/chat/completions')).toBe(true);
		expect(isAllowedBrowserApiRequest('POST', '/api/v1/audio/transcriptions')).toBe(true);
		expect(isAllowedBrowserApiRequest('POST', '/api/v1/audio/speech')).toBe(true);
		expect(isAllowedBrowserApiRequest('GET', '/api/v1/browser-extension/workflows')).toBe(true);
		expect(
			isAllowedBrowserApiRequest(
				'PUT',
				'/api/v1/browser-extension/workflows/123e4567-e89b-12d3-a456-426614174000'
			)
		).toBe(true);
		expect(isAllowedBrowserApiRequest('GET', '/api/v1/browser-extension/schedules')).toBe(true);
		expect(
			isAllowedBrowserApiRequest(
				'POST',
				'/api/v1/browser-extension/schedules/123e4567-e89b-12d3-a456-426614174000/runs'
			)
		).toBe(true);
		for (const [method, path] of [
			['GET', '/api/v1/users'],
			['GET', '/api/v1/browser-extension/devices'],
			['DELETE', '/api/v1/chats/123e4567-e89b-12d3-a456-426614174000'],
			['POST', '/api/models/unload'],
			['GET', 'https://evil.example/api/models'],
			['GET', '/api/models/../users']
		]) {
			expect(isAllowedBrowserApiRequest(method, path)).toBe(false);
		}
	});

	it('adds the memory-only device token without returning or logging it', async () => {
		const fetcher = vi.fn(async () =>
			response(JSON.stringify([{ id: 'local-model', name: 'Local' }]), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		const auth = {
			getAccessToken: vi.fn(async () => 'memory-only-browser-token'),
			status: vi.fn(() => ({ serverOrigin: 'https://tide-bot.com' }))
		};
		const proxy = new BrowserApiProxy({ auth, fetcher, sendMessage: vi.fn() });

		const value = await proxy.request('GET', '/api/models');

		expect(value).toEqual([{ id: 'local-model', name: 'Local' }]);
		expect(fetcher).toHaveBeenCalledWith(
			'https://tide-bot.com/api/models',
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({
					authorization: 'Bearer memory-only-browser-token',
					'x-tide-bot-origin': 'https://tide-bot.com'
				}),
				credentials: 'omit',
				redirect: 'error'
			})
		);
		expect(JSON.stringify(value)).not.toContain('browser-token');
	});

	it('streams bounded assistant deltas and sanitized tool activity to the panel', async () => {
		const stream = [
			'data: {"choices":[{"delta":{"content":"Hello "}}]}',
			'',
			'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"browser_observe","arguments":"{\\"secret\\":\\"drop\\"}"}}]}}]}',
			'',
			'data: {"type":"chat:message:delta","data":{"content":"world"}}',
			'',
			'data: [DONE]',
			''
		].join('\n');
		const sent: unknown[] = [];
		const proxy = new BrowserApiProxy({
			auth: {
				getAccessToken: vi.fn(async () => 'token'),
				status: () => ({ serverOrigin: 'https://tide-bot.com' })
			},
			fetcher: vi.fn(async () =>
				response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
			),
			sendMessage: async (message) => {
				sent.push(message);
			}
		});

		await proxy.streamChat('request-a', {
			model: 'local-model',
			stream: true,
			chat_id: '123e4567-e89b-12d3-a456-426614174000'
		});

		expect(sent).toEqual([
			{
				type: 'tide-bot:api:stream',
				requestId: 'request-a',
				event: 'delta',
				value: 'Hello '
			},
			{
				type: 'tide-bot:api:stream',
				requestId: 'request-a',
				event: 'activity',
				value: { label: 'Observe page', status: 'running' }
			},
			{
				type: 'tide-bot:api:stream',
				requestId: 'request-a',
				event: 'delta',
				value: 'world'
			},
			{
				type: 'tide-bot:api:stream',
				requestId: 'request-a',
				event: 'done',
				chatId: '123e4567-e89b-12d3-a456-426614174000'
			}
		]);
		expect(JSON.stringify(sent)).not.toMatch(/secret|arguments|drop/);
	});

	it('caps response sizes and reduces server errors to stable codes', async () => {
		const sendMessage = vi.fn();
		const auth = {
			getAccessToken: vi.fn(async () => 'token'),
			status: () => ({ serverOrigin: 'https://tide-bot.com' })
		};
		const oversized = new BrowserApiProxy({
			auth,
			fetcher: vi.fn(async () => response(JSON.stringify({ value: 'x'.repeat(500) }))),
			sendMessage,
			maxResponseBytes: 100
		});
		await expect(oversized.request('GET', '/api/models')).rejects.toMatchObject({
			code: 'api_response_too_large'
		});

		const failed = new BrowserApiProxy({
			auth,
			fetcher: vi.fn(async () => response('password=hunter2', { status: 500 })),
			sendMessage
		});
		await expect(failed.request('GET', '/api/models')).rejects.toMatchObject({
			code: 'api_http_500'
		});
	});

	it('proxies ephemeral STT and TTS bytes without exposing the device token', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				response(JSON.stringify({ text: 'Hands free transcript' }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
			.mockResolvedValueOnce(
				response(new Uint8Array([1, 2, 3, 4]), {
					status: 200,
					headers: { 'content-type': 'audio/mpeg' }
				})
			);
		const proxy = new BrowserApiProxy({
			auth: {
				getAccessToken: vi.fn(async () => 'memory-only-token'),
				status: () => ({ serverOrigin: 'https://tide-bot.com' })
			},
			fetcher,
			sendMessage: vi.fn()
		});

		const transcript = await proxy.transcribeAudio({
			data: btoa('voice-bytes'),
			mimeType: 'audio/webm'
		});
		expect(transcript).toBe('Hands free transcript');
		const transcriptionRequest = fetcher.mock.calls[0];
		expect(transcriptionRequest[0]).toBe('https://tide-bot.com/api/v1/audio/transcriptions');
		expect(transcriptionRequest[1]?.body).toBeInstanceOf(FormData);
		expect(String(transcriptionRequest[1]?.headers)).not.toContain('voice-bytes');

		const speech = await proxy.synthesizeSpeech({ text: 'Finished.' });
		expect(speech).toEqual({
			data: 'AQIDBA==',
			mimeType: 'audio/mpeg'
		});
		expect(JSON.stringify({ transcript, speech })).not.toContain('memory-only-token');
	});
});
