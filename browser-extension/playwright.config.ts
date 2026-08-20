import { join, resolve, sep } from 'node:path';

import { defineConfig } from '@playwright/test';

const profileDir = resolve(process.env.TIDE_E2E_PROFILE_DIR ?? '');
const temporaryRoot = resolve(process.env.TMPDIR ?? '/tmp');

if (
	!profileDir.startsWith(`${temporaryRoot}${sep}`) ||
	!profileDir.includes('tide-bot-browser-extension-e2e-')
) {
	throw new Error('playwright_profile_must_be_harness_owned');
}

export default defineConfig({
	testDir: './e2e',
	testMatch: 'browser-control.spec.ts',
	fullyParallel: false,
	workers: 1,
	timeout: 105_000,
	expect: { timeout: 10_000 },
	forbidOnly: true,
	retries: 0,
	reporter: [['line']],
	outputDir: join(profileDir, 'playwright-output'),
	use: {
		trace: 'off',
		screenshot: 'off',
		video: 'off'
	}
});
