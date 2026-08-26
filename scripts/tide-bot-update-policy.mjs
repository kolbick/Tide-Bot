import { fileURLToPath } from 'node:url';

const expectedBaselineSha = 'd3e8bf3405e848cfba377814d0aa7ba7290e414d';
const defaultDiagnosticOutputChars = 4000;

export function redactDiagnostic(value) {
	return String(value)
		.replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]')
		.replace(/\b(?:sk|ghp|github_pat|xox)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
		.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]')
		.replace(/\bBearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
		.replace(
			/\b(refresh_token|access_token|api[_-]?key|secret|password)\s*[=:]\s*[^\s,;]+/gi,
			'$1=[REDACTED]'
		);
}

export function formatSubprocessResult(
	name,
	result,
	{ maxOutputChars = defaultDiagnosticOutputChars } = {}
) {
	if (!result.error && result.status === 0) {
		return [`PASS ${name}`];
	}

	const detail = redactDiagnostic(result.error?.message ?? `exit ${result.status ?? 'unknown'}`);
	const output = redactDiagnostic([result.stdout, result.stderr].filter(Boolean).join('\n')).trim();
	if (!output) {
		return [`FAIL ${name}: ${detail}`];
	}

	const limit =
		Number.isInteger(maxOutputChars) && maxOutputChars > 0
			? maxOutputChars
			: defaultDiagnosticOutputChars;
	return [
		`FAIL ${name}: ${detail}`,
		`diagnostic tail (max ${limit} chars):\n${output.slice(-limit)}`
	];
}

function isSha(value) {
	return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}

export function validateBaselineTag(baselineSha) {
	if (!isSha(baselineSha) || baselineSha.toLowerCase() !== expectedBaselineSha) {
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
		{
			name: 'production frontend build',
			command: npmCommand,
			args: ['run', 'build'],
			options: { env: { NODE_OPTIONS: '--max-old-space-size=8192' } }
		},
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
