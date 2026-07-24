import { randomBytes } from 'node:crypto';
import { access, chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rejectedComposeEnvironment = Object.keys(process.env).filter((name) =>
	name.startsWith('COMPOSE_')
);
if (rejectedComposeEnvironment.length > 0) {
	throw new Error('Refusing caller COMPOSE_* source-selection environment');
}
if (process.argv.length !== 2) {
	throw new Error('This wrapper accepts no arguments or Compose source overrides');
}

const runId = process.env.RUN_ID ?? '';
if (runId.length > 40 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(runId)) {
	throw new Error(
		'RUN_ID is required and must contain only lowercase letters, digits, and hyphens, beginning and ending alphanumeric'
	);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const composeFilePath = join(
	repoRoot,
	'deploy',
	'tide-stack',
	'docker-compose.presence-integration.yml'
);
const projectName = `tedbot-presence-it-${runId}`;
const runTmpDir = await mkdtemp(join(tmpdir(), `${projectName}-`));
await chmod(runTmpDir, 0o700);
const dockerConfigDir = join(runTmpDir, 'docker-config');
await mkdir(dockerConfigDir, { mode: 0o700 });
const composePluginCandidates = [
	'/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose',
	'/usr/local/lib/docker/cli-plugins/docker-compose',
	'/usr/lib/docker/cli-plugins/docker-compose'
];
let composePlugin;
for (const candidate of composePluginCandidates) {
	try {
		await access(candidate);
		composePlugin = candidate;
		break;
	} catch {
		// Continue to the next fixed system plugin location.
	}
}
if (!composePlugin) {
	await rm(runTmpDir, { recursive: true, force: true });
	throw new Error('Docker Compose plugin was not found in a fixed system location');
}
const cliPluginsDir = join(dockerConfigDir, 'cli-plugins');
await mkdir(cliPluginsDir, { mode: 0o700 });
await symlink(composePlugin, join(cliPluginsDir, 'docker-compose'));
const runEnvFile = join(runTmpDir, 'integration.env');
const webuiSecret = randomBytes(32).toString('base64url');
const redisKeyPrefix = `${projectName}:`;
await writeFile(
	runEnvFile,
	[
		`RUN_ID=${runId}`,
		`WEBUI_SECRET_KEY=${webuiSecret}`,
		`REDIS_KEY_PREFIX=${redisKeyPrefix}`,
		''
	].join('\n'),
	{ mode: 0o600 }
);
await chmod(runEnvFile, 0o600);

const cleanEnvironment = {
	PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
	TMPDIR: runTmpDir,
	DOCKER_CONFIG: dockerConfigDir
};

function isolatedDocker(args) {
	return spawnSync(
		'/usr/bin/env',
		[
			'-i',
			`PATH=${cleanEnvironment.PATH}`,
			`TMPDIR=${runTmpDir}`,
			`DOCKER_CONFIG=${dockerConfigDir}`,
			'docker',
			...args
		],
		{
			cwd: runTmpDir,
			encoding: 'utf8',
			env: cleanEnvironment,
			maxBuffer: 16 * 1024 * 1024
		}
	);
}

function compose(args) {
	const result = isolatedDocker([
		'compose',
		'--file',
		composeFilePath,
		'--env-file',
		runEnvFile,
		'--project-name',
		projectName,
		...args
	]);
	if (result.error) {
		throw result.error;
	}
	return result;
}

function requireSuccess(result, operation) {
	if (result.status !== 0) {
		const diagnostic = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
			.replaceAll(webuiSecret, '[REDACTED]')
			.replaceAll(runEnvFile, '[PRIVATE_ENV_FILE]')
			.split('\n')
			.filter((line) => !/WEBUI_SECRET_KEY=|password|token/i.test(line))
			.slice(-12)
			.join('\n')
			.trim();
		throw new Error(
			`${operation} failed with exit ${result.status}${diagnostic ? `: ${diagnostic}` : ''}`
		);
	}
	return result.stdout;
}

function projectResources() {
	const kinds = [
		[
			'container',
			[
				'ps',
				'-a',
				'--filter',
				`label=com.docker.compose.project=${projectName}`,
				'--format',
				'{{.ID}}'
			]
		],
		[
			'network',
			[
				'network',
				'ls',
				'--filter',
				`label=com.docker.compose.project=${projectName}`,
				'--format',
				'{{.ID}}'
			]
		],
		[
			'volume',
			[
				'volume',
				'ls',
				'--filter',
				`label=com.docker.compose.project=${projectName}`,
				'--format',
				'{{.Name}}'
			]
		]
	];
	return kinds.flatMap(([kind, args]) => {
		const output = requireSuccess(isolatedDocker(args), `inspect ${kind} resources`);
		return output
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((id) => `${kind}:${id}`);
	});
}

function existingTideBotResources() {
	const containers = requireSuccess(
		isolatedDocker(['ps', '-a', '--format', '{{.ID}}|{{.Names}}']),
		'inspect pre-existing Tide-Bot containers'
	)
		.trim()
		.split('\n')
		.filter((line) => /tide-bot/i.test(line))
		.map((line) => line.split('|')[0])
		.flatMap((id) => {
			const inspected = requireSuccess(
				isolatedDocker([
					'inspect',
					'--format',
					'container:{{.Id}}|{{.Name}}|{{.State.StartedAt}}|{{.RestartCount}}',
					id
				]),
				'inspect pre-existing Tide-Bot container state'
			);
			return inspected.trim() ? [inspected.trim()] : [];
		});
	const networks = requireSuccess(
		isolatedDocker(['network', 'ls', '--format', 'network:{{.ID}}|{{.Name}}']),
		'inspect pre-existing Tide-Bot networks'
	)
		.trim()
		.split('\n')
		.filter((line) => /tide-bot/i.test(line));
	const volumes = requireSuccess(
		isolatedDocker(['volume', 'ls', '--format', 'volume:{{.Name}}']),
		'inspect pre-existing Tide-Bot volumes'
	)
		.trim()
		.split('\n')
		.filter((line) => /tide-bot/i.test(line));
	return [...containers, ...networks, ...volumes].filter(Boolean).sort();
}

function safeEvidence(output) {
	return output
		.split('\n')
		.filter((line) => line.startsWith('ASSERT '))
		.join('\n');
}

let integrationError;
const preExistingTideBot = existingTideBotResources();
console.log(`PROJECT ${projectName}`);
console.log('WORKERS presence-worker-a:8080 presence-worker-b:8080');
try {
	requireSuccess(
		compose([
			'up',
			'-d',
			'--wait',
			'--wait-timeout',
			'300',
			'presence-redis',
			'presence-worker-a',
			'presence-worker-b'
		]),
		'start isolated presence stack'
	);
	requireSuccess(compose(['ps', '--status', 'running']), 'inspect isolated presence stack');
	const test = compose(['run', '--rm', 'presence-integration']);
	const evidence = safeEvidence(`${test.stdout}\n${test.stderr}`);
	if (evidence) {
		console.log(evidence);
	}
	requireSuccess(test, 'run isolated real-Redis presence integration');
} catch (error) {
	integrationError = error;
	const logs = compose(['logs', '--no-color', '--tail', '120']);
	const evidence = safeEvidence(`${logs.stdout}\n${logs.stderr}`);
	if (evidence) {
		console.error(evidence);
	}
} finally {
	const down = compose(['down', '--volumes', '--remove-orphans']);
	if (down.status !== 0 && !integrationError) {
		integrationError = new Error(`isolated teardown failed with exit ${down.status}`);
	}
	const remaining = projectResources();
	if (remaining.length > 0 && !integrationError) {
		integrationError = new Error('namespaced Compose resources remained after teardown');
	}
	const postExistingTideBot = existingTideBotResources();
	if (
		JSON.stringify(preExistingTideBot) !== JSON.stringify(postExistingTideBot) &&
		!integrationError
	) {
		integrationError = new Error(
			'a pre-existing Tide-Bot container changed during the isolated run'
		);
	}
	if (remaining.length === 0) {
		console.log('ASSERT namespaced-resource-teardown PASS');
	}
	if (JSON.stringify(preExistingTideBot) === JSON.stringify(postExistingTideBot)) {
		console.log('ASSERT pre-existing-tide-bot-untouched PASS');
	}
	await rm(runTmpDir, { recursive: true, force: true });
}

if (integrationError) {
	throw integrationError;
}
