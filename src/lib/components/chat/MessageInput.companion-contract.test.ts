import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const readMessageInput = () =>
	readFile(fileURLToPath(new URL('./MessageInput.svelte', import.meta.url)), 'utf8');

test('delegates companion typing to the presentation-only composer through canonical handlers', async () => {
	const source = await readMessageInput();

	expect(source).toContain(
		"import CompanionTextComposer from './MessageInput/CompanionTextComposer.svelte'"
	);
	expect(source).toContain("export let mode: 'full' | 'companion' = 'full'");
	expect(source).toMatch(
		/{#if mode === 'companion'}[\s\S]*<CompanionTextComposer[\s\S]*isGenerating={isActive}[\s\S]*on:send={handleCompanionSend}[\s\S]*on:stop={handleCompanionStop}[\s\S]*{:else}/
	);
	expect(source).toMatch(
		/const handleCompanionSend = \(event: CustomEvent<string>\) => {\s*dispatch\('submit', event\.detail\);\s*}/
	);
	expect(source).toMatch(/const handleCompanionStop = \(\) => {\s*stopResponse\(\);\s*}/);
	expect(source).toMatch(/<CompanionTextComposer[\s\S]*(?:chatId={chatId}|{chatId})/);
});

test('keeps optional input controls and global listeners outside companion mode', async () => {
	const source = await readMessageInput();
	const branch = source.match(
		/{#if mode === 'companion'}(?<companion>[\s\S]*?){:else}(?<full>[\s\S]*){\/if}\s*$/
	);

	expect(branch?.groups?.companion).toBeDefined();
	expect(branch?.groups?.companion).not.toMatch(
		/ToolServersModal|SkillsModal|InputVariablesModal|ValvesModal|VoiceRecording|filesInputElement|InputMenu|IntegrationsMenu|TerminalMenu|webSearchEnabled|recording|microphone|attach/i
	);
	expect(branch?.groups?.full).toMatch(
		/ToolServersModal[\s\S]*VoiceRecording[\s\S]*filesInputElement[\s\S]*webSearchEnabled[\s\S]*TerminalMenu/
	);
	expect(source).toMatch(
		/onMount\(\(\) => {\s*if \(mode === 'companion'\) {\s*loaded = true;\s*return;\s*}/
	);
});
