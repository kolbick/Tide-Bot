import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
	prepareBlindRun,
	preparePetQaRun,
	sealReviewerSubmission
} from './verify-ted-bot-direction-evidence.mjs';

const fixtureRoot = await mkdtemp(join(tmpdir(), 'ted-bot-evidence-'));
after(async () => rm(fixtureRoot, { recursive: true, force: true }));

async function createFiles(name) {
	const dir = join(fixtureRoot, name);
	await mkdir(dir, { recursive: true });
	for (const file of ['atlas.webp', 'blind.png']) await writeFile(join(dir, file), file);
	await writeFile(join(dir, 'key.json'), JSON.stringify({ atlas_sha256: '' }));
	return {
		dir,
		atlas: join(dir, 'atlas.webp'),
		blindSheet: join(dir, 'blind.png'),
		answerKey: join(dir, 'key.json')
	};
}

test('refuses malformed run ids before creating any run path', async () => {
	const { atlas } = await createFiles('malformed');
	const runsRoot = join(fixtureRoot, 'runs-malformed');
	for (const runId of ['', '.', '../escape', 'Upper', 'space here']) {
		await assert.rejects(preparePetQaRun({ runId, runsRoot, atlas }), /run id/i);
	}
	await assert.rejects(stat(runsRoot), /ENOENT/);
});

test('creates only a private sibling pet-QA pending directory', async () => {
	const { atlas } = await createFiles('outer');
	const runsRoot = join(fixtureRoot, 'runs-outer');
	const pendingDir = await preparePetQaRun({ runId: 'release-1', runsRoot, atlas });
	assert.equal(pendingDir, join(runsRoot, '.release-1.pending'));
	assert.equal((await stat(pendingDir)).mode & 0o777, 0o700);
	await assert.rejects(preparePetQaRun({ runId: 'release-1', runsRoot, atlas }), /pending|final/i);
	await assert.rejects(stat(join(runsRoot, 'release-1')), /ENOENT/);
});

test('creates a redacted blind-review package and keeps the answer key private', async () => {
	const { atlas, blindSheet, answerKey } = await createFiles('blind');
	const runsRoot = join(fixtureRoot, 'runs-blind');
	const key = JSON.parse(await readFile(answerKey, 'utf8'));
	key.atlas_sha256 = (await import('node:crypto'))
		.createHash('sha256')
		.update(await readFile(atlas))
		.digest('hex');
	await writeFile(answerKey, JSON.stringify(key));
	const pendingDir = await prepareBlindRun({
		runId: 'release-2-blind',
		runsRoot,
		atlas,
		blindSheet,
		answerKey
	});
	const manifest = JSON.parse(
		await readFile(join(pendingDir, 'blind-review-manifest.json'), 'utf8')
	);
	assert.deepEqual(Object.keys(manifest).sort(), [
		'answerKeySha256',
		'atlasSha256',
		'blindSheetSha256',
		'manifestSha256',
		'schemaVersion'
	]);
	await stat(join(pendingDir, 'blind-sheet.png'));
	await assert.rejects(stat(join(pendingDir, 'key.json')), /ENOENT/);
});

test('seals a validated reviewer submission so later raw-file changes cannot alter it', async () => {
	const { atlas, blindSheet, answerKey, dir } = await createFiles('seal');
	const atlasSha256 = (await import('node:crypto'))
		.createHash('sha256')
		.update(await readFile(atlas))
		.digest('hex');
	await writeFile(
		answerKey,
		JSON.stringify({ atlas_sha256: atlasSha256, pairs: [{ pair: 'pair-1' }] })
	);
	const runsRoot = join(dir, 'blind-runs');
	const pendingDir = await prepareBlindRun({
		runId: 'release-3-blind',
		runsRoot,
		atlas,
		blindSheet,
		answerKey
	});
	const manifest = JSON.parse(
		await readFile(join(pendingDir, 'blind-review-manifest.json'), 'utf8')
	);
	const rawVerdict = join(dir, 'reviewer.json');
	await writeFile(
		rawVerdict,
		JSON.stringify({
			schemaVersion: manifest.schemaVersion,
			reviewerId: 'reviewer-1',
			atlasSha256: manifest.atlasSha256,
			blindSheetSha256: manifest.blindSheetSha256,
			manifestSha256: manifest.manifestSha256,
			pairs: [{ pair: 'pair-1', A: 'screen-left', B: 'screen-right' }]
		})
	);
	const sealed = await sealReviewerSubmission({
		runId: 'release-3-blind',
		runsRoot,
		verdict: rawVerdict
	});
	const sealedBefore = await readFile(sealed.sealed, 'utf8');
	await writeFile(rawVerdict, '{"changed":true}');
	assert.equal(await readFile(sealed.sealed, 'utf8'), sealedBefore);
	assert.equal((await stat(sealed.sealed)).mode & 0o777, 0o600);
	await assert.rejects(
		sealReviewerSubmission({ runId: 'release-3-blind', runsRoot, verdict: rawVerdict }),
		/submission already sealed|invalid schema/i
	);
});
