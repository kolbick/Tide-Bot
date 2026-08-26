import { randomBytes } from 'node:crypto';
import { access, chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
	'docker-compose.presence-integration.yml'
);

function fixedChildEnvironment(platform, runTmpDir, dockerConfigDir) {
	return {
		PATH: platform === 'win32' ? 'C:\\Windows\\System32;C:\\Windows' : '/usr/bin:/bin',
		DOCKER_CONFIG: dockerConfigDir,
		...(platform === 'win32'
			? {
					ComSpec: 'C:\\Windows\\System32\\cmd.exe',
					SystemRoot: 'C:\\Windows',
					TEMP: runTmpDir,
					TMP: runTmpDir
				}
			: { TMPDIR: runTmpDir })
	};
}

export async function runCompanionPresenceRedisIntegration({
	env = process.env,
	argv = process.argv,
	platform = process.platform,
	spawn = spawnSync,
	accessFile = access,
	linkFile = symlink,
	tempRoot = tmpdir(),
	randomSecret = () => randomBytes(32).toString('base64url'),
	output = console.log,
	errorOutput = console.error
} = {}) {
	const rejectedComposeEnvironment = Object.keys(env).filter((name) => name.startsWith('COMPOSE_'));
	if (rejectedComposeEnvironment.length > 0) {
		throw new Error('Refusing caller COMPOSE_* source-selection environment');
	}
	if (argv.length !== 2) {
		throw new Error('This wrapper accepts no arguments or Compose source overrides');
	}

	const runId = env.RUN_ID ?? '';
	if (runId.length > 40 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(runId)) {
		throw new Error(
			'RUN_ID is required and must contain only lowercase letters, digits, and hyphens, beginning and ending alphanumeric'
		);
	}

	const projectName = `tedbot-presence-it-${runId}`;
	const runTmpDir = await mkdtemp(join(tempRoot, `${projectName}-`));
	let integrationError;
	const cleanupErrors = [];
	try {
		if (platform !== 'win32') await chmod(runTmpDir, 0o700);
		const dockerConfigDir = join(runTmpDir, 'docker-config');
		await mkdir(dockerConfigDir, { mode: 0o700 });
		let composePlugin;
		for (const candidate of composePluginCandidates(platform)) {
			try {
				await accessFile(candidate);
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
		const dockerCli = await findDockerCliExecutable(platform, accessFile);
		const cliPluginsDir = join(dockerConfigDir, 'cli-plugins');
		if (platform !== 'win32') {
			await mkdir(cliPluginsDir, { mode: 0o700 });
			await linkFile(composePlugin, join(cliPluginsDir, 'docker-compose'));
		}
		const runEnvFile = join(runTmpDir, 'integration.env');
		const webuiSecret = randomSecret();
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
		if (platform !== 'win32') await chmod(runEnvFile, 0o600);

		const cleanEnvironment = fixedChildEnvironment(platform, runTmpDir, dockerConfigDir);
		const spawnOptions = {
			cwd: runTmpDir,
			encoding: 'utf8',
			env: cleanEnvironment,
			maxBuffer: 16 * 1024 * 1024,
			shell: false,
			windowsHide: true
		};

		function isolatedDocker(args) {
			return spawn(dockerCli, args, spawnOptions);
		}

		function compose(args) {
			const composeArgs = [
				'--file',
				composeFilePath,
				'--env-file',
				runEnvFile,
				'--project-name',
				projectName,
				...args
			];
			const invocation = composeInvocation(platform, composePlugin, dockerCli, composeArgs);
			const result = spawn(invocation.file, invocation.args, spawnOptions);
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

		let preExistingTideBot;
		try {
			preExistingTideBot = existingTideBotResources();
			output(`PROJECT ${projectName}`);
			output('WORKERS presence-worker-a:8080 presence-worker-b:8080');
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
				output(evidence);
			}
			requireSuccess(test, 'run isolated real-Redis presence integration');
		} catch (error) {
			integrationError = error;
			try {
				const logs = compose(['logs', '--no-color', '--tail', '120']);
				const evidence = safeEvidence(`${logs.stdout}\n${logs.stderr}`);
				if (evidence) {
					errorOutput(evidence);
				}
			} catch (logsError) {
				cleanupErrors.push(logsError);
			}
		} finally {
			try {
				const down = compose(['down', '--volumes', '--remove-orphans']);
				if (down.status !== 0) {
					throw new Error(`isolated teardown failed with exit ${down.status}`);
				}
			} catch (downError) {
				cleanupErrors.push(downError);
			}

			let remaining;
			try {
				remaining = projectResources();
				if (remaining.length > 0) {
					throw new Error('namespaced Compose resources remained after teardown');
				}
				output('ASSERT namespaced-resource-teardown PASS');
			} catch (inspectionError) {
				cleanupErrors.push(inspectionError);
			}

			if (preExistingTideBot) {
				try {
					const postExistingTideBot = existingTideBotResources();
					if (JSON.stringify(preExistingTideBot) !== JSON.stringify(postExistingTideBot)) {
						throw new Error(
							'a pre-existing Tide-Bot container, network, or volume changed during the isolated run'
						);
					}
					output('ASSERT pre-existing-tide-bot-untouched PASS');
				} catch (inventoryError) {
					cleanupErrors.push(inventoryError);
				}
			}
		}
	} catch (error) {
		if (!integrationError) {
			integrationError = error;
		} else {
			cleanupErrors.push(error);
		}
	} finally {
		try {
			await rm(runTmpDir, { recursive: true, force: true });
		} catch (removeError) {
			cleanupErrors.push(removeError);
		}
	}

	if (integrationError) {
		throw integrationError;
	}
	if (cleanupErrors.length > 0) {
		throw new AggregateError(cleanupErrors, 'isolated presence cleanup failed');
	}
	return { projectName };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await runCompanionPresenceRedisIntegration();
}
