import { WEBUI_API_BASE_URL } from '$lib/constants';

export type BrowserExtensionDevice = {
	id: string;
	label: string;
	allowed_origin: string;
	extension_version: string;
	last_seen_at: number | null;
	revoked_at: number | null;
	created_at: number;
	updated_at: number;
};

export type BrowserExtensionWorkflow = {
	id: string;
	name: string;
	version: number;
	definition: Record<string, unknown>;
	created_at: number;
	updated_at: number;
};

export type BrowserExtensionSchedule = {
	id: string;
	workflow_id: string;
	device_id: string;
	name: string;
	rrule: string;
	timezone: string;
	is_active: boolean;
	last_run_at: number | null;
	next_run_at: number | null;
	catch_up_pending: boolean;
	created_at: number;
	updated_at: number;
};

export type BrowserExtensionSettings = {
	custom_origins_unlocked: boolean;
	default_origin: string;
	can_manage: boolean;
};

const endpoint = (path: string) => `${WEBUI_API_BASE_URL}/browser-extension${path}`;

const errorDetail = async (response: Response): Promise<string> => {
	try {
		const body = await response.json();
		if (typeof body?.detail === 'string') return body.detail;
	} catch {
		// The stable status fallback below avoids surfacing server response bodies.
	}
	return `browser_extension_request_failed_${response.status}`;
};

const requestJson = async <T>(token: string, path: string, init: RequestInit = {}): Promise<T> => {
	const response = await fetch(endpoint(path), {
		...init,
		headers: {
			Accept: 'application/json',
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			authorization: `Bearer ${token}`,
			...init.headers
		}
	});
	if (!response.ok) throw new Error(await errorDetail(response));
	return response.json() as Promise<T>;
};

export const getBrowserExtensionDevices = (token: string) =>
	requestJson<BrowserExtensionDevice[]>(token, '/devices', { method: 'GET' });

export const renameBrowserExtensionDevice = (token: string, deviceId: string, label: string) =>
	requestJson<BrowserExtensionDevice>(token, `/devices/${encodeURIComponent(deviceId)}`, {
		method: 'PUT',
		body: JSON.stringify({ label })
	});

export const revokeBrowserExtensionDevice = (token: string, deviceId: string) =>
	requestJson<{ status: 'revoked' }>(token, `/devices/${encodeURIComponent(deviceId)}/revoke`, {
		method: 'POST'
	});

export const getBrowserExtensionWorkflows = (token: string) =>
	requestJson<BrowserExtensionWorkflow[]>(token, '/workflows', { method: 'GET' });

export const getBrowserExtensionSchedules = (token: string) =>
	requestJson<BrowserExtensionSchedule[]>(token, '/schedules', { method: 'GET' });

export const getBrowserExtensionSettings = (token: string) =>
	requestJson<BrowserExtensionSettings>(token, '/settings', { method: 'GET' });

export const updateBrowserExtensionSettings = (
	token: string,
	settings: Pick<BrowserExtensionSettings, 'custom_origins_unlocked'>
) =>
	requestJson<BrowserExtensionSettings>(token, '/settings', {
		method: 'PUT',
		body: JSON.stringify(settings)
	});

export const approveBrowserExtensionPairing = (
	token: string,
	grantId: string,
	deviceCode: string,
	approved: boolean
) =>
	requestJson<{ status: 'approved' | 'denied' }>(
		token,
		`/pairing/${encodeURIComponent(grantId)}/approve`,
		{
			method: 'POST',
			body: JSON.stringify({ device_code: deviceCode, approved })
		}
	);

export const downloadBrowserExtension = async (token: string): Promise<void> => {
	const response = await fetch(endpoint('/download'), {
		method: 'GET',
		headers: {
			Accept: 'application/zip',
			authorization: `Bearer ${token}`
		}
	});
	if (!response.ok) throw new Error(await errorDetail(response));
	if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/zip')) {
		throw new Error('browser_extension_download_invalid_content_type');
	}

	const archive = await response.blob();
	const objectUrl = URL.createObjectURL(archive);
	try {
		const anchor = document.createElement('a');
		anchor.href = objectUrl;
		anchor.download = 'tide-bot-browser-extension.zip';
		anchor.rel = 'noopener';
		anchor.click();
		anchor.remove();
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
};

export const browserExtensionClient = {
	listDevices: getBrowserExtensionDevices,
	renameDevice: renameBrowserExtensionDevice,
	revokeDevice: revokeBrowserExtensionDevice,
	listWorkflows: getBrowserExtensionWorkflows,
	listSchedules: getBrowserExtensionSchedules,
	getSettings: getBrowserExtensionSettings,
	updateSettings: updateBrowserExtensionSettings,
	download: downloadBrowserExtension,
	approvePairing: approveBrowserExtensionPairing
};

export type BrowserExtensionClient = typeof browserExtensionClient;
