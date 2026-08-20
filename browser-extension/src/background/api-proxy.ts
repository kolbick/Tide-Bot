const CHAT_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RESOURCE_ID = CHAT_ID;
const MAX_STREAM_BYTES = 4 * 1_024 * 1_024;
const MAX_AUDIO_BYTES = 12 * 1_024 * 1_024;
const AUDIO_MIME_TYPES = new Set([
	'audio/webm',
	'audio/mp4',
	'audio/mpeg',
	'audio/wav',
	'audio/ogg'
]);

interface AuthLike {
	getAccessToken(): Promise<string>;
	status(): { serverOrigin: string };
}

interface BrowserApiProxyOptions {
	auth: AuthLike;
	fetcher?: typeof fetch;
	sendMessage: (message: Record<string, unknown>) => Promise<unknown> | unknown;
	maxResponseBytes?: number;
}

export class BrowserApiProxyError extends Error {
	constructor(public readonly code: string) {
		super(code);
		this.name = 'BrowserApiProxyError';
	}
}

export function isAllowedBrowserApiRequest(method: string, path: string) {
	if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..')) return false;
	const upperMethod = method.toUpperCase();
	if (upperMethod === 'GET' && path === '/api/models') return true;
	if (upperMethod === 'GET' && /^\/api\/v1\/chats\/?\?page=[1-9][0-9]{0,3}$/.test(path))
		return true;
	if (upperMethod === 'POST' && path === '/api/v1/chats/new') return true;
	if (
		['GET', 'POST'].includes(upperMethod) &&
		new RegExp(`^/api/v1/chats/${CHAT_ID}$`, 'i').test(path)
	)
		return true;
	if (
		upperMethod === 'POST' &&
		['/api/chat/completions', '/api/v1/chat/completions'].includes(path)
	)
		return true;
	if (
		upperMethod === 'POST' &&
		['/api/v1/audio/transcriptions', '/api/v1/audio/speech'].includes(path)
	)
		return true;
	if (path === '/api/v1/browser-extension/workflows' && ['GET', 'POST'].includes(upperMethod))
		return true;
	if (
		['GET', 'PUT', 'DELETE'].includes(upperMethod) &&
		new RegExp(`^/api/v1/browser-extension/workflows/${RESOURCE_ID}$`, 'i').test(path)
	)
		return true;
	if (path === '/api/v1/browser-extension/schedules' && ['GET', 'POST'].includes(upperMethod))
		return true;
	if (
		['PUT', 'DELETE'].includes(upperMethod) &&
		new RegExp(`^/api/v1/browser-extension/schedules/${RESOURCE_ID}$`, 'i').test(path)
	)
		return true;
	if (
		upperMethod === 'POST' &&
		new RegExp(`^/api/v1/browser-extension/schedules/${RESOURCE_ID}/runs$`, 'i').test(path)
	)
		return true;
	return false;
}

