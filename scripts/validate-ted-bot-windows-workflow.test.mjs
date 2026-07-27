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
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const workflowPath = join(repoRoot, '.github/workflows/ted-bot-windows.yml');

function parseYamlWithPython(text) {
	// The Node runtime intentionally avoids pulling in a YAML library for
	// this single validator. Spawn the system Python (preferred 3.11/3.12)
	// which has pyyaml available via the project's dev venv at
	// /tmp/yaml-venv or via a globally installed pyyaml.
	const candidates = [
		'/tmp/yaml-venv/bin/python',
		process.env.PYTHON_BIN,
		'/usr/local/bin/python3.12',
		'/usr/bin/python3',
		'python3'
	].filter(Boolean);

	const script = `
import yaml, json, sys
doc = yaml.safe_load(open(${JSON.stringify(workflowPath)}))
out = {
    'name': doc.get('name'),
    'on': doc.get(True, doc.get('on', {})),
    'env': doc.get('env', {}),
    'concurrency': doc.get('concurrency', {}),
    'jobs': {
        name: {
            'runs-on': job.get('runs-on'),
            'timeout-minutes': job.get('timeout-minutes'),
            'steps': [
                {
                    'name': s.get('name', '<unnamed>'),
                    'uses': s.get('uses'),
                    'with': s.get('with', {}),
                    'run': s.get('run'),
                    'env': s.get('env', {}),
                    'working-directory': s.get('working-directory'),
                    'shell': s.get('shell'),
                }
                for s in job.get('steps', [])
            ],
        }
        for name, job in doc.get('jobs', {}).items()
    },
}
print(json.dumps(out))
`;

	for (const bin of candidates) {
		const r = spawnSync(bin, ['-c', script], { encoding: 'utf8' });
		if (r.status === 0) {
			return JSON.parse(r.stdout);
		}
	}
	throw new Error(
		`No Python with PyYAML available. Tried: ${candidates.join(', ')}. ` +
			`Install with: /usr/local/bin/python3.12 -m venv /tmp/yaml-venv && /tmp/yaml-venv/bin/pip install pyyaml`
	);
}

const wf = parseYamlWithPython(await readFile(workflowPath, 'utf8'));

test('workflow: name and triggers', () => {
	assert.equal(wf.name, 'ted-bot-windows');
	assert.ok(wf.on.workflow_dispatch, 'workflow_dispatch required');
	assert.ok(wf.on.push, 'push trigger required');
	assert.deepEqual(wf.on.push.branches, ['release/**']);
});

test('workflow: pinned Node 22.18.0', () => {
	assert.equal(wf.env.NODE_VERSION, '22.18.0');
	const nodeStep = wf.jobs['build-windows'].steps.find(
		(s) => s.name === 'Install Node 22.18.0'
	);
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

test('workflow: cargo cache key includes Cargo.lock', () => {
	const cacheStep = wf.jobs['build-windows'].steps.find(
		(s) => s.name === 'Cache cargo registry and target'
	);
	assert.ok(cacheStep, 'cache step required');
	assert.match(cacheStep.with.key, /Cargo\.lock/);
});

test('workflow: build step consumes both origins', () => {
	const buildStep = wf.jobs['build-windows'].steps.find(
		(s) => s.name === 'Build Windows artifact'
	);
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
	assert.equal(
		wf.concurrency.group,
		'ted-bot-windows-${{ github.ref }}'
	);
});
