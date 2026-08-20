import { readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import {
	chromium,
	expect,
	test,
	type APIRequestContext,
	type BrowserContext,
	type Page
} from '@playwright/test';

const requiredEnvironment = (name: string) => {
	const value = process.env[name];
	if (!value) throw new Error(`missing_${name.toLowerCase()}`);
	return value;
};

const serverOrigin = requiredEnvironment('TIDE_E2E_SERVER_ORIGIN');
const extensionPath = resolve(requiredEnvironment('TIDE_E2E_EXTENSION_PATH'));
const profileDir = resolve(requiredEnvironment('TIDE_E2E_PROFILE_DIR'));
const downloadDir = resolve(requiredEnvironment('TIDE_E2E_DOWNLOAD_DIR'));

if (
	new URL(serverOrigin).hostname !== '127.0.0.1' ||
	!profileDir.includes('tide-bot-browser-extension-e2e-') ||
	!extensionPath.startsWith(`${resolve(profileDir, '..')}${sep}`)
) {
	throw new Error('unsafe_browser_extension_e2e_environment');
}

const audioMocks = () => {
	class FakeTrack {
		stop() {}
	}
	class FakeStream {
		getTracks() {
			return [new FakeTrack()];
		}
	}
	Object.defineProperty(navigator, 'mediaDevices', {
		configurable: true,
		value: { getUserMedia: async () => new FakeStream() }
	});

	class FakeMediaRecorder {
		static isTypeSupported() {
			return true;
		}
		state = 'inactive';
		ondataavailable: ((event: { data: Blob }) => void) | null = null;
		onstop: (() => void) | null = null;
		constructor(_stream: unknown, _options?: unknown) {}
		start() {
			this.state = 'recording';
		}
		stop() {
			this.ondataavailable?.({ data: new Blob(['voice-e2e'], { type: 'audio/webm' }) });
			this.state = 'inactive';
			queueMicrotask(() => this.onstop?.());
		}
	}
	Object.defineProperty(globalThis, 'MediaRecorder', {
		configurable: true,
		value: FakeMediaRecorder
	});

	class FakeAudioContext {
		createMediaStreamSource() {
			return { connect() {} };
		}
		createAnalyser() {
			let samples = 0;
			return {
				fftSize: 1024,
				getFloatTimeDomainData(values: Float32Array) {
					values.fill(samples++ < 3 ? 0.08 : 0);
				}
			};
		}
		async resume() {}
		async close() {}
	}
	Object.defineProperty(globalThis, 'AudioContext', {
		configurable: true,
		value: FakeAudioContext
	});

	class FakeAudio {
		onended: (() => void) | null = null;
		constructor(_url: string) {}
		async play() {
			setTimeout(() => this.onended?.(), 10);
		}
		pause() {}
	}
	Object.defineProperty(globalThis, 'Audio', { configurable: true, value: FakeAudio });
};

async function extensionId(context: BrowserContext) {
	let worker = context.serviceWorkers()[0];
	worker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
	const id = new URL(worker.url()).host;
	if (!/^[a-p]{32}$/.test(id)) throw new Error('invalid_test_extension_id');
	return id;
}

async function submit(panel: Page, prompt: string) {
	await panel.getByLabel('Message Tide-Bot').fill(prompt);
	await panel.getByRole('button', { name: 'Send message' }).click();
}

async function submitAndExpect(panel: Page, prompt: string, response: string) {
	await submit(panel, prompt);
	try {
		await expect(panel.getByText(response, { exact: true })).toBeVisible();
	} catch (cause) {
		const bounded = (values: string[]) => values.slice(-5).map((value) => value.slice(0, 200));
		const alerts = bounded(await panel.getByRole('alert').allTextContents());
		const assistantMessages = bounded(await panel.locator('article.assistant p').allTextContents());
		throw new Error(
			`assistant_response_missing alerts=${JSON.stringify(alerts)} assistant=${JSON.stringify(assistantMessages)}`,
			{ cause }
		);
	}
}

async function e2eState(request: APIRequestContext) {
	const response = await request.get(`${serverOrigin}/__e2e/state`);
	expect(response.ok()).toBe(true);
	return response.json();
}

async function setSessionMode(panel: Page, target: Page, mode: string) {
	const stop = panel.getByRole('button', { name: 'Stop', exact: true });
	if (await stop.isVisible().catch(() => false)) await stop.click();
	await panel.getByLabel('Action mode').selectOption(mode);
	await target.bringToFront();
	await panel.getByRole('button', { name: 'Start controlling tab' }).click();
	await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
}

test('pairs, chats, controls one tab, uses voice, records schedules, and recovers securely', async ({
	request
}: {
	request: APIRequestContext;
}) => {
	const context = await chromium.launchPersistentContext(profileDir, {
		channel: 'chromium',
		headless: true,
		acceptDownloads: true,
		downloadsPath: downloadDir,
		args: [
			`--disable-extensions-except=${extensionPath}`,
			`--load-extension=${extensionPath}`,
			'--no-first-run',
			'--disable-default-apps'
		]
	});
	await context.addInitScript(audioMocks);

	try {
		const id = await extensionId(context);
		const panel = await context.newPage();
		await panel.goto(`chrome-extension://${id}/sidepanel.html`);
		await expect(
			panel.getByRole('heading', { name: 'Bring Tide-Bot into your browser.' })
		).toBeVisible();
		await expect(panel.getByLabel('Voice controls')).toHaveCount(0);

		const verificationPromise = context.waitForEvent('page');
		await panel.getByRole('button', { name: 'Pair browser' }).click();
		const verification = await verificationPromise;
		await verification.waitForLoadState('domcontentloaded');
		await expect(verification.getByText('TIDE-E2E', { exact: true })).toBeVisible();
		await verification.getByRole('button', { name: 'Approve browser' }).click();
		await expect(verification.getByRole('heading', { name: 'Browser approved' })).toBeVisible();
		await expect(panel.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15_000 });

		await expect(panel.getByLabel('Model')).toHaveValue('local-llama');
		await panel.getByLabel('Model').selectOption('local-qwen');
		await expect(panel.getByLabel('Model')).toHaveValue('local-qwen');
		await expect(panel.getByLabel('Action mode')).toHaveValue('autonomous');
		await expect(panel.getByLabel('Tab policy')).toHaveValue('locked');
		expect(await panel.getByLabel('Action mode').locator('option').allTextContents()).toEqual([
			'Autonomous',
			'Consequential approval',
			'Manual approval'
		]);

		const target = verification;
		await target.goto(`${serverOrigin}/test-page`);
		await target.bringToFront();
		await panel.getByRole('button', { name: 'Start controlling tab' }).click();
		await expect(panel.getByText(`${serverOrigin}/test-page`, { exact: true })).toBeVisible();

		await submitAndExpect(
			panel,
			'Hello Tide-Bot from text chat',
			'Tide-Bot replied through the selected local model.'
		);
		await submitAndExpect(
			panel,
			'E2E ordinary controls',
			'Ordinary controls completed in the locked tab.'
		);
		await expect(target.getByLabel('Name')).toHaveValue('Ada Lovelace');
		await expect(target.getByLabel('Plan')).toHaveValue('pro');
		await expect(target.getByText('ordinary clicked', { exact: true })).toBeVisible();

		await submitAndExpect(panel, 'E2E navigate within test', 'Navigation completed.');
		await target.waitForURL(`${serverOrigin}/test-page?view=navigated`);
		await expect(target.getByText('navigated', { exact: true })).toBeVisible();

		await submitAndExpect(
			panel,
			'E2E capture safe diagnostics',
			'Screenshot metadata and sanitized diagnostics verified.'
		);

		const secondTab = await context.newPage();
		await secondTab.goto(`${serverOrigin}/test-page?view=second`);
		await secondTab.bringToFront();
		await submitAndExpect(panel, 'E2E locked tab check', 'The original tab remained locked.');
		await expect(target.getByText('locked clicked', { exact: true })).toBeVisible();
		await expect(secondTab.getByText('No actions yet', { exact: true })).toBeVisible();

		await setSessionMode(panel, target, 'consequential-approval');
		await submit(panel, 'E2E delete account test');
		await expect(panel.getByText('Approval needed', { exact: true })).toBeVisible();
		await panel.getByRole('button', { name: 'Allow action' }).click();
		await expect(
			panel.getByText('The consequential test action completed after approval.', { exact: true })
		).toBeVisible();
		await expect(target.getByText('delete clicked', { exact: true })).toBeVisible();

		await submit(panel, 'E2E download test report');
		await expect(panel.getByText('Approval needed', { exact: true })).toBeVisible();
		await panel.getByRole('button', { name: 'Allow action' }).click();
		await expect(
			panel.getByText('The approved report download started.', { exact: true })
		).toBeVisible();
		await expect.poll(async () => (await e2eState(request)).coverage.browser_download).toBe(1);

		await setSessionMode(panel, target, 'manual-approval');
		await submit(panel, 'E2E manual ordinary action');
		await expect(panel.getByText('Approval needed', { exact: true })).toBeVisible();
		await panel.getByRole('button', { name: 'Allow action' }).click();
		await expect(
			panel.getByText('The manual action completed after approval.', { exact: true })
		).toBeVisible();

		await setSessionMode(panel, target, 'autonomous');
		await panel.getByRole('button', { name: 'Manage workflows' }).click();
		await panel.getByRole('button', { name: 'Start recording' }).click();
		await target.waitForTimeout(250);
		await target.getByRole('button', { name: 'Ordinary action' }).click();
		await target.waitForTimeout(250);
		await panel.getByRole('button', { name: 'Stop and review' }).click();
		await expect(panel.getByText(/Review \d+ recorded steps?/)).toBeVisible();
		await panel.getByLabel('Workflow name').fill('E2E recorded workflow');
		await panel.getByRole('button', { name: 'Save reviewed workflow' }).click();
		await expect(panel.getByText('E2E recorded workflow', { exact: true })).toBeVisible();

		await panel.getByLabel('Schedule name').fill('E2E scheduled replay');
		await panel.getByLabel('Schedule frequency').selectOption('HOURLY');
		await panel.getByLabel('First run').fill('2099-01-01T12:00');
		await panel.getByRole('button', { name: 'Create schedule' }).click();
		await expect(panel.getByText('E2E scheduled replay', { exact: true })).toBeVisible();
		await expect
			.poll(async () => (await e2eState(request)).events.schedule_runs, {
				timeout: 12_000
			})
			.toBeGreaterThan(0);
		await expect(panel.getByText('Schedule: E2E scheduled replay', { exact: true })).toBeVisible();

		await panel.getByRole('button', { name: 'Use voice' }).click();
		await expect(panel.getByLabel('Voice mode')).toHaveValue('hands-free');
		await expect(panel.getByText('Hands-free voice', { exact: true })).toBeVisible();
		await expect(
			panel.getByText('Tide-Bot replied through the selected local model.', { exact: true })
		).toHaveCount(2, { timeout: 15_000 });
		await expect
			.poll(async () => (await e2eState(request)).coverage.hands_free_transcription)
			.toBe(true);

		await request.post(`${serverOrigin}/__e2e/offline`, { data: { offline: true } });
		await panel.reload();
		await expect(panel.getByText('Offline', { exact: true })).toBeVisible();
		await request.post(`${serverOrigin}/__e2e/offline`, { data: { offline: false } });
		await panel.getByRole('button', { name: 'Reconnect' }).click();
		await expect(panel.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15_000 });

		await request.post(`${serverOrigin}/__e2e/revoke`);
		await panel.waitForTimeout(1_500);
		await panel.reload();
		await expect(panel.getByText('Offline', { exact: true })).toBeVisible();
		await panel.getByRole('button', { name: 'Reconnect' }).click();
		await expect(panel.getByRole('button', { name: 'Pair browser' })).toBeVisible();
		await expect.poll(async () => (await e2eState(request)).revoked).toBe(true);

		const downloaded = await readdir(downloadDir);
		expect(downloaded.some((name) => name.includes('tide-bot-e2e-report'))).toBe(true);
	} finally {
		await context.close();
	}
});
