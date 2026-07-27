import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { access, chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const wrapper = new URL('./run-companion-presence-redis-integration.mjs', import.meta.url);
const composeFile = fileURLToPath(
	new URL('../deploy/tide-stack/docker-compose.presence-integration.yml', import.meta.url)
);
const composePluginCandidates = [
	'/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose',
	'/usr/local/lib/docker/cli-plugins/docker-compose',
	'/usr/lib/docker/cli-plugins/docker-compose'
];

async function findComposePlugin() {
	for (const candidate of composePluginCandidates) {
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
			'/dev/null',
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

async function runWithFakeDocker(runId, fakeDockerSource) {
	const fixture = await mkdtemp(join(tmpdir(), 'presence-wrapper-test-'));
	const fakeDocker = join(fixture, 'docker');
	await writeFile(fakeDocker, fakeDockerSource, { mode: 0o700 });
	await chmod(fakeDocker, 0o700);
	const prefix = `tedbot-presence-it-${runId}-`;
	const before = (await readdir(tmpdir())).filter((name) => name.startsWith(prefix));
	const env = { ...process.env, RUN_ID: runId, PATH: `${fixture}:/usr/bin:/bin:/usr/local/bin` };
	for (const name of Object.keys(env)) {
		if (name.startsWith('COMPOSE_')) {
			delete env[name];
		}
	}

	const result = spawnSync(process.execPath, [fileURLToPath(wrapper)], {
		encoding: 'utf8',
		env
	});
	const after = (await readdir(tmpdir())).filter((name) => name.startsWith(prefix));
	const leaked = after.filter((name) => !before.includes(name));
	await Promise.all(
		leaked.map((name) => rm(join(tmpdir(), name), { recursive: true, force: true }))
	);
	await rm(fixture, { recursive: true, force: true });
	return { result, leaked };
}

test('inventory failure still deletes the private environment directory', async () => {
	const { result, leaked } = await runWithFakeDocker('cleanup-inventory', '#!/bin/sh\nexit 42\n');

	assert.notEqual(result.status, 0);
	assert.match(`${result.stdout}\n${result.stderr}`, /inspect pre-existing Tide-Bot containers/);
	assert.deepEqual(leaked, []);
});

test('teardown failures preserve the primary error and still delete private files', async () => {
	const fakeDocker = `#!/bin/sh
case " $* " in
  *" compose "*" up "*) exit 41 ;;
  *" compose "*" logs "*) exit 0 ;;
  *" compose "*" down "*) exit 42 ;;
  *" ps -a --filter "*) exit 43 ;;
  *) exit 0 ;;
esac
`;
	const { result, leaked } = await runWithFakeDocker('cleanup-primary', fakeDocker);
	const output = `${result.stdout}\n${result.stderr}`;

	assert.notEqual(result.status, 0);
	assert.match(output, /start isolated presence stack failed/);
	assert.doesNotMatch(output, /inspect container resources failed with exit 43/);
	assert.deepEqual(leaked, []);
});
