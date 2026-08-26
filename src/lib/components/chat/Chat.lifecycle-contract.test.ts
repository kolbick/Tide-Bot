import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, test } from 'vitest';

let source = '';

const section = (start: string, end: string) => {
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex + start.length);
	expect(startIndex, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
	expect(endIndex, `missing section end: ${end}`).toBeGreaterThan(startIndex);
	return source.slice(startIndex, endIndex);
};

beforeAll(async () => {
	source = await readFile(fileURLToPath(new URL('./Chat.svelte', import.meta.url)), 'utf8');
});

test('uses one lifecycle binding for real load, completion, stop, and queue continuations', () => {
	expect(source).toContain("from './chatLifecycleBinding'");
	expect(source).toContain('const chatLifecycle = createChatLifecycleBinding()');

	const navigation = section('const navigateHandler', 'const initEmbeddedDraft');
	const load = section('const loadChat', 'const scrollToBottom');
	const completion = section('const sendMessageSocket', 'const handleOpenAIError');
	const stop = section('const stopResponse', 'const submitMessage');
	const queue = section('const processNextInQueue', 'const chatCompletedHandler');

	expect(`${navigation}\n${load}`).toMatch(
		/capture\('load'[\s\S]*await (?:loadChat|getChatById)[\s\S]*continueIfCurrent/
	);
	expect(completion).toMatch(
		/capture\('completion'[\s\S]*await generateOpenAIChatCompletion[\s\S]*continueIfCurrent/
	);
	expect(stop).toMatch(
		/capture\('stop'[\s\S]*await (?:stopTasksByChatId|Promise\.all)[\s\S]*continueIfCurrent/
	);
	expect(queue).toMatch(/capture\('queue'[\s\S]*await submitPrompt[\s\S]*continueIfCurrent/);
});

test('guards socket completion settlement after render and queue awaits', () => {
	const completionEvents = section('const chatCompletionEventHandler', '// Chat functions');

	expect(completionEvents).toMatch(
		/capture\('completion'[\s\S]*await tick\(\)[\s\S]*continueIfCurrent/
	);
	expect(completionEvents).toMatch(
		/capture\('completion'[\s\S]*await processNextInQueue\(chatId\)[\s\S]*continueIfCurrent/
	);
});

test('invalidates every chat-id transition and component destruction', () => {
	expect(source).toMatch(
		/\$:\s*if \(chatIdProp !== lifecycleChatId\) {[\s\S]*chatLifecycle\.resetForNavigation\(\)[\s\S]*if \(chatIdProp\)/
	);
	expect(source).toMatch(/onDestroy\(\(\) => {[\s\S]*?chatLifecycle\.destroy\(\);[\s\S]*?}\)/);
});

test('denies pending confirmation and clears stale dialog state on chat transition', () => {
	const navigationReset = section(
		'$: if (chatIdProp !== lifecycleChatId)',
		'$: if (embedded && embeddedDraftKey'
	);
	const confirmationReset = section('const clearEventConfirmationState', 'let selectedModels');

	expect(navigationReset).toMatch(
		/chatLifecycle\.resetForNavigation\(\);\s*clearEventConfirmationState\(\);/
	);
	expect(confirmationReset).toMatch(/showEventConfirmation = false/);
	expect(confirmationReset).toMatch(/eventConfirmationInput = false/);
	expect(confirmationReset).toMatch(/eventConfirmationInputValue = ''/);
	expect(confirmationReset).toMatch(/eventCallback = null/);
});

test('registers and settles every canonical event callback through one-shot wrappers', () => {
	const wrappedAssignments =
		source.match(/eventCallback\s*=\s*chatLifecycle\.registerPendingEventCallback\(/g) ?? [];
	const allAssignments = source.match(/eventCallback\s*=/g) ?? [];
	expect(wrappedAssignments).toHaveLength(6);
	expect(allAssignments).toHaveLength(wrappedAssignments.length + 1);

	const eventHandler = section('const chatEventHandler', 'const onMessageHandler');
	const embeddedHandlers = section('const onMessageHandler', 'const savedModelIds');
	const dialog = section('<EventConfirmDialog', '<div\n\tclass=');

	expect(eventHandler).toMatch(
		/type === 'execute'[\s\S]*registerPendingEventCallback\(cb\)[\s\S]*\w+Callback\.settle\(result\)/
	);
	expect(eventHandler).toMatch(/type === 'confirmation'[\s\S]*registerPendingEventCallback\(cb\)/);
	expect(eventHandler).toMatch(/type === 'input'[\s\S]*registerPendingEventCallback\(cb\)/);
	expect(eventHandler).toMatch(
		/type === 'request:user_input'[\s\S]*registerPendingEventCallback\(cb\)/
	);
	expect(embeddedHandlers.match(/registerPendingEventCallback\(/g)).toHaveLength(2);
	expect(dialog.match(/eventCallback\?\.settle\(/g)).toHaveLength(4);
	expect(dialog).not.toMatch(/eventCallback\?\.\(|eventCallback\(/);
});

test('defines the canonical companion surface without changing completion ownership', () => {
	expect(source).toContain("type ChatSurface = 'full' | 'note' | 'companion'");
	expect(source).toContain("export let surface: ChatSurface = 'full'");
	expect(source).toMatch(
		/<Messages[\s\S]*<MessageInput[\s\S]*mode={surface === 'companion' \? 'companion' : 'full'}/
	);
	expect(source).toMatch(/{#if surface !== 'companion'}[\s\S]*<Navbar/);
	expect(source).toMatch(/{#if !embedded && surface !== 'companion'}[\s\S]*<ChatControls/);
	expect(source).not.toMatch(/chatController|companionCompletion|companionEventHandler/);
});
