// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest';

import {
	downloadBrowserExtension,
	getBrowserExtensionDevices,
	renameBrowserExtensionDevice
} from './index';

afterEach(() => {
	vi.restoreAllMocks();
});

test('uses the signed-in Tide-Bot session for device management', async () => {
	const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
		ok: true,
		json: async () => []
	} as Response);

	await getBrowserExtensionDevices('session-token');
	await renameBrowserExtensionDevice('session-token', 'device/a', 'Office Chrome');

	expect(fetchMock).toHaveBeenNthCalledWith(
		1,
		expect.stringMatching(/\/browser-extension\/devices$/),
		expect.objectContaining({
			method: 'GET',
			headers: expect.objectContaining({ authorization: 'Bearer session-token' })
		})
	);
	expect(fetchMock).toHaveBeenNthCalledWith(
		2,
		expect.stringMatching(/\/browser-extension\/devices\/device%2Fa$/),
		expect.objectContaining({
			method: 'PUT',
			body: JSON.stringify({ label: 'Office Chrome' })
		})
	);
});

test('downloads only a server-verified zip and always releases the object URL', async () => {
	const click = vi.fn();
	const remove = vi.fn();
	vi.spyOn(document, 'createElement').mockReturnValue({
		click,
		remove
	} as unknown as HTMLAnchorElement);
	const createObjectURL = vi.fn().mockReturnValue('blob:tide-extension');
	const revokeObjectURL = vi.fn();
	Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
	Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
	vi.spyOn(globalThis, 'fetch').mockResolvedValue({
		ok: true,
		headers: {
			get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/zip' : null)
		},
		blob: async () => new Blob(['PK'], { type: 'application/zip' })
	} as Response);

	await downloadBrowserExtension('session-token');

	expect(createObjectURL).toHaveBeenCalledTimes(1);
	expect(click).toHaveBeenCalledTimes(1);
	expect(remove).toHaveBeenCalledTimes(1);
	expect(revokeObjectURL).toHaveBeenCalledWith('blob:tide-extension');
});

test('rejects an unexpected download content type before creating a local download', async () => {
	const createObjectURL = vi.fn();
	Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
	vi.spyOn(globalThis, 'fetch').mockResolvedValue({
		ok: true,
		headers: { get: () => 'text/html' }
	} as unknown as Response);

	await expect(downloadBrowserExtension('session-token')).rejects.toThrow(
		'browser_extension_download_invalid_content_type'
	);
	expect(createObjectURL).not.toHaveBeenCalled();
});
