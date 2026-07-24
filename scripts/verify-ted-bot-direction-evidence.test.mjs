import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
	EXPECTED_DIRECTIONS,
	createEvidenceVerifier,
	prepareBlindRun,
	preparePetQaRun,
	publishPetQaRun,
	sealPetQaArtifacts,
	sealReviewerSubmission,
	verifyAndCombine
} from './verify-ted-bot-direction-evidence.mjs';

const fixtureRoot = await mkdtemp(join(tmpdir(), 'ted-bot-evidence-'));
after(async () => rm(fixtureRoot, { recursive: true, force: true }));

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const BLIND_PAIR_SPECS = [
	['horizontal', '022.5', 'screen-right', '337.5', 'screen-left'],
	['horizontal', '045', 'screen-right', '315', 'screen-left'],
	['horizontal', '067.5', 'screen-right', '292.5', 'screen-left'],
	['horizontal', '090', 'screen-right', '270', 'screen-left'],
	['horizontal', '112.5', 'screen-right', '247.5', 'screen-left'],
	['horizontal', '135', 'screen-right', '225', 'screen-left'],
	['horizontal', '157.5', 'screen-right', '202.5', 'screen-left'],
	['vertical', '000', 'up', '180', 'down'],
	['vertical', '022.5', 'up', '157.5', 'down'],
	['vertical', '045', 'up', '135', 'down'],
	['vertical', '067.5', 'up', '112.5', 'down'],
	['vertical', '337.5', 'up', '202.5', 'down'],
	['vertical', '315', 'up', '225', 'down'],
	['vertical', '292.5', 'up', '247.5', 'down']
];

function digest(value) {
	return createHash('sha256').update(value).digest('hex');
}

async function hash(file) {
	return digest(await readFile(file));
}

async function writePng(file) {
	await writeFile(file, PNG_SIGNATURE);
}

function answerKeyPairs() {
	const axisIndexes = { horizontal: 0, vertical: 0 };
	return BLIND_PAIR_SPECS.map(([axis, firstSource, firstDirection, secondSource, secondDirection]) => {
		axisIndexes[axis] += 1;
		return {
			pair: `${axis}-${axisIndexes[axis]}`,
			axis,
			gate:
				(firstSource === '090' && secondSource === '270') ||
				(firstSource === '000' && secondSource === '180')
					? 'hard'
					: 'review',
			A: { source_direction: firstSource, expected_direction: firstDirection },
			B: { source_direction: secondSource, expected_direction: secondDirection }
		};
	});
}

function reviewerPairs(answerKey) {
	return answerKey.pairs.map((pair) => ({
		pair: pair.pair,
		A: pair.A.expected_direction,
		B: pair.B.expected_direction
	}));
}

function atlasValidation(atlas) {
	return {
		ok: true,
		errors: [],
		warnings: [],
		file: atlas,
		format: 'WEBP',
		mode: 'RGBA',
		width: 1536,
		height: 2288,
		columns: 8,
		rows: 11,
		sprite_version_number: 2,
		transparent_rgb_residue_pixels: 0,
		cells: Array.from({ length: 88 }, (_, index) => ({
			state: 'fixture',
			row: Math.floor(index / 8),
			column: index % 8,
			used: true,
			nontransparent_pixels: 1,
			opaque_chroma_key_pixels: 0,
			chroma_fringe_pixels: 0
		}))
	};
}

function continuityResult(warnings = ['review continuity transition']) {
	return {
		ok: true,
		reviewRequired: warnings.length > 0,
		medianDiffPixels: 1,
		warnings,
		alphaHoles: [],
		pairs: EXPECTED_DIRECTIONS.map(([from], index) => ({
			from,
			to: EXPECTED_DIRECTIONS[(index + 1) % EXPECTED_DIRECTIONS.length][0],
			firstPixels: 1,
			secondPixels: 1,
			diffPixels: 1,
			centerDelta: 0,
			areaRatio: 1
		}))
	};
}

