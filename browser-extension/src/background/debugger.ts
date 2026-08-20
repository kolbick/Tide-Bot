const ALLOWED_DEBUGGER_METHODS = new Set([
	'Page.enable',
	'Runtime.enable',
	'Network.enable',
	'Page.captureScreenshot'
]);
const MAX_ENTRIES = 200;
const MAX_PENDING_REQUESTS = 500;
const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const VALID_RESOURCE_TYPES = new Set([
	'document',
	'stylesheet',
	'image',
	'media',
	'font',
	'script',
	'fetch',
	'xhr',
	'websocket',
	'other'
]);

interface DebuggerTarget {
	tabId: number;
}

interface DebuggerApi {
	attach(target: DebuggerTarget, version: string): Promise<void>;
	detach(target: DebuggerTarget): Promise<void>;
	sendCommand(
		target: DebuggerTarget,
		method: string,
		params?: Record<string, unknown>
	): Promise<any>;
	onEvent: {
		addListener(
			listener: (source: { tabId?: number }, method: string, params?: Record<string, any>) => void
		): void;
		removeListener?(
			listener: (source: { tabId?: number }, method: string, params?: Record<string, any>) => void
		): void;
	};
	onDetach?: {
		addListener(listener: (source: { tabId?: number }) => void): void;
	};
}

interface ConsoleEntry {
	severity: 'debug' | 'info' | 'warning' | 'error';
	summary: string;
}

interface NetworkEntry {
	method: string;
	url: string;
	resourceType: string;
	status: number;
	timing: { duration: number } | null;
}

interface PendingNetworkEntry {
	method: string;
	url: string;
	resourceType: string;
	startedAt?: number;
}

interface DebuggerFacadeOptions {
	debuggerApi: DebuggerApi;
	maxScreenshotBytes?: number;
}

export class DebuggerCapabilityError extends Error {
	constructor(public readonly code: string) {
		super(code);
		this.name = 'DebuggerCapabilityError';
	}
}

export function isAllowedDebuggerMethod(method: string) {
	return ALLOWED_DEBUGGER_METHODS.has(method);
}

function redactSummary(value: string) {
	return value
		.replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
		.replace(
			/\b(password|passwd|passcode|api[_-]?key|token|secret|card(?:number)?|cvv|cvc)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
			'$1=[REDACTED]'
		)
		.replace(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, '[REDACTED]')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 2_000);
}

function safeUrl(value: unknown) {
	if (typeof value !== 'string') return '';
	try {
		const parsed = new URL(value);
		if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
			return '';
		return `${parsed.origin}${parsed.pathname}`.slice(0, 2_048);
	} catch {
		return '';
	}
}

function base64ByteLength(value: string) {
	if (!/^[a-z0-9+/]*={0,2}$/i.test(value) || value.length % 4 !== 0) {
		throw new DebuggerCapabilityError('invalid_screenshot');
	}
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	return (value.length / 4) * 3 - padding;
}

export class DebuggerFacade {
	private readonly debuggerApi: DebuggerApi;
	private readonly maxScreenshotBytes: number;
	private tabId: number | null = null;
	private readonly consoleBuffer: ConsoleEntry[] = [];
	private readonly networkBuffer: NetworkEntry[] = [];
	private readonly pendingNetwork = new Map<string, PendingNetworkEntry>();
	private readonly eventListener: (
		source: { tabId?: number },
		method: string,
		params?: Record<string, any>
	) => void;

	constructor(options: DebuggerFacadeOptions) {
		this.debuggerApi = options.debuggerApi;
		this.maxScreenshotBytes = Math.max(1, options.maxScreenshotBytes ?? 2 * 1_024 * 1_024);
		this.eventListener = (source, method, params) => this.handleEvent(source, method, params);
		this.debuggerApi.onEvent.addListener(this.eventListener);
		this.debuggerApi.onDetach?.addListener((source) => {
			if (source.tabId === this.tabId) this.reset();
		});
	}

	status() {
		return { attached: this.tabId !== null, tabId: this.tabId };
	}

	async attach(tabId: number) {
		if (!Number.isInteger(tabId) || tabId < 0) throw new DebuggerCapabilityError('invalid_tab');
		if (this.tabId !== null) {
			if (this.tabId !== tabId) throw new DebuggerCapabilityError('second_tab_denied');
			return;
		}
		await this.debuggerApi.attach({ tabId }, '1.3');
		this.tabId = tabId;
		try {
			await this.request(tabId, 'Page.enable', {});
			await this.request(tabId, 'Runtime.enable', {});
			await this.request(tabId, 'Network.enable', {
				maxTotalBufferSize: 0,
				maxResourceBufferSize: 0,
				maxPostDataSize: 0
			});
		} catch (error) {
			await this.detach().catch(() => undefined);
			throw error;
		}
	}

	async detach() {
		if (this.tabId === null) return;
		const tabId = this.tabId;
		this.reset();
		await this.debuggerApi.detach({ tabId });
	}

	async request(tabId: number, method: string, params: Record<string, unknown> = {}) {
		if (!isAllowedDebuggerMethod(method)) {
			throw new DebuggerCapabilityError('debugger_method_denied');
		}
		this.assertControlledTab(tabId);
		return this.debuggerApi.sendCommand({ tabId }, method, params);
	}

