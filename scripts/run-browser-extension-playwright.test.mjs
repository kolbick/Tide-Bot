import assert from 'node:assert/strict';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';

import {
	HARNESS_TIMEOUT_MS,
	assertSafeRunnerOptions,
	cleanupHarnessWorkspace,
	createHarnessWorkspace,
	fixedHarnessInputs,
	redactHarnessOutput
} from './run-browser-extension-playwright.mjs';

test('rejects every caller-controlled origin, profile, extension, credential, and output path', () => {
	for (const key of ['serverOrigin', 'userDataDir', 'extensionPath', 'credentials', 'outputRoot']) {
		assert.throws(() => assertSafeRunnerOptions({ [key]: 'caller-controlled' }), {
			message: 'browser_extension_harness_options_are_fixed'
		});
	}
});

test('allocates a private harness-owned profile beneath a unique temporary root', async () => {
	const workspace = await createHarnessWorkspace();
	try {
		const root = resolve(workspace.root);
		assert.ok(root.startsWith(`${resolve(tmpdir())}${sep}`));
		assert.match(root, /tide-bot-browser-extension-e2e-/);
		assert.equal((await stat(root)).mode & 0o077, 0);
		assert.equal(workspace.profileDir, join(root, 'chromium-profile'));
		assert.equal(workspace.extensionOutputDir, join(root, 'extension'));
		assert.equal(workspace.downloadDir, join(root, 'downloads'));
		await access(workspace.ownerMarker);
	} finally {
		await cleanupHarnessWorkspace(workspace);
	}
	await assert.rejects(access(workspace.root));
});

test('refuses to clean a directory that was not created and marked by the harness', async () => {
	const unrelated = await mkdtemp(join(tmpdir(), 'not-tide-bot-e2e-'));
	try {
		await assert.rejects(
			cleanupHarnessWorkspace({
				root: unrelated,
				ownerMarker: join(unrelated, '.missing-owner')
			}),
			{ message: 'browser_extension_harness_cleanup_refused' }
		);
	} finally {
		await rm(unrelated, { recursive: true, force: true });
	}
});

test('uses fixed repository inputs and a bounded runtime', () => {
	const inputs = fixedHarnessInputs();
	assert.equal(inputs.extensionRoot, resolve('browser-extension'));
	assert.equal(inputs.playwrightConfig, resolve('browser-extension/playwright.config.ts'));
	assert.ok(HARNESS_TIMEOUT_MS >= 30_000 && HARNESS_TIMEOUT_MS <= 180_000);
	assert.deepEqual(Object.keys(inputs).sort(), ['extensionRoot', 'playwrightConfig']);
});

test('redacts credentials and pairing secrets from failure output', () => {
	const raw = [
		'Authorization: Bearer access-secret',
		'"refresh_token":"refresh-secret"',
		'"verifier":"verifier-secret"',
		'"device_code":"TIDE-1234"'
	].join('\n');
	const safe = redactHarnessOutput(raw);

	for (const secret of ['access-secret', 'refresh-secret', 'verifier-secret', 'TIDE-1234']) {
		assert.equal(safe.includes(secret), false);
	}
	assert.match(safe, /\[REDACTED\]/);
});
