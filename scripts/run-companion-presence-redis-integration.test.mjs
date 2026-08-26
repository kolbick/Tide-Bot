import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
	composePluginCandidates,
	dockerCliCandidates,
	nullDevice
} from './fixed-tool-candidates.mjs';

const wrapper = new URL('./run-companion-presence-redis-integration.mjs', import.meta.url);
const composeFile = fileURLToPath(
	new URL('../deploy/tide-stack/docker-compose.presence-integration.yml', import.meta.url)
);
let runCompanionPresenceRedisIntegration;
try {
	({ runCompanionPresenceRedisIntegration } = await import(wrapper));
} catch {
	// The RED state executes immediately and has no injectable runner export.
}
async function findComposePlugin() {
	for (const candidate of composePluginCandidates()) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Continue to the next fixed system plugin location.
		}
	}
	throw new Error('Docker Compose plugin was not found in a fixed system location');
}

test('workers render with retrieval disabled and no network-backed embedding initialization', async () => {
	const composePlugin = await findComposePlugin();
	const env = {
		...process.env,
		WEBUI_SECRET_KEY: randomBytes(32).toString('base64url'),
		REDIS_KEY_PREFIX: 'presence-config-test:'
	};
	for (const name of Object.keys(env)) {
		if (name.startsWith('COMPOSE_')) {
			delete env[name];
		}
	}
	const result = spawnSync(
		composePlugin,
		[
			'--file',
			composeFile,
			'--env-file',
			nullDevice(),
			'--project-name',
			'tedbot-presence-config-test',
			'config',
			'--format',
			'json'
		],
		{ encoding: 'utf8', env }
	);

	assert.equal(result.status, 0, result.stderr);
	const config = JSON.parse(result.stdout);
	assert.equal(config.networks['presence-integration'].internal, true);
	for (const worker of ['presence-worker-a', 'presence-worker-b']) {
		const workerEnvironment = config.services[worker].environment;
		assert.equal(workerEnvironment.OFFLINE_MODE, 'true');
		assert.equal(workerEnvironment.RAG_EMBEDDING_MODEL, '');
		assert.equal(workerEnvironment.BYPASS_EMBEDDING_AND_RETRIEVAL, 'true');
	}
});

function ok(stdout = '') {
	return { status: 0, signal: null, stdout, stderr: '' };
}

async function runWithFakeDocker({ runId, platform = 'linux', spawn }) {
	assert.equal(typeof runCompanionPresenceRedisIntegration, 'function');
	const fixture = await mkdtemp(join(tmpdir(), 'presence-wrapper-test-'));
	const prefix = `tedbot-presence-it-${runId}-`;
	const before = (await readdir(fixture)).filter((name) => name.startsWith(prefix));
	const composePlugin = composePluginCandidates(platform)[0];
	const dockerCli = dockerCliCandidates(platform)[0];
	const links = [];
	let error;
	try {
		await runCompanionPresenceRedisIntegration({
			env: {
				RUN_ID: runId,
				PATH: platform === 'win32' ? 'C:\\hostile-tools' : '/hostile/bin',
				SystemRoot: 'C:\\hostile-windows'
			},
			argv: ['node', 'run-companion-presence-redis-integration.mjs'],
			platform,
			spawn,
			accessFile: async (candidate) => {
				if (candidate !== composePlugin && candidate !== dockerCli) {
					throw new Error('not installed');
				}
			},
			linkFile: async (source, destination) => links.push({ source, destination }),
			tempRoot: fixture,
			randomSecret: () => 'unit-generated-secret',
			output: () => {},
			errorOutput: () => {}
		});
	} catch (caught) {
		error = caught;
	}
	const after = (await readdir(fixture)).filter((name) => name.startsWith(prefix));
	const leaked = after.filter((name) => !before.includes(name));
	await rm(fixture, { recursive: true, force: true });
	return { error, leaked, links, composePlugin, dockerCli };
}

test('inventory failure is intercepted without host Docker and deletes private files', async () => {
	const calls = [];
	const { error, leaked, dockerCli } = await runWithFakeDocker({
		runId: 'cleanup-inventory',
		spawn: (command, args, options) => {
			calls.push({ command, args: [...args], options });
			return { ...ok(), status: 42 };
		}
	});

	assert.match(error.message, /inspect pre-existing Tide-Bot containers/);
	assert.ok(calls.length > 0);
	assert.ok(calls.every((call) => call.command === dockerCli));
	assert.deepEqual(leaked, []);
});

test('teardown failures preserve the primary error and command order without host Docker', async () => {
	const calls = [];
	const { error, leaked } = await runWithFakeDocker({
		runId: 'cleanup-primary',
		spawn: (command, args, options) => {
			calls.push({ command, args: [...args], options });
			if (args.includes('up')) return { ...ok(), status: 41 };
			if (args.includes('down')) return { ...ok(), status: 42 };
			if (args.includes('--filter')) return { ...ok(), status: 43 };
			return ok();
		}
	});

	assert.match(error.message, /start isolated presence stack failed/);
	assert.doesNotMatch(error.message, /inspect container resources failed with exit 43/);
	const upIndex = calls.findIndex((call) => call.args.includes('up'));
	const logsIndex = calls.findIndex((call) => call.args.includes('logs'));
	const downIndex = calls.findIndex((call) => call.args.includes('down'));
	assert.ok(upIndex >= 0 && upIndex < logsIndex && logsIndex < downIndex);
	assert.deepEqual(leaked, []);
});

test('fixed child environments reject hostile PATH and SystemRoot on every platform', async () => {
	for (const platform of ['linux', 'win32']) {
		const calls = [];
		const { error, links, composePlugin, dockerCli } = await runWithFakeDocker({
			runId: `fixed-env-${platform}`,
			platform,
			spawn: (command, args, options) => {
				calls.push({ command, args: [...args], options });
				return ok();
			}
		});

		assert.equal(error, undefined);
		assert.equal(
			calls.some((call) => call.options.env.PATH.includes('hostile')),
			false
		);
		assert.equal(
			calls.some((call) => call.options.env.SystemRoot === 'C:\\hostile-windows'),
			false
		);
		assert.equal(
			calls.some((call) => call.command === '/usr/bin/env'),
			false
		);
		assert.ok(calls.every((call) => call.options.shell === false));
		assert.ok(
			calls.every((call) =>
				platform === 'win32'
					? call.options.env.PATH === 'C:\\Windows\\System32;C:\\Windows' &&
						call.options.env.SystemRoot === 'C:\\Windows'
					: call.options.env.PATH === '/usr/bin:/bin' &&
						!Object.hasOwn(call.options.env, 'SystemRoot')
			)
		);
		assert.ok(calls.every((call) => [dockerCli, composePlugin].includes(call.command)));
		assert.equal(links.length, platform === 'win32' ? 0 : 1);
	}
});
