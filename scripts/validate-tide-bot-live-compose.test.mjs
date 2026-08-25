import assert from 'node:assert/strict';
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

test('live compose preserves the legacy resource contract without a host environment file', async () => {
	const compose = await readCompose();
	const service = compose.services['tidebot-open-webui'];

	assert.equal(compose.name, 'tidebot-webui');
	assert.equal(service.container_name, 'tidebot-open-webui');
	assert.equal(service.ports[0], '127.0.0.1:${TIDEBOT_OPEN_WEBUI_PORT:-3102}:8080');
	assert.equal(
		service.image,
		'${TIDE_BOT_IMAGE_REF:-tidebot-open-webui:${TIDE_BOT_COMMIT:-unconfigured}}'
	);
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

test('environment migration utility is tracked beside the secret-free example', async () => {
	const [initializer, envExample] = await Promise.all([
		readFile(initializerPath, 'utf8'),
		readFile(envExamplePath, 'utf8')
	]);

	assert.match(initializer, /SourceEnvFile/);
	assert.match(initializer, /SupportsShouldProcess/);
	assert.match(envExample, /^WEBUI_SECRET_KEY=$/m);
	assert.match(envExample, /^TIDE_BOT_COMMIT=$/m);
});
