import type { VoiceMode } from '../shared/constants';

interface VoiceApi {
	transcribe(audio: Blob): Promise<string>;
	speak(text: string): Promise<Blob>;
}

interface RecorderLike {
	state: string;
	ondataavailable: ((event: { data: Blob }) => void) | null;
	onstop: (() => void) | null;
	start(): void;
	stop(): void;
}

interface VadLike {
	start(): void;
	stop(): void;
	destroy?(): void;
}

interface AudioLike {
	onended: (() => void) | null;
	play(): Promise<void> | void;
	pause(): void;
}

interface VoiceControllerOptions {
	api: VoiceApi;
	getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
	createRecorder?: (stream: MediaStream) => RecorderLike;
	createVad?: (
		stream: MediaStream,
		callbacks: { onSpeechStart: () => void; onSpeechEnd: () => void }
	) => VadLike;
	createAudio?: (url: string) => AudioLike;
	url?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
	onTranscript?: (text: string) => void;
	onSubmit?: (text: string) => Promise<void> | void;
	onStatus?: (status: VoiceStatus) => void;
}

export interface VoiceStatus {
	inputMode: 'text' | 'voice';
	voiceMode: VoiceMode;
	listening: boolean;
	recording: boolean;
	processing: boolean;
	error: string | null;
}

export class VoiceControllerError extends Error {
	constructor(public readonly code: string) {
		super(code);
		this.name = 'VoiceControllerError';
	}
}

class WebAudioVad implements VadLike {
	private readonly context: AudioContext;
	private readonly analyser: AnalyserNode;
	private readonly samples: Float32Array<ArrayBuffer>;
	private timer: ReturnType<typeof setInterval> | null = null;
	private speaking = false;
	private lastVoiceAt = 0;

	constructor(
		stream: MediaStream,
		private readonly callbacks: { onSpeechStart: () => void; onSpeechEnd: () => void }
	) {
		this.context = new AudioContext();
		const source = this.context.createMediaStreamSource(stream);
		this.analyser = this.context.createAnalyser();
		this.analyser.fftSize = 1_024;
		this.samples = new Float32Array(this.analyser.fftSize);
		source.connect(this.analyser);
	}

	start() {
		if (this.timer !== null) return;
		void this.context.resume();
		this.timer = setInterval(() => this.sample(), 80);
	}

	stop() {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
		if (this.speaking) this.callbacks.onSpeechEnd();
		this.speaking = false;
	}

	destroy() {
		this.stop();
		void this.context.close();
	}

	private sample() {
		this.analyser.getFloatTimeDomainData(this.samples);
		let energy = 0;
		for (const sample of this.samples) energy += sample * sample;
		const rms = Math.sqrt(energy / this.samples.length);
		const now = performance.now();
		if (rms >= 0.025) {
			this.lastVoiceAt = now;
			if (!this.speaking) {
				this.speaking = true;
				this.callbacks.onSpeechStart();
			}
		} else if (this.speaking && now - this.lastVoiceAt >= 650) {
			this.speaking = false;
			this.callbacks.onSpeechEnd();
		}
	}
}

const defaultRecorder = (stream: MediaStream) => {
	const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
		MediaRecorder.isTypeSupported(type)
	);
	return new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined) as RecorderLike;
};

export class VoiceController {
	private readonly options: Required<
		Pick<
			VoiceControllerOptions,
			'api' | 'getUserMedia' | 'createRecorder' | 'createVad' | 'createAudio' | 'url'
		>
	> &
		Pick<VoiceControllerOptions, 'onTranscript' | 'onSubmit' | 'onStatus'>;
	private current: VoiceStatus = {
		inputMode: 'text',
		voiceMode: 'hands-free',
		listening: false,
		recording: false,
		processing: false,
		error: null
	};
	private stream: MediaStream | null = null;
	private recorder: RecorderLike | null = null;
	private vad: VadLike | null = null;
	private chunks: Blob[] = [];
	private acceptSegment = false;
	private vadRunning = false;
	private playback: { audio: AudioLike; url: string } | null = null;

