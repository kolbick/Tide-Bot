import { describe, expect, it, vi } from 'vitest';

import { VoiceController } from './voice';

class FakeRecorder {
	state = 'inactive';
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void) | null = null;
	start = vi.fn(() => {
		this.state = 'recording';
	});
	stop = vi.fn(() => {
		this.ondataavailable?.({ data: new Blob(['voice-bytes'], { type: 'audio/webm' }) });
		this.state = 'inactive';
		this.onstop?.();
	});
}

const setup = (changes: Record<string, unknown> = {}) => {
	let speechStart: () => void = () => undefined;
	let speechEnd: () => void = () => undefined;
	const recorder = new FakeRecorder();
	const vad = { start: vi.fn(), stop: vi.fn() };
	const track = { stop: vi.fn() };
	const api = {
		transcribe: vi.fn(async (_audio: Blob) => 'Turn on the porch light'),
		speak: vi.fn(async () => new Blob(['speech'], { type: 'audio/mpeg' }))
	};
	const submitted: string[] = [];
	const transcripts: string[] = [];
	const audio = {
		play: vi.fn(async () => undefined),
		pause: vi.fn(),
		onended: null as (() => void) | null
	};
	const url = { createObjectURL: vi.fn(() => 'blob:voice'), revokeObjectURL: vi.fn() };
	const controller = new VoiceController({
		api,
		getUserMedia: vi.fn(async () => ({ getTracks: () => [track] }) as any),
		createRecorder: () => recorder as any,
		createVad: (_stream, callbacks) => {
			speechStart = callbacks.onSpeechStart;
			speechEnd = callbacks.onSpeechEnd;
			return vad;
		},
		createAudio: () => audio as any,
		url,
		onTranscript: (text) => transcripts.push(text),
		onSubmit: async (text) => {
			submitted.push(text);
		},
		...(changes as any)
	});
	return {
		controller,
		api,
		recorder,
		vad,
		track,
		audio,
		url,
		submitted,
		transcripts,
		speechStart: () => speechStart(),
		speechEnd: () => speechEnd()
	};
};

describe('VoiceController', () => {
	it('starts in text and selects hands-free as the default voice mode', async () => {
		const { controller, vad } = setup();

		expect(controller.status()).toMatchObject({ inputMode: 'text', voiceMode: 'hands-free' });
		await controller.selectVoice();

		expect(controller.status()).toMatchObject({
			inputMode: 'voice',
			voiceMode: 'hands-free',
			listening: true
		});
		expect(vad.start).toHaveBeenCalledOnce();
	});

	it('uses VAD segments and submits hands-free transcripts without another tap', async () => {
		const { controller, recorder, api, submitted, transcripts, speechStart, speechEnd } = setup();
		await controller.selectVoice();

		speechStart();
		speechEnd();
		await vi.waitFor(() => expect(submitted).toEqual(['Turn on the porch light']));

		expect(recorder.start).toHaveBeenCalledOnce();
		expect(recorder.stop).toHaveBeenCalledOnce();
		expect(api.transcribe.mock.calls[0][0]).toBeInstanceOf(Blob);
		expect(transcripts).toEqual(['Turn on the porch light']);
	});

	it('keeps push-to-talk opt-in and waits for an explicit send', async () => {
		const { controller, vad, submitted, transcripts } = setup();
		await controller.selectVoice('push-to-talk');

		expect(controller.status().voiceMode).toBe('push-to-talk');
		expect(vad.start).not.toHaveBeenCalled();
		controller.beginPushToTalk();
		controller.endPushToTalk();
		await vi.waitFor(() => expect(transcripts).toEqual(['Turn on the porch light']));

		expect(submitted).toEqual([]);
	});

	it('plays Tide-Bot speech and interruption stops playback and revokes object URLs', async () => {
		const { controller, api, audio, url } = setup();

		await controller.speak('Done.');

		expect(api.speak).toHaveBeenCalledWith('Done.');
		expect(audio.play).toHaveBeenCalledOnce();
		controller.interrupt();
		expect(audio.pause).toHaveBeenCalledOnce();
		expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:voice');
	});

	it('releases speech blobs when browser playback fails', async () => {
		const { controller, url } = setup({
			createAudio: () => ({
				play: vi.fn(async () => {
					throw new DOMException('Playback blocked', 'NotAllowedError');
				}),
				pause: vi.fn(),
				onended: null
			})
		});

		await expect(controller.speak('Done.')).rejects.toThrow('Playback blocked');
		expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:voice');
	});

	it('recovers from microphone denial and never touches extension storage', async () => {
		const storage = { set: vi.fn(), get: vi.fn() };
		const { controller } = setup({
			getUserMedia: vi.fn(async () => {
				throw new DOMException('Denied', 'NotAllowedError');
			}),
			storage
		});

		await expect(controller.selectVoice()).rejects.toMatchObject({ code: 'microphone_denied' });
		expect(controller.status()).toMatchObject({ inputMode: 'text', listening: false });
		expect(storage.set).not.toHaveBeenCalled();
	});
});
