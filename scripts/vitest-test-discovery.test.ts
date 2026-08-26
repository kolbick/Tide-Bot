import { describe, expect, test } from 'vitest';
import { configDefaults } from 'vitest/config';

import viteConfig, { getVitestExclude } from '../vite.config';

describe('Vitest test discovery exclusions', () => {
	test('excludes only nested worktrees on Linux and macOS', () => {
		expect(getVitestExclude('linux')).toEqual(['.worktrees/**']);
		expect(getVitestExclude('darwin')).toEqual(['.worktrees/**']);
	});

	test('also excludes the POSIX permission test on Windows', () => {
		expect(getVitestExclude('win32')).toEqual([
			'.worktrees/**',
			'scripts/verify-ted-bot-direction-evidence.test.mjs'
		]);
	});

	test('the active config consumes the exclusions for its current platform', () => {
		const activePlatformExclusions =
			process.platform === 'win32'
				? ['.worktrees/**', 'scripts/verify-ted-bot-direction-evidence.test.mjs']
				: ['.worktrees/**'];

		expect(viteConfig.test?.exclude).toEqual(expect.arrayContaining(activePlatformExclusions));
		if (process.platform !== 'win32') {
			expect(viteConfig.test?.exclude).not.toContain(
				'scripts/verify-ted-bot-direction-evidence.test.mjs'
			);
		}
	});

	test('the active config preserves the Vitest default exclusions', () => {
		expect(viteConfig.test?.exclude).toEqual(expect.arrayContaining(configDefaults.exclude));
	});
});