function inspectionResult({ atlas, atlasSha256, pending }) {
	const validationPath = join(pending, 'ted-bot-atlas-validation.json');
	return {
		schemaVersion: 'ted-bot-pet-qa-inspection/v1',
		atlasPath: atlas,
		preAtlasSha256: atlasSha256,
		postAtlasSha256: atlasSha256,
		runtimePath: '/bundled/runtime/python',
		validatorCommand: [
			'/bundled/runtime/python',
			'/Users/kolbyunderwood/.codex/skills/hatch-pet/scripts/validate_atlas.py',
			atlas,
			'--require-v2',
			'--json-out',
			validationPath
		],
		validatorResultPath: validationPath,
		contactSheetPath: join(pending, 'ted-bot-atlas-contact-sheet.png'),
		inspector: 'fixture reviewer',
		inspectedAt: '2026-07-24T12:00:00.000Z',
		rubric: {
			identity: 'pass',
			cellAlignment: 'pass',
			directionContinuity: 'pass',
			unusedCellTransparency: 'pass'
		}
	};
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function manifestHash(payload) {
	const { manifestSha256: _ignored, ...withoutHash } = payload;
	return digest(canonical(withoutHash));
}

async function createFiles(name) {
	const dir = join(fixtureRoot, name);
	await mkdir(dir, { recursive: true });
	const atlas = join(dir, 'atlas.webp');
	const blindSheet = join(dir, 'blind.png');
	const answerKey = join(dir, 'key.json');
	await writeFile(atlas, `atlas-${name}`);
	await writePng(blindSheet);
	await writeFile(answerKey, JSON.stringify({ atlas_sha256: '', pairs: [] }));
	return { dir, atlas, blindSheet, answerKey };
}

function fakeHatchRunner(calls = []) {
	return async (_program, args) => {
		calls.push(args);
		const output = args[args.indexOf('--json-out') + 1];
	if (args[0] === 'combine') {
		const sealed = [];
		for (let index = 0; index < args.length; index += 1) {
			if (args[index] === '--verdicts') sealed.push(args[index + 1]);
		}
			const first = JSON.parse(await readFile(sealed[0], 'utf8'));
			await writeFile(output, JSON.stringify({ pairs: first.pairs }));
		} else if (args[0] === 'validate') {
			const answerKey = JSON.parse(await readFile(args[args.indexOf('--answer-key') + 1], 'utf8'));
			await writeFile(
				output,
				JSON.stringify({
					ok: true,
					errors: [],
					warnings: [],
					unconfirmed: [],
					reviewRequired: false,
					pairs: answerKey.pairs.map((pair) => ({
						pair: pair.pair,
						axis: pair.axis,
						gate: pair.gate,
						A: {
							observed: pair.A.expected_direction,
							expected: pair.A.expected_direction,
							source_direction: pair.A.source_direction,
							pass: true
						},
						B: {
							observed: pair.B.expected_direction,
							expected: pair.B.expected_direction,
							source_direction: pair.B.source_direction,
							pass: true
						}
					}))
				})
			);
		} else {
			throw new Error(`unexpected fake Hatch command ${args[0]}`);
		}
	};
}

async function setupBlind(name, { runId = `release-${name}-blind` } = {}) {
	const files = await createFiles(name);
	const atlasSha256 = await hash(files.atlas);
	await writeFile(
		files.answerKey,
		JSON.stringify({
			atlas_sha256: atlasSha256,
			schema_version: 3,
			instructions: 'Do not provide this answer key to the blind visual QA reviewer.',
			pairs: answerKeyPairs()
		})
	);
	const runsRoot = join(files.dir, 'blind-runs');
	const pending = await prepareBlindRun({
		runId,
		runsRoot,
		atlas: files.atlas,
		blindSheet: files.blindSheet,
		answerKey: files.answerKey
	});
	const manifest = JSON.parse(await readFile(join(pending, 'blind-review-manifest.json'), 'utf8'));
	const rawFiles = [];
	for (const reviewerId of ['reviewer-1', 'reviewer-2', 'reviewer-3']) {
		const raw = join(files.dir, `${reviewerId}.json`);
		await writeFile(
			raw,
			JSON.stringify({
				schemaVersion: manifest.schemaVersion,
				reviewerId,
				atlasSha256: manifest.atlasSha256,
				blindSheetSha256: manifest.blindSheetSha256,
				manifestSha256: manifest.manifestSha256,
				pairs: reviewerPairs(JSON.parse(await readFile(files.answerKey, 'utf8')))
			})
		);
		await sealReviewerSubmission({ runId, runsRoot, verdict: raw });
		rawFiles.push(raw);
	}
	return {
		...files,
		runId,
		runsRoot,
		pending,
		final: join(runsRoot, runId),
		manifest,
		rawFiles,
		atlasSha256
	};
}

async function verifyBlind(setup, calls = []) {
	return verifyAndCombine({
		python: 'fake-python',
		combineScript: 'combine',
		validateScript: 'validate',
		runId: setup.runId,
		runsRoot: setup.runsRoot,
		commandRunner: fakeHatchRunner(calls)
	});
}

async function expectNoFinal(setup, action) {
	await assert.rejects(action(), /Ted-Bot direction evidence failed|unexpected/i);
	await assert.rejects(stat(setup.final), /ENOENT/);
}

test('rejects malformed PET and blind run IDs before touching injected path or filesystem dependencies', async () => {
	const calls = [];
	const verifier = createEvidenceVerifier({
		path: new Proxy({}, { get: (_target, property) => () => calls.push(`path:${String(property)}`) }),
		fs: new Proxy({}, { get: (_target, property) => () => calls.push(`fs:${String(property)}`) })
	});
	for (const runId of ['', '.', '../escape', 'slash/value', 'space here', 'Upper']) {
		await assert.rejects(
			verifier.preparePetQaRun({ runId, runsRoot: '/unused', atlas: '/unused' }),
			/run id/i
		);
		await assert.rejects(
			verifier.prepareBlindRun({
				runId,
				runsRoot: '/unused',
				atlas: '/unused',
				blindSheet: '/unused',
				answerKey: '/unused'
			}),
			/run id/i
		);
	}
	assert.deepEqual(calls, []);
});

test('creates only a private sibling pet-QA pending directory and refuses collisions', async () => {
	const { atlas, dir } = await createFiles('outer-pending');
	const runsRoot = join(dir, 'runs');
	const pending = await preparePetQaRun({ runId: 'release-outer', runsRoot, atlas });
	assert.equal(pending, join(runsRoot, '.release-outer.pending'));
	assert.equal((await stat(pending)).mode & 0o777, 0o700);
	await assert.rejects(preparePetQaRun({ runId: 'release-outer', runsRoot, atlas }), /pending|final/i);
});

test('contains valid sibling paths before checking collisions', async () => {
	const { atlas, dir } = await createFiles('valid-id-order');
	const calls = [];
	const path = new Proxy(nodePath, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver);
			if (typeof value !== 'function') return value;
			return (...args) => {
				calls.push(`path:${String(property)}`);
				return value(...args);
			};
		}
	});
	const fs = new Proxy(nodeFs, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver);
			if (typeof value !== 'function') return value;
			return (...args) => {
				calls.push(`fs:${String(property)}`);
				return value(...args);
			};
		}
	});
	const verifier = createEvidenceVerifier({ path, fs });
	await verifier.preparePetQaRun({ runId: 'release-order', runsRoot: join(dir, 'runs'), atlas });
	const firstCollisionCheck = calls.indexOf('fs:access');
	const containmentChecks = calls
		.map((call, index) => (call === 'path:relative' ? index : -1))
		.filter((index) => index >= 0);
	assert.equal(containmentChecks.length, 2);
	assert.ok(containmentChecks.every((index) => index < firstCollisionCheck));
});

