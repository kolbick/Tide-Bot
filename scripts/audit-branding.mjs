import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const requiredFiles = [
	'static/tide-bot/tide-bot-master.png',
	'static/tide-bot/tide-bot-96.png',
	'static/tide-bot/tide-bot-192.png',
	'static/tide-bot/tide-bot-512.png',
	'static/tide-bot/ted-bot/spritesheet.webp',
	'src/lib/branding.ts'
];

const requiredIdentity = [
	['src/lib/branding.ts', 'Tide-Bot'],
	['src/lib/branding.ts', 'Changing Tides Treatment Center'],
	['backend/open_webui/env.py', "WEBUI_NAME = os.getenv('WEBUI_NAME', 'Tide-Bot')"],
	['src/routes/auth/+page.svelte', '<BrandLockup />'],
	['src/routes/auth/+page.svelte', '<TedBotMascot />'],
	['src/lib/components/OnBoarding.svelte', 'Welcome to Tide-Bot.'],
	['src/lib/components/OnBoarding.svelte', '<BrandLockup compact={true} />'],
	['src/lib/components/branding/TedBotMascot.svelte', 'background-size: 800% 1100%'],
	['src/lib/components/chat/Placeholder.svelte', 'tide-chat-landing'],
	['src/lib/components/layout/Sidebar.svelte', 'tide-sidebar'],
	['src/app.css', 'tide-chat-landing__panel'],
	[
		'backend/open_webui/config.py',
		"ENABLE_COMMUNITY_SHARING = os.getenv('ENABLE_COMMUNITY_SHARING', 'False')"
	],
	['src/app.html', '<title>Tide-Bot | Changing Tides Treatment Center</title>'],
	['src/app.html', '/tide-bot/tide-bot-96.png'],
	['static/static/site.webmanifest', 'Tide-Bot | Changing Tides Treatment Center']
];

const productSurfaceFiles = [
	'src/routes/error/+page.svelte',
	'src/routes/+layout.svelte',
	'src/lib/components/layout/Sidebar/UserMenu.svelte',
	'src/lib/components/channel/Channel.svelte',
	'src/lib/components/chat/Settings/About.svelte',
	'src/lib/components/chat/ShareChatModal.svelte',
	'src/lib/components/admin/Settings/General.svelte',
	'src/lib/components/admin/Functions.svelte',
	'src/lib/components/workspace/Prompts.svelte',
	'src/lib/components/workspace/Models.svelte',
	'src/lib/components/workspace/Tools.svelte',
	'src/lib/components/chat/ChatPlaceholder.svelte',
	'src/lib/components/chat/Messages/RateComment.svelte',
	'src/lib/components/chat/ModelSelector/ModelItemMenu.svelte',
	'src/lib/components/AddToolServerModal.svelte',
	'src/lib/components/admin/Evaluations/Feedbacks.svelte'
];

const prohibitedPromotionalUrls = [
	'https://docs.openwebui.com',
	'https://discord.gg/5rJgQTnV4s',
	'https://twitter.com/OpenWebUI',
	'https://github.com/open-webui/open-webui/releases',
	'https://openwebui.com',
	'https://github.com/sponsors/open-webui'
];

for (const file of requiredFiles) {
	await access(resolve(root, file));
}

for (const [file, expected] of requiredIdentity) {
	const contents = await readFile(resolve(root, file), 'utf8');
	if (!contents.includes(expected)) {
		throw new Error(`Brand audit failed: expected ${JSON.stringify(expected)} in ${file}`);
	}
}

for (const file of productSurfaceFiles) {
	const contents = await readFile(resolve(root, file), 'utf8');
	for (const url of prohibitedPromotionalUrls) {
		if (contents.includes(url)) {
			throw new Error(`Brand audit failed: upstream promotional URL ${url} remains in ${file}`);
		}
	}
}

console.log('Tide-Bot brand audit passed.');
