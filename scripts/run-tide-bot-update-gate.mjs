import { spawnSync } from 'node:child_process';
import {
	buildUpdateGateCommands,
	formatSubprocessResult,
	redactDiagnostic
} from './tide-bot-update-policy.mjs';

const expectedNode = '22.18';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(name, command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		env: { ...process.env, ...options.env },
		shell: process.platform === 'win32',
		windowsHide: true
	});
	const messages = formatSubprocessResult(name, result);

	if (result.error || result.status !== 0) {
		for (const message of messages) console.error(message);
		process.exitCode = 1;
		return false;
	}

	console.log(messages[0]);
	return true;
}

if (!process.versions.node.startsWith(`${expectedNode}.`)) {
	console.error(`FAIL node-version: expected ${expectedNode}.x, received ${redactDiagnostic(process.versions.node)}`);
	process.exit(1);
}

for (const { name, command, args, options } of buildUpdateGateCommands(npmCommand)) {
	if (!run(name, command, args, options)) {
		process.exit(1);
	}
}

const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true });
if (commit.status !== 0 || !/^[0-9a-f]{40}\s*$/i.test(commit.stdout)) {
	console.error(
		`FAIL git-commit: ${redactDiagnostic(commit.error?.message ?? `exit ${commit.status ?? 'unknown'}`)}`
	);
	process.exit(1);
}

console.log(`PASS update-gate commit ${commit.stdout.trim()}`);