test('requires a complete Hatch blind key and PNG review sheet before creating a blind run', async () => {
	const files = await createFiles('blind-input-contract');
	const atlasSha256 = await hash(files.atlas);
	await writeFile(
		files.answerKey,
		JSON.stringify({
			schema_version: 3,
			atlas_sha256: atlasSha256,
			instructions: 'Do not provide this answer key to the blind visual QA reviewer.',
			pairs: []
		})
	);
	await assert.rejects(
		prepareBlindRun({
			runId: 'release-incomplete-key',
			runsRoot: join(files.dir, 'blind-runs'),
			atlas: files.atlas,
			blindSheet: files.blindSheet,
			answerKey: files.answerKey
		}),
		/Ted-Bot direction evidence failed/i
	);
	await writeFile(
		files.answerKey,
		JSON.stringify({
			schema_version: 3,
			atlas_sha256: atlasSha256,
			instructions: 'Do not provide this answer key to the blind visual QA reviewer.',
			pairs: answerKeyPairs()
		})
	);
	await writeFile(files.blindSheet, 'not-a-png');
	await assert.rejects(
		prepareBlindRun({
			runId: 'release-not-png',
			runsRoot: join(files.dir, 'blind-runs'),
			atlas: files.atlas,
			blindSheet: files.blindSheet,
			answerKey: files.answerKey
		}),
		/Ted-Bot direction evidence failed/i
	);
});

