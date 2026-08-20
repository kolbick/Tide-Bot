import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { startFakeTideBot } from '../browser-extension/e2e/fixtures/fake-tide-bot.mjs';
import { buildBrowserExtension } from './build-browser-extension.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKSPACE_PREFIX = 'tide-bot-browser-extension-e2e-';
const OWNER_MARKER = '.tide-bot-harness-owner';
const OWNER_VALUE = 'tide-bot-browser-extension-harness-v1\n';
const MAX_CAPTURE_BYTES = 1_048_576;

export const HARNESS_TIMEOUT_MS = 120_000;

export function assertSafeRunnerOptions(options = {}) {
	if (
		typeof options !== 'object' ||
		options === null ||
		Array.isArray(options) ||
		Object.keys(options).length !== 0
	) {
		throw new Error('browser_extension_harness_options_are_fixed');
	}
}

export function fixedHarnessInputs() {
	return {
		extensionRoot: resolve(repoRoot, 'browser-extension'),
		playwrightConfig: resolve(repoRoot, 'browser-extension/playwright.config.ts')
	};
}

export async function createHarnessWorkspace() {
	const root = await mkdtemp(join(tmpdir(), WORKSPACE_PREFIX));
	await chmod(root, 0o700);
	const workspace = {
		root,
		profileDir: join(root, 'chromium-profile'),
		extensionOutputDir: join(root, 'extension'),
		downloadDir: join(root, 'downloads'),
		ownerMarker: join(root, OWNER_MARKER)
	};
	await Promise.all([
		mkdir(workspace.profileDir, { mode: 0o700 }),
		mkdir(workspace.extensionOutputDir, { mode: 0o700 }),
		mkdir(workspace.downloadDir, { mode: 0o700 })
	]);
	await writeFile(workspace.ownerMarker, OWNER_VALUE, { mode: 0o600, flag: 'wx' });
	return workspace;
}

export async function cleanupHarnessWorkspace(workspace) {
	const root = resolve(String(workspace?.root ?? ''));
	const marker = resolve(String(workspace?.ownerMarker ?? ''));
	const temporaryRoot = `${resolve(tmpdir())}${sep}`;
	const validPath =
		root.startsWith(temporaryRoot) &&
		root.split(sep).at(-1)?.startsWith(WORKSPACE_PREFIX) &&
		marker === join(root, OWNER_MARKER);
	if (!validPath) throw new Error('browser_extension_harness_cleanup_refused');
	let owner = '';
	try {
		owner = await readFile(marker, 'utf8');
	} catch {
		throw new Error('browser_extension_harness_cleanup_refused');
	}
	if (owner !== OWNER_VALUE) throw new Error('browser_extension_harness_cleanup_refused');
	await rm(root, { recursive: true, force: false });
}

export function redactHarnessOutput(value) {
	return String(value)
		.replace(/(authorization\s*:\s*bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
		.replace(
			/(["']?(?:access_token|refresh_token|verifier|device_code)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
			'$1[REDACTED]'
		)
		.replace(/(bearer\s+)[a-z0-9._~+\/-]+/gi, '$1[REDACTED]');
}

function appendBounded(current, chunk) {
	const next = `${current}${chunk}`;
	return next.length <= MAX_CAPTURE_BYTES ? next : next.slice(-MAX_CAPTURE_BYTES);
}

async function runPlaywright({ origin, workspace }) {
	const inputs = fixedHarnessInputs();
	const cli = join(repoRoot, 'node_modules/@playwright/test/cli.js');
	const environment = {
		PATH: process.env.PATH ?? '',
		...(process.env.HOME ? { HOME: process.env.HOME } : {}),
		...(process.env.LANG ? { LANG: process.env.LANG } : {}),
		TMPDIR: workspace.root,
		TIDE_E2E_SERVER_ORIGIN: origin,
		TIDE_E2E_EXTENSION_PATH: join(workspace.extensionOutputDir, 'dist'),
		TIDE_E2E_PROFILE_DIR: workspace.profileDir,
		TIDE_E2E_DOWNLOAD_DIR: workspace.downloadDir,
		TIDE_E2E_RUN_ID: randomBytes(12).toString('hex')
	};
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), HARNESS_TIMEOUT_MS);
	let stdout = '';
	let stderr = '';
	try {
		const child = spawn(process.execPath, [cli, 'test', '--config', inputs.playwrightConfig], {
			cwd: repoRoot,
			env: environment,
			stdio: ['ignore', 'pipe', 'pipe'],
			signal: controller.signal
		});
		child.stdout.on('data', (chunk) => (stdout = appendBounded(stdout, chunk)));
		child.stderr.on('data', (chunk) => (stderr = appendBounded(stderr, chunk)));
		const result = await new Promise((resolve, reject) => {
			child.once('error', reject);
			child.once('close', (code, signal) => resolve({ code, signal }));
		});
		if (result.code !== 0) {
			const detail = redactHarnessOutput(`${stdout}\n${stderr}`).trim();
			throw new Error(
				`browser_extension_e2e_failed:${result.signal ?? result.code}${detail ? `\n${detail}` : ''}`
			);
		}
	} finally {
		clearTimeout(timer);
	}
}

export async function runBrowserExtensionPlaywright(options = {}) {
	assertSafeRunnerOptions(options);
	const workspace = await createHarnessWorkspace();
	let fakeServer;
	try {
		fakeServer = await startFakeTideBot();
		const parsedOrigin = new URL(fakeServer.origin);
		if (
			parsedOrigin.protocol !== 'http:' ||
			parsedOrigin.hostname !== '127.0.0.1' ||
			!/^\d+$/.test(parsedOrigin.port)
		) {
			throw new Error('browser_extension_harness_origin_rejected');
		}
		await buildBrowserExtension({
			mode: 'test',
			outputRoot: workspace.extensionOutputDir,
			publishBackendArtifact: false,
			testServerOrigin: parsedOrigin.origin
		});
		await runPlaywright({ origin: parsedOrigin.origin, workspace });
	} finally {
		await fakeServer?.stop().catch(() => undefined);
		await cleanupHarnessWorkspace(workspace);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	runBrowserExtensionPlaywright()
		.then(() => process.stdout.write('Tide-Bot browser extension E2E passed.\n'))
		.catch((error) => {
			process.stderr.write(`${redactHarnessOutput(error?.message ?? error)}\n`);
			process.exitCode = 1;
		});
}
