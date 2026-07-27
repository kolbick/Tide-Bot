import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

import { createFakeOpenAIServer } from '../deploy/tide-stack/cypress-fake-openai/server.mjs';
import { runCompanionCypress } from './run-companion-cypress.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const composeFile = join(repoRoot, 'deploy', 'tide-stack', 'docker-compose.cypress-companion.yml');

function ok(stdout = '') {
	return { status: 0, signal: null, stdout, stderr: '' };
}

function fakeSpawnRecorder({ cypressResult = ok('Cypress run complete') } = {}) {
	const calls = [];
	const spawn = (command, args, options) => {
		calls.push({ command, args: [...args], options: { ...options } });
		const joined = args.join(' ');

		if (joined.includes(' ps -a --format ')) {
			return ok('existing-id|tide-bot-user-stack\n');
		}
		if (joined.includes(' inspect --format ')) {
			return ok('container:existing-id|/tide-bot-user-stack|2026-01-01T00:00:00Z|0\n');
		}
		if (joined.includes(' network ls ') || joined.includes(' volume ls ')) {
			return ok('');
		}
		if (joined.includes('compose') && joined.includes('logs')) {
			return ok('');
		}
		if (args.some((arg) => arg.endsWith('/node_modules/.bin/cypress'))) {
			return cypressResult;
		}
		return ok('');
	};
	return { calls, spawn };
}

function composeInvocation(call) {
	const index = call.args.indexOf('compose');
	return index === -1 ? null : call.args.slice(index + 1);
}

test('rejects caller-controlled Compose sources, origins, ports, and application credentials', async () => {
	const rejected = [
		['COMPOSE_FILE', '/tmp/live.yml'],
		['COMPOSE_PROJECT_NAME', 'live'],
		['COMPOSE_ENV_FILES', '/tmp/live.env'],
		['CYPRESS_BASE_URL', 'https://tide-bot.example.com'],
		['BASE_URL', 'http://127.0.0.1:3102'],
		['APP_HOST_PORT', '3102'],
		['FIXTURE_STATUS_PORT', '3103'],
		['WEBUI_SECRET_KEY', 'caller-secret'],
		['OPENAI_API_KEYS', 'real-key'],
		['DATABASE_URL', 'postgres://live']
	];

	for (const [name, value] of rejected) {
		await assert.rejects(
			runCompanionCypress({
				env: { RUN_ID: 'reject-input', [name]: value },
				argv: ['node', 'run-companion-cypress.mjs'],
				spawn: () => {
					throw new Error('spawn must not run for rejected input');
				}
			}),
			new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		);
	}
});

