import { describe, expect, it, vi } from 'vitest';

import { BrowserAuth, type TokenResponse } from './auth';
import { createChromeMock } from '../testing/chrome';

const tokenResponse = (changes: Partial<TokenResponse> = {}): TokenResponse => ({
	access_token: 'memory-only-access-token',
	refresh_token: 'opaque-refresh-token-a',
	token_type: 'Bearer',
	expires_in: 600,
	token_family_id: 'family-a',
	device: {
		id: 'device-a',
		label: 'My Chrome',
		allowed_origin: 'https://tide-bot.com',
		extension_version: '0.1.0'
	},
	...changes
});

const response = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

describe('BrowserAuth', () => {
	it('keeps access and pairing secrets in memory while storing only the opaque device credential', async () => {
		const mock = createChromeMock();
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				response(200, {
					grant_id: 'grant-a',
					device_code: 'ABCD-2345',
					verifier: 'private-verifier-value-that-never-leaves-memory',
					verification_uri: 'https://tide-bot.com/browser-extension/pair?grant_id=grant-a',
					interval: 2,
					expires_in: 300
				})
			)
			.mockResolvedValueOnce(response(200, tokenResponse()));
		const auth = new BrowserAuth({
			storage: mock.chrome.storage.local,
			fetcher,
			openVerification: (url) => mock.chrome.tabs.create({ url }),
			clock: () => 1_000_000,
			sleep: vi.fn()
		});

		const pairing = await auth.beginPairing('My Chrome');
		expect(pairing).toEqual({
			deviceCode: 'ABCD-2345',
			verificationUri: 'https://tide-bot.com/browser-extension/pair?grant_id=grant-a',
			expiresAt: 1_300_000
		});
		expect(JSON.stringify(pairing)).not.toContain('verifier');
		await auth.pollPairing();

		expect(mock.storageData).toEqual({
			tideBotAuth: {
				serverOrigin: 'https://tide-bot.com',
				deviceId: 'device-a',
				refreshToken: 'opaque-refresh-token-a',
				tokenFamilyId: 'family-a'
			}
		});
		expect(JSON.stringify(mock.storageData)).not.toContain('memory-only-access-token');
		expect(JSON.stringify(mock.storageData)).not.toContain('private-verifier');
		expect(await auth.getAccessToken()).toBe('memory-only-access-token');
	});

	it('polls pending pairing at the server interval and never persists the verifier', async () => {
		const mock = createChromeMock();
		const sleep = vi.fn();
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				response(200, {
					grant_id: 'grant-a',
					device_code: 'ABCD-2345',
					verifier: 'v'.repeat(64),
					verification_uri: 'https://tide-bot.com/pair',
					interval: 2,
					expires_in: 300
				})
			)
			.mockResolvedValueOnce(response(428, { detail: 'authorization_pending' }))
			.mockResolvedValueOnce(response(200, tokenResponse()));
		const auth = new BrowserAuth({ storage: mock.chrome.storage.local, fetcher, sleep });

		await auth.beginPairing('My Chrome');
		await auth.pollPairing();

		expect(sleep).toHaveBeenCalledWith(2_000);
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(JSON.stringify(mock.storageData)).not.toContain('vvvv');
	});

	it('refreshes before expiry, rotates the opaque credential, and restores after worker restart', async () => {
		const mock = createChromeMock({
			tideBotAuth: {
				serverOrigin: 'https://tide-bot.com',
				deviceId: 'device-a',
				refreshToken: 'opaque-refresh-token-a',
				tokenFamilyId: 'family-a'
			}
		});
		const fetcher = vi.fn().mockResolvedValue(
			response(
				200,
				tokenResponse({
					access_token: 'fresh-memory-token',
					refresh_token: 'opaque-refresh-token-b'
				})
			)
		);
		const auth = new BrowserAuth({
			storage: mock.chrome.storage.local,
			fetcher,
			clock: () => 5_000_000
		});

		expect(await auth.restore()).toBe(true);
		expect(await auth.getAccessToken()).toBe('fresh-memory-token');
		expect(mock.storageData.tideBotAuth).toMatchObject({
			refreshToken: 'opaque-refresh-token-b'
		});
		expect(fetcher).toHaveBeenCalledWith(
			'https://tide-bot.com/api/v1/browser-extension/token/refresh',
			expect.objectContaining({ method: 'POST' })
		);
	});

	it('refreshes a memory access token during the one-minute expiry safety window', async () => {
		const mock = createChromeMock();
		let now = 1_000_000;
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				response(200, {
					grant_id: 'grant-a',
					device_code: 'ABCD-2345',
					verifier: 'v'.repeat(64),
					verification_uri: 'https://tide-bot.com/pair',
					interval: 2,
					expires_in: 300
				})
			)
			.mockResolvedValueOnce(response(200, tokenResponse()))
			.mockResolvedValueOnce(
				response(
					200,
					tokenResponse({
						access_token: 'refreshed-before-expiry',
						refresh_token: 'opaque-refresh-token-b'
					})
				)
			);
		const auth = new BrowserAuth({
			storage: mock.chrome.storage.local,
			fetcher,
			clock: () => now
		});
		await auth.beginPairing('My Chrome');
		await auth.pollPairing();

		now = 1_541_000;
		expect(await auth.getAccessToken()).toBe('refreshed-before-expiry');
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it('signs out and erases the credential when refresh replay is detected', async () => {
		const mock = createChromeMock({
			tideBotAuth: {
				serverOrigin: 'https://tide-bot.com',
				deviceId: 'device-a',
				refreshToken: 'replayed-refresh-token',
				tokenFamilyId: 'family-a'
			}
		});
		const fetcher = vi
			.fn()
			.mockResolvedValue(response(401, { detail: 'invalid_refresh_credential' }));
		const auth = new BrowserAuth({ storage: mock.chrome.storage.local, fetcher });

		await expect(auth.restore()).rejects.toMatchObject({ code: 'invalid_refresh_credential' });
		expect(mock.storageData).toEqual({});
		expect(auth.status()).toEqual({
			paired: false,
			serverOrigin: 'https://tide-bot.com',
			deviceId: null
		});
	});

	it('never includes credential material in public status or console output', async () => {
		const mock = createChromeMock({
			tideBotAuth: {
				serverOrigin: 'https://tide-bot.com',
				deviceId: 'device-a',
				refreshToken: 'do-not-log-this-refresh-token',
				tokenFamilyId: 'family-a'
			}
		});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const auth = new BrowserAuth({
			storage: mock.chrome.storage.local,
			fetcher: vi.fn().mockResolvedValue(response(500, { detail: 'server_error' }))
		});

		await expect(auth.restore()).rejects.toMatchObject({ code: 'server_error' });
		expect(JSON.stringify(auth.status())).not.toContain('token');
		expect(consoleSpy).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});
