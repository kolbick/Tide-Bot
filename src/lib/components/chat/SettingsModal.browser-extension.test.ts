import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const readSource = (relativePath: string) =>
	readFile(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

test('exposes browser control settings only through the effective feature permission', async () => {
	const modal = await readSource('./SettingsModal.svelte');

	expect(modal).toContain("id: 'browser_extension'");
	expect(modal).toContain('$user?.permissions?.features?.browser_extension ?? true');
	expect(modal).toContain(
		"import BrowserExtensionSettings from '../browser-extension/BrowserExtensionSettings.svelte'"
	);
	expect(modal).toMatch(
		/{:else if selectedTab === 'browser_extension'}[\s\S]*<BrowserExtensionSettings[\s\S]*role={\$user\?\.role \?\? 'user'}/
	);
});

test('adds a direct Browser control entry to the signed-in user menu', async () => {
	const menu = await readSource('../layout/Sidebar/UserMenu.svelte');

	expect(menu).toContain("showSettings.set('browser_extension')");
	expect(menu).toContain('$user?.permissions?.features?.browser_extension ?? true');
	expect(menu).toContain("$i18n.t('Browser control')");
});