test('uses exact isolated Compose invocations, generated loopback origins, and private cleanup', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'companion-cypress-runner-test-'));
	const { calls, spawn } = fakeSpawnRecorder();
	const output = [];

	try {
		const result = await runCompanionCypress({
			env: { RUN_ID: 'unit-isolation', PATH: '/usr/bin:/bin' },
			argv: ['node', 'run-companion-cypress.mjs'],
			spawn,
			tempRoot: fixtureRoot,
			reservePorts: async () => ({ appPort: 49120, fixturePort: 49121 }),
			randomSecret: () => 'unit-generated-secret',
			fetchImpl: async () => ({ ok: true }),
			output: (line) => output.push(line)
		});

		assert.equal(result.projectName, 'tedbot-companion-cypress-unit-isolation');
		assert.equal(result.baseUrl, 'http://127.0.0.1:49120');
		assert.equal(result.fixtureOrigin, 'http://127.0.0.1:49121');
		assert.match(output.join('\n'), /PROJECT tedbot-companion-cypress-unit-isolation/);
		assert.doesNotMatch(output.join('\n'), /unit-generated-secret|PRIVATE_ENV/);

		const composeCalls = calls.filter((call) => composeInvocation(call));
		assert.ok(composeCalls.length >= 3);
		for (const call of composeCalls) {
			const args = composeInvocation(call);
			assert.deepEqual(args.slice(0, 6), [
				'--file',
				composeFile,
				'--env-file',
				result.privateEnvFile,
				'--project-name',
				result.projectName
			]);
			assert.notEqual(call.options.cwd, repoRoot);
			assert.deepEqual(
				Object.keys(call.options.env).sort(),
				['DOCKER_BUILDKIT', 'DOCKER_CONFIG', 'PATH', 'TMPDIR'].sort()
			);
			assert.equal(call.options.env.DOCKER_BUILDKIT, '0');
		}

		const up = composeCalls.find((call) => composeInvocation(call).includes('up'));
		assert.ok(up);
		assert.ok(composeInvocation(up).includes('--wait'));
		assert.ok(composeInvocation(up).includes('fake-openai'));
		assert.ok(composeInvocation(up).includes('tide-bot'));
		assert.ok(composeInvocation(up).includes('loopback-gateway'));
		// Compose must never reach the registry credential path on the way up.
		assert.ok(composeInvocation(up).includes('--no-build'));
		assert.ok(!composeInvocation(up).includes('--build'));

		const fixtureBuilds = calls.filter(
			(call) => call.args[call.args.indexOf('docker') + 1] === 'build'
		);
		assert.equal(fixtureBuilds.length, 2, 'each fixture image is built directly and offline');
		for (const [index, context] of [
			join(repoRoot, 'deploy', 'tide-stack', 'cypress-fake-openai'),
			join(repoRoot, 'deploy', 'tide-stack', 'cypress-loopback-gateway')
		].entries()) {
			const build = fixtureBuilds[index];
			assert.equal(build.args.at(-1), context);
			assert.ok(build.args.includes('--label'));
			assert.ok(
				build.args.includes(`com.docker.compose.project=${result.projectName}`),
				'fixture images must carry the project label so teardown can verify removal'
			);
			assert.ok(calls.indexOf(build) < calls.indexOf(up));
		}
		assert.ok(
			calls.some(
				(call) =>
					call.args.includes('image') &&
					call.args.includes('rm') &&
					call.args.includes(`${result.projectName}-fake-openai:test`) &&
					call.args.includes(`${result.projectName}-loopback-gateway:test`)
			),
			'the wrapper-built fixture images must be removed during teardown'
		);
		const build = calls.find(
			(call) =>
				call.args.includes('npm') &&
				call.args.includes('--prefix') &&
				call.args.includes(repoRoot) &&
				call.args.includes('build')
		);
		assert.ok(build, 'the current worktree frontend must be built before Compose starts');
		assert.ok(calls.indexOf(build) < calls.indexOf(up));
		assert.notEqual(build.options.cwd, repoRoot);

		const cypress = calls.find((call) =>
			call.args.some((arg) => arg.endsWith('/node_modules/.bin/cypress'))
		);
		assert.ok(cypress);
		assert.deepEqual(cypress.args.slice(-11), [
			'run',
			'--project',
			repoRoot,
			'--config-file',
			'cypress.config.ts',
			'--spec',
			join(repoRoot, 'cypress', 'e2e', 'ted-bot-companion.cy.ts'),
			'--config',
			'baseUrl=http://127.0.0.1:49120,video=false,screenshotOnRunFailure=false',
			'--env',
			'fixtureOrigin=http://127.0.0.1:49121'
		]);
		assert.notEqual(cypress.options.cwd, repoRoot);
		assert.equal(cypress.options.env.CYPRESS_baseUrl, undefined);
		assert.equal(cypress.options.env.WEBUI_SECRET_KEY, undefined);
		assert.ok(
			Number.isInteger(cypress.options.timeout) && cypress.options.timeout > 0,
			'a wedged Cypress run must not strand the isolated project'
		);

		const down = composeCalls.find((call) => composeInvocation(call).includes('down'));
		assert.ok(down);
		assert.deepEqual(composeInvocation(down).slice(-3), ['down', '--volumes', '--remove-orphans']);

		await assert.rejects(stat(result.privateEnvFile), /ENOENT/);
		assert.deepEqual(await readdir(fixtureRoot), []);
	} finally {
		await rm(fixtureRoot, { recursive: true, force: true });
	}
});

