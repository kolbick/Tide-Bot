import { describe, expect, it, vi } from 'vitest';

import { DownloadError, DownloadManager, sanitizeDownloadFilename } from './downloads';

class Event<T extends (...args: any[]) => unknown> {
	listeners: T[] = [];
	addListener = (listener: T) => this.listeners.push(listener);
	fire(...args: Parameters<T>) {
		for (const listener of this.listeners) listener(...args);
	}
}

const setup = () => {
	const onChanged = new Event<(delta: Record<string, any>) => void>();
	const downloadsApi = {
		download: vi.fn(async () => 42),
		onChanged
	};
	const notificationsApi = { create: vi.fn(async () => 'notification-id') };
	const manager = new DownloadManager({
		downloadsApi,
		notificationsApi,
		assertControlledTab: (tabId) => {
			if (tabId !== 7)
				throw Object.assign(new Error('second_tab_denied'), { code: 'second_tab_denied' });
		}
	});
	return { downloadsApi, notificationsApi, manager, onChanged };
};

describe('DownloadManager', () => {
	it('sanitizes filenames to one safe basename', () => {
		expect(sanitizeDownloadFilename('../../report<final>?.pdf')).toBe('report_final__.pdf');
		expect(sanitizeDownloadFilename('...')).toBe('tide-bot-download');
		expect(sanitizeDownloadFilename('a'.repeat(300))).toHaveLength(120);
	});

	it('starts user-visible HTTP downloads only for the controlled tab', async () => {
		const { manager, downloadsApi } = setup();

		const result = await manager.start(7, {
			url: 'https://example.com/files/report.pdf?signature=ephemeral',
			filename: '../report?.pdf'
		});

		expect(result).toEqual({ downloadId: 42, state: 'in_progress' });
		expect(downloadsApi.download).toHaveBeenCalledWith({
			url: 'https://example.com/files/report.pdf?signature=ephemeral',
			filename: 'report_.pdf',
			conflictAction: 'uniquify',
			saveAs: false
		});
		await expect(manager.start(8, { url: 'https://example.com/file' })).rejects.toMatchObject({
			code: 'second_tab_denied'
		});
		await expect(manager.start(7, { url: 'javascript:alert(1)' })).rejects.toBeInstanceOf(
			DownloadError
		);
	});

	it('notifies only for extension-owned completion or interruption', async () => {
		const { manager, notificationsApi, onChanged } = setup();
		await manager.start(7, { url: 'https://example.com/file' });

		onChanged.fire({ id: 99, state: { current: 'complete' } });
		onChanged.fire({ id: 42, bytesReceived: { current: 20 } });
		expect(notificationsApi.create).not.toHaveBeenCalled();

		onChanged.fire({ id: 42, state: { current: 'complete' } });
		expect(notificationsApi.create).toHaveBeenCalledWith(
			'tide-bot-download-42',
			expect.objectContaining({
				type: 'basic',
				title: 'Tide-Bot download complete',
				iconUrl: 'icons/icon-128.png'
			})
		);
		onChanged.fire({ id: 42, state: { current: 'interrupted' } });
		expect(notificationsApi.create).toHaveBeenCalledTimes(1);
	});
});
