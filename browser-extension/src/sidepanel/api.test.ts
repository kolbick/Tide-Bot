import { describe, expect, it, vi } from 'vitest';

import { createSidePanelApi } from './api';

const runtime = () => ({
	sendMessage: vi.fn(async (message: any) => {
		if (message.type === 'tide-bot:api:request') {
			if (message.path === '/api/v1/browser-extension/workflows') {
				return {
					ok: true,
					value: [
						{
							id: 'workflow-a',
							name: 'Morning report',
							version: 1,
							definition: { schemaVersion: 1, origin: 'https://example.com', steps: [] }
						}
					]
				};
			}
			return { ok: true, value: { status: 'deleted' } };
		}
		if (message.type === 'tide-bot:recording:start') {
			return { ok: true, recordingId: 'recording-a' };
		}
		if (message.type === 'tide-bot:api:audio:transcribe') {
			return { ok: true, text: 'Open the tide report' };
		}
		if (message.type === 'tide-bot:api:audio:speech') {
			return { ok: true, data: 'AQIDBA==', mimeType: 'audio/mpeg' };
		}
		return { ok: false, error: 'unexpected_message' };
	}),
	onMessage: {
		addListener: vi.fn(),
		removeListener: vi.fn()
	}
});

describe('side-panel audio API', () => {
	it('sends transient audio bytes through the service worker and returns a transcript', async () => {
		const chromeRuntime = runtime();
		const api = createSidePanelApi(chromeRuntime);
		const audio = new Blob(['voice-bytes'], { type: 'audio/webm;codecs=opus' });

		await expect(api.transcribe(audio)).resolves.toBe('Open the tide report');
		expect(chromeRuntime.sendMessage).toHaveBeenCalledWith({
			type: 'tide-bot:api:audio:transcribe',
			audio: {
				data: 'dm9pY2UtYnl0ZXM=',
				mimeType: 'audio/webm;codecs=opus'
			}
		});
	});

	it('decodes Tide-Bot speech entirely in memory', async () => {
		const chromeRuntime = runtime();
		const api = createSidePanelApi(chromeRuntime);

		const speech = await api.speak('Finished.');

		expect(chromeRuntime.sendMessage).toHaveBeenCalledWith({
			type: 'tide-bot:api:audio:speech',
			text: 'Finished.'
		});
		expect(speech.type).toBe('audio/mpeg');
		expect(Array.from(new Uint8Array(await speech.arrayBuffer()))).toEqual([1, 2, 3, 4]);
	});

	it('lists encrypted-sync workflows and starts recording through the controlled tab', async () => {
		const chromeRuntime = runtime();
		const api = createSidePanelApi(chromeRuntime);

		await expect(api.workflows()).resolves.toEqual([
			expect.objectContaining({ id: 'workflow-a', name: 'Morning report', version: 1 })
		]);
		await expect(api.startRecording()).resolves.toEqual({ recordingId: 'recording-a' });
		expect(chromeRuntime.sendMessage).toHaveBeenCalledWith({ type: 'tide-bot:recording:start' });
	});
});