test('redacts failed Cypress output and still tears down only the isolated project', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'companion-cypress-redaction-test-'));
	const { calls, spawn } = fakeSpawnRecorder({
		cypressResult: {
			status: 7,
			signal: null,
			stdout: 'Authorization: Bearer browser-token\nunit-generated-secret\nrequest body: private',
			stderr: 'OPENAI_API_KEYS=real-key'
		}
	});
	const errors = [];

	try {
		await assert.rejects(
			runCompanionCypress({
				env: { RUN_ID: 'failure-cleanup', PATH: '/usr/bin:/bin' },
				argv: ['node', 'run-companion-cypress.mjs'],
				spawn,
				tempRoot: fixtureRoot,
				reservePorts: async () => ({ appPort: 49220, fixturePort: 49221 }),
				randomSecret: () => 'unit-generated-secret',
				fetchImpl: async () => ({ ok: true }),
				output: () => {},
				errorOutput: (line) => errors.push(line)
			}),
			/Cypress companion smoke failed with exit 7/
		);

		const diagnostic = errors.join('\n');
		assert.doesNotMatch(
			diagnostic,
			/browser-token|unit-generated-secret|private|real-key|Authorization|OPENAI_API_KEYS/
		);
		assert.ok(
			calls.some((call) => {
				const args = composeInvocation(call);
				return (
					args?.includes('down') &&
					args.includes('--project-name') &&
					args.includes('tedbot-companion-cypress-failure-cleanup')
				);
			})
		);
		assert.deepEqual(await readdir(fixtureRoot), []);
	} finally {
		await rm(fixtureRoot, { recursive: true, force: true });
	}
});

test('the tracked Cypress config declares no origin of its own', async () => {
	const config = await readFile(join(repoRoot, 'cypress.config.ts'), 'utf8');
	assert.doesNotMatch(config, /baseUrl\s*:/);
	assert.match(config, /specPattern:\s*'cypress\/e2e\/\*\*\/\*\.cy\.ts'/);
	assert.match(config, /supportFile:\s*false/);
	assert.match(config, /video:\s*false/);
	assert.match(config, /screenshotOnRunFailure:\s*false/);
});

test('Compose config isolates the fake model and clears external integrations', async () => {
	const config = YAML.parse(await readFile(composeFile, 'utf8'));
	assert.deepEqual(Object.keys(config.services).sort(), [
		'fake-openai',
		'loopback-gateway',
		'tide-bot'
	]);
	assert.equal(config.networks['companion-cypress'].internal, true);
	assert.deepEqual(config.services['fake-openai'].build, {
		context: './cypress-fake-openai',
		dockerfile: 'Dockerfile'
	});
	assert.equal(
		config.services['fake-openai'].image,
		'${FAKE_OPENAI_IMAGE:?generated fixture image tag required}'
	);
	assert.equal(
		config.services['loopback-gateway'].image,
		'${GATEWAY_IMAGE:?generated fixture image tag required}'
	);
	assert.equal(config.services['tide-bot'].image, 'tide-bot:local');
	assert.equal(config.services['tide-bot'].build, undefined);
	assert.equal(config.services['tide-bot'].depends_on['fake-openai'].condition, 'service_healthy');

	// The application under test and the fake model must never sit on a network
	// that can leave the host, and only the credential-free forwarder may bridge
	// the two, on generated loopback ports.
	for (const name of ['fake-openai', 'tide-bot']) {
		assert.deepEqual(config.services[name].networks, ['companion-cypress']);
		assert.equal(config.services[name].ports, undefined);
	}
	const gateway = config.services['loopback-gateway'];
	assert.deepEqual(gateway.build, {
		context: './cypress-loopback-gateway',
		dockerfile: 'Dockerfile'
	});
	assert.deepEqual(gateway.networks, ['companion-cypress', 'companion-cypress-ingress']);
	assert.deepEqual(gateway.ports, [
		'127.0.0.1:${APP_HOST_PORT:?generated app port required}:8080',
		'127.0.0.1:${FIXTURE_STATUS_PORT:?generated fixture port required}:8081'
	]);
	assert.equal(gateway.depends_on['tide-bot'].condition, 'service_healthy');
	assert.equal(gateway.depends_on['fake-openai'].condition, 'service_healthy');
	assert.equal(gateway.environment, undefined, 'the forwarder takes no configuration');
	assert.equal(gateway.volumes, undefined, 'the forwarder mounts no host path');

	const gatewaySource = await readFile(
		join(repoRoot, 'deploy', 'tide-stack', 'cypress-loopback-gateway', 'server.mjs'),
		'utf8'
	);
	assert.doesNotMatch(gatewaySource, /process\.env/, 'the forwarder must not be env-configurable');
	assert.match(gatewaySource, /host: 'tide-bot', port: 8080/);
	assert.match(gatewaySource, /host: 'fake-openai', port: 8081/);
	assert.deepEqual(config.services['tide-bot'].volumes, [
		'../../build:/app/build:ro',
		'../../backend/open_webui:/app/backend/open_webui:ro',
		'companion-cypress-data:/app/backend/data'
	]);

	const environment = config.services['tide-bot'].environment;
	assert.equal(environment.OPENAI_API_BASE_URLS, 'http://fake-openai:8081/v1');
	assert.equal(environment.OPENAI_API_KEYS, 'tedbot-cypress-inert-key');
	assert.equal(environment.DEFAULT_MODELS, 'tedbot-cypress-model');
	assert.equal(environment.ENABLE_SIGNUP, 'true');
	assert.equal(environment.DEFAULT_USER_ROLE, 'user');
	assert.equal(environment.ENABLE_WEB_SEARCH, 'true');
	assert.equal(environment.ENABLE_WEB_SEARCH_CONFIRMATION, 'true');
	for (const name of [
		'OLLAMA_BASE_URL',
		'WEB_SEARCH_ENGINE',
		'GOOGLE_PSE_API_KEY',
		'BRAVE_SEARCH_API_KEY',
		'BING_SEARCH_V7_ENDPOINT',
		'BING_SEARCH_V7_SUBSCRIPTION_KEY',
		'GOOGLE_CLIENT_ID',
		'GOOGLE_CLIENT_SECRET',
		'MICROSOFT_CLIENT_ID',
		'MICROSOFT_CLIENT_SECRET',
		'ENABLE_OAUTH_SIGNUP',
		'ENABLE_LDAP',
		'ENABLE_TERMINAL',
		'CPTR_API_BASE_URL',
		'CPTR_API_KEY'
	]) {
		assert.equal(environment[name], '', `${name} must be explicitly empty`);
	}
});

