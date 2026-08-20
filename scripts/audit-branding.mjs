import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const requiredFiles = [
	'static/tide-bot/tide-bot-master.png',
	'static/tide-bot/tide-bot-96.png',
	'static/tide-bot/tide-bot-192.png',
	'static/tide-bot/tide-bot-512.png',
	'static/tide-bot/ted-bot/spritesheet.webp',
	'src/lib/branding.ts',
	'browser-extension/manifest.json',
	'src/lib/components/browser-extension/BrowserExtensionSettings.svelte'
];

const requiredIdentity = [
	['src/lib/branding.ts', 'Tide-Bot'],
	['src/lib/branding.ts', 'Changing Tides Treatment Center'],
	['backend/open_webui/env.py', "WEBUI_NAME = os.getenv('WEBUI_NAME', 'Tide-Bot')"],
	['src/routes/auth/+page.svelte', '<BrandLockup />'],
	['src/routes/auth/+page.svelte', '<TedBotMascot />'],
	['src/lib/components/OnBoarding.svelte', 'Welcome to Tide-Bot.'],
	['src/lib/components/OnBoarding.svelte', '<BrandLockup compact={true} />'],
	[
		'backend/open_webui/config.py',
		"ENABLE_COMMUNITY_SHARING = os.getenv('ENABLE_COMMUNITY_SHARING', 'False')"
	],
	['src/app.html', '<title>Tide-Bot | Changing Tides Treatment Center</title>'],
	['src/app.html', '/tide-bot/tide-bot-96.png'],
	['src/lib/components/layout/Sidebar.svelte', 'BRAND.faviconPath'],
	['browser-extension/manifest.json', 'Tide-Bot Browser Control'],
	[
		'src/lib/components/browser-extension/BrowserExtensionSettings.svelte',
		'Tide-Bot Browser Control'
	],
	[
		'src/lib/components/browser-extension/BrowserExtensionSettings.svelte',
		'local models remain on your Tide-Bot server'
	],
	['backend/open_webui/routers/models.py', '/tide-bot/tide-bot-96.png'],
	['static/static/site.webmanifest', 'Tide-Bot | Changing Tides Treatment Center']
];

const brandedFallbackAssets = [
	['static/favicon.png', 'static/tide-bot/tide-bot-96.png'],
	['static/static/favicon.png', 'static/tide-bot/tide-bot-96.png'],
	['static/static/favicon-96x96.png', 'static/tide-bot/tide-bot-96.png']
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
	'src/lib/components/admin/Evaluations/Feedbacks.svelte',
	'src/lib/components/browser-extension/BrowserExtensionSettings.svelte'
];

const authenticatedBrandingFiles = [
	'src/lib/components/chat/Settings/General.svelte',
	'src/lib/components/chat/Settings/About.svelte',
	'src/lib/components/chat/Settings/SyncStatsModal.svelte',
	'src/lib/components/admin/Settings/Audio.svelte',
	'src/lib/components/admin/Settings/Authentication.svelte',
	'src/lib/components/admin/Settings/CodeExecution.svelte',
	'src/lib/components/admin/Settings/Events.svelte',
	'src/lib/components/admin/Settings/ExternalKnowledge.svelte',
	'src/lib/components/admin/Functions/FunctionEditor.svelte',
	'src/lib/components/workspace/Knowledge/KnowledgeBase.svelte',
	'src/lib/components/workspace/common/CommunityDiscover.svelte',
	'src/lib/components/workspace/common/ManifestModal.svelte',
	'src/lib/components/AddTerminalServerModal.svelte',
	'src/routes/(app)/admin/functions/create/+page.svelte',
	'src/routes/(app)/admin/functions/edit/+page.svelte',
	'src/routes/(app)/workspace/tools/create/+page.svelte',
	'src/routes/(app)/workspace/tools/edit/+page.svelte',
	'src/lib/components/browser-extension/BrowserExtensionSettings.svelte'
];

const prohibitedVisibleBranding = ['Open WebUI', 'OpenWebUI'];

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

for (const [alias, canonical] of brandedFallbackAssets) {
	const aliasBytes = await readFile(resolve(root, alias));
	const canonicalBytes = await readFile(resolve(root, canonical));
	if (!aliasBytes.equals(canonicalBytes)) {
		throw new Error(`Brand audit failed: ${alias} is not the Tide-Bot fallback asset`);
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

for (const file of authenticatedBrandingFiles) {
	const contents = await readFile(resolve(root, file), 'utf8');
	for (const label of prohibitedVisibleBranding) {
		if (contents.includes(label)) {
			throw new Error(
				`Brand audit failed: visible upstream label ${JSON.stringify(label)} remains in ${file}`
			);
		}
	}
}

console.log('Tide-Bot brand audit passed.');
