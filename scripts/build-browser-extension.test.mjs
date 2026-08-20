import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildBrowserExtension } from './build-browser-extension.mjs';

const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

test('packages a production MV3 extension with the fixed Tide-Bot origin', async () => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'tide-bot-browser-extension-build-'));

	try {
		const result = await buildBrowserExtension({
			mode: 'production',
			outputRoot,
			publishBackendArtifact: false
		});
		const manifest = JSON.parse(await readFile(join(result.distDir, 'manifest.json'), 'utf8'));

		assert.equal(manifest.manifest_version, 3);
		assert.equal(manifest.minimum_chrome_version, '120');
		assert.deepEqual([...manifest.permissions].sort(), [
			'activeTab',
			'alarms',
			'debugger',
			'downloads',
			'notifications',
			'sidePanel',
			'storage',
			'tabs'
		]);
		assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
		assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
		assert.equal(result.serverOrigin, 'https://tide-bot.com');
		for (const size of [16, 32, 48, 128]) {
			assert.deepEqual(pngSize(await readFile(join(result.distDir, `icons/icon-${size}.png`))), {
				width: size,
				height: size
			});
		}

		const rebuilt = await buildBrowserExtension({
			mode: 'production',
			outputRoot,
			publishBackendArtifact: false
		});
		assert.equal(rebuilt.sha256, result.sha256);
	} finally {
		await rm(outputRoot, { recursive: true, force: true });
	}
});

test('keeps the published archive behind the authenticated API', async () => {
	const main = await readFile(join(process.cwd(), 'backend/open_webui/main.py'), 'utf8');
	const router = await readFile(
		join(process.cwd(), 'backend/open_webui/routers/browser_extension.py'),
		'utf8'
	);
	const denial = main.indexOf("@app.api_route('/static/browser-extension'");
	const staticMount = main.indexOf("app.mount('/static', StaticFiles(directory=STATIC_DIR)");

	assert.notEqual(denial, -1);
	assert.ok(
		denial < staticMount,
		'the archive denial route must run before the public static mount'
	);
	assert.match(router, /@router\.get\(['"]\/download['"]\)/);
});

test('documents installation, permissions, retention, recovery, and store release boundaries', async () => {
	const files = {
		user: await readFile(join(process.cwd(), 'docs/browser-extension/README.md'), 'utf8'),
		security: await readFile(join(process.cwd(), 'docs/browser-extension/security.md'), 'utf8'),
		store: await readFile(
			join(process.cwd(), 'docs/browser-extension/chrome-web-store.md'),
			'utf8'
		),
		privacy: await readFile(join(process.cwd(), 'browser-extension/store/privacy.md'), 'utf8')
	};
	const manifest = JSON.parse(
		await readFile(join(process.cwd(), 'browser-extension/manifest.json'), 'utf8')
	);
	const combined = Object.values(files).join('\n');
	const requiredStatements = [
		'Download extension',
		'chrome://extensions',
		'Load unpacked',
		'local models run on your Tide-Bot server',
		'Autonomous',
		'Consequential approval',
		'Manual approval',
		'one controlled tab at a time',
		'Chrome must be open',
		'Revoke',
		'Incident recovery',
		'custom origins are admin-only',
		'No automatic Chrome Web Store submission occurs'
	];
	for (const statement of requiredStatements) assert.ok(combined.includes(statement), statement);

	for (const permission of [
		...manifest.permissions.map((value) => `\`${value}\``),
		...manifest.host_permissions.map((value) => `\`${value}\``)
	]) {
		assert.ok(
			files.security.includes(permission),
			`missing permission explanation for ${permission}`
		);
	}
	assert.ok(
		files.security
			.split('\n')
			.some(
				(line) =>
					line.replace(/\s+/g, ' ').trim() ===
					'| Data class | Persists where | Retention / deletion |'
			),
		'data retention table is required'
	);
	assert.ok(files.store.includes('- [ ]'), 'Chrome Web Store checklist is required');
	for (const recovery of [
		'lost device',
		'replay detection',
		'origin mismatch',
		'offline model',
		'worker suspension',
		'revoked browser access'
	]) {
		assert.ok(files.security.toLowerCase().includes(recovery), `missing recovery: ${recovery}`);
	}
});