test('fake OpenAI serves one model, deterministic completions, and abort-only slow streams', async () => {
	const fixture = createFakeOpenAIServer();
	await fixture.listen(0, '127.0.0.1');
	const address = fixture.address();
	assert.ok(address && typeof address === 'object');
	const origin = `http://127.0.0.1:${address.port}`;

	try {
		const models = await fetch(`${origin}/v1/models`).then((response) => response.json());
		assert.deepEqual(
			models.data.map((model) => model.id),
			['tedbot-cypress-model']
		);

		const completion = await fetch(`${origin}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model: 'tedbot-cypress-model', messages: [], stream: false })
		}).then((response) => response.json());
		assert.equal(completion.choices[0].message.content, 'Ted-Bot Cypress completion.');

		const ordinaryStream = await fetch(`${origin}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model: 'tedbot-cypress-model', messages: [], stream: true })
		}).then((response) => response.text());
		assert.match(ordinaryStream, /Ted-Bot Cypress stream/);
		assert.match(ordinaryStream, /data: \[DONE\]/);

		const controller = new AbortController();
		const slowResponse = await fetch(`${origin}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				model: 'tedbot-cypress-model',
				messages: [{ role: 'user', content: 'TEDBOT_CYPRESS_SLOW_STREAM' }],
				stream: true
			}),
			signal: controller.signal
		});
		const reader = slowResponse.body.getReader();
		const first = new TextDecoder().decode((await reader.read()).value);
		assert.match(first, /Ted-Bot Cypress first delta/);
		controller.abort();
		await assert.rejects(reader.read(), /AbortError/);

		await new Promise((resolve) => setTimeout(resolve, 30));
		const statusResponse = await fetch(`${origin}/__fixture/status`);
		const statusBody = await statusResponse.json();
		assert.deepEqual(Object.keys(statusBody).sort(), [
			'aborted',
			'completedCount',
			'requestCount',
			'streamStarted'
		]);
		assert.deepEqual(statusBody, {
			requestCount: 3,
			streamStarted: true,
			aborted: true,
			completedCount: 2
		});
		assert.equal(statusResponse.headers.get('access-control-allow-origin'), null);
	} finally {
		await fixture.close();
	}
});