function contentLength(response: Response) {
	const raw = response.headers.get('content-length');
	if (!raw) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

const activityLabel = (name: unknown) => {
	if (typeof name !== 'string' || !name.startsWith('browser_')) return null;
	const labels: Record<string, string> = {
		browser_observe: 'Observe page',
		browser_click: 'Click element',
		browser_type: 'Type in field',
		browser_select: 'Choose option',
		browser_scroll: 'Scroll page',
		browser_navigate: 'Navigate page',
		browser_screenshot: 'Capture screenshot',
		browser_download: 'Start download',
		browser_wait: 'Wait for page'
	};
	return labels[name] ?? 'Use browser tool';
};

function decodeBase64(value: unknown) {
	if (
		typeof value !== 'string' ||
		value.length > Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 4 ||
		!/^[a-z0-9+/]*={0,2}$/i.test(value)
	) {
		throw new BrowserApiProxyError('invalid_audio');
	}
	let binary: string;
	try {
		binary = atob(value);
	} catch {
		throw new BrowserApiProxyError('invalid_audio');
	}
	if (!binary.length || binary.length > MAX_AUDIO_BYTES) {
		throw new BrowserApiProxyError('invalid_audio');
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function encodeBase64(bytes: Uint8Array) {
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 32_768) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
	}
	return btoa(binary);
}

export class BrowserApiProxy {
	private readonly auth: AuthLike;
	private readonly fetcher: typeof fetch;
	private readonly sendMessage: BrowserApiProxyOptions['sendMessage'];
	private readonly maxResponseBytes: number;

	constructor(options: BrowserApiProxyOptions) {
		this.auth = options.auth;
		this.fetcher = options.fetcher ?? fetch.bind(globalThis);
		this.sendMessage = options.sendMessage;
		this.maxResponseBytes = Math.max(1, options.maxResponseBytes ?? 2 * 1_024 * 1_024);
	}

	async request(method: string, path: string, body?: unknown) {
		const response = await this.fetch(method, path, body);
		if (!response.ok) throw new BrowserApiProxyError(`api_http_${response.status}`);
		const declaredSize = contentLength(response);
		if (declaredSize !== null && declaredSize > this.maxResponseBytes) {
			throw new BrowserApiProxyError('api_response_too_large');
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > this.maxResponseBytes) {
			throw new BrowserApiProxyError('api_response_too_large');
		}
		if (!bytes.byteLength) return null;
		try {
			return JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			throw new BrowserApiProxyError('invalid_api_response');
		}
	}

	async streamChat(requestId: string, body: Record<string, unknown>) {
		if (!/^[a-z0-9_-]{1,128}$/i.test(requestId)) {
			throw new BrowserApiProxyError('invalid_request_id');
		}
		const response = await this.fetch('POST', '/api/chat/completions', body);
		if (!response.ok) throw new BrowserApiProxyError(`api_http_${response.status}`);
		if (!response.body) throw new BrowserApiProxyError('invalid_api_response');
		const contentType = response.headers.get('content-type') ?? '';
		if (contentType.includes('application/json')) {
			const value = await this.boundedJson(response);
			const content = value?.choices?.[0]?.message?.content;
			if (typeof content === 'string') await this.emit(requestId, 'delta', { value: content });
			await this.emit(requestId, 'done', { chatId: String(body.chat_id ?? '') || undefined });
			return;
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let totalBytes = 0;
		let finished = false;
		while (!finished) {
			const { value, done } = await reader.read();
			if (value) {
				totalBytes += value.byteLength;
				if (totalBytes > MAX_STREAM_BYTES) {
					await reader.cancel();
					throw new BrowserApiProxyError('api_response_too_large');
				}
				buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
			}
			if (done) buffer += decoder.decode();
			let boundary: number;
			while ((boundary = buffer.indexOf('\n\n')) >= 0) {
				const event = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				for (const line of event.split('\n')) {
					if (!line.startsWith('data:')) continue;
					const data = line.slice(5).trim();
					if (data === '[DONE]') {
						finished = true;
						break;
					}
					await this.handleStreamData(requestId, data);
				}
				if (finished) break;
			}
			if (done) finished = true;
		}
		await this.emit(requestId, 'done', { chatId: String(body.chat_id ?? '') || undefined });
	}

	async transcribeAudio(value: { data?: unknown; mimeType?: unknown }) {
		const mimeType =
			typeof value.mimeType === 'string' ? value.mimeType.split(';', 1)[0].toLowerCase() : '';
		if (!AUDIO_MIME_TYPES.has(mimeType)) throw new BrowserApiProxyError('invalid_audio');
		const bytes = decodeBase64(value.data);
		const extension: Record<string, string> = {
			'audio/webm': 'webm',
			'audio/mp4': 'm4a',
			'audio/mpeg': 'mp3',
			'audio/wav': 'wav',
			'audio/ogg': 'ogg'
		};
		const form = new FormData();
		form.append('file', new Blob([bytes], { type: mimeType }), `voice.${extension[mimeType]}`);
		const response = await this.fetchAuthorized('/api/v1/audio/transcriptions', {
			method: 'POST',
			body: form
		});
		if (!response.ok) throw new BrowserApiProxyError(`api_http_${response.status}`);
		const body = await this.boundedJson(response);
		if (typeof body?.text !== 'string' || body.text.length > 50_000) {
			throw new BrowserApiProxyError('invalid_api_response');
		}
		return body.text;
	}

	async synthesizeSpeech(value: { text?: unknown; voice?: unknown }) {
		if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 20_000) {
			throw new BrowserApiProxyError('invalid_speech_text');
		}
		const voice =
			typeof value.voice === 'string' && /^[a-z0-9_-]{1,40}$/i.test(value.voice)
				? value.voice
				: 'alloy';
		const response = await this.fetchAuthorized('/api/v1/audio/speech', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model: 'tts-1', input: value.text.trim(), voice })
		});
		if (!response.ok) throw new BrowserApiProxyError(`api_http_${response.status}`);
		const declared = contentLength(response);
		if (declared !== null && declared > MAX_AUDIO_BYTES) {
			throw new BrowserApiProxyError('api_response_too_large');
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) {
			throw new BrowserApiProxyError('api_response_too_large');
		}
		const mimeType = (response.headers.get('content-type') ?? 'audio/mpeg').split(';', 1)[0];
		if (!AUDIO_MIME_TYPES.has(mimeType)) throw new BrowserApiProxyError('invalid_api_response');
		return { data: encodeBase64(bytes), mimeType };
	}

	private async fetch(method: string, path: string, body?: unknown) {
		const normalizedMethod = method.toUpperCase();
		if (!isAllowedBrowserApiRequest(normalizedMethod, path)) {
			throw new BrowserApiProxyError('api_route_denied');
		}
		return this.fetchAuthorized(path, {
			method: normalizedMethod,
			headers: {
				accept: 'application/json, text/event-stream',
				...(body === undefined ? {} : { 'content-type': 'application/json' })
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
	}

	private async fetchAuthorized(path: string, init: RequestInit) {
		const status = this.auth.status();
		const token = await this.auth.getAccessToken();
		return this.fetcher(`${status.serverOrigin}${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${token}`,
				'x-tide-bot-origin': status.serverOrigin,
				...(init.headers ?? {})
			},
			credentials: 'omit',
			cache: 'no-store',
			redirect: 'error'
		});
	}

	private async boundedJson(response: Response): Promise<any> {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > this.maxResponseBytes) {
			throw new BrowserApiProxyError('api_response_too_large');
		}
		try {
			return JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			throw new BrowserApiProxyError('invalid_api_response');
		}
	}

	private async handleStreamData(requestId: string, raw: string) {
		let data: any;
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}
		const content =
			data?.choices?.[0]?.delta?.content ??
			(data?.type === 'chat:message:delta' ? data?.data?.content : undefined);
		if (typeof content === 'string' && content) {
			await this.emit(requestId, 'delta', { value: content.slice(0, 50_000) });
		}
		const toolName =
			data?.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name ??
			data?.data?.tool?.name ??
			data?.data?.name;
		const label = activityLabel(toolName);
		if (label) {
			await this.emit(requestId, 'activity', {
				value: { label, status: 'running' }
			});
		}
	}

	private async emit(requestId: string, event: string, value: Record<string, unknown>) {
		await this.sendMessage({
			type: 'tide-bot:api:stream',
			requestId,
			event,
			...value
		});
	}
}
