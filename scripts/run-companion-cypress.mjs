import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
	composeInvocation,
	composePluginCandidates,
	findDockerCliExecutable
} from './fixed-tool-candidates.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const composeFilePath = join(
	repoRoot,
	'deploy',
	'tide-stack',
	'docker-compose.cypress-companion.yml'
);
const fakeOpenAIContextPath = join(repoRoot, 'deploy', 'tide-stack', 'cypress-fake-openai');
const gatewayContextPath = join(repoRoot, 'deploy', 'tide-stack', 'cypress-loopback-gateway');
const cypressSpecPath = join(repoRoot, 'cypress', 'e2e', 'ted-bot-companion.cy.ts');
const cypressCliPath = join(repoRoot, 'node_modules', 'cypress', 'bin', 'cypress');
// Cypress resolves --config-file against the project root, and its config loader
// resolves `typescript` from that same directory, so the config has to be the
// tracked repository one rather than a file in the private run directory.
const cypressConfigFileName = 'cypress.config.ts';
const cypressTimeoutMs = 15 * 60 * 1000;
const forbiddenEnvironment = [
	'CYPRESS_BASE_URL',
	'BASE_URL',
	'APP_HOST_PORT',
	'FIXTURE_STATUS_PORT',
	'WEBUI_SECRET_KEY',
	'OPENAI_API_KEY',
	'OPENAI_API_KEYS',
	'OPENAI_API_BASE_URL',
	'OPENAI_API_BASE_URLS',
	'DATABASE_URL',
	'DEFAULT_MODELS',
	'ENABLE_SIGNUP'
];

function validateInputs(env, argv) {
	if (argv.length !== 2) {
		throw new Error(
			'This wrapper accepts no arguments, alternate Compose files, or project options'
		);
	}
	const composeSource = Object.keys(env).find((name) => name.startsWith('COMPOSE_'));
	if (composeSource) {
		throw new Error(`${composeSource} is forbidden: caller COMPOSE_* source selection is rejected`);
	}
	const forbidden = forbiddenEnvironment.find((name) =>
		Object.prototype.hasOwnProperty.call(env, name)
	);
	if (forbidden) {
		throw new Error(`${forbidden} is caller-controlled configuration and is forbidden`);
	}
	const runId = env.RUN_ID ?? '';
	if (runId.length > 40 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(runId)) {
		throw new Error(
			'RUN_ID is required and must contain only lowercase letters, digits, and hyphens, beginning and ending alphanumeric'
		);
	}
	return runId;
}

async function reservePort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		server.close();
		throw new Error('failed to reserve a loopback port');
	}
	const port = address.port;
	await new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
	return port;
}

async function defaultReservePorts() {
	const appPort = await reservePort();
	let fixturePort = await reservePort();
	while (fixturePort === appPort) {
		fixturePort = await reservePort();
	}
	return { appPort, fixturePort };
}

