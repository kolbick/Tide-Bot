import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
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

function gitIdentityStepIsBefore(workflow, writerStep) {
	const identity = namedStep(workflow, 'Configure Tide-Bot automation identity');
	assert.match(identity.run, /git config user\.name/);
	assert.match(identity.run, /git config user\.email/);
	assert.ok(stepIndex(workflow, identity.name) < stepIndex(workflow, writerStep));
}

function assertNoOpControlFlow(workflow) {
	const noOp = namedStep(workflow, 'Fetch and validate upstream baseline');
	const ancestryGuard = noOp.run.indexOf('if git merge-base --is-ancestor "$UPSTREAM_SHA" origin/main; then');
	const noOpDecision = noOp.run.indexOf('upstream --already-on-main true');
	const reviewDecision = noOp.run.indexOf('upstream --already-on-main false');
	const earlyExit = noOp.run.indexOf("if [ \"$UPSTREAM_DECISION\" = 'no-op' ]; then");
	const output = noOp.run.indexOf('echo "upstream_sha=$UPSTREAM_SHA" >> "$GITHUB_OUTPUT"');

	for (const index of [ancestryGuard, noOpDecision, reviewDecision, earlyExit, output]) {
		assert.ok(index >= 0, 'missing a required no-op control-flow operation');
	}
	assert.ok(ancestryGuard < noOpDecision);
	assert.ok(noOpDecision < reviewDecision);
	assert.ok(reviewDecision < earlyExit);
	assert.ok(earlyExit < output);
	assert.match(noOp.run.slice(earlyExit, output), /exit 0/);

	for (const name of [
		'Merge upstream into a review branch',
		'Run common update gate',
		'Record and propose passing integration'
	]) {
		assert.equal(namedStep(workflow, name).if, "steps.upstream.outputs.upstream_sha != ''");
	}
}

const upstream = await readWorkflow('tide-bot-upstream-main.yml');
const deployable = await readWorkflow('tide-bot-deployable.yml');

test('upstream workflow has a trusted hourly review path with configured commit identity', () => {
	assert.equal(upstream.on.schedule[0].cron, '0 * * * *');
	assert.ok(Object.hasOwn(upstream.on, 'workflow_dispatch'));
	assert.equal(upstream.permissions.contents, 'write');
	assert.equal(upstream.permissions.issues, 'write');
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

test('every sanitized upstream issue path has an explicit GitHub token', () => {
	const issueSteps = steps(upstream).filter((step) => step.run?.includes('gh issue create'));
	assert.equal(issueSteps.length, 3);
	for (const step of issueSteps) {
		assert.equal(step.env.GH_TOKEN, '${{ github.token }}');
	}
});

test('upstream workflow handles a wrong baseline hash through the sanitized issue branch', () => {
	const baseline = namedStep(upstream, 'Fetch and validate upstream baseline');
	assert.match(baseline.run, /node scripts\/tide-bot-update-policy\.mjs baseline/);
	assert.match(baseline.run, /gh issue create/);
	assert.match(baseline.run, /git merge-base --is-ancestor/);
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
