import { describe, expect, it } from 'vitest';

import { DEFAULT_PERMISSIONS } from './permissions';

describe('browser extension permission defaults', () => {
	it('enables browser control for users until an administrator disables it', () => {
		expect(DEFAULT_PERMISSIONS.features.browser_extension).toBe(true);
	});
});
