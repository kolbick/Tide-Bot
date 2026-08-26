import { fileURLToPath } from 'node:url';

const expectedBaselinePrefix = 'd3e8bf3';

function isSha(value) {
	return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}

export function validateBaselineTag(baselineSha) {
	if (!isSha(baselineSha) || !baselineSha.startsWith(expectedBaselinePrefix)) {
		return { outcome: 'blocked', reason: 'baseline-hash-mismatch', createIssue: true };
	}

	return { outcome: 'ready' };
}

export function decideUpstreamRun({ upstreamIsAlreadyOnMain }) {
	return upstreamIsAlreadyOnMain
		? { outcome: 'no-op', createReview: false, triggerMarker: false }
		: { outcome: 'review', createReview: true, triggerMarker: false };
}

export function decideMarker({ candidateSha, mainTipSha }) {
	if (!isSha(candidateSha) || !isSha(mainTipSha)) {
		throw new Error('Marker candidate and main tip must be 40-character commit SHAs.');
	}

	return candidateSha === mainTipSha ? 'mark' : 'skip-stale';
}

export function simulateMarkerRun(state, { candidateSha, mainTipSha }) {
	const outcome = decideMarker({ candidateSha, mainTipSha });
	return {
		markerSha: outcome === 'mark' ? candidateSha : state.markerSha,
		outcome: outcome === 'mark' ? 'marked' : 'skipped-stale'
	};
}

export function buildUpdateGateCommands(npmCommand) {
	return [
		{
			name: 'frontend companion contracts',
			command: npmCommand,
			args: ['exec', 'vitest', '--', 'run', 'src/lib/ted-bot', 'src/lib/components/ted-bot', 'src/lib/components/chat/MessageInput']
		},
		{
			name: 'browser voice',
			command: npmCommand,
			args: ['run', 'test:browser-extension:unit', '--', 'browser-extension/src/sidepanel/voice.test.ts']
		},
		{
			name: 'backend ChatGPT subscription and Responses streaming',
			command: 'python',
			args: [
				'-m',
				'pytest',
				'-q',
				'backend/tests/test_verify_chatgpt_subscription_cli.py',
				'backend/tests/test_chatgpt_subscription.py',
				'backend/tests/test_responses_streaming.py'
			],
			options: { env: { PYTHONPATH: 'backend', WEBUI_SECRET_KEY: 'update-gate-test-secret' } }
		},
		{ name: 'branding audit', command: npmCommand, args: ['run', 'audit:branding'] },
		{ name: 'production frontend build', command: npmCommand, args: ['run', 'build'] },
		{
			name: 'isolated disposable companion smoke',
			command: npmCommand,
			args: ['run', 'test:companion:e2e'],
			options: { env: { RUN_ID: `update-gate-${process.pid}` } }
		},
		{ name: 'whitespace diff check', command: 'git', args: ['diff', '--check'] }
	];
}

function option(args, name) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [operation] = process.argv.slice(2);
	if (operation === 'baseline') {
		const result = validateBaselineTag(option(process.argv, '--baseline-sha'));
		process.stdout.write(`${result.outcome}\n`);
	} else if (operation === 'upstream') {
		const alreadyOnMain = option(process.argv, '--already-on-main');
		if (alreadyOnMain !== 'true' && alreadyOnMain !== 'false') {
			throw new Error('Expected --already-on-main true or false.');
		}
		process.stdout.write(`${decideUpstreamRun({ upstreamIsAlreadyOnMain: alreadyOnMain === 'true' }).outcome}\n`);
	} else if (operation === 'marker') {
		process.stdout.write(
			`${decideMarker({
				candidateSha: option(process.argv, '--candidate-sha'),
				mainTipSha: option(process.argv, '--main-tip-sha')
			})}\n`
		);
	} else {
		throw new Error('Expected a policy operation of baseline, upstream, or marker.');
	}
}
