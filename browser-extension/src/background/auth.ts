import { DEFAULT_SERVER_ORIGIN } from '../shared/constants';

export const AUTH_STORAGE_KEY = 'tideBotAuth';
export const PREFERENCES_STORAGE_KEY = 'tideBotPreferences';
const REFRESH_SKEW_MS = 60_000;
const API_PATH = '/api/v1/browser-extension';

export interface StorageArea {
	get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
	set(values: Record<string, unknown>): Promise<void>;
	remove(keys: string | string[]): Promise<void>;
}

export interface StoredCredential {
	serverOrigin: string;
	deviceId: string;
	refreshToken: string;
	tokenFamilyId: string;
}

export interface DeviceResponse {
	id: string;
	label: string;
	allowed_origin: string;
	extension_version: string;
}

export interface TokenResponse {
	access_token: string;
	refresh_token: string;
	token_type: string;
	expires_in: number;
	token_family_id: string;
	device: DeviceResponse;
}

interface PairingResponse {
	grant_id: string;
	device_code: string;
	verifier: string;
	verification_uri: string;
	interval: number;
	expires_in: number;
}

interface PendingPairing extends PairingResponse {
	expiresAt: number;
}

export class BrowserAuthError extends Error {
	constructor(
		public readonly code: string,
		message = code
	) {
		super(message);
		this.name = 'BrowserAuthError';
	}
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface BrowserAuthOptions {
	storage?: StorageArea;
	fetcher?: Fetcher;
	serverOrigin?: string;
	extensionVersion?: string;
	clock?: () => number;
	sleep?: (milliseconds: number) => Promise<void>;
	openVerification?: (url: string) => Promise<unknown>;
	closeVerification?: (tabId: number) => Promise<unknown>;
}

const defaultStorage = () => (globalThis as any).chrome.storage.local as StorageArea;
const defaultExtensionVersion = () =>
	(globalThis as any).chrome?.runtime?.getManifest?.().version ?? '0.1.0';
const defaultOpenVerification = (url: string) => {
	const tabs = (globalThis as any).chrome?.tabs;
	return tabs?.create ? (tabs.create({ url }) as Promise<unknown>) : Promise.resolve();
};
const defaultCloseVerification = (tabId: number) => {
	const tabs = (globalThis as any).chrome?.tabs;
	return tabs?.remove ? (tabs.remove(tabId) as Promise<unknown>) : Promise.resolve();
};

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isStoredCredential(value: unknown): value is StoredCredential {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return (
		JSON.stringify(keys) ===
			JSON.stringify(['deviceId', 'refreshToken', 'serverOrigin', 'tokenFamilyId']) &&
		isString(record.serverOrigin) &&
		isString(record.deviceId) &&
		isString(record.refreshToken) &&
		isString(record.tokenFamilyId)
	);
}

function isTokenResponse(value: unknown): value is TokenResponse {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	const device = record.device;
	return (
		isString(record.access_token) &&
		isString(record.refresh_token) &&
		record.token_type === 'Bearer' &&
		typeof record.expires_in === 'number' &&
		Number.isFinite(record.expires_in) &&
		record.expires_in > 0 &&
		isString(record.token_family_id) &&
		typeof device === 'object' &&
		device !== null &&
		isString((device as Record<string, unknown>).id) &&
		isString((device as Record<string, unknown>).allowed_origin)
	);
}

async function errorCode(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { detail?: unknown };
		return typeof body.detail === 'string' ? body.detail : `http_${response.status}`;
	} catch {
		return `http_${response.status}`;
	}
}

export class BrowserAuth {
	private readonly storage: StorageArea;
	private readonly fetcher: Fetcher;
	private readonly configuredOrigin: string;
	private readonly extensionVersion: string;
	private readonly clock: () => number;
	private readonly sleep: (milliseconds: number) => Promise<void>;
	private readonly openVerification: (url: string) => Promise<unknown>;
	private readonly closeVerification: (tabId: number) => Promise<unknown>;
	private credential: StoredCredential | null = null;
	private accessToken: string | null = null;
	private accessExpiresAt = 0;
	private pendingPairing: PendingPairing | null = null;
	private refreshPromise: Promise<string> | null = null;
	private verificationTabId: number | null = null;