test('redacts the blind package and seals reviewer submissions against later raw changes', async () => {
	const setup = await setupBlind('seal');
	await stat(join(setup.pending, 'blind-sheet.png'));
	await assert.rejects(stat(join(setup.pending, 'key.json')), /ENOENT/);
	const sealed = join(setup.pending, 'sealed-reviewer-reviewer-1.json');
	const before = await readFile(sealed, 'utf8');
	await writeFile(setup.rawFiles[0], '{"changed":true}');
	assert.equal(await readFile(sealed, 'utf8'), before);
	assert.equal((await stat(sealed)).mode & 0o777, 0o600);
});

test('combines only sealed submissions and validates through the injected Hatch runner', async () => {
	const setup = await setupBlind('sealed-flow');
	await writeFile(setup.rawFiles[0], '{"changed":true}');
	const calls = [];
	const final = await verifyBlind(setup, calls);
	assert.equal(final, setup.final);
	assert.equal(calls.length, 2);
	const combinePaths = calls[0].filter((value, index) => calls[0][index - 1] === '--verdicts');
	assert.equal(combinePaths.length, 3);
	assert.ok(combinePaths.every((value) => String(value).includes('sealed-reviewer-')));
	assert.ok(combinePaths.every((value) => !setup.rawFiles.includes(value)));
	assert.equal(calls[1][calls[1].indexOf('--answer-key') + 1], setup.answerKey);
	await assert.rejects(stat(setup.pending), /ENOENT/);
});

test('rejects every changed blind input or sealed receipt before producing a blind final run', async () => {
	const cases = [
		['atlas', async (s) => writeFile(s.atlas, 'changed-atlas')],
		['blind-sheet', async (s) => writeFile(join(s.pending, 'blind-sheet.png'), 'changed-sheet')],
		['answer-key', async (s) => writeFile(s.answerKey, '{"atlas_sha256":"changed","pairs":[]}')],
		['manifest', async (s) => writeFile(join(s.pending, 'blind-review-manifest.json'), '{}')],
		['sealed-verdict', async (s) => writeFile(join(s.pending, 'sealed-reviewer-reviewer-1.json'), '{}')],
		['sealed-receipt', async (s) => writeFile(join(s.pending, 'sealed-reviewer-reviewer-1.receipt.json'), '{}')]
	];
	for (const [name, mutate] of cases) {
		const setup = await setupBlind(`mutate-${name}`);
		await mutate(setup);
		await expectNoFinal(setup, () => verifyBlind(setup));
	}
});

test('rejects missing or duplicate sealed reviewer submissions', async () => {
	const missing = await setupBlind('missing-submission');
	await rm(join(missing.pending, 'sealed-reviewer-reviewer-3.receipt.json'));
	await expectNoFinal(missing, () => verifyBlind(missing));

	const duplicate = await setupBlind('duplicate-submission');
	const receipt = JSON.parse(
		await readFile(join(duplicate.pending, 'sealed-reviewer-reviewer-2.receipt.json'), 'utf8')
	);
	receipt.reviewerId = 'reviewer-1';
	await writeFile(join(duplicate.pending, 'sealed-reviewer-reviewer-2.receipt.json'), JSON.stringify(receipt));
	await expectNoFinal(duplicate, () => verifyBlind(duplicate));
});

