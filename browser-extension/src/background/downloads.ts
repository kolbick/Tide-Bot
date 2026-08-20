interface DownloadsApi {
	download(options: Record<string, unknown>): Promise<number>;
	onChanged: {
		addListener(listener: (delta: Record<string, any>) => void): void;
	};
}

interface NotificationsApi {
	create(id: string, options: Record<string, unknown>): Promise<unknown> | unknown;
}

interface DownloadManagerOptions {
	downloadsApi: DownloadsApi;
	notificationsApi: NotificationsApi;
	assertControlledTab: (tabId: number) => void;
}

export class DownloadError extends Error {
	constructor(public readonly code: string) {
		super(code);
		this.name = 'DownloadError';
	}
}

export function sanitizeDownloadFilename(value: string) {
	const basename = value.replaceAll('\\', '/').split('/').pop() ?? '';
	const safe = basename
		.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
		.replace(/^\.+|\.+$/g, '')
		.trim()
		.slice(0, 120);
	return safe || 'tide-bot-download';
}

function validatedDownloadUrl(value: unknown) {
	if (typeof value !== 'string' || value.length > 4_096) {
		throw new DownloadError('invalid_download_url');
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new DownloadError('invalid_download_url');
	}
	if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
		throw new DownloadError('invalid_download_url');
	}
	return parsed.href;
}

export class DownloadManager {
	private readonly downloadsApi: DownloadsApi;
	private readonly notificationsApi: NotificationsApi;
	private readonly assertControlledTab: (tabId: number) => void;
	private readonly ownedDownloads = new Set<number>();

	constructor(options: DownloadManagerOptions) {
		this.downloadsApi = options.downloadsApi;
		this.notificationsApi = options.notificationsApi;
		this.assertControlledTab = options.assertControlledTab;
		this.downloadsApi.onChanged.addListener((delta) => this.handleChanged(delta));
	}

	async start(tabId: number, options: { url?: unknown; filename?: unknown }) {
		this.assertControlledTab(tabId);
		const url = validatedDownloadUrl(options.url);
		const request: Record<string, unknown> = {
			url,
			conflictAction: 'uniquify',
			saveAs: false
		};
		if (typeof options.filename === 'string' && options.filename) {
			request.filename = sanitizeDownloadFilename(options.filename);
		}
		const downloadId = await this.downloadsApi.download(request);
		if (!Number.isInteger(downloadId) || downloadId < 0) {
			throw new DownloadError('download_start_failed');
		}
		this.ownedDownloads.add(downloadId);
		return { downloadId, state: 'in_progress' as const };
	}

	private handleChanged(delta: Record<string, any>) {
		if (!Number.isInteger(delta.id) || !this.ownedDownloads.has(delta.id)) return;
		const state = delta.state?.current;
		if (state !== 'complete' && state !== 'interrupted') return;
		this.ownedDownloads.delete(delta.id);
		const complete = state === 'complete';
		void this.notificationsApi.create(`tide-bot-download-${delta.id}`, {
			type: 'basic',
			iconUrl: 'icons/icon-128.png',
			title: complete ? 'Tide-Bot download complete' : 'Tide-Bot download interrupted',
			message: complete
				? 'Your browser download is ready.'
				: 'Chrome could not finish the browser download.',
			priority: 0
		});
	}
}
