import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const upstreamWorkflowPath = join(repoRoot, '.github/workflows/tide-bot-upstream-main.yml');
const deployableWorkflowPath = join(repoRoot, '.github/workflows/tide-bot-deployable.yml');
const updateGatePath = join(repoRoot, 'scripts/run-tide-bot-update-gate.mjs');

async function readWorkflow(path) {
	return parse(await readFile(path, 'utf8'));
}

function commandText(workflow) {
	return Object.values(workflow.jobs)
		.flatMap((job) => job.steps ?? [])
		.map((step) => step.run ?? '')
		.join('\n');
}

function setupText(workflow) {
	return Object.values(workflow.jobs)
		.flatMap((job) => job.steps ?? [])
		.map((step) => JSON.stringify({ uses: step.uses, with: step.with }))
		.join('\n');
}

function artifactText(workflow) {
	return Object.values(workflow.jobs)
		.flatMap((job) => job.steps ?? [])
		.filter((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/upload-artifact'))
		.map((step) => JSON.stringify(step.with ?? {}))
		.join('\n');
}

const upstream = await readWorkflow(upstreamWorkflowPath);
const deployable = await readWorkflow(deployableWorkflowPath);
const updateGate = await readFile(updateGatePath, 'utf8');

test('common gate invokes the Windows npm shim when required', () => {
	assert.match(updateGate, /process\.platform === 'win32' \? 'npm\.cmd' : 'npm'/);
	assert.match(updateGate, /shell: process\.platform === 'win32'/);
	assert.match(
		updateGate,
		/env: \{ PYTHONPATH: 'backend', WEBUI_SECRET_KEY: 'update-gate-test-secret' \}/
	);
});

test('upstream workflow is scheduled, constrained, and creates a review branch', () => {
	assert.ok(upstream.on.schedule.some((entry) => entry.cron === '0 * * * *'));
	assert.ok(Object.hasOwn(upstream.on, 'workflow_dispatch'));
	assert.equal(upstream.permissions.contents, 'write');
	assert.equal(upstream.permissions.issues, 'write');

	const commands = commandText(upstream);
	const setup = setupText(upstream);
	assert.match(setup, /node-version.*22\.18\.0/);
	assert.match(setup, /python-version.*3\.(11|12)/);
	assert.match(commands, /git fetch --no-tags upstream main/);
	assert.match(commands, /UPSTREAM_SHA="\$\(git rev-parse upstream\/main\^\{commit\}\)"/);
	assert.match(commands, /automation\/upstream-main-\$\{UPSTREAM_SHA:0:12\}/);
	assert.match(commands, /git merge --no-ff --no-commit "\$UPSTREAM_SHA"/);
	assert.doesNotMatch(commands, /git merge -s ours|git checkout --theirs|git reset --hard/);
	assert.doesNotMatch(commands, /git push[^\n]*--force[^\n]*main/);
});

test('upstream workflow verifies the v0.11.1 baseline before merging', () => {
	const commands = commandText(upstream);
	assert.match(commands, /refs\/tags\/v0\.11\.1/);
	assert.match(commands, /d3e8bf3/);
	assert.match(commands, /git merge-base --is-ancestor "\$BASELINE_SHA" "\$UPSTREAM_SHA"/);
	assert.match(commands, /gh issue create/);
	assert.match(commands, /git diff --name-only --diff-filter=U/);
	assert.match(commands, /git merge --abort/);
});

test('upstream workflow runs the common gate before it records or integrates a merge', () => {
	const commands = commandText(upstream);
	const gate = commands.indexOf('npm run test:update-gate');
	const record = commands.indexOf('node scripts/record-upstream-integration.mjs --upstream-sha "$UPSTREAM_SHA"');
	const gateStep = Object.values(upstream.jobs)
		.flatMap((job) => job.steps ?? [])
		.find((step) => step.name === 'Run common update gate');
	assert.ok(gate >= 0, 'common update gate is required');
	assert.ok(record > gate, 'recording must follow a passing update gate');
	assert.match(gateStep.run, /gh issue create/);
	assert.match(commands, /gh pr merge[^\n]*--merge/);
});

test('deployable workflow gates main commits and moves only the annotated marker tag', () => {
	assert.deepEqual(deployable.on.push.branches, ['main']);
	assert.ok(Object.hasOwn(deployable.on, 'workflow_dispatch'));
	assert.equal(deployable.permissions.contents, 'write');

	const commands = commandText(deployable);
	assert.match(commands, /npm run test:update-gate/);
	assert.match(commands, /git tag -fa tide-bot-deployable "\$GITHUB_SHA" -m "Tide-Bot deployable \$GITHUB_SHA"/);
	assert.match(commands, /git push origin refs\/tags\/tide-bot-deployable --force/);
	for (const line of commands.split('\n').filter((line) => line.includes('git push') && line.includes('--force'))) {
		assert.match(line, /^git push origin refs\/tags\/tide-bot-deployable --force$/);
	}
});

test('workflows never upload secrets, database data, Docker archives, or test data', () => {
	for (const artifacts of [artifactText(upstream), artifactText(deployable)]) {
		assert.doesNotMatch(artifacts, /\.env|\.sqlite|\.db|\.tar|docker|test-data/i);
	}
});