test('rejects an answer-key atlas mismatch even when its manifest and sealed attestations are freshly consistent', async () => {
	const setup = await setupBlind('semantic-key-mismatch');
	const key = JSON.parse(await readFile(setup.answerKey, 'utf8'));
	key.atlas_sha256 = '0'.repeat(64);
	await writeFile(setup.answerKey, JSON.stringify(key));
	const manifestPath = join(setup.pending, 'blind-review-manifest.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	manifest.answerKeySha256 = await hash(setup.answerKey);
	manifest.manifestSha256 = manifestHash(manifest);
	await writeFile(manifestPath, JSON.stringify(manifest));
	for (const reviewerId of ['reviewer-1', 'reviewer-2', 'reviewer-3']) {
		const sealedPath = join(setup.pending, `sealed-reviewer-${reviewerId}.json`);
		const receiptPath = join(setup.pending, `sealed-reviewer-${reviewerId}.receipt.json`);
		const verdict = JSON.parse(await readFile(sealedPath, 'utf8'));
		verdict.manifestSha256 = manifest.manifestSha256;
		await writeFile(sealedPath, JSON.stringify(verdict));
		const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
		receipt.manifestSha256 = manifest.manifestSha256;
		receipt.sourceSha256 = await hash(sealedPath);
		receipt.sealedSha256 = await hash(sealedPath);
		await writeFile(receiptPath, JSON.stringify(receipt));
	}
	await expectNoFinal(setup, () => verifyBlind(setup));
});

function semanticDirections() {
	return EXPECTED_DIRECTIONS.map(([id, expected]) => {
		const diagonal = !['000', '090', '180', '270'].includes(id);
		return {
			id,
			expected,
			observed: expected,
			verdict: 'pass',
			reason: 'Reviewed against the labelled direction sheet.',
			...(diagonal
				? {
						landmarks: {
							horizontal: 'The muzzle and ear placement show the horizontal turn.',
							vertical: 'The nose and forehead placement show the vertical turn.'
						}
					}
				: {})
		};
	});
}

async function setupOuter(name, { runId = `release-${name}`, seal = true } = {}) {
	const files = await createFiles(`outer-${name}`);
	const runsRoot = join(files.dir, 'pet-qa-runs');
	const pending = await preparePetQaRun({ runId, runsRoot, atlas: files.atlas });
	const atlasSha256 = await hash(files.atlas);
	const outerBlindSheet = join(pending, 'ted-bot-direction-blind-sheet.png');
	const outerAnswerKey = join(pending, 'ted-bot-direction-blind-answer-key.json');
	await writePng(outerBlindSheet);
	await writeFile(
		outerAnswerKey,
		JSON.stringify({
			atlas_sha256: atlasSha256,
			schema_version: 3,
			instructions: 'Do not provide this answer key to the blind visual QA reviewer.',
			pairs: answerKeyPairs()
		})
	);
	await writeFile(
		join(pending, 'ted-bot-atlas-validation.json'),
		JSON.stringify(atlasValidation(files.atlas))
	);
	await writeFile(
		join(pending, 'ted-bot-pet-qa-inspection.json'),
		JSON.stringify(inspectionResult({ atlas: files.atlas, atlasSha256, pending }))
	);
	await writePng(join(pending, 'ted-bot-atlas-contact-sheet.png'));
	await writePng(join(pending, 'ted-bot-direction-qa-sheet.png'));
	await writeFile(
		join(pending, 'ted-bot-direction-continuity.json'),
		JSON.stringify(continuityResult())
	);
	await writeFile(
		join(pending, 'ted-bot-direction-semantics.json'),
		JSON.stringify({
			atlas_sha256: atlasSha256,
			directions: semanticDirections(),
			warningAssessments: [
				{ warning: 'review continuity transition', reason: 'Reviewed in the direction QA sheet.' }
			]
		})
	);

	const blindRunId = `${runId}-blind`;
	const blindRunsRoot = join(pending, 'blind-runs');
	const blindPending = await prepareBlindRun({
		runId: blindRunId,
		runsRoot: blindRunsRoot,
		atlas: files.atlas,
		blindSheet: outerBlindSheet,
		answerKey: outerAnswerKey
	});
	const manifest = JSON.parse(await readFile(join(blindPending, 'blind-review-manifest.json'), 'utf8'));
	for (const reviewerId of ['reviewer-1', 'reviewer-2', 'reviewer-3']) {
		const raw = join(files.dir, `${runId}-${reviewerId}.json`);
		await writeFile(
			raw,
			JSON.stringify({
				schemaVersion: manifest.schemaVersion,
				reviewerId,
				atlasSha256: manifest.atlasSha256,
				blindSheetSha256: manifest.blindSheetSha256,
				manifestSha256: manifest.manifestSha256,
				pairs: reviewerPairs(JSON.parse(await readFile(outerAnswerKey, 'utf8')))
			})
		);
		await sealReviewerSubmission({ runId: blindRunId, runsRoot: blindRunsRoot, verdict: raw });
	}
	await verifyAndCombine({
		python: 'fake-python',
		combineScript: 'combine',
		validateScript: 'validate',
		runId: blindRunId,
		runsRoot: blindRunsRoot,
		commandRunner: fakeHatchRunner()
	});
	if (seal) await sealPetQaArtifacts({ runId, runsRoot, atlas: files.atlas });
	return {
		...files,
		runId,
		runsRoot,
		pending,
		final: join(runsRoot, runId),
		blindRunId,
		blindFinal: join(blindRunsRoot, blindRunId),
		atlasSha256
	};
}

test('publishes only a sealed complete outer pet-QA bundle', async () => {
	const setup = await setupOuter('publish');
	const final = await publishPetQaRun({ runId: setup.runId, runsRoot: setup.runsRoot, atlas: setup.atlas });
	assert.equal(final, setup.final);
	const metadata = JSON.parse(await readFile(join(final, 'ted-bot-pet-qa-run.json'), 'utf8'));
	assert.equal(metadata.runId, setup.runId);
	assert.equal(metadata.atlasSha256, setup.atlasSha256);
	assert.ok(Object.keys(metadata.artifactSha256).length >= 10);
	await assert.rejects(preparePetQaRun({ runId: setup.runId, runsRoot: setup.runsRoot, atlas: setup.atlas }), /final/i);
});

test('rejects incomplete Hatch output contracts and diagonal evidence before sealing', async () => {
	const atlas = await setupOuter('sparse-atlas', { seal: false });
	const atlasFile = join(atlas.pending, 'ted-bot-atlas-validation.json');
	const atlasValue = JSON.parse(await readFile(atlasFile, 'utf8'));
	delete atlasValue.transparent_rgb_residue_pixels;
	await writeFile(atlasFile, JSON.stringify(atlasValue));
	await assert.rejects(
		sealPetQaArtifacts({ runId: atlas.runId, runsRoot: atlas.runsRoot, atlas: atlas.atlas }),
		/Ted-Bot direction evidence failed/i
	);

	const continuity = await setupOuter('sparse-continuity', { seal: false });
	const continuityFile = join(continuity.pending, 'ted-bot-direction-continuity.json');
	const continuityValue = JSON.parse(await readFile(continuityFile, 'utf8'));
	delete continuityValue.alphaHoles;
	await writeFile(continuityFile, JSON.stringify(continuityValue));
	await assert.rejects(
		sealPetQaArtifacts({ runId: continuity.runId, runsRoot: continuity.runsRoot, atlas: continuity.atlas }),
		/Ted-Bot direction evidence failed/i
	);

	const diagonal = await setupOuter('sparse-diagonal', { seal: false });
	const semanticsFile = join(diagonal.pending, 'ted-bot-direction-semantics.json');
	const semanticsValue = JSON.parse(await readFile(semanticsFile, 'utf8'));
	delete semanticsValue.directions.find((entry) => entry.id === '045').landmarks;
	await writeFile(semanticsFile, JSON.stringify(semanticsValue));
	await assert.rejects(
		sealPetQaArtifacts({ runId: diagonal.runId, runsRoot: diagonal.runsRoot, atlas: diagonal.atlas }),
		/Ted-Bot direction evidence failed/i
	);

	const inspection = await setupOuter('sparse-inspection', { seal: false });
	const inspectionFile = join(inspection.pending, 'ted-bot-pet-qa-inspection.json');
	const inspectionValue = JSON.parse(await readFile(inspectionFile, 'utf8'));
	inspectionValue.rubric.identity = 'fail';
	await writeFile(inspectionFile, JSON.stringify(inspectionValue));
	await assert.rejects(
		sealPetQaArtifacts({ runId: inspection.runId, runsRoot: inspection.runsRoot, atlas: inspection.atlas }),
		/Ted-Bot direction evidence failed/i
	);

	const linkage = await setupOuter('wrong-blind-linkage', { seal: false });
	const contextFile = join(linkage.blindFinal, 'blind-run-context.json');
	const context = JSON.parse(await readFile(contextFile, 'utf8'));
	context.runId = 'different-valid-run';
	await writeFile(contextFile, JSON.stringify(context));
	await assert.rejects(
		sealPetQaArtifacts({ runId: linkage.runId, runsRoot: linkage.runsRoot, atlas: linkage.atlas }),
		/Ted-Bot direction evidence failed/i
	);
});

test('rejects mutated outer artifacts and blind linkage without publishing the current run', async () => {
	const cases = [
		['contact-sheet', async (s) => writeFile(join(s.pending, 'ted-bot-atlas-contact-sheet.png'), 'changed')],
		['direction-sheet', async (s) => writeFile(join(s.pending, 'ted-bot-direction-qa-sheet.png'), 'changed')],
		['atlas-validation', async (s) => writeFile(join(s.pending, 'ted-bot-atlas-validation.json'), '{"ok":false}')],
		['continuity', async (s) => writeFile(join(s.pending, 'ted-bot-direction-continuity.json'), '{"ok":true,"warnings":[]}')],
		['outer-blind-sheet', async (s) => writeFile(join(s.pending, 'ted-bot-direction-blind-sheet.png'), 'changed')],
		['outer-answer-key', async (s) => writeFile(join(s.pending, 'ted-bot-direction-blind-answer-key.json'), '{"atlas_sha256":"changed","pairs":[]}')],
		['semantics-direction', async (s) => {
			const file = join(s.pending, 'ted-bot-direction-semantics.json');
			const value = JSON.parse(await readFile(file, 'utf8'));
			value.directions[0].expected = 'wrong';
			await writeFile(file, JSON.stringify(value));
		}],
		['missing-warning-assessment', async (s) => {
			const file = join(s.pending, 'ted-bot-direction-semantics.json');
			const value = JSON.parse(await readFile(file, 'utf8'));
			value.warningAssessments = [];
			await writeFile(file, JSON.stringify(value));
		}],
		['blind-envelope', async (s) => writeFile(join(s.blindFinal, 'ted-bot-direction-blind-consensus-envelope.json'), '{}')],
		['blind-consensus', async (s) => writeFile(join(s.blindFinal, 'ted-bot-direction-blind-consensus.json'), '{}')],
		['blind-validation', async (s) => writeFile(join(s.blindFinal, 'ted-bot-direction-blind-validation.json'), '{"ok":false}')],
		['blind-receipt', async (s) => writeFile(join(s.blindFinal, 'sealed-reviewer-reviewer-1.receipt.json'), '{}')],
		['artifact-manifest', async (s) => writeFile(join(s.pending, 'ted-bot-pet-qa-artifact-manifest.json'), '{}')]
	];
	for (const [name, mutate] of cases) {
		const setup = await setupOuter(`outer-mutate-${name}`);
		await mutate(setup);
		await assert.rejects(
			publishPetQaRun({ runId: setup.runId, runsRoot: setup.runsRoot, atlas: setup.atlas }),
			/Ted-Bot direction evidence failed/i
		);
		await assert.rejects(stat(setup.final), /ENOENT/);
	}
});

test('does not let a failed current run replace a prior published run', async () => {
	const prior = await setupOuter('prior', { runId: 'release-prior' });
	await publishPetQaRun({ runId: prior.runId, runsRoot: prior.runsRoot, atlas: prior.atlas });
	const current = await setupOuter('current', { runId: 'release-current' });
	await writeFile(join(current.pending, 'ted-bot-atlas-contact-sheet.png'), 'changed');
	await assert.rejects(
		publishPetQaRun({ runId: current.runId, runsRoot: current.runsRoot, atlas: current.atlas }),
		/Ted-Bot direction evidence failed/i
	);
	await stat(prior.final);
	await assert.rejects(stat(current.final), /ENOENT/);
});