	constructor(options: VoiceControllerOptions) {
		this.options = {
			...options,
			getUserMedia:
				options.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints)),
			createRecorder: options.createRecorder ?? defaultRecorder,
			createVad: options.createVad ?? ((stream, callbacks) => new WebAudioVad(stream, callbacks)),
			createAudio: options.createAudio ?? ((url) => new Audio(url) as AudioLike),
			url: options.url ?? URL
		};
	}

	status(): VoiceStatus {
		return { ...this.current };
	}

	async selectVoice(mode: VoiceMode = 'hands-free') {
		if (!['hands-free', 'push-to-talk'].includes(mode)) {
			throw new VoiceControllerError('invalid_voice_mode');
		}
		this.current = { ...this.current, inputMode: 'voice', voiceMode: mode, error: null };
		this.emitStatus();
		try {
			if (!this.stream) await this.openMicrophone();
			this.configureMode();
			this.current = { ...this.current, listening: true };
			this.emitStatus();
		} catch (error) {
			this.current = {
				...this.current,
				inputMode: 'text',
				listening: false,
				error: 'microphone_denied'
			};
			this.emitStatus();
			throw new VoiceControllerError('microphone_denied');
		}
	}

	async setVoiceMode(mode: VoiceMode) {
		if (this.current.inputMode !== 'voice') return this.selectVoice(mode);
		this.current = { ...this.current, voiceMode: mode };
		this.configureMode();
		this.emitStatus();
	}

	beginPushToTalk() {
		if (this.current.inputMode !== 'voice' || this.current.voiceMode !== 'push-to-talk') return;
		this.startSegment();
	}

	endPushToTalk() {
		if (this.current.voiceMode !== 'push-to-talk') return;
		this.endSegment();
	}

	async speak(text: string) {
		const bounded = text.trim().slice(0, 20_000);
		if (!bounded) return;
		this.interrupt();
		const blob = await this.options.api.speak(bounded);
		const url = this.options.url.createObjectURL(blob);
		const audio = this.options.createAudio(url);
		this.playback = { audio, url };
		audio.onended = () => this.releasePlayback();
		try {
			await audio.play();
		} catch (error) {
			this.releasePlayback();
			throw error;
		}
	}

	interrupt() {
		if (!this.playback) return;
		this.playback.audio.pause();
		this.releasePlayback();
	}

	stop() {
		this.acceptSegment = false;
		if (this.recorder?.state === 'recording') this.recorder.stop();
		if (this.vad?.destroy) this.vad.destroy();
		else this.vad?.stop();
		this.vad = null;
		this.vadRunning = false;
		for (const track of this.stream?.getTracks() ?? []) track.stop();
		this.stream = null;
		this.recorder = null;
		this.chunks = [];
		this.interrupt();
		this.current = {
			...this.current,
			inputMode: 'text',
			listening: false,
			recording: false,
			processing: false
		};
		this.emitStatus();
	}

	private async openMicrophone() {
		this.stream = await this.options.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			video: false
		});
		this.recorder = this.options.createRecorder(this.stream);
		this.recorder.ondataavailable = (event) => {
			if (event.data.size > 0) this.chunks.push(event.data);
		};
		this.recorder.onstop = () => {
			const chunks = this.chunks;
			this.chunks = [];
			const accepted = this.acceptSegment;
			this.acceptSegment = false;
			this.current = { ...this.current, recording: false };
			this.emitStatus();
			if (accepted && chunks.length) void this.processSegment(chunks);
		};
		this.vad = this.options.createVad(this.stream, {
			onSpeechStart: () => this.startSegment(),
			onSpeechEnd: () => this.endSegment()
		});
	}

	private configureMode() {
		if (!this.vad) return;
		if (this.current.voiceMode === 'hands-free' && !this.vadRunning) {
			this.vad.start();
			this.vadRunning = true;
		} else if (this.current.voiceMode === 'push-to-talk' && this.vadRunning) {
			this.vad.stop();
			this.vadRunning = false;
		}
	}

	private startSegment() {
		if (!this.recorder || this.recorder.state === 'recording' || this.current.processing) return;
		this.interrupt();
		this.chunks = [];
		this.acceptSegment = true;
		this.recorder.start();
		this.current = { ...this.current, recording: true };
		this.emitStatus();
	}

	private endSegment() {
		if (!this.recorder || this.recorder.state !== 'recording') return;
		this.recorder.stop();
	}

	private async processSegment(chunks: Blob[]) {
		this.current = { ...this.current, processing: true };
		this.emitStatus();
		try {
			const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
			const transcript = (await this.options.api.transcribe(blob)).trim();
			if (!transcript) return;
			this.options.onTranscript?.(transcript);
			if (this.current.voiceMode === 'hands-free') await this.options.onSubmit?.(transcript);
		} finally {
			this.current = { ...this.current, processing: false };
			this.emitStatus();
		}
	}

	private releasePlayback() {
		if (!this.playback) return;
		this.options.url.revokeObjectURL(this.playback.url);
		this.playback.audio.onended = null;
		this.playback = null;
	}

	private emitStatus() {
		this.options.onStatus?.(this.status());
	}
}
