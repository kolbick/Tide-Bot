import { ACTION_MODES, TAB_POLICIES, type ActionMode, type TabPolicy } from '../shared/constants';

export interface ControlledTabSession {
	sessionId: string;
	tabId: number;
	url: string;
	origin: string;
	actionMode: ActionMode;
	tabPolicy: TabPolicy;
}

interface OpenSessionOptions {
	sessionId: string;
	tabId: number;
	actionMode: ActionMode;
	tabPolicy: TabPolicy;
}

interface TabsApi {
	get(tabId: number): Promise<{ id?: number; url?: string } | undefined>;
	query(query: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>>;
	onActivated?: {
		addListener(listener: (info: { tabId: number; windowId: number }) => unknown): void;
	};
	onRemoved?: { addListener(listener: (tabId: number) => unknown): void };
	onReplaced?: {
		addListener(listener: (addedTabId: number, removedTabId: number) => unknown): void;
	};
	onUpdated?: {
		addListener(
			listener: (
				tabId: number,
				changeInfo: { url?: string },
				tab: { id?: number; url?: string }
			) => unknown
		): void;
	};
}

interface SingleTabControllerOptions {
	tabs: TabsApi;
	onSessionOpen?: (session: ControlledTabSession) => Promise<void>;
	onSessionClose?: (session: ControlledTabSession) => Promise<void>;
}

export class TabControlError extends Error {
	constructor(
		public readonly code: string,
		message = code
	) {
		super(message);
		this.name = 'TabControlError';
	}
}

export function pageIdentity(url: string): { url: string; origin: string } {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new TabControlError('restricted_url');
	}
	if (
		!['http:', 'https:'].includes(parsed.protocol) ||
		parsed.username !== '' ||
		parsed.password !== ''
	) {
		throw new TabControlError('restricted_url');
	}
	return { url: parsed.href, origin: parsed.origin };
}

export class SingleTabController {
	private readonly tabs: TabsApi;
	private readonly onSessionOpen: (session: ControlledTabSession) => Promise<void>;
	private readonly onSessionClose: (session: ControlledTabSession) => Promise<void>;
	private session: ControlledTabSession | null = null;

	constructor(options: SingleTabControllerOptions) {
		this.tabs = options.tabs;
		this.onSessionOpen = options.onSessionOpen ?? (async () => undefined);
		this.onSessionClose = options.onSessionClose ?? (async () => undefined);
		this.tabs.onActivated?.addListener((info) => this.handleActivated(info.tabId));
		this.tabs.onRemoved?.addListener((tabId) => this.handleRemoved(tabId));
		this.tabs.onReplaced?.addListener((addedTabId, removedTabId) =>
			this.handleReplaced(addedTabId, removedTabId)
		);
		this.tabs.onUpdated?.addListener((tabId, changeInfo, tab) =>
			this.handleUpdated(tabId, changeInfo.url ?? tab.url)
		);
	}

	current(): ControlledTabSession | null {
		return this.session ? { ...this.session } : null;
	}

	async openActive(options: Omit<OpenSessionOptions, 'tabId'>) {
		const [tab] = await this.tabs.query({ active: true, currentWindow: true });
		if (typeof tab?.id !== 'number') throw new TabControlError('active_tab_unavailable');
		return this.open({ ...options, tabId: tab.id });
	}

	async open(options: OpenSessionOptions): Promise<ControlledTabSession> {
		if (!ACTION_MODES.includes(options.actionMode) || !TAB_POLICIES.includes(options.tabPolicy)) {
			throw new TabControlError('invalid_session_policy');
		}
		if (this.session) {
			if (this.session.sessionId !== options.sessionId || this.session.tabId !== options.tabId) {
				throw new TabControlError('single_tab_only');
			}
			const updated = {
				...this.session,
				actionMode: options.actionMode,
				tabPolicy: options.tabPolicy
			};
			this.session = updated;
			await this.onSessionOpen({ ...updated });
			return { ...updated };
		}
		const next = await this.sessionForTab(options, options.tabId);
		this.session = next;
		try {
			await this.onSessionOpen({ ...next });
		} catch (error) {
			this.session = null;
			throw error;
		}
		return { ...next };
	}

	async close() {
		if (!this.session) return;
		const previous = this.session;
		this.session = null;
		await this.onSessionClose({ ...previous });
	}

	requireControlledTab(tabId?: number): ControlledTabSession {
		if (!this.session) throw new TabControlError('session_not_open');
		if (tabId !== undefined && tabId !== this.session.tabId) {
			throw new TabControlError('second_tab_denied');
		}
		return { ...this.session };
	}

	private async handleActivated(tabId: number) {
		if (
			!this.session ||
			this.session.tabPolicy !== 'follow-active' ||
			tabId === this.session.tabId
		) {
			return;
		}
		const previous = this.session;
		await this.close();
		const next = await this.sessionForTab(previous, tabId);
		this.session = next;
		try {
			await this.onSessionOpen({ ...next });
		} catch (error) {
			this.session = null;
			throw error;
		}
	}

	private async handleRemoved(tabId: number) {
		if (this.session?.tabId === tabId) await this.close();
	}

	private async handleReplaced(addedTabId: number, removedTabId: number) {
		if (this.session?.tabId !== removedTabId) return;
		const previous = this.session;
		await this.close();
		const next = await this.sessionForTab(previous, addedTabId);
		this.session = next;
		try {
			await this.onSessionOpen({ ...next });
		} catch (error) {
			this.session = null;
			throw error;
		}
	}

	private async handleUpdated(tabId: number, url?: string) {
		if (!this.session || this.session.tabId !== tabId || !url) return;
		let identity: { url: string; origin: string };
		try {
			identity = pageIdentity(url);
		} catch {
			await this.close();
			return;
		}
		this.session = { ...this.session, ...identity };
		await this.onSessionOpen({ ...this.session });
	}

	private async sessionForTab(
		options: Pick<ControlledTabSession, 'sessionId' | 'actionMode' | 'tabPolicy'>,
		tabId: number
	): Promise<ControlledTabSession> {
		if (!Number.isInteger(tabId) || tabId < 0) throw new TabControlError('invalid_tab');
		const tab = await this.tabs.get(tabId);
		if (!tab || typeof tab.url !== 'string') throw new TabControlError('tab_unavailable');
		return {
			...options,
			tabId,
			...pageIdentity(tab.url)
		};
	}
}
