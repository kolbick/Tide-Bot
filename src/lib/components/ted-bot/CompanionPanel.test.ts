import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const readSource = (relativePath: string) =>
	readFile(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

test('reuses the canonical companion Chat surface without duplicate APIs', async () => {
	const source = await readSource('./CompanionPanel.svelte');

	expect(source).toContain("from '$lib/components/chat/Chat.svelte'");
	expect(source).toMatch(/<Chat[\s\S]*chatIdProp={chatId}[\s\S]*surface=['"]companion['"]/);
	expect(source).not.toMatch(/from\s+['"]\$lib\/apis\/(?:openai|tools)['"]/);
});

test('subscribes the authenticated companion route to authorized active-chat presence', async () => {
	const source = await readSource('../../../routes/(app)/companion/+page.svelte');

	expect(source).toContain("from '$lib/ted-bot/presence'");
	expect(source).toContain('createCompanionPresenceSubscriber');
	expect(source).toMatch(/active\?\.chatId\s*\?\?\s*null/);
	expect(source).toMatch(/<CompanionPanel\s+chatId={activeChatId}/);
	expect(source).not.toMatch(/getChatById|fetch\(|\$lib\/apis/);
});
