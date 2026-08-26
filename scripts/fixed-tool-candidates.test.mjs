import assert from 'node:assert/strict';
import test from 'node:test';

let discovery;
try {
	discovery = await import('./fixed-tool-candidates.mjs');
} catch {
	// The RED state has no shared cross-platform discovery module yet.
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
		'/usr/lib/docker/cli-plugins/docker-compose'
	];
	assert.deepEqual(discovery.composePluginCandidates('darwin'), expected);
	assert.deepEqual(discovery.composePluginCandidates('linux'), expected);
	assert.equal(
		expected.some((candidate) => candidate === 'docker-compose'),
		false
	);
});

test('Windows Python discovery accepts the standard launcher without weakening POSIX candidates', () => {
	assert.ok(discovery, 'cross-platform fixed-tool discovery module is missing');
	assert.deepEqual(discovery.pythonCandidates('win32', {}), ['python']);
	assert.deepEqual(
		discovery.pythonCandidates('win32', { PYTHON_BIN: 'C:\\approved\\python.exe' }),
		['C:\\approved\\python.exe', 'python']
	);
	assert.deepEqual(discovery.pythonCandidates('linux', {}), [
		'/tmp/yaml-venv/bin/python',
		'/usr/local/bin/python3.12',
		'/usr/bin/python3',
		'python3'
	]);
});

test('Compose config uses the platform null device', () => {
	assert.ok(discovery, 'cross-platform fixed-tool discovery module is missing');
	assert.equal(discovery.nullDevice('win32'), 'NUL');
	assert.equal(discovery.nullDevice('linux'), '/dev/null');
});

test('Windows Docker CLI invocation uses the fixed Docker Desktop executable', () => {
	assert.equal(typeof discovery.dockerCliExecutable, 'function');
	assert.equal(
		discovery.dockerCliExecutable('win32'),
		'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'
	);
	assert.equal(discovery.dockerCliExecutable('linux'), 'docker');
});

test('Windows Compose invocation executes the validated plugin directly', () => {
	assert.equal(typeof discovery.composeInvocation, 'function');
	const plugin = 'C:\\Program Files\\Docker\\Docker\\resources\\cli-plugins\\docker-compose.exe';
	assert.deepEqual(discovery.composeInvocation('win32', plugin, ['config']), {
		file: plugin,
		args: ['config']
	});
	assert.deepEqual(discovery.composeInvocation('linux', plugin, ['config']), {
		file: 'docker',
		args: ['compose', 'config']
	});
});