function npmCliPath(platform, nodeExecutable) {
	return platform === 'win32'
		? join(dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js')
		: resolve(dirname(nodeExecutable), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

function fixedChildPath(platform, nodeExecutable) {
	const nodeDirectory = dirname(nodeExecutable);
	return platform === 'win32'
		? `${nodeDirectory};C:\\Windows\\System32;C:\\Windows`
		: `${nodeDirectory}:/usr/bin:/bin`;
}

async function findComposePlugin(platform, accessFile) {
	for (const candidate of composePluginCandidates(platform)) {
		try {
			await accessFile(candidate);
			return candidate;
		} catch {
			// Continue through fixed system plugin locations only.
		}
	}
	throw new Error('Docker Compose plugin was not found in a fixed system location');
}

const failureDiagnosticLimit = 2000;

function isSensitiveFieldName(fieldName) {
	const segments = fieldName
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.toLowerCase()
		.split(/[-_]+/)
		.filter(Boolean);
	if (segments.some((segment) => ['password', 'token', 'secret'].includes(segment))) {
		return true;
	}
	return segments.some(
		(segment, index) => segment === 'api' && /^keys?$/.test(segments[index + 1] ?? '')
	);
}

function hasSensitiveFieldDelimiter(line) {
	const fieldPattern = /(["']?)([A-Za-z0-9_-]+)\1\s*[:=]/g;
	return [...line.matchAll(fieldPattern)].some((match) => isSensitiveFieldName(match[2]));
}

function redactFailureDiagnostic(value, { webuiSecret, privateEnvFile }) {
	let redacted = String(value ?? '');
	for (const exactValue of [webuiSecret, privateEnvFile]) {
		if (exactValue) redacted = redacted.replaceAll(exactValue, '[REDACTED]');
	}
	return redacted
		.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
		.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
		.split(/\r?\n/)
		.filter(
			(line) =>
				!/\bAuthorization\s*:/i.test(line) &&
				!hasSensitiveFieldDelimiter(line) &&
				!/^\s*request body\s*:/i.test(line)
		)
		.join('\n')
		.trim();
}

export function sanitizedFailure(operation, result, sensitiveValues = {}) {
	const code = result?.status ?? 'unknown';
	const message = `${operation} failed with exit ${code}`;
	const diagnostic = redactFailureDiagnostic(
		`${result?.stderr ?? ''}\n${result?.stdout ?? ''}`,
		sensitiveValues
	);
	if (!diagnostic) return new Error(message);
	const boundedDiagnostic =
		diagnostic.length > failureDiagnosticLimit
			? `…${diagnostic.slice(-(failureDiagnosticLimit - 1))}`
			: diagnostic;
	return new Error(`${message}: ${boundedDiagnostic}`);
}

async function waitForFixture(fetchImpl, fixtureOrigin) {
	let lastError;
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			const response = await fetchImpl(`${fixtureOrigin}/health`, {
				redirect: 'error',
				signal: AbortSignal.timeout(2000)
			});
			if (response.ok) {
				return;
			}
			lastError = new Error(`fixture health returned ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`fixture health did not become ready: ${lastError?.message ?? 'unknown error'}`);
}

export async function runCompanionCypress({
	env = process.env,
	argv = process.argv,
	spawn = spawnSync,
	platform = process.platform,
	nodeExecutable = process.execPath,
	homeDirectory = homedir(),
	accessFile = access,
	linkFile = symlink,
	tempRoot = tmpdir(),
	reservePorts = defaultReservePorts,
	randomSecret = () => randomBytes(32).toString('base64url'),
	fetchImpl = fetch,
	output = console.log,
	errorOutput = console.error
} = {}) {
	const runId = validateInputs(env, argv);
	const projectName = `tedbot-companion-cypress-${runId}`;
	const runTmpDir = await mkdtemp(join(tempRoot, `${projectName}-`));
	const privateEnvFile = join(runTmpDir, 'companion-cypress.env');
	const cleanupErrors = [];
	let primaryError;
	let preExistingTideBot;
	let ownsProject = false;
	let baseUrl;
	let fixtureOrigin;

	try {
		if (platform !== 'win32') await chmod(runTmpDir, 0o700);
		const dockerConfigDir = join(runTmpDir, 'docker-config');
		const cliPluginsDir = join(dockerConfigDir, 'cli-plugins');
		await mkdir(cliPluginsDir, { recursive: true, mode: 0o700 });
		const composePlugin = await findComposePlugin(platform, accessFile);
		const dockerCli = await findDockerCliExecutable(platform, accessFile);
		if (platform !== 'win32') {
			await linkFile(composePlugin, join(cliPluginsDir, 'docker-compose'));
		}

		const { appPort, fixturePort } = await reservePorts();
		if (
			!Number.isInteger(appPort) ||
			!Number.isInteger(fixturePort) ||
			appPort < 1024 ||
			appPort > 65535 ||
			fixturePort < 1024 ||
			fixturePort > 65535 ||
			appPort === fixturePort
		) {
			throw new Error('generated test ports must be distinct unprivileged TCP ports');
		}
		baseUrl = `http://127.0.0.1:${appPort}`;
		fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
		const webuiSecret = randomSecret();
		const fakeOpenAIImage = `${projectName}-fake-openai:test`;
		const gatewayImage = `${projectName}-loopback-gateway:test`;
		await writeFile(
			privateEnvFile,
			[
				`RUN_ID=${runId}`,
				`APP_HOST_PORT=${appPort}`,
				`FIXTURE_STATUS_PORT=${fixturePort}`,
				`WEBUI_SECRET_KEY=${webuiSecret}`,
				`FAKE_OPENAI_IMAGE=${fakeOpenAIImage}`,
				`GATEWAY_IMAGE=${gatewayImage}`,
				''
			].join('\n'),
			{ mode: 0o600 }
		);
		if (platform !== 'win32') await chmod(privateEnvFile, 0o600);

		const cleanEnvironment = {
			PATH: fixedChildPath(platform, nodeExecutable),
			TMPDIR: runTmpDir,
			...(platform === 'win32'
				? {
						ComSpec: 'C:\\Windows\\System32\\cmd.exe',
						SystemRoot: 'C:\\Windows',
						TEMP: runTmpDir,
						TMP: runTmpDir
					}
				: {}),
			DOCKER_CONFIG: dockerConfigDir,
			// The fixture images build from local sources and an already-pulled base.
			// BuildKit still resolves its frontend over the network first, which has
			// stalled this harness indefinitely; the legacy builder keeps the fixture
			// build hermetic and offline. Wrapper-owned, never caller-supplied.
			DOCKER_BUILDKIT: '0'
		};
		const spawnClean = (command, args, extraEnvironment = {}, extraOptions = {}) =>
			spawn(command, args, {
				cwd: runTmpDir,
				encoding: 'utf8',
				env: { ...cleanEnvironment, ...extraEnvironment },
				maxBuffer: 16 * 1024 * 1024,
				shell: false,
				windowsHide: true,
				...extraOptions
			});
		const docker = (args) => spawnClean(dockerCli, args);
		const compose = (args) => {
			const invocation = composeInvocation(platform, composePlugin, dockerCli, [
				'--file',
				composeFilePath,
				'--env-file',
				privateEnvFile,
				'--project-name',
				projectName,
				...args
			]);
			return spawnClean(invocation.file, invocation.args);
		};
		const requireSuccess = (result, operation) => {
			if (result.error) {
				throw new Error(`${operation} did not complete (${result.error.code ?? 'spawn error'})`);
			}
			if (result.status !== 0) {
				throw sanitizedFailure(operation, result, { webuiSecret, privateEnvFile });
			}
			return result.stdout ?? '';
		};
		const projectResources = () => {
			const resourceQueries = [
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
				],
				[
					'image',
					[
						'image',
						'ls',
						'--filter',
						`label=com.docker.compose.project=${projectName}`,
						'--format',
						'{{.ID}}'
					]
				]
			];
			return resourceQueries.flatMap(([kind, args]) =>
				requireSuccess(docker(args), `inspect ${kind} resources`)
					.trim()
					.split('\n')
					.filter(Boolean)
					.map((id) => `${kind}:${id}`)
			);
		};
		const existingTideBotResources = () => {
			const containers = requireSuccess(
				docker(['ps', '-a', '--format', '{{.ID}}|{{.Names}}']),
				'inspect pre-existing Tide-Bot containers'
			)
				.trim()
				.split('\n')
				.filter((line) => /tide-bot/i.test(line))
				.map((line) => line.split('|')[0])
				.flatMap((id) => {
					const state = requireSuccess(
						docker([
							'inspect',
							'--format',
							'container:{{.Id}}|{{.Name}}|{{.State.StartedAt}}|{{.RestartCount}}',
							id
						]),
						'inspect pre-existing Tide-Bot container state'
					).trim();
					return state ? [state] : [];
				});
			const networks = requireSuccess(
				docker(['network', 'ls', '--format', 'network:{{.ID}}|{{.Name}}']),
				'inspect pre-existing Tide-Bot networks'
			)
				.trim()
				.split('\n')
				.filter((line) => /tide-bot/i.test(line));
			const volumes = requireSuccess(
				docker(['volume', 'ls', '--format', 'volume:{{.Name}}']),
				'inspect pre-existing Tide-Bot volumes'
			)
				.trim()
				.split('\n')
				.filter((line) => /tide-bot/i.test(line));
			return [...containers, ...networks, ...volumes].filter(Boolean).sort();
		};

		try {
			preExistingTideBot = existingTideBotResources();
			if (projectResources().length > 0) {
				throw new Error(`refusing pre-existing resources for project ${projectName}`);
			}
			ownsProject = true;
			output(`PROJECT ${projectName}`);
			output(`APP_ORIGIN ${baseUrl}`);
			output(`FIXTURE_ORIGIN ${fixtureOrigin}`);
			requireSuccess(
				spawnClean(
					nodeExecutable,
					[npmCliPath(platform, nodeExecutable), '--prefix', repoRoot, 'run', 'build'],
					{
						HOME: runTmpDir,
						CI: '1',
						NO_COLOR: '1',
						NODE_OPTIONS: '--max-old-space-size=8192'
					}
				),
				'build current-worktree companion frontend'
			);
			// Compose resolves registry credentials for every service before it
			// builds, which fails outright on a locked keychain. Building each
			// fixture image directly keeps the build offline, and the project label
			// lets teardown prove it removed exactly what this run created.
			for (const [image, context] of [
				[fakeOpenAIImage, fakeOpenAIContextPath],
				[gatewayImage, gatewayContextPath]
			]) {
				requireSuccess(
					docker([
						'build',
						'--label',
						`com.docker.compose.project=${projectName}`,
						'--tag',
						image,
						context
					]),
					'build isolated companion fixture image'
				);
			}
			requireSuccess(
				compose([
					'up',
					'-d',
					'--no-build',
					'--wait',
					'--wait-timeout',
					'600',
					'fake-openai',
					'tide-bot',
					'loopback-gateway'
				]),
				'start isolated companion Cypress stack'
			);
			requireSuccess(compose(['ps', '--status', 'running']), 'inspect companion Cypress stack');
			await waitForFixture(fetchImpl, fixtureOrigin);

			const cypress = spawnClean(
				nodeExecutable,
				[
					cypressCliPath,
					'run',
					'--project',
					repoRoot,
					'--config-file',
					cypressConfigFileName,
					'--spec',
					cypressSpecPath,
					'--config',
					`baseUrl=${baseUrl},video=false,screenshotOnRunFailure=false`,
					'--env',
					`fixtureOrigin=${fixtureOrigin}`
				],
				{
					HOME: runTmpDir,
					CYPRESS_CACHE_FOLDER:
						platform === 'win32'
							? join(homeDirectory, 'AppData', 'Local', 'Cypress', 'Cache')
							: platform === 'darwin'
								? join(homeDirectory, 'Library', 'Caches', 'Cypress')
								: join(homeDirectory, '.cache', 'Cypress'),
					CI: '1',
					NO_COLOR: '1'
				},
				// A wedged browser must never outlive the run and strand the isolated
				// project; the unconditional teardown below has to be reachable.
				{ timeout: cypressTimeoutMs }
			);
			requireSuccess(cypress, 'Cypress companion smoke');
			output('ASSERT authenticated-companion-cypress PASS');
		} catch (error) {
			primaryError = error;
			errorOutput(`ASSERT authenticated-companion-cypress FAIL: ${error.message}`);
			try {
				compose(['logs', '--no-color', '--tail', '120']);
			} catch {
				// Raw service logs are intentionally not emitted.
			}
		} finally {
			if (ownsProject) {
				try {
					const down = compose(['down', '--volumes', '--remove-orphans']);
					if (down.error || down.status !== 0) {
						throw new Error(`isolated teardown failed with exit ${down.status ?? 'unknown'}`);
					}
				} catch (error) {
					cleanupErrors.push(error);
				}
				try {
					// `down` only removes images Compose itself built, so the
					// wrapper-built fixture tags have to be dropped explicitly.
					const removal = docker(['image', 'rm', '--force', fakeOpenAIImage, gatewayImage]);
					if (removal.error) {
						throw new Error('isolated fixture image removal did not complete');
					}
				} catch (error) {
					cleanupErrors.push(error);
				}
				try {
					const remaining = projectResources();
					if (remaining.length > 0) {
						throw new Error('namespaced Compose resources remained after teardown');
					}
					output('ASSERT namespaced-resource-teardown PASS');
				} catch (error) {
					cleanupErrors.push(error);
				}
			}
			if (preExistingTideBot) {
				try {
					const after = existingTideBotResources();
					if (JSON.stringify(after) !== JSON.stringify(preExistingTideBot)) {
						throw new Error('a pre-existing Tide-Bot resource changed during the isolated run');
					}
					output('ASSERT pre-existing-tide-bot-untouched PASS');
				} catch (error) {
					cleanupErrors.push(error);
				}
			}
		}
	} catch (error) {
		if (!primaryError) {
			primaryError = error;
		} else {
			cleanupErrors.push(error);
		}
	} finally {
		try {
			await rm(runTmpDir, { recursive: true, force: true });
		} catch (error) {
			cleanupErrors.push(error);
		}
	}

	if (primaryError) {
		throw primaryError;
	}
	if (cleanupErrors.length > 0) {
		throw new AggregateError(cleanupErrors, 'isolated companion Cypress cleanup failed');
	}
	return { projectName, baseUrl, fixtureOrigin, privateEnvFile };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await runCompanionCypress();
}