	constructor(options: BrowserAuthOptions = {}) {
		this.storage = options.storage ?? defaultStorage();
		this.fetcher = options.fetcher ?? fetch.bind(globalThis);
		this.configuredOrigin = options.serverOrigin ?? DEFAULT_SERVER_ORIGIN;
		this.extensionVersion = options.extensionVersion ?? defaultExtensionVersion();
		this.clock = options.clock ?? Date.now;
		this.sleep =
			options.sleep ??
			((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
		this.openVerification = options.openVerification ?? defaultOpenVerification;
		this.closeVerification = options.closeVerification ?? defaultCloseVerification;
	}

	status() {
		return {
			paired: this.credential !== null,
			serverOrigin: this.credential?.serverOrigin ?? this.configuredOrigin,
			deviceId: this.credential?.deviceId ?? null
		};
	}

	/**
	 * Pair straight from the user's signed-in Tide-Bot session.
	 *
	 * Host permissions let this request carry the tide-bot.com session cookie,
	 * so the packaged extension can prove identity without the verification
	 * tab. The session is used once, here, and never stored: what gets kept is
	 * the same scoped, revocable device credential the code flow produces.
	 * Callers fall back to beginPairing when this is refused.
	 */
	async claimWithSession(deviceLabel: string) {
		const label = deviceLabel.trim();
		if (!label || label.length > 80) throw new BrowserAuthError('invalid_device_label');
		const response = await this.fetcher(`${this.configuredOrigin}${API_PATH}/pairing/claim`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				device_label: label,
				origin: this.configuredOrigin,
				extension_version: this.extensionVersion
			}),
			credentials: 'include',
			cache: 'no-store',
			redirect: 'error'
		});
		if (!response.ok) throw new BrowserAuthError(await errorCode(response));
		await this.applyTokenResponse(await response.json(), null);
	}

	async beginPairing(deviceLabel: string) {
		const label = deviceLabel.trim();
		if (!label || label.length > 80) throw new BrowserAuthError('invalid_device_label');
		const response = await this.request(`${API_PATH}/pairing/start`, {
			device_label: label,
			origin: this.configuredOrigin,
			extension_version: this.extensionVersion
		});
		if (!response.ok) throw new BrowserAuthError(await errorCode(response));
		const value = (await response.json()) as Partial<PairingResponse>;
		if (
			!isString(value.grant_id) ||
			!isString(value.device_code) ||
			!isString(value.verifier) ||
			!isString(value.verification_uri) ||
			typeof value.interval !== 'number' ||
			typeof value.expires_in !== 'number'
		) {
			throw new BrowserAuthError('invalid_pairing_response');
		}
		this.pendingPairing = {
			...(value as PairingResponse),
			expiresAt: this.clock() + value.expires_in * 1_000
		};
		const opened = await this.openVerification(value.verification_uri);
		// Remembered so approval can put the user back where they started
		// instead of stranding them on the verification tab.
		this.verificationTabId =
			typeof (opened as { id?: unknown } | null)?.id === 'number'
				? ((opened as { id: number }).id)
				: null;
		return {
			deviceCode: value.device_code,
			verificationUri: value.verification_uri,
			expiresAt: this.pendingPairing.expiresAt
		};
	}

	async pollPairing(): Promise<void> {
		const pairing = this.pendingPairing;
		if (!pairing) throw new BrowserAuthError('pairing_not_started');
		while (this.clock() < pairing.expiresAt) {
			const response = await this.request(`${API_PATH}/pairing/token`, {
				grant_id: pairing.grant_id,
				device_code: pairing.device_code,
				verifier: pairing.verifier
			});
			if (response.status === 428) {
				await this.sleep(Math.max(1, pairing.interval) * 1_000);
				continue;
			}
			if (!response.ok) {
				this.pendingPairing = null;
				throw new BrowserAuthError(await errorCode(response));
			}
			const token = await response.json();
			await this.applyTokenResponse(token, null);
			this.pendingPairing = null;
			await this.closeVerificationTab();
			return;
		}
		this.pendingPairing = null;
		throw new BrowserAuthError('expired_token');
	}

	private async closeVerificationTab() {
		const tabId = this.verificationTabId;
		this.verificationTabId = null;
		if (tabId === null) return;
		try {
			await this.closeVerification(tabId);
		} catch {
			// The user may have already closed it; pairing still succeeded.
		}
	}

	async restore(): Promise<boolean> {
		const stored = await this.storage.get(AUTH_STORAGE_KEY);
		const value = stored[AUTH_STORAGE_KEY];
		if (!isStoredCredential(value)) {
			if (value !== undefined) await this.storage.remove(AUTH_STORAGE_KEY);
			this.clearMemory();
			return false;
		}
		this.credential = { ...value };
		await this.refresh();
		return true;
	}

	async getAccessToken(): Promise<string> {
		if (this.accessToken && this.clock() < this.accessExpiresAt - REFRESH_SKEW_MS) {
			return this.accessToken;
		}
		return this.refresh();
	}

	async signOut(): Promise<void> {
		this.clearMemory();
		this.pendingPairing = null;
		await this.storage.remove(AUTH_STORAGE_KEY);
	}

	private async refresh(): Promise<string> {
		if (this.refreshPromise) return this.refreshPromise;
		this.refreshPromise = this.performRefresh();
		try {
			return await this.refreshPromise;
		} finally {
			this.refreshPromise = null;
		}
	}

	private async performRefresh(): Promise<string> {
		const credential = this.credential;
		if (!credential) throw new BrowserAuthError('not_paired');
		const response = await this.request(
			`${API_PATH}/token/refresh`,
			{
				refresh_token: credential.refreshToken,
				origin: credential.serverOrigin,
				extension_version: this.extensionVersion
			},
			credential.serverOrigin
		);
		if (!response.ok) {
			const code = await errorCode(response);
			if (response.status === 401 || response.status === 403) await this.signOut();
			throw new BrowserAuthError(code);
		}
		const token = await response.json();
		await this.applyTokenResponse(token, credential);
		return this.accessToken as string;
	}

	private async applyTokenResponse(value: unknown, previous: StoredCredential | null) {
		if (!isTokenResponse(value)) throw new BrowserAuthError('invalid_token_response');
		if (
			previous &&
			(previous.deviceId !== value.device.id || previous.tokenFamilyId !== value.token_family_id)
		) {
			await this.signOut();
			throw new BrowserAuthError('device_identity_mismatch');
		}
		const credential: StoredCredential = {
			serverOrigin: value.device.allowed_origin,
			deviceId: value.device.id,
			refreshToken: value.refresh_token,
			tokenFamilyId: value.token_family_id
		};
		if (credential.serverOrigin !== (previous?.serverOrigin ?? this.configuredOrigin)) {
			throw new BrowserAuthError('origin_mismatch');
		}
		await this.storage.set({ [AUTH_STORAGE_KEY]: credential });
		this.credential = credential;
		this.accessToken = value.access_token;
		this.accessExpiresAt = this.clock() + value.expires_in * 1_000;
	}

	private request(path: string, body: Record<string, unknown>, origin = this.configuredOrigin) {
		return this.fetcher(`${origin}${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			credentials: 'omit',
			cache: 'no-store',
			redirect: 'error'
		});
	}

	private clearMemory() {
		this.credential = null;
		this.accessToken = null;
		this.accessExpiresAt = 0;
	}
}
