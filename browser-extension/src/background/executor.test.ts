import { describe, expect, it, vi } from 'vitest';

import { BrowserExecutor } from './executor';

const setup = () => {
	const session = {
		sessionId: 'session-1',
		tabId: 7,
		url: 'https://example.com/start',
		origin: 'https://example.com',
		actionMode: 'autonomous' as const,
		tabPolicy: 'locked' as const
	};
	const tabController = {
		requireControlledTab: vi.fn(() => session)
	};
	const tabs = {
		sendMessage: vi.fn(async (): Promise<any> => ({ ok: true, snapshot: { revision: 2 } })),
		update: vi.fn(async () => ({ id: 7 })),
		goBack: vi.fn(async () => undefined),
		goForward: vi.fn(async () => undefined),
		reload: vi.fn(async () => undefined)
	};
	const debuggerFacade = {
		status: vi.fn(() => ({ attached: false, tabId: null })),
		attach: vi.fn(async () => undefined),
		detach: vi.fn(async () => undefined),
		screenshot: vi.fn(async () => ({ format: 'png', data: 'aGVsbG8=', byteLength: 5 })),
		consoleEntries: vi.fn(() => [{ severity: 'error', summary: 'safe' }]),
		networkEntries: vi.fn(() => [{ method: 'GET', url: 'https://example.com', status: 200 }])
	};
	const downloads = {
		start: vi.fn(async () => ({ downloadId: 42, state: 'in_progress' }))
	};
	const executor = new BrowserExecutor({
		tabs,
		tabController,
		debuggerFacade,
		downloads
	});
	return { executor, tabs, tabController, debuggerFacade, downloads };
};

describe('BrowserExecutor', () => {
	it('routes DOM actions only to the controlled tab and preserves content-script errors', async () => {
		const { executor, tabs, tabController } = setup();

		const result = await executor.execute({
			name: 'browser_click',
			args: { target: { handle: 'tbx_1_1_nonce' } },
			mutating: true
		});

		expect(tabController.requireControlledTab).toHaveBeenCalledOnce();
		expect(tabs.sendMessage).toHaveBeenCalledWith(7, {
			source: 'tide-bot-browser-control',
			type: 'action',
			name: 'browser_click',
			args: { target: { handle: 'tbx_1_1_nonce' } }
		});
		expect(result).toEqual({ ok: true, snapshot: { revision: 2 } });

		tabs.sendMessage.mockResolvedValueOnce({ ok: false, error: { code: 'stale_handle' } });
		await expect(
			executor.execute({
				name: 'browser_click',
				args: { target: { handle: 'tbx_1_1_nonce' } },
				mutating: true
			})
		).rejects.toMatchObject({ code: 'stale_handle' });
	});

	it('retains only bounded page-risk signals for the current session', async () => {
		const { executor, tabs } = setup();
		tabs.sendMessage.mockResolvedValueOnce({
			ok: true,
			snapshot: {
				revision: 1,
				pageSignals: ['prompt_injection', 42, 'x'.repeat(200)]
			}
		});

		await executor.execute({ name: 'browser_observe', args: {}, mutating: false });

		expect(executor.pageSignals()).toEqual(['prompt_injection']);
		await executor.closeSession();
		expect(executor.pageSignals()).toEqual([]);
	});

	it('uses tab APIs for safe navigation and history without opening another tab', async () => {
		const { executor, tabs } = setup();

		expect(
			await executor.execute({
				name: 'browser_navigate',
				args: { url: 'https://other.example/path' },
				mutating: true
			})
		).toEqual({ ok: true, url: 'https://other.example/path' });
		expect(tabs.update).toHaveBeenCalledWith(7, { url: 'https://other.example/path' });
		await executor.execute({ name: 'browser_go_back', args: {}, mutating: true });
		await executor.execute({ name: 'browser_go_forward', args: {}, mutating: true });
		await executor.execute({ name: 'browser_reload', args: {}, mutating: true });
		expect(tabs.goBack).toHaveBeenCalledWith(7);
		expect(tabs.goForward).toHaveBeenCalledWith(7);
		expect(tabs.reload).toHaveBeenCalledWith(7);
		await expect(
			executor.execute({
				name: 'browser_navigate',
				args: { url: 'chrome://settings' },
				mutating: true
			})
		).rejects.toMatchObject({ code: 'restricted_url' });
	});

	it('lazily binds debugger reads and detaches them with the session', async () => {
		const { executor, debuggerFacade } = setup();

		await executor.execute({
			name: 'browser_screenshot',
			args: { format: 'png' },
			mutating: false
		});
		await executor.execute({ name: 'browser_console', args: { maxEntries: 10 }, mutating: false });
		await executor.execute({ name: 'browser_network', args: { maxEntries: 10 }, mutating: false });

		expect(debuggerFacade.attach).toHaveBeenCalledWith(7);
		expect(debuggerFacade.screenshot).toHaveBeenCalledWith(7, { format: 'png' });
		expect(debuggerFacade.consoleEntries).toHaveBeenCalledWith({ maxEntries: 10 });
		expect(debuggerFacade.networkEntries).toHaveBeenCalledWith({ maxEntries: 10 });
		await executor.closeSession();
		expect(debuggerFacade.detach).toHaveBeenCalledOnce();
	});

	it('resolves target downloads locally and returns only the download identifier', async () => {
		const { executor, tabs, downloads } = setup();
		tabs.sendMessage.mockResolvedValueOnce({
			ok: true,
			download: {
				url: 'https://example.com/report.pdf?signature=ephemeral',
				filename: 'report.pdf'
			}
		});

		const result = await executor.execute({
			name: 'browser_download',
			args: { target: { handle: 'tbx_1_1_nonce' } },
			mutating: true
		});

		expect(downloads.start).toHaveBeenCalledWith(7, {
			url: 'https://example.com/report.pdf?signature=ephemeral',
			filename: 'report.pdf'
		});
		expect(result).toEqual({ downloadId: 42, state: 'in_progress' });
		expect(JSON.stringify(result)).not.toContain('signature');
	});
});
