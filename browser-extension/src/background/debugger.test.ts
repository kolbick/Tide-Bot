import { describe, expect, it, vi } from 'vitest';

import { DebuggerCapabilityError, DebuggerFacade, isAllowedDebuggerMethod } from './debugger';

class Event<T extends (...args: any[]) => unknown> {
	listeners: T[] = [];
	addListener = (listener: T) => this.listeners.push(listener);
	removeListener = (listener: T) => {
		this.listeners = this.listeners.filter((candidate) => candidate !== listener);
	};
	fire(...args: Parameters<T>) {
		for (const listener of this.listeners) listener(...args);
	}
}

const setup = (responses: Record<string, unknown> = {}) => {
	const onEvent = new Event<
		(source: { tabId?: number }, method: string, params?: Record<string, any>) => void
	>();
	const debuggerApi = {
		attach: vi.fn(async () => undefined),
		detach: vi.fn(async () => undefined),
		sendCommand: vi.fn(
			async (_target: { tabId: number }, method: string) => responses[method] ?? {}
		),
		onEvent
	};
	const facade = new DebuggerFacade({ debuggerApi, maxScreenshotBytes: 32 });
	return { debuggerApi, facade, onEvent };
};

describe('DebuggerFacade', () => {
	it('uses a fixed CDP allowlist and rejects forbidden capabilities', async () => {
		const { facade, debuggerApi } = setup();

		expect(isAllowedDebuggerMethod('Page.captureScreenshot')).toBe(true);
		for (const method of [
			'Runtime.evaluate',
			'Network.getResponseBody',
			'Network.getRequestPostData',
			'Network.getAllCookies',
			'Storage.getCookies',
			'DOMStorage.getDOMStorageItems'
		]) {
			expect(isAllowedDebuggerMethod(method)).toBe(false);
			await expect(facade.request(7, method, {})).rejects.toMatchObject({
				code: 'debugger_method_denied'
			});
		}
		expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
	});

	it('attaches only to the controlled tab and always detaches on cleanup', async () => {
		const { facade, debuggerApi } = setup();

		await facade.attach(7);
		expect(debuggerApi.attach).toHaveBeenCalledWith({ tabId: 7 }, '1.3');
		await expect(facade.request(8, 'Page.enable', {})).rejects.toBeInstanceOf(
			DebuggerCapabilityError
		);
		await expect(facade.attach(8)).rejects.toMatchObject({ code: 'second_tab_denied' });

		await facade.detach();
		expect(debuggerApi.detach).toHaveBeenCalledWith({ tabId: 7 });
		expect(facade.status()).toEqual({ attached: false, tabId: null });
	});

	it('caps screenshots and never calls a forbidden fallback', async () => {
		const small = setup({ 'Page.captureScreenshot': { data: btoa('small image') } });
		await small.facade.attach(7);

		const result = await small.facade.screenshot(7, { format: 'png', quality: 80 });

		expect(result).toMatchObject({ format: 'png', byteLength: 11 });
		expect(result.data).toBe(btoa('small image'));
		expect(small.debuggerApi.sendCommand).toHaveBeenLastCalledWith(
			{ tabId: 7 },
			'Page.captureScreenshot',
			expect.objectContaining({ format: 'png' })
		);

		const oversized = setup({ 'Page.captureScreenshot': { data: btoa('x'.repeat(40)) } });
		await oversized.facade.attach(7);
		await expect(oversized.facade.screenshot(7, { format: 'jpeg' })).rejects.toMatchObject({
			code: 'screenshot_too_large'
		});
	});

	it('collects only redacted console summaries and allowlisted network metadata', async () => {
		const { facade, onEvent } = setup();
		await facade.attach(7);

		onEvent.fire({ tabId: 8 }, 'Runtime.consoleAPICalled', {
			type: 'error',
			args: [{ type: 'string', value: 'other tab' }]
		});
		onEvent.fire({ tabId: 7 }, 'Runtime.consoleAPICalled', {
			type: 'error',
			args: [
				{ type: 'string', value: 'Authorization: Bearer abc.def' },
				{ type: 'object', objectId: 'private-object', description: 'password=hunter2' }
			],
			stackTrace: { callFrames: [{ url: 'https://secret.invalid' }] }
		});
		onEvent.fire({ tabId: 7 }, 'Network.requestWillBeSent', {
			requestId: 'request-1',
			type: 'Fetch',
			timestamp: 10,
			request: {
				method: 'POST',
				url: 'https://example.com/api?token=secret#private',
				headers: { Authorization: 'Bearer secret' },
				postData: 'password=hunter2'
			}
		});
		onEvent.fire({ tabId: 7 }, 'Network.responseReceived', {
			requestId: 'request-1',
			timestamp: 10.25,
			response: {
				status: 201,
				headers: { 'Set-Cookie': 'private=true' },
				securityDetails: { subjectName: 'private' }
			}
		});

		expect(facade.consoleEntries()).toEqual([
			{ severity: 'error', summary: 'Authorization: Bearer [REDACTED]' }
		]);
		expect(facade.networkEntries()).toEqual([
			{
				method: 'POST',
				url: 'https://example.com/api',
				resourceType: 'fetch',
				status: 201,
				timing: { duration: 250 }
			}
		]);
		const serialized = JSON.stringify({
			console: facade.consoleEntries(),
			network: facade.networkEntries()
		});
		expect(serialized).not.toMatch(/hunter2|private-object|Set-Cookie|postData|headers/i);
	});
});
