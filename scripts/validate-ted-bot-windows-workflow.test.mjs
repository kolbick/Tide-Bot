// Node --test wrapper for the ted-bot-windows workflow structure validation.
// Run: node --test scripts/validate-ted-bot-windows-workflow.test.mjs
//
// This is a defensive structural check: it confirms the tracked workflow
// stays compatible with the desktop/tide-bot package's tracked launcher
// and pinned Node 22.18.0 toolchain. Real GitHub Actions execution remains
// the source of truth for actual workflow behavior.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const workflowPath = join(repoRoot, '.github/workflows/ted-bot-windows.yml');

const wf = parse(await readFile(workflowPath, 'utf8'));

test('workflow: name and triggers', () => {
	assert.equal(wf.name, 'ted-bot-windows');
	assert.ok(wf.on.workflow_dispatch, 'workflow_dispatch required');
	assert.ok(wf.on.push, 'push trigger required');
	assert.deepEqual(wf.on.push.branches, ['release/**']);
});

test('workflow: pinned Node 22.18.0', () => {
	assert.equal(wf.env.NODE_VERSION, '22.18.0');
	const nodeStep = wf.jobs['build-windows'].steps.find((s) => s.name === 'Install Node 22.18.0');
	assert.ok(nodeStep, 'Install Node 22.18.0 step required');
	assert.equal(nodeStep.with['node-version'], '${{ env.NODE_VERSION }}');
});

test('workflow: npm ci under desktop/tide-bot', () => {
	const ciStep = wf.jobs['build-windows'].steps.find(
		(s) => s.name === 'Install desktop node dependencies'
	);
	assert.ok(ciStep, 'install step required');
	assert.match(ciStep.run, /npm ci/, 'must use npm ci');
	assert.equal(ciStep['working-directory'], 'desktop/tide-bot');
});

test('workflow: root npm ci and frontend build precede tauri build', () => {
	const steps = wf.jobs['build-windows'].steps;
	const find = (n) => steps.findIndex((s) => s.name === n);
	const rootCi = find('Install root node dependencies');
	const frontendBuild = find('Build frontend (produces build/ for Tauri frontendDist)');
	const tauriBuild = find('Build Windows artifact');
	assert.ok(rootCi >= 0, 'Install root node dependencies step required');
	assert.ok(frontendBuild >= 0, 'Build frontend step required');
	assert.ok(rootCi < tauriBuild, 'root npm ci must precede tauri build');
	assert.ok(frontendBuild < tauriBuild, 'frontend build must precede tauri build');
	const rootCiStep = steps[rootCi];
	const frontendStep = steps[frontendBuild];
	assert.match(rootCiStep.run, /npm ci/);
	assert.match(frontendStep.run, /npm run build/);
});

test('workflow: cargo cache key includes Cargo.lock', () => {
	const cacheStep = wf.jobs['build-windows'].steps.find(
		(s) => s.name === 'Cache cargo registry and target'
	);
	assert.ok(cacheStep, 'cache step required');
	assert.match(cacheStep.with.key, /Cargo\.lock/);
});

test('workflow: build step consumes both origins', () => {
	const buildStep = wf.jobs['build-windows'].steps.find((s) => s.name === 'Build Windows artifact');
	assert.ok(buildStep, 'build step required');
	assert.ok(buildStep.env.TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN);
	assert.ok(buildStep.env.TIDE_BOT_DESKTOP_DEV_ORIGIN);
});

test('workflow: artifact upload pinned', () => {
	const upload = wf.jobs['build-windows'].steps.find(
		(s) => s.name === 'Upload unsigned Windows artifact, checksum, and metadata'
	);
	assert.ok(upload, 'upload step required');
	assert.equal(upload.with.name, 'ted-bot-windows-artifact');
	assert.equal(upload.with['if-no-files-found'], 'error');
});

test('workflow: windows-latest with 90 minute timeout', () => {
	const job = wf.jobs['build-windows'];
	assert.equal(job['runs-on'], 'windows-latest');
	assert.equal(job['timeout-minutes'], 90);
});

test('workflow: concurrency group', () => {
	assert.equal(wf.concurrency.group, 'ted-bot-windows-${{ github.ref }}');
});
