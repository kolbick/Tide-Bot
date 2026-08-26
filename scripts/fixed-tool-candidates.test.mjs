import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

let discovery;
try {
	discovery = await import('./fixed-tool-candidates.mjs');
} catch {
	// The RED state has no shared cross-platform discovery module yet.
}

function assertNoExternalCommandCandidate(source) {
	const forbiddenPatterns = [
		/\b(?:node:)?child_process\b/,
		/\b(?:spawn(?:Sync)?|exec(?:File)?(?:Sync)?)\b/,
		/\bpython(?:3(?:\.\d+)*)?(?:\.exe)?\b/i,
		/process\s*\.\s*env\s*\.\s*PATH\b/
	];
	for (const pattern of forbiddenPatterns) {
		assert.doesNotMatch(source, pattern);
	}
}

test('Windows accepts only the fixed Docker Desktop Compose plugin path', () => {
	assert.ok(discovery, 'cross-platform fixed-tool discovery module is missing');
	assert.deepEqual(discovery.composePluginCandidates('win32'), [
		'C:\\Program Files\\Docker\\Docker\\resources\\cli-plugins\\docker-compose.exe'
	]);
	assert.equal(
		discovery.composePluginCandidates('win32').some((candidate) => !candidate.includes('\\')),
		false
	);
});

test('non-Windows Compose discovery remains restricted to approved fixed locations', () => {
	assert.ok(discovery, 'cross-platform fixed-tool discovery module is missing');
	const expected = [
		'/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose',
		'/usr/local/lib/docker/cli-plugins/docker-compose',
		'/usr/lib/docker/cli-plugins/docker-compose',
		'/usr/libexec/docker/cli-plugins/docker-compose'
	];
	assert.deepEqual(discovery.composePluginCandidates('darwin'), expected);
	assert.deepEqual(discovery.composePluginCandidates('linux'), expected);
	assert.equal(
		expected.some((candidate) => candidate === 'docker-compose'),
		false
	);
});

test('workflow validator parses YAML in-process without an external command candidate', async () => {
	const source = await readFile(
		new URL('./validate-ted-bot-windows-workflow.test.mjs', import.meta.url),
		'utf8'
	);

	assert.match(source, /import \{ parse \} from 'yaml';/);
	assert.match(source, /const wf = parse\(await readFile\(workflowPath, 'utf8'\)\);/);
	assertNoExternalCommandCandidate(source);
});

test('workflow security detector rejects equivalent external command mechanisms', () => {
	const mutations = [
		['node-prefixed child_process', "import { spawn } from 'node:child_process';"],
		['child_process without node prefix', "import { spawn } from 'child_process';"],
		['spawn', "spawn('tool');"],
		['spawnSync', "spawnSync('tool');"],
		['exec', "exec('tool');"],
		['execSync', "execSync('tool');"],
		['execFile', "execFile('tool', []);"],
		['execFileSync', "execFileSync('tool', []);"],
		['bare Python launcher', "const launcher = 'python';"],
		['Python executable launcher', "const launcher = 'python.exe';"],
		['Python 3 launcher', "const launcher = 'python3';"],
		['caller PATH lookup', 'const searchPath = process.env.PATH;']
	];
	const accepted = mutations
		.filter(([, source]) => {
			try {
				assertNoExternalCommandCandidate(source);
				return true;
			} catch {
				return false;
			}
		})
		.map(([name]) => name);

	assert.deepEqual(accepted, [], `detector accepted forbidden mutations: ${accepted.join(', ')}`);
});

test('Compose config uses the platform null device', () => {
	assert.ok(discovery, 'cross-platform fixed-tool discovery module is missing');
	assert.equal(discovery.nullDevice('win32'), 'NUL');
	assert.equal(discovery.nullDevice('linux'), '/dev/null');
});

test('Docker CLI discovery uses only approved fixed platform locations', () => {
	assert.equal(typeof discovery.dockerCliCandidates, 'function');
	assert.deepEqual(discovery.dockerCliCandidates('win32'), [
		'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'
	]);
	assert.deepEqual(discovery.dockerCliCandidates('darwin'), [
		'/Applications/Docker.app/Contents/Resources/bin/docker',
		'/usr/local/bin/docker'
	]);
	assert.deepEqual(discovery.dockerCliCandidates('linux'), [
		'/usr/local/bin/docker',
		'/usr/bin/docker'
	]);
});

test('Docker CLI selection validates candidates and falls back without PATH lookup', async () => {
	assert.equal(typeof discovery.findDockerCliExecutable, 'function');
	const checked = [];
	const selected = await discovery.findDockerCliExecutable('linux', async (candidate) => {
		checked.push(candidate);
		if (candidate !== '/usr/bin/docker') throw new Error('not installed');
	});

	assert.equal(selected, '/usr/bin/docker');
	assert.deepEqual(checked, ['/usr/local/bin/docker', '/usr/bin/docker']);
	await assert.rejects(
		discovery.findDockerCliExecutable('darwin', async () => {
			throw new Error('not installed');
		}),
		/approved fixed location/
	);
});

test('Windows Compose invocation executes the validated plugin directly', () => {
	assert.equal(typeof discovery.composeInvocation, 'function');
	const plugin = 'C:\\Program Files\\Docker\\Docker\\resources\\cli-plugins\\docker-compose.exe';
	const dockerCli = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
	assert.deepEqual(discovery.composeInvocation('win32', plugin, dockerCli, ['config']), {
		file: plugin,
		args: ['config']
	});
	assert.deepEqual(
		discovery.composeInvocation('linux', plugin, '/usr/local/bin/docker', ['config']),
		{
			file: '/usr/local/bin/docker',
			args: ['compose', 'config']
		}
	);
});
