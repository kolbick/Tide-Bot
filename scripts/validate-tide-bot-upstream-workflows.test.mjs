import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import * as updatePolicy from './tide-bot-update-policy.mjs';
import {
	buildUpdateGateCommands,
	decideUpstreamRun,
	simulateMarkerRun,
	validateBaselineTag
} from './tide-bot-update-policy.mjs';
import { updateUpstreamIntegrationMarkdown } from './record-upstream-integration.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

async function readWorkflow(name) {
	return parse(await readFile(join(repoRoot, '.github', 'workflows', name), 'utf8'));
}

function steps(workflow) {
	return Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
}

function namedStep(workflow, name) {
	const step = steps(workflow).find((entry) => entry.name === name);
	assert.ok(step, `missing workflow step: ${name}`);
	return step;
}

function stepIndex(workflow, name) {
	const index = steps(workflow).findIndex((entry) => entry.name === name);
	assert.ok(index >= 0, `missing workflow step: ${name}`);
	return index;
}

function workflowCommands(workflow) {
	return steps(workflow)
		.map((step) => step.run ?? '')
		.join('\n');
}

function assertDeployableCommandPolicy(workflow) {
	const commandSteps = steps(workflow)
		.filter((step) => typeof step.run === 'string')
		.map((step) => ({ ...step, run: step.run.replace(/\\\r?\n[ \t]*/g, ' ') }));
	const commands = commandSteps.map((step) => step.run).join('\n');
	if ((commands.match(/\bdocker\s+build\b/gi) ?? []).length !== 1) {
		throw new Error('forbidden deployable workflow command: expected one Docker build');
	}

	const forbidden = [
		['Buildx', /\b(?:docker\s+)?buildx\b/i],
		['Docker login or pull', /\bdocker\b[^\n;&|]*(?<![-\w])(?:login|pull)\b/i],
		['Compose pull', /\b(?:docker(?:-|\s+)compose|compose)\b[^\n]*\bpull\b/i],
		[
			'remote Docker context',
			/\bdocker\s+(?:build|buildx\s+build)\b[^\n]*(?:https?:\/\/|git:\/\/|ssh:\/\/|git@)/i
		],
		['GitHub expression', /\$\{\{/]
	];

	for (const step of commandSteps) {
		for (const [name, pattern] of forbidden) {
			if (pattern.test(step.run)) {
				throw new Error(`forbidden deployable workflow command (${name}) in ${step.name ?? 'unnamed step'}`);
			}
		}
	}
}

function gitIdentityStepIsBefore(workflow, writerStep) {
	const identity = namedStep(workflow, 'Configure Tide-Bot automation identity');
	assert.match(identity.run, /git config user\.name/);
	assert.match(identity.run, /git config user\.email/);
	assert.ok(stepIndex(workflow, identity.name) < stepIndex(workflow, writerStep));
}

function assertNoOpControlFlow(workflow) {
	const noOp = namedStep(workflow, 'Fetch and validate upstream baseline');
	const ancestryGuard = noOp.run.indexOf('if git merge-base --is-ancestor "$UPSTREAM_SHA" origin/main; then');
	const noOpDecision = noOp.run.indexOf("OUTCOME='no-op'");
	const output = noOp.run.indexOf('echo "upstream_sha=$UPSTREAM_SHA" >> "$GITHUB_OUTPUT"');

	for (const index of [ancestryGuard, noOpDecision, output]) {
		assert.ok(index >= 0, 'missing a required no-op control-flow operation');
	}
	assert.ok(ancestryGuard < noOpDecision);
	assert.ok(noOpDecision < output);

	assert.equal(namedStep(workflow, 'Merge upstream into a review branch').if, "steps.upstream.outputs.outcome == 'review'");
	assert.match(namedStep(workflow, 'Run common update gate').if, /steps\.upstream\.outputs\.outcome == 'review'/);
	assert.match(workflow.jobs.publish.if, /outputs\.outcome != 'no-op'/);
}

const upstream = await readWorkflow('tide-bot-upstream-main.yml');
const deployable = await readWorkflow('tide-bot-deployable.yml');

test('workflow directory contains only approved Tide-Bot workflows', async () => {
	const approved = [
		'ted-bot-windows.yml',
		'tide-bot-browser-extension.yml',
		'tide-bot-deployable.yml',
		'tide-bot-upstream-main.yml'
	];
	const actual = (await readdir(join(repoRoot, '.github', 'workflows')))
		.filter((name) => /\.ya?ml$/i.test(name))
		.sort();

	assert.deepEqual(actual, approved);
});

test('upstream workflow has a trusted hourly review path with configured commit identity', () => {
	assert.equal(upstream.on.schedule[0].cron, '0 * * * *');
	assert.ok(Object.hasOwn(upstream.on, 'workflow_dispatch'));
	assert.equal(upstream.permissions.contents, 'read');
	const verify = upstream.jobs.verify;
	const publish = upstream.jobs.publish;
	assert.ok(verify);
	assert.ok(publish);
	assert.deepEqual(verify.permissions, { contents: 'read' });
	assert.deepEqual(publish.permissions, {
		contents: 'write',
		issues: 'write',
		'pull-requests': 'write'
	});
	assert.equal(publish.needs, 'verify');
	assert.equal(verify.steps.find((step) => step.uses === 'actions/checkout@v4').with['persist-credentials'], false);
	assert.equal(namedStep(upstream, 'Install Node').with['node-version'], '22.18.0');
	assert.equal(namedStep(upstream, 'Install Python').with['python-version'], '3.12');
	gitIdentityStepIsBefore(upstream, 'Record and propose passing integration');
	assert.match(namedStep(upstream, 'Record and propose passing integration').run, /git commit/);
	const commands = workflowCommands(upstream);
	assert.match(commands, /git fetch --no-tags upstream main/);
	assert.match(commands, /automation\/upstream-main-\$\{UPSTREAM_SHA:0:12\}/);
	assert.match(commands, /git merge --no-ff --no-commit "\$UPSTREAM_SHA"/);
	assert.doesNotMatch(commands, /git merge -s ours|git checkout --theirs|git reset --hard/);
	assert.doesNotMatch(commands, /git push[^\n]*--force[^\n]*main/);
});

test('untrusted upstream merge and gate are credential-free and mutation-free', () => {
	const verify = upstream.jobs.verify;
	const commands = (verify.steps ?? []).map((step) => step.run ?? '').join('\n');
	for (const step of verify.steps ?? []) {
		assert.equal(Object.hasOwn(step.env ?? {}, 'GH_TOKEN'), false);
	}
	assert.doesNotMatch(commands, /gh (?:issue|pr)|git push|git tag/);
	assert.match(commands, /git merge --no-ff --no-commit/);
	assert.match(commands, /npm run test:update-gate/);
});

test('every sanitized upstream issue path has an explicit GitHub token', () => {
	const issueSteps = steps(upstream).filter((step) => step.run?.includes('gh issue create'));
	assert.equal(issueSteps.length, 1);
	for (const step of issueSteps) {
		assert.equal(step.env.GH_TOKEN, '${{ github.token }}');
	}
});

test('upstream workflow handles a wrong baseline hash through the sanitized issue branch', () => {
	const baseline = namedStep(upstream, 'Fetch and validate upstream baseline');
	assert.match(baseline.run, /node scripts\/tide-bot-update-policy\.mjs baseline/);
	assert.doesNotMatch(baseline.run, /gh issue create|GH_TOKEN/);
	assert.match(baseline.run, /OUTCOME='baseline-mismatch'/);
	assert.match(namedStep(upstream, 'Create sanitized failure issue').run, /gh issue create/);
	assert.match(baseline.run, /git merge-base --is-ancestor/);
	const trusted = namedStep(upstream, 'Validate trusted verification output').run;
	assert.match(trusted, /baseline-mismatch\) test "\$BASELINE_SHA" != "\$EXPECTED_BASELINE_SHA"/);
	assert.match(trusted, /git merge-base --is-ancestor "\$UPSTREAM_SHA" upstream\/main/);
});

test('workflow no-op decision prevents every later upstream mutation', () => {
	assertNoOpControlFlow(upstream);
});

test('no-op workflow semantics reject a disconnected ancestry guard', () => {
	const broken = structuredClone(upstream);
	namedStep(broken, 'Fetch and validate upstream baseline').run = namedStep(broken, 'Fetch and validate upstream baseline').run.replace(
		'if git merge-base --is-ancestor "$UPSTREAM_SHA" origin/main; then',
		'if false; then'
	);
	assert.throws(() => assertNoOpControlFlow(broken), /missing a required no-op control-flow operation/);
});

test('common gate selects companion and real browser voice test commands', () => {
	const commands = buildUpdateGateCommands('npm');
	assert.deepEqual(commands[0], {
		name: 'frontend companion contracts',
		command: 'npm',
		args: ['exec', 'vitest', '--', 'run', 'src/lib/ted-bot', 'src/lib/components/ted-bot', 'src/lib/components/chat/MessageInput']
	});
	assert.deepEqual(commands[1], {
		name: 'browser voice',
		command: 'npm',
		args: ['run', 'test:browser-extension:unit', '--', 'browser-extension/src/sidepanel/voice.test.ts']
	});
});

test('common gate pins the production frontend build heap independently of ambient CI settings', () => {
	const productionBuild = buildUpdateGateCommands('npm').find(
		(command) => command.name === 'production frontend build'
	);

	assert.deepEqual(productionBuild, {
		name: 'production frontend build',
		command: 'npm',
		args: ['run', 'build'],
		options: { env: { NODE_OPTIONS: '--max-old-space-size=8192' } }
	});
});

test('failed gate commands expose only a bounded redacted output tail', () => {
	assert.equal(typeof updatePolicy.formatSubprocessResult, 'function');
	const messages = updatePolicy.formatSubprocessResult(
		'isolated disposable companion smoke',
		{
			status: 1,
			stdout: [
				'early-output-sentinel',
				'filler '.repeat(100),
				'request https://private.example.test/path?access_token=url-secret'
			].join('\n'),
			stderr: 'Bearer sk-example-token-123456 password=hunter2\nfinal cypress failure'
		},
		{ maxOutputChars: 180 }
	);

	assert.equal(messages[0], 'FAIL isolated disposable companion smoke: exit 1');
	assert.equal(messages.length, 2);
	assert.match(messages[1], /^diagnostic tail \(max 180 chars\):\n/);
	assert.match(messages[1], /final cypress failure/);
	assert.doesNotMatch(
		messages.join('\n'),
		/early-output-sentinel|private\.example|sk-example|hunter2|url-secret/
	);
	assert.ok(messages[1].length <= 220);
});

test('successful gate commands do not emit captured child output', () => {
	assert.equal(typeof updatePolicy.formatSubprocessResult, 'function');
	assert.deepEqual(
		updatePolicy.formatSubprocessResult('browser voice', {
			status: 0,
			stdout: 'noisy child stdout',
			stderr: 'noisy child stderr'
		}),
		['PASS browser voice']
	);
});

test('deployable workflow only starts from trusted main push or explicit dispatch', () => {
	assert.deepEqual(deployable.on.push.branches, ['main']);
	assert.ok(Object.hasOwn(deployable.on, 'workflow_dispatch'));
	assert.equal(Object.hasOwn(deployable.on, 'workflow_run'), false);
	assert.equal(deployable.permissions.contents, 'write');
	assert.equal(deployable.concurrency.group, 'tide-bot-deployable-main');
	assert.equal(deployable.concurrency['cancel-in-progress'], false);
	gitIdentityStepIsBefore(deployable, 'Move tested deployable marker');
	assert.ok(stepIndex(deployable, 'Run common update gate') < stepIndex(deployable, 'Guard current main tip'));
	assert.ok(stepIndex(deployable, 'Guard current main tip') < stepIndex(deployable, 'Move tested deployable marker'));
	assert.match(namedStep(deployable, 'Guard current main tip').run, /tide-bot-update-policy\.mjs marker/);
	assert.equal(namedStep(deployable, 'Move tested deployable marker').if, "steps.main_tip.outputs.decision == 'mark'");
	const marker = namedStep(deployable, 'Move tested deployable marker').run;
	assert.match(marker, /git tag -fa tide-bot-deployable "\$GITHUB_SHA" -m "Tide-Bot deployable \$GITHUB_SHA"/);
	assert.match(marker, /git push origin refs\/tags\/tide-bot-deployable --force/);
	for (const line of marker.split('\n').filter((line) => line.includes('git push'))) {
		assert.equal(line.trim(), 'git push origin refs/tags/tide-bot-deployable --force');
	}
});

test('deployable workflow builds the fixed local Cypress runtime image before the gate', () => {
	const buildImage = namedStep(deployable, 'Build local Tide-Bot runtime image');
	assert.equal(
		stepIndex(deployable, buildImage.name) + 1,
		stepIndex(deployable, 'Run common update gate')
	);
	assert.equal(buildImage.shell, 'bash');
	assert.deepEqual(buildImage.env, {
		DOCKER_BUILDKIT: '0',
		DOCKER_CONFIG: '/tmp/tide-bot-local-image-docker-config'
	});
	assert.deepEqual(buildImage.run.trimEnd().split('\n'), [
		'set -euo pipefail',
		'install -d -m 0700 "$DOCKER_CONFIG"',
		'docker build \\',
		'  --pull=false \\',
		'  --build-arg USE_SLIM=true \\',
		'  --tag tide-bot:local \\',
		'  .'
	]);
	assert.equal((workflowCommands(deployable).match(/\bdocker\s+build\b/g) ?? []).length, 1);
	assert.doesNotMatch(buildImage.run, /\bbuildx\b|https?:\/\/|git:\/\/|\$\{\{|\$INPUT_/i);
});

test('deployable workflow command policy accepts the tracked trusted commands', () => {
	assertDeployableCommandPolicy(deployable);
});

test('deployable workflow command policy rejects malicious later-step mutations', () => {
	const mutations = [
		{
			name: 'remote Buildx context',
			run: 'docker buildx build https://attacker.example/context.git'
		},
		{
			name: 'registry image pull',
			run: 'docker image pull attacker/image:latest'
		},
		{
			name: 'direct image pull',
			run: 'docker pull attacker/image:latest'
		},
		{
			name: 'Docker login after global config option',
			run: 'docker --config /tmp/attacker login registry.example'
		},
		{
			name: 'image pull after global context option',
			run: 'docker --context attacker image pull attacker/image:latest'
		},
		{
			name: 'continued Docker login after global config option',
			run: 'docker --config /tmp/attacker \\\nlogin registry.example'
		},
		{
			name: 'continued image pull after global context option',
			run: 'docker --context attacker image \\\npull attacker/image'
		},
		{
			name: 'continued Compose pull',
			run: 'docker compose \\\npull'
		},
		{
			name: 'Compose pull with options',
			run: 'docker compose --file attacker.yml pull'
		},
		{
			name: 'standalone Buildx invocation',
			run: 'buildx version'
		},
		{
			name: 'secret expression',
			run: 'echo "${{ secrets.REGISTRY_TOKEN }}"'
		}
	];

	for (const mutation of mutations) {
		const broken = structuredClone(deployable);
		broken.jobs['mark-deployable'].steps.push({ name: mutation.name, run: mutation.run });
		assert.throws(
			() => assertDeployableCommandPolicy(broken),
			/forbidden deployable workflow command/,
			mutation.name
		);
	}
});

test('marker runtime and companion fixture Dockerfiles pin every external image by digest', async () => {
	const nodeImage =
		'node:22-alpine3.20@sha256:2289fb1fba0f4633b08ec47b94a89c7e20b829fc5679f9b7b298eaa2f1ed8b7e';
	const fixtureNodeImage =
		'node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32';
	const pythonImage =
		'python:3.11-slim-bookworm@sha256:0bee7276f83efd4a1ee05bbbf4281d95ed28e079220a9457f25a93e3f1e3c31b';
	const expected = new Map([
		['Dockerfile', [`FROM --platform=$BUILDPLATFORM ${nodeImage} AS build`, `FROM ${pythonImage} AS base`]],
		['deploy/tide-stack/cypress-fake-openai/Dockerfile', [`FROM ${fixtureNodeImage}`]],
		['deploy/tide-stack/cypress-loopback-gateway/Dockerfile', [`FROM ${fixtureNodeImage}`]]
	]);

	for (const [relativePath, expectedFromLines] of expected) {
		const source = await readFile(join(repoRoot, relativePath), 'utf8');
		const fromLines = source.split(/\r?\n/).filter((line) => /^FROM\s/.test(line));
		assert.deepEqual(fromLines, expectedFromLines, relativePath);
		assert.ok(
			fromLines.every((line) => /@sha256:[a-f0-9]{64}(?:\s|$)/.test(line)),
			`${relativePath} contains a mutable external image`
		);
	}
});

test('synthetic no-op upstream run neither creates a review nor triggers a marker', () => {
	assert.deepEqual(decideUpstreamRun({ upstreamIsAlreadyOnMain: true }), {
		outcome: 'no-op',
		createReview: false,
		triggerMarker: false
	});
});

test('synthetic out-of-order marker jobs never roll the tag back', () => {
	const shaA = 'a'.repeat(40);
	const shaB = 'b'.repeat(40);
	let state = { markerSha: null };

	state = simulateMarkerRun(state, { candidateSha: shaB, mainTipSha: shaB });
	assert.deepEqual(state, { markerSha: shaB, outcome: 'marked' });

	state = simulateMarkerRun(state, { candidateSha: shaA, mainTipSha: shaB });
	assert.deepEqual(state, { markerSha: shaB, outcome: 'skipped-stale' });
});

test('synthetic baseline mismatch blocks before a merge attempt and requests an issue', () => {
	const result = validateBaselineTag('f'.repeat(40));
	assert.deepEqual(result, { outcome: 'blocked', reason: 'baseline-hash-mismatch', createIssue: true });
});

test('baseline validation requires the exact full v0.11.1 commit', () => {
	assert.deepEqual(validateBaselineTag('d3e8bf3400000000000000000000000000000000'), {
		outcome: 'blocked',
		reason: 'baseline-hash-mismatch',
		createIssue: true
	});
	assert.deepEqual(validateBaselineTag('d3e8bf3405e848cfba377814d0aa7ba7290e414d'), {
		outcome: 'ready'
	});
});

test('upstream record keeps one table and accumulates distinct SHA rows', () => {
	const first = '1'.repeat(40);
	const second = '2'.repeat(40);
	const source = '# Upstream baseline\n\n## Automated upstream/main integrations\n\nExisting notes.\n';
	const afterFirst = updateUpstreamIntegrationMarkdown(source, { date: '2026-08-25', upstreamSha: first });
	const afterSecond = updateUpstreamIntegrationMarkdown(afterFirst, { date: '2026-08-26', upstreamSha: second });
	const repeated = updateUpstreamIntegrationMarkdown(afterSecond, { date: '2026-08-27', upstreamSha: first });

	assert.equal((repeated.match(/\| Date \| Upstream commit \| Record \|/g) ?? []).length, 1);
	assert.equal((repeated.match(new RegExp(first, 'g')) ?? []).length, 1);
	assert.equal((repeated.match(new RegExp(second, 'g')) ?? []).length, 1);
	assert.ok(repeated.indexOf(first) < repeated.indexOf(second));
});

test('workflows never upload secrets, databases, Docker archives, or test data', () => {
	for (const workflow of [upstream, deployable]) {
		const uploads = steps(workflow).filter((step) => step.uses?.startsWith('actions/upload-artifact'));
		assert.deepEqual(uploads, []);
	}
});
