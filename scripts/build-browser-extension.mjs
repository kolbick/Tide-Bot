import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import JSZip from 'jszip';
import { build } from 'vite';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionRoot = join(repoRoot, 'browser-extension');
const productionOrigin = 'https://tide-bot.com';
const archiveDate = new Date('2026-01-01T00:00:00.000Z');

async function listFiles(root, current = root) {
	const entries = await readdir(current, { withFileTypes: true });
	const files = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		const path = join(current, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
		else files.push({ path, name: relative(root, path).replaceAll('\\', '/') });
	}
	return files;
}

function resolveServerOrigin(mode, testServerOrigin) {
	if (mode === 'production') return productionOrigin;
	if (mode !== 'test') throw new Error('mode must be production or test');
	const parsed = new URL(testServerOrigin ?? '');
	if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
		throw new Error('test server origin must be loopback HTTP');
	}
	return parsed.origin;
}

async function buildSidePanel(distDir, serverOrigin) {
	await build({
		root: extensionRoot,
		configFile: false,
		plugins: [svelte()],
		define: { __TIDE_BOT_SERVER_ORIGIN__: JSON.stringify(serverOrigin) },
		build: {
			emptyOutDir: true,
			outDir: distDir,
			sourcemap: false,
			rollupOptions: { input: join(extensionRoot, 'sidepanel.html') }
		},
		logLevel: 'silent'
	});
}

async function buildScript({ entry, fileName, format, name, distDir, serverOrigin }) {
	await build({
		root: extensionRoot,
		configFile: false,
		define: { __TIDE_BOT_SERVER_ORIGIN__: JSON.stringify(serverOrigin) },
		build: {
			emptyOutDir: false,
			outDir: distDir,
			sourcemap: false,
			lib: { entry, formats: [format], name, fileName: () => fileName },
			rollupOptions: { output: { inlineDynamicImports: true } }
		},
		logLevel: 'silent'
	});
}

async function assertNoRemoteHostedCode(distDir) {
	for (const file of await listFiles(distDir)) {
		if (!/\.(?:html|js)$/.test(file.name)) continue;
		const source = await readFile(file.path, 'utf8');
		if (/<script[^>]+src=["']https?:\/\//i.test(source)) {
			throw new Error(`remote script found in ${file.name}`);
		}
		if (/\bimport\s*\(\s*["']https?:\/\//i.test(source)) {
			throw new Error(`remote module import found in ${file.name}`);
		}
	}
}

async function writeArchive(distDir, zipPath) {
	const zip = new JSZip();
	for (const file of await listFiles(distDir)) {
		zip.file(file.name, await readFile(file.path), {
			date: archiveDate,
			unixPermissions: 0o644,
			createFolders: false
		});
	}
	const bytes = await zip.generateAsync({
		type: 'nodebuffer',
		platform: 'UNIX',
		compression: 'DEFLATE',
		compressionOptions: { level: 9 }
	});
	await writeFile(zipPath, bytes, { mode: 0o644 });
	return createHash('sha256').update(bytes).digest('hex');
}

export async function buildBrowserExtension({
	mode = 'production',
	outputRoot = join(extensionRoot, 'release'),
	publishBackendArtifact = true,
	testServerOrigin
} = {}) {
	const serverOrigin = resolveServerOrigin(mode, testServerOrigin);
	const distDir = join(outputRoot, 'dist');
	const zipPath = join(outputRoot, 'tide-bot-browser-extension.zip');
	await rm(outputRoot, { recursive: true, force: true });
	await mkdir(distDir, { recursive: true });

	await buildSidePanel(distDir, serverOrigin);
	await buildScript({
		entry: join(extensionRoot, 'src/background/service-worker.ts'),
		fileName: 'service-worker.js',
		format: 'es',
		name: 'TideBotServiceWorker',
		distDir,
		serverOrigin
	});
	await buildScript({
		entry: join(extensionRoot, 'src/content/index.ts'),
		fileName: 'content-script.js',
		format: 'iife',
		name: 'TideBotContentScript',
		distDir,
		serverOrigin
	});

	await cp(join(extensionRoot, 'manifest.json'), join(distDir, 'manifest.json'));
	await cp(join(extensionRoot, 'icons'), join(distDir, 'icons'), { recursive: true });

	await assertNoRemoteHostedCode(distDir);
	const sha256 = await writeArchive(distDir, zipPath);
	if (publishBackendArtifact) {
		const backendDir = join(repoRoot, 'backend/open_webui/static/browser-extension');
		await mkdir(backendDir, { recursive: true });
		await cp(zipPath, join(backendDir, 'tide-bot-browser-extension.zip'));
		await writeFile(join(backendDir, 'tide-bot-browser-extension.sha256'), `${sha256}\n`);
	}

	return { distDir, zipPath, sha256, serverOrigin };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await buildBrowserExtension();
	process.stdout.write(`Tide-Bot browser extension: ${result.zipPath}\nSHA-256: ${result.sha256}\n`);
}
