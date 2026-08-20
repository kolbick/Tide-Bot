import type { BrowserCommand } from '../shared/protocol';
import type { DebuggerFacade } from './debugger';
import type { DownloadManager } from './downloads';
import { pageIdentity, type SingleTabController } from './tab-controller';

const CONTENT_MESSAGE_SOURCE = 'tide-bot-browser-control';
const DOM_COMMANDS = new Set([
	'browser_observe',
	'browser_click',
	'browser_type',
	'browser_select',
	'browser_scroll',
	'browser_wait',
	'browser_dom'
]);

interface TabsApi {
	sendMessage(tabId: number, message: Record<string, unknown>): Promise<any>;
	update(tabId: number, properties: { url: string }): Promise<unknown>;
	goBack(tabId: number): Promise<unknown>;
	goForward(tabId: number): Promise<unknown>;
	reload(tabId: number): Promise<unknown>;
}

interface TabControllerLike {
	requireControlledTab(tabId?: number): ReturnType<SingleTabController['requireControlledTab']>;
}

interface DebuggerFacadeLike {
	status(): { attached: boolean; tabId: number | null };
	attach(tabId: number): Promise<void>;
	detach(): Promise<void>;
	screenshot(tabId: number, options: Record<string, unknown>): Promise<unknown>;
	consoleEntries(options?: Record<string, any>): unknown;
	networkEntries(options?: Record<string, any>): unknown;
}

interface DownloadManagerLike {
	start(tabId: number, options: { url?: unknown; filename?: unknown }): Promise<unknown>;
}

interface BrowserExecutorOptions {
	tabs: TabsApi;
	tabController: TabControllerLike;
	debuggerFacade: DebuggerFacadeLike | DebuggerFacade;
	downloads: DownloadManagerLike | DownloadManager;
	recordingHandler?: (tabId: number, args: Record<string, unknown>) => Promise<unknown>;
}

export class BrowserExecutionError extends Error {
	constructor(public readonly code: string) {
		super(code);
		this.name = 'BrowserExecutionError';
	}
}

const asRecord = (value: unknown): Record<string, any> => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new BrowserExecutionError('invalid_arguments');
	}
	return value as Record<string, any>;
};

export class BrowserExecutor {
	private readonly tabs: TabsApi;
	private readonly tabController: TabControllerLike;
	private readonly debuggerFacade: DebuggerFacadeLike;
	private readonly downloads: DownloadManagerLike;
	private readonly recordingHandler?: BrowserExecutorOptions['recordingHandler'];
	private currentPageSignals: string[] = [];

	constructor(options: BrowserExecutorOptions) {
		this.tabs = options.tabs;
		this.tabController = options.tabController;
		this.debuggerFacade = options.debuggerFacade;
		this.downloads = options.downloads;
		this.recordingHandler = options.recordingHandler;
	}

	async execute(command: BrowserCommand) {
		const session = this.tabController.requireControlledTab();
		const args = asRecord(command.args);
		if (DOM_COMMANDS.has(command.name))
			return this.contentAction(session.tabId, command.name, args);
		switch (command.name) {
			case 'browser_navigate': {
				if (typeof args.url !== 'string') throw new BrowserExecutionError('invalid_arguments');
				let identity: ReturnType<typeof pageIdentity>;
				try {
					identity = pageIdentity(args.url);
				} catch {
					throw new BrowserExecutionError('restricted_url');
				}
				await this.tabs.update(session.tabId, { url: identity.url });
				this.currentPageSignals = [];
				return { ok: true, url: identity.url };
			}
			case 'browser_go_back':
				await this.tabs.goBack(session.tabId);
				this.currentPageSignals = [];
				return { ok: true };
			case 'browser_go_forward':
				await this.tabs.goForward(session.tabId);
				this.currentPageSignals = [];
				return { ok: true };
			case 'browser_reload':
				await this.tabs.reload(session.tabId);
				this.currentPageSignals = [];
				return { ok: true };
			case 'browser_screenshot':
				await this.ensureDebugger(session.tabId);
				return this.debuggerFacade.screenshot(session.tabId, args);
			case 'browser_console':
				await this.ensureDebugger(session.tabId);
				return { entries: this.debuggerFacade.consoleEntries(args) };
			case 'browser_network':
				await this.ensureDebugger(session.tabId);
				return { entries: this.debuggerFacade.networkEntries(args) };
			case 'browser_download':
				return this.download(session.tabId, args);
			case 'browser_recording':
				if (!this.recordingHandler) throw new BrowserExecutionError('recording_unavailable');
				return this.recordingHandler(session.tabId, args);
			default:
				throw new BrowserExecutionError('forbidden_capability');
		}
	}

	async closeSession() {
		this.currentPageSignals = [];
		await this.debuggerFacade.detach();
	}

	pageSignals() {
		return [...this.currentPageSignals];
	}

	private async ensureDebugger(tabId: number) {
		const status = this.debuggerFacade.status();
		if (status.attached && status.tabId !== tabId) {
			throw new BrowserExecutionError('second_tab_denied');
		}
		if (!status.attached) await this.debuggerFacade.attach(tabId);
	}

	private async contentAction(tabId: number, name: string, args: Record<string, unknown>) {
		let response: any;
		try {
			response = await this.tabs.sendMessage(tabId, {
				source: CONTENT_MESSAGE_SOURCE,
				type: 'action',
				name,
				args
			});
		} catch {
			throw new BrowserExecutionError('content_script_unavailable');
		}
		if (!response?.ok) {
			throw new BrowserExecutionError(
				typeof response?.error?.code === 'string' ? response.error.code : 'dom_action_failed'
			);
		}
		if (Array.isArray(response.snapshot?.pageSignals)) {
			this.currentPageSignals = response.snapshot.pageSignals
				.filter(
					(signal: unknown): signal is string =>
						typeof signal === 'string' && /^[a-z0-9_:-]{1,64}$/i.test(signal)
				)
				.slice(0, 20);
		}
		return response;
	}

	private async download(tabId: number, args: Record<string, unknown>) {
		let options: { url?: unknown; filename?: unknown } = {
			url: args.url,
			filename: args.filename
		};
		if (!options.url && args.target) {
			const response = await this.contentAction(tabId, 'browser_download', {
				target: args.target
			});
			if (typeof response.download !== 'object' || response.download === null) {
				throw new BrowserExecutionError('invalid_download_url');
			}
			options = {
				url: response.download.url,
				filename: args.filename ?? response.download.filename
			};
		}
		return this.downloads.start(tabId, options);
	}
}
