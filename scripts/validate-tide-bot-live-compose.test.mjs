import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composePath = resolve(repositoryRoot, 'deploy/tide-stack/docker-compose.live.yml');
const envExamplePath = resolve(repositoryRoot, 'deploy/tide-stack/.env.live.example');
const initializerPath = resolve(repositoryRoot, 'scripts/initialize-tide-bot-production-environment.ps1');

const approvedContainerNames = new Set(['tidebot-open-webui', 'tide-terminal', 'tide-cptr-gateway']);

async function readCompose() {
	return YAML.parse(await readFile(composePath, 'utf8'));
}

function composeConfig(environment) {
	const configEnvironment = { ...process.env, WEBUI_SECRET_KEY: 'fixture-only-compose-validation' };
	for (const name of [
		'TIDE_BOT_COMMIT',
		'TIDE_BOT_IMAGE_REF',
		'TIDEBOT_OPEN_WEBUI_PORT',
		'COMPOSE_FILE',
		'COMPOSE_PROJECT_NAME',
		'COMPOSE_PROFILES',
		'COMPOSE_ENV_FILES',
		'COMPOSE_DISABLE_ENV_FILE',
		'OAUTH_CLIENT_INFO_ENCRYPTION_KEY'
	]) {
		delete configEnvironment[name];
	}

	Object.assign(configEnvironment, environment);
	return spawnSync(
		'docker',
		[
			'compose',
			'-f',
			'deploy/tide-stack/docker-compose.live.yml',
			'--env-file',
			'deploy/tide-stack/.env.live.example',
			'config',
			'--format',
			'json'
		],
		{ cwd: repositoryRoot, encoding: 'utf8', env: configEnvironment }
	);
}

test('live compose preserves the legacy resource contract without a host environment file', async () => {
	const compose = await readCompose();
	const service = compose.services['tidebot-open-webui'];

	assert.equal(compose.name, 'tidebot-webui');
	assert.equal(service.container_name, 'tidebot-open-webui');
	assert.equal(service.ports[0], '127.0.0.1:${TIDEBOT_OPEN_WEBUI_PORT:-3102}:8080');
	assert.equal(service.image, 'tidebot-open-webui:${TIDE_BOT_COMMIT:?TIDE_BOT_COMMIT is required}');
	assert.equal(service.build.args.BUILD_HASH, '${TIDE_BOT_COMMIT:?TIDE_BOT_COMMIT is required}');
	assert.equal(compose.volumes.tidebot_data.external, true);
	assert.equal(compose.volumes.tidebot_data.name, 'tidebot-webui_tidebot-open-webui');
	assert.equal(compose.volumes.tidebot_computer.external, true);
	assert.equal(compose.volumes.tidebot_computer.name, 'tidebot-webui_tidebot-computer');
	assert.equal(compose.networks.tidebot_net.external, true);
	assert.equal(compose.networks.tidebot_net.name, 'tidebot-net');
	assert.doesNotMatch(await readFile(envExamplePath, 'utf8'), /(?:sk-|Bearer |refresh_token|WEBUI_SECRET_KEY=.{20,})/i);

	for (const configuredService of Object.values(compose.services)) {
		assert.equal(configuredService.env_file, undefined);
		if (configuredService.container_name) {
			assert.ok(approvedContainerNames.has(configuredService.container_name));
		}
		for (const port of configuredService.ports ?? []) {
			assert.match(port, /^127\.0\.0\.1:/);
		}
	}

	for (const volume of Object.values(compose.volumes)) {
		assert.notEqual(volume.external, false);
		assert.equal(volume.external, true);
	}
});

test('live Compose requires a commit and ignores an arbitrary image override', () => {
	const missingCommit = composeConfig({});
	assert.notEqual(missingCommit.status, 0);
	assert.match(`${missingCommit.stdout}${missingCommit.stderr}`, /TIDE_BOT_COMMIT is required/);

	const standardBuild = composeConfig({ TIDE_BOT_COMMIT: 'fixture-commit' });
	assert.equal(standardBuild.status, 0, standardBuild.stderr);
	const standardService = JSON.parse(standardBuild.stdout).services['tidebot-open-webui'];
	assert.equal(standardService.image, 'tidebot-open-webui:fixture-commit');
	assert.equal(standardService.build.args.BUILD_HASH, 'fixture-commit');

	const arbitraryImageOverride = composeConfig({
		TIDE_BOT_COMMIT: 'fixture-commit',
		TIDE_BOT_IMAGE_REF: 'unrecognized-image:arbitrary-tag'
	});
	assert.equal(arbitraryImageOverride.status, 0, arbitraryImageOverride.stderr);
	assert.equal(JSON.parse(arbitraryImageOverride.stdout).services['tidebot-open-webui'].image, 'tidebot-open-webui:fixture-commit');
});

test('live Compose omits the OAuth encryption key unless an explicit key is configured', () => {
	const omitted = composeConfig({ TIDE_BOT_COMMIT: 'fixture-commit' });
	assert.equal(omitted.status, 0, omitted.stderr);
	assert.equal(
		JSON.parse(omitted.stdout).services['tidebot-open-webui'].environment.OAUTH_CLIENT_INFO_ENCRYPTION_KEY,
		null,
		'Compose null pass-through must remain unset, never an empty string'
	);

	const explicit = composeConfig({
		TIDE_BOT_COMMIT: 'fixture-commit',
		OAUTH_CLIENT_INFO_ENCRYPTION_KEY: 'fixture-explicit-oauth-key'
	});
	assert.equal(explicit.status, 0, explicit.stderr);
	assert.equal(
		JSON.parse(explicit.stdout).services['tidebot-open-webui'].environment.OAUTH_CLIENT_INFO_ENCRYPTION_KEY,
		'fixture-explicit-oauth-key'
	);
});

test('environment migration utility is tracked beside the secret-free example', async () => {
	const [initializer, envExample] = await Promise.all([
		readFile(initializerPath, 'utf8'),
		readFile(envExamplePath, 'utf8')
	]);

	assert.match(initializer, /SourceEnvFile/);
	assert.match(initializer, /SupportsShouldProcess/);
	assert.match(envExample, /^WEBUI_SECRET_KEY=$/m);
	assert.doesNotMatch(envExample, /^OAUTH_CLIENT_INFO_ENCRYPTION_KEY=$/m);
	assert.match(envExample, /^TIDE_BOT_COMMIT=$/m);
	assert.doesNotMatch(envExample, /^TIDE_BOT_IMAGE_REF=/m);
});
