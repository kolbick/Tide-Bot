import { spawnSync } from 'node:child_process';

const expectedNode = '22.18';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function redact(value) {
	return String(value)
		.replace(/\b(?:sk|ghp|github_pat|xox)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
		.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]')
		.replace(/\bBearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
		.replace(/\b(refresh_token|access_token|api[_-]?key|secret|password)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

function run(name, command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		env: { ...process.env, ...options.env },
		shell: process.platform === 'win32',
		windowsHide: true
	});

	if (result.error || result.status !== 0) {
		const detail = redact(result.error?.message ?? `exit ${result.status ?? 'unknown'}`);
		console.error(`FAIL ${name}: ${detail}`);
		process.exitCode = 1;
		return false;
	}

	console.log(`PASS ${name}`);
	return true;
}

if (!process.versions.node.startsWith(`${expectedNode}.`)) {
	console.error(`FAIL node-version: expected ${expectedNode}.x, received ${redact(process.versions.node)}`);
	process.exit(1);
}

const commands = [
	[
		'frontend companion and voice contracts',
		npmCommand,
		[
			'exec',
			'vitest',
			'--',
			'run',
			'src/lib/ted-bot',
			'src/lib/components/ted-bot',
			'src/lib/components/chat/MessageInput'
		]
	],
	[
		'backend ChatGPT subscription and Responses streaming',
		'python',
		[
			'-m',
			'pytest',
			'-q',
			'backend/tests/test_verify_chatgpt_subscription_cli.py',
			'backend/tests/test_chatgpt_subscription.py',
			'backend/tests/test_responses_streaming.py'
		],
		{ env: { PYTHONPATH: 'backend', WEBUI_SECRET_KEY: 'update-gate-test-secret' } }
	],
	['branding audit', npmCommand, ['run', 'audit:branding']],
	['production frontend build', npmCommand, ['run', 'build']],
	[
		'isolated disposable companion smoke',
		npmCommand,
		['run', 'test:companion:e2e'],
		{ env: { RUN_ID: `update-gate-${process.pid}` } }
	],
	['whitespace diff check', 'git', ['diff', '--check']]
];

for (const [name, command, args, options] of commands) {
	if (!run(name, command, args, options)) {
		process.exit(1);
	}
}

const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true });
if (commit.status !== 0 || !/^[0-9a-f]{40}\s*$/i.test(commit.stdout)) {
	console.error(`FAIL git-commit: ${redact(commit.error?.message ?? `exit ${commit.status ?? 'unknown'}`)}`);
	process.exit(1);
}

console.log(`PASS update-gate commit ${commit.stdout.trim()}`);