	async screenshot(
		tabId: number,
		options: { format?: unknown; quality?: unknown; fullPage?: unknown }
	) {
		const format = options.format === 'jpeg' ? 'jpeg' : options.format === 'png' ? 'png' : null;
		if (!format) throw new DebuggerCapabilityError('invalid_arguments');
		const quality = Number(options.quality ?? 85);
		if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
			throw new DebuggerCapabilityError('invalid_arguments');
		}
		const response = await this.request(tabId, 'Page.captureScreenshot', {
			format,
			...(format === 'jpeg' ? { quality } : {}),
			captureBeyondViewport: options.fullPage === true,
			fromSurface: true
		});
		if (typeof response?.data !== 'string') {
			throw new DebuggerCapabilityError('invalid_screenshot');
		}
		const byteLength = base64ByteLength(response.data);
		if (byteLength > this.maxScreenshotBytes) {
			throw new DebuggerCapabilityError('screenshot_too_large');
		}
		return { format, data: response.data, byteLength };
	}

	consoleEntries(options: { levels?: string[]; maxEntries?: number } = {}) {
		const levels = new Set(options.levels ?? ['debug', 'info', 'warning', 'error']);
		const maxEntries = Math.max(1, Math.min(MAX_ENTRIES, options.maxEntries ?? 50));
		return this.consoleBuffer.filter((entry) => levels.has(entry.severity)).slice(-maxEntries);
	}

	networkEntries(
		options: { methods?: string[]; resourceTypes?: string[]; maxEntries?: number } = {}
	) {
		const methods = options.methods ? new Set(options.methods) : null;
		const resourceTypes = options.resourceTypes ? new Set(options.resourceTypes) : null;
		const maxEntries = Math.max(1, Math.min(MAX_ENTRIES, options.maxEntries ?? 50));
		return this.networkBuffer
			.filter(
				(entry) =>
					(!methods || methods.has(entry.method)) &&
					(!resourceTypes || resourceTypes.has(entry.resourceType))
			)
			.slice(-maxEntries);
	}

	private assertControlledTab(tabId: number) {
		if (this.tabId === null) throw new DebuggerCapabilityError('debugger_not_attached');
		if (tabId !== this.tabId) throw new DebuggerCapabilityError('second_tab_denied');
	}

	private handleEvent(
		source: { tabId?: number },
		method: string,
		params: Record<string, any> = {}
	) {
		if (this.tabId === null || source.tabId !== this.tabId) return;
		if (method === 'Runtime.consoleAPICalled') this.captureConsole(params);
		if (method === 'Network.requestWillBeSent') this.captureRequest(params);
		if (method === 'Network.responseReceived') this.captureResponse(params);
	}

	private captureConsole(params: Record<string, any>) {
		const severityMap: Record<string, ConsoleEntry['severity']> = {
			debug: 'debug',
			log: 'info',
			info: 'info',
			warning: 'warning',
			warn: 'warning',
			error: 'error',
			assert: 'error'
		};
		const severity = severityMap[params.type];
		if (!severity || !Array.isArray(params.args)) return;
		const summary = redactSummary(
			params.args
				.filter(
					(argument: any) => argument?.type === 'string' && typeof argument.value === 'string'
				)
				.map((argument: any) => argument.value)
				.join(' ')
		);
		if (!summary) return;
		this.consoleBuffer.push({ severity, summary });
		if (this.consoleBuffer.length > MAX_ENTRIES) this.consoleBuffer.shift();
	}

	private captureRequest(params: Record<string, any>) {
		if (typeof params.requestId !== 'string' || typeof params.request !== 'object') return;
		const method = String(params.request.method ?? '').toUpperCase();
		const url = safeUrl(params.request.url);
		const candidateType = String(params.type ?? 'other').toLowerCase();
		const resourceType = VALID_RESOURCE_TYPES.has(candidateType) ? candidateType : 'other';
		if (!VALID_METHODS.has(method) || !url) return;
		this.pendingNetwork.set(params.requestId, {
			method,
			url,
			resourceType,
			startedAt: typeof params.timestamp === 'number' ? params.timestamp : undefined
		});
		while (this.pendingNetwork.size > MAX_PENDING_REQUESTS) {
			this.pendingNetwork.delete(this.pendingNetwork.keys().next().value as string);
		}
	}

	private captureResponse(params: Record<string, any>) {
		if (typeof params.requestId !== 'string') return;
		const pending = this.pendingNetwork.get(params.requestId);
		this.pendingNetwork.delete(params.requestId);
		const status = params.response?.status;
		if (!pending || !Number.isInteger(status) || status < 0 || status > 599) return;
		const endedAt = typeof params.timestamp === 'number' ? params.timestamp : undefined;
		const duration =
			pending.startedAt !== undefined && endedAt !== undefined && endedAt >= pending.startedAt
				? Math.round((endedAt - pending.startedAt) * 1_000)
				: null;
		this.networkBuffer.push({
			method: pending.method,
			url: pending.url,
			resourceType: pending.resourceType,
			status,
			timing: duration === null ? null : { duration }
		});
		if (this.networkBuffer.length > MAX_ENTRIES) this.networkBuffer.shift();
	}

	private reset() {
		this.tabId = null;
		this.consoleBuffer.length = 0;
		this.networkBuffer.length = 0;
		this.pendingNetwork.clear();
	}
}
