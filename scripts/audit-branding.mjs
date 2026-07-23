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
	['src/app.html', '<title>Tide-Bot | Changing Tides Treatment Center</title>'],
	['src/app.html', '/tide-bot/tide-bot-96.png'],
	['static/static/site.webmanifest', 'Tide-Bot | Changing Tides Treatment Center']
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

console.log('Tide-Bot brand audit passed.');
