#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
	access,
	copyFile,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const RUN_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SCHEMA_VERSION = 'ted-bot-direction-blind-review/v1';

function fail(message) {
	throw new Error(`Ted-Bot direction evidence failed: ${message}`);
}

function assertRunId(runId) {
	if (typeof runId !== 'string' || !RUN_ID.test(runId))
		fail('run id must match ^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$');
}

function contained(root, target) {
	const relative = path.relative(root, target);
	return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function runPaths(runId, runsRoot) {
	assertRunId(runId);
	const root = path.resolve(runsRoot);
	const pending = path.join(root, `.${runId}.pending`);
	const final = path.join(root, runId);
	if (!contained(root, pending) || !contained(root, final))
		fail('run paths escape the configured runs root');
	return { root, pending, final };
}

async function exists(file) {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

async function sha256(file) {
	return createHash('sha256')
		.update(await readFile(file))
		.digest('hex');
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

function selfHash(payload) {
	const { manifestSha256: _ignored, ...withoutHash } = payload;
	return createHash('sha256').update(canonical(withoutHash)).digest('hex');
}

async function createPending(paths) {
	await mkdir(paths.root, { recursive: true });
	if (await exists(paths.final)) fail(`final run already exists: ${path.basename(paths.final)}`);
	if (await exists(paths.pending))
		fail(`pending run already exists: ${path.basename(paths.pending)}`);
	await mkdir(paths.pending, { mode: 0o700 });
	await stat(paths.pending);
	return paths.pending;
}

async function readJson(file, label) {
	try {
		return JSON.parse(await readFile(file, 'utf8'));
	} catch (error) {
		fail(`${label} is not readable JSON: ${error.message}`);
	}
}

async function writeJson(file, value, mode = 0o600) {
	const temporary = `${file}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
	await rename(temporary, file);
}

export async function preparePetQaRun({ runId, runsRoot, atlas }) {
	const paths = runPaths(runId, runsRoot);
	const atlasPath = path.resolve(atlas);
	if (!(await exists(atlasPath))) fail('atlas does not exist');
	const pending = await createPending(paths);
	try {
		await writeJson(path.join(pending, 'ted-bot-pet-qa-run.json'), {
			schemaVersion: SCHEMA_VERSION,
			runId,
			atlasPath,
			atlasSha256: await sha256(atlasPath)
		});
		return pending;
	} catch (error) {
		await rm(pending, { recursive: true, force: true });
		throw error;
	}
}

export async function prepareBlindRun({ runId, runsRoot, atlas, blindSheet, answerKey }) {
	const paths = runPaths(runId, runsRoot);
	const atlasPath = path.resolve(atlas);
	const blindSheetPath = path.resolve(blindSheet);
	const answerKeyPath = path.resolve(answerKey);
	for (const [label, file] of [
		['atlas', atlasPath],
		['blind sheet', blindSheetPath],
		['answer key', answerKeyPath]
	]) {
		if (!(await exists(file))) fail(`${label} does not exist`);
	}
	const pending = await createPending(paths);
	try {
		const payload = {
			schemaVersion: SCHEMA_VERSION,
			atlasSha256: await sha256(atlasPath),
			blindSheetSha256: await sha256(blindSheetPath),
			answerKeySha256: await sha256(answerKeyPath)
		};
		const key = await readJson(answerKeyPath, 'answer key');
		if (key.atlas_sha256 !== payload.atlasSha256)
			fail('answer key atlas_sha256 does not name the exact atlas');
		payload.manifestSha256 = selfHash(payload);
		await copyFile(blindSheetPath, path.join(pending, 'blind-sheet.png'));
		await writeJson(path.join(pending, 'blind-review-manifest.json'), payload);
		await writeJson(path.join(pending, 'blind-run-context.json'), { atlasPath, answerKeyPath });
		return pending;
	} catch (error) {
		await rm(pending, { recursive: true, force: true });
		throw error;
	}
}

function command(program, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, { stdio: 'pipe' });
		let stderr = '';
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0
				? resolve()
				: reject(new Error(`${path.basename(program)} exited ${code}: ${stderr.trim()}`))
		);
	});
}

function verifiedVerdict(value, manifest, answerKey) {
	if (
		!value ||
		typeof value !== 'object' ||
		value.schemaVersion !== SCHEMA_VERSION ||
		typeof value.reviewerId !== 'string' ||
		!value.reviewerId
	) {
		fail('reviewer verdict has an invalid schema version or reviewerId');
	}
	for (const key of ['atlasSha256', 'blindSheetSha256', 'manifestSha256']) {
		if (value[key] !== manifest[key])
			fail(`reviewer verdict ${key} does not attest to the blind review manifest`);
	}
	if (!Array.isArray(value.pairs) || value.pairs.length !== answerKey.pairs?.length)
		fail('reviewer verdict does not contain complete pair votes');
	const expectedPairs = new Set(answerKey.pairs.map((pair) => pair.pair));
	const seen = new Set();
	for (const pair of value.pairs) {
		if (
			!pair ||
			!expectedPairs.has(pair.pair) ||
			seen.has(pair.pair) ||
			typeof pair.A !== 'string' ||
			typeof pair.B !== 'string'
		) {
			fail('reviewer verdict contains malformed pair votes');
		}
		seen.add(pair.pair);
	}
	return value;
}

export async function sealReviewerSubmission({ runId, runsRoot, verdict }) {
	const paths = runPaths(runId, runsRoot);
	if (!(await exists(paths.pending)) || (await exists(paths.final)))
		fail('blind pending run must exist without a final run');
	const source = path.resolve(verdict);
	const manifest = await readJson(
		path.join(paths.pending, 'blind-review-manifest.json'),
		'blind review manifest'
	);
	const context = await readJson(
		path.join(paths.pending, 'blind-run-context.json'),
		'private blind run context'
	);
	if (manifest.manifestSha256 !== selfHash(manifest))
		fail('blind review manifest self hash does not verify');
	const answerKey = await readJson(path.resolve(context.answerKeyPath), 'answer key');
	const raw = await readFile(source);
	const parsed = verifiedVerdict(JSON.parse(raw), manifest, answerKey);
	const safeReviewerId = parsed.reviewerId.replace(/[^a-zA-Z0-9_-]/g, '_');
	const sealed = path.join(paths.pending, `sealed-reviewer-${safeReviewerId}.json`);
	const receiptPath = path.join(paths.pending, `sealed-reviewer-${safeReviewerId}.receipt.json`);
	if ((await exists(sealed)) || (await exists(receiptPath)))
		fail(`reviewer submission already sealed: ${parsed.reviewerId}`);
	const sourceSha256 = createHash('sha256').update(raw).digest('hex');
	const temporary = `${sealed}.${process.pid}.tmp`;
	try {
		await writeFile(temporary, raw, { mode: 0o600 });
		await rename(temporary, sealed);
		const sealedSha256 = await sha256(sealed);
		await writeJson(receiptPath, {
			schemaVersion: SCHEMA_VERSION,
			reviewerId: parsed.reviewerId,
			atlasSha256: manifest.atlasSha256,
			blindSheetSha256: manifest.blindSheetSha256,
			manifestSha256: manifest.manifestSha256,
			sourceSha256,
			sealedSha256
		});
		return { sealed, receipt: receiptPath };
	} catch (error) {
		await rm(temporary, { force: true });
		await rm(sealed, { force: true });
		await rm(receiptPath, { force: true });
		throw error;
	}
}

export async function verifyAndCombine({ python, combineScript, validateScript, runId, runsRoot }) {
	const paths = runPaths(runId, runsRoot);
	if (!(await exists(paths.pending)) || (await exists(paths.final)))
		fail('blind pending run must exist without a final run');
	try {
		const manifestPath = path.join(paths.pending, 'blind-review-manifest.json');
		const context = await readJson(
			path.join(paths.pending, 'blind-run-context.json'),
			'private blind run context'
		);
		const atlasPath = path.resolve(context.atlasPath);
		const keyPath = path.resolve(context.answerKeyPath);
		if (!(await exists(atlasPath))) fail('the exact atlas recorded for the blind run is missing');
		const manifest = await readJson(manifestPath, 'blind review manifest');
		if (manifest.manifestSha256 !== selfHash(manifest))
			fail('blind review manifest self hash does not verify');
		const blindSheetPath = path.join(paths.pending, 'blind-sheet.png');
		if (
			manifest.atlasSha256 !== (await sha256(atlasPath)) ||
			manifest.blindSheetSha256 !== (await sha256(blindSheetPath))
		)
			fail('atlas or blind sheet has changed');
		if (!(await exists(keyPath))) fail('private answer key is missing from the outer pending run');
		if (manifest.answerKeySha256 !== (await sha256(keyPath))) fail('answer key has changed');
		const answerKey = await readJson(keyPath, 'answer key');
		if (answerKey.atlas_sha256 !== (await sha256(atlasPath)))
			fail('answer key atlas_sha256 does not name the exact atlas');
		const reviewers = [];
		const reviewerIds = new Set();
		const submissions = (await readdir(paths.pending)).filter(
			(name) => name.startsWith('sealed-reviewer-') && name.endsWith('.receipt.json')
		);
		if (submissions.length !== 3) fail('exactly three sealed reviewer receipts are required');
		for (const receiptName of submissions.sort()) {
			const receiptPath = path.join(paths.pending, receiptName);
			const receipt = await readJson(receiptPath, 'sealed reviewer receipt');
			const sealed = path.join(paths.pending, receiptName.replace(/\.receipt\.json$/, '.json'));
			if (!(await exists(sealed))) fail('sealed reviewer receipt has no sealed verdict');
			const raw = await readFile(sealed);
			const verdict = verifiedVerdict(JSON.parse(raw), manifest, answerKey);
			if (
				receipt.schemaVersion !== SCHEMA_VERSION ||
				receipt.reviewerId !== verdict.reviewerId ||
				receipt.sealedSha256 !== (await sha256(sealed)) ||
				receipt.sourceSha256 !== createHash('sha256').update(raw).digest('hex') ||
				receipt.atlasSha256 !== manifest.atlasSha256 ||
				receipt.blindSheetSha256 !== manifest.blindSheetSha256 ||
				receipt.manifestSha256 !== manifest.manifestSha256
			)
				fail('sealed reviewer verdict or receipt does not verify');
			if (reviewerIds.has(verdict.reviewerId)) fail('reviewer IDs must be unique');
			reviewerIds.add(verdict.reviewerId);
			reviewers.push({
				reviewerId: verdict.reviewerId,
				receiptFile: path.basename(receiptPath),
				receiptSha256: await sha256(receiptPath),
				sourceSha256: receipt.sourceSha256,
				sealedFile: path.basename(sealed),
				sealedPath: sealed,
				sealedSha256: await sha256(sealed)
			});
		}
		const consensus = path.join(paths.pending, 'ted-bot-direction-blind-consensus.json');
		await command(python, [
			combineScript,
			...reviewers.flatMap(({ sealedPath }) => ['--verdicts', sealedPath]),
			'--json-out',
			consensus
		]);
		const consensusSha256 = await sha256(consensus);
		const validation = path.join(paths.pending, 'ted-bot-direction-blind-validation.json');
		await command(python, [
			validateScript,
			'--answer-key',
			keyPath,
			'--verdicts',
			consensus,
			'--json-out',
			validation
		]);
		const envelope = {
			schemaVersion: SCHEMA_VERSION,
			atlasSha256: await sha256(atlasPath),
			blindSheetSha256: await sha256(blindSheetPath),
			answerKeySha256: await sha256(keyPath),
			manifestSha256: manifest.manifestSha256,
			sourceVerdicts: reviewers.map(({ sealedPath: _sealedPath, ...reviewer }) => reviewer),
			plainConsensusSha256: consensusSha256,
			hatchValidationSha256: await sha256(validation)
		};
		await writeJson(
			path.join(paths.pending, 'ted-bot-direction-blind-consensus-envelope.json'),
			envelope
		);
		await rename(paths.pending, paths.final);
		return paths.final;
	} catch (error) {
		await rm(paths.pending, { recursive: true, force: true });
		throw error;
	}
}

export async function publishPetQaRun({ runId, runsRoot, atlas }) {
	const paths = runPaths(runId, runsRoot);
	const atlasPath = path.resolve(atlas);
	if (!(await exists(paths.pending)) || (await exists(paths.final)))
		fail('pet-QA pending run must exist without a final run');
	const metadataPath = path.join(paths.pending, 'ted-bot-pet-qa-run.json');
	const metadata = await readJson(metadataPath, 'pet-QA run metadata');
	const atlasSha256 = await sha256(atlasPath);
	if (
		metadata.runId !== runId ||
		metadata.atlasPath !== atlasPath ||
		metadata.atlasSha256 !== atlasSha256
	)
		fail('atlas changed after pet-QA preparation');
	const artifactPaths = Object.fromEntries(
		[
			'ted-bot-atlas-validation.json',
			'ted-bot-atlas-contact-sheet.png',
			'ted-bot-direction-qa-sheet.png',
			'ted-bot-direction-continuity.json',
			'ted-bot-direction-semantics.json'
		].map((artifact) => [artifact, path.join(paths.pending, artifact)])
	);
	for (const [artifact, artifactPath] of Object.entries(artifactPaths)) {
		if (!(await exists(artifactPath))) fail(`required pet-QA artifact is missing: ${artifact}`);
	}
	const atlasValidation = await readJson(
		artifactPaths['ted-bot-atlas-validation.json'],
		'atlas validation'
	);
	if (
		atlasValidation.ok !== true ||
		atlasValidation.width !== 1536 ||
		atlasValidation.height !== 2288 ||
		atlasValidation.columns !== 8 ||
		atlasValidation.rows !== 11 ||
		atlasValidation.sprite_version_number !== 2
	)
		fail('atlas validation does not attest to the required Codex v2 atlas');
	const continuity = await readJson(
		artifactPaths['ted-bot-direction-continuity.json'],
		'direction continuity'
	);
	if (continuity.ok !== true || !Array.isArray(continuity.warnings))
		fail('direction continuity result is invalid');
	const semantics = await readJson(
		artifactPaths['ted-bot-direction-semantics.json'],
		'direction semantics'
	);
	const directions = semantics.directions;
	if (
		semantics.atlas_sha256 !== atlasSha256 ||
		!Array.isArray(directions) ||
		directions.length !== 16 ||
		new Set(directions.map((entry) => entry.id)).size !== 16
	)
		fail('direction semantics do not attest to all 16 atlas directions');
	for (const entry of directions) {
		if (
			!entry ||
			typeof entry.expected !== 'string' ||
			typeof entry.observed !== 'string' ||
			typeof entry.verdict !== 'string' ||
			typeof entry.reason !== 'string' ||
			entry.verdict === 'fail'
		)
			fail('direction semantics has an invalid or failed direction verdict');
	}
	const assessments = semantics.warningAssessments;
	if (!Array.isArray(assessments) || assessments.length !== continuity.warnings.length)
		fail('every continuity warning requires a semantic assessment');
	for (const warning of continuity.warnings) {
		if (!assessments.some((entry) => entry.warning === warning && typeof entry.reason === 'string'))
			fail('a continuity warning has no semantic assessment');
	}
	const blindRunsRoot = path.join(paths.pending, 'blind-runs');
	const blindRuns = (await exists(blindRunsRoot)) ? await readdir(blindRunsRoot) : [];
	if (blindRuns.length !== 1 || blindRuns[0].startsWith('.'))
		fail('exactly one published blind run is required');
	const blindDir = path.join(blindRunsRoot, blindRuns[0]);
	const envelope = await readJson(
		path.join(blindDir, 'ted-bot-direction-blind-consensus-envelope.json'),
		'blind envelope'
	);
	const blindValidation = await readJson(
		path.join(blindDir, 'ted-bot-direction-blind-validation.json'),
		'blind validation'
	);
	if (
		envelope.atlasSha256 !== atlasSha256 ||
		!Array.isArray(envelope.sourceVerdicts) ||
		envelope.sourceVerdicts.length !== 3 ||
		blindValidation.ok !== true
	)
		fail('published blind evidence does not verify against this atlas');
	for (const reviewer of envelope.sourceVerdicts) {
		if (
			!(await exists(path.join(blindDir, reviewer.sealedFile))) ||
			!(await exists(path.join(blindDir, reviewer.receiptFile))) ||
			reviewer.sealedSha256 !== (await sha256(path.join(blindDir, reviewer.sealedFile))) ||
			reviewer.receiptSha256 !== (await sha256(path.join(blindDir, reviewer.receiptFile)))
		)
			fail('published blind evidence has a changed sealed reviewer submission');
	}
	metadata.blindRunId = blindRuns[0];
	metadata.artifactSha256 = Object.fromEntries(
		await Promise.all(
			Object.entries(artifactPaths).map(async ([name, artifactPath]) => [
				name,
				await sha256(artifactPath)
			])
		)
	);
	await writeJson(metadataPath, metadata);
	await rename(paths.pending, paths.final);
	return paths.final;
}

function parseOptions(args) {
	const values = {};
	for (let index = 0; index < args.length; index += 2) {
		if (!args[index]?.startsWith('--') || args[index + 1] === undefined)
			fail('arguments must be --key value pairs');
		const key = args[index].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
		(values[key] ??= []).push(args[index + 1]);
	}
	return Object.fromEntries(
		Object.entries(values).map(([key, value]) => [key, value.length === 1 ? value[0] : value])
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const [operation, ...args] = process.argv.slice(2);
		const options = parseOptions(args);
		let result;
		if (operation === 'prepare-pet-qa-run') result = await preparePetQaRun(options);
		else if (operation === 'prepare-blind-run') result = await prepareBlindRun(options);
		else if (operation === 'seal-reviewer-submission')
			result = await sealReviewerSubmission(options);
		else if (operation === 'verify-and-combine') result = await verifyAndCombine(options);
		else if (operation === 'publish-pet-qa-run') result = await publishPetQaRun(options);
		else
			fail(
				'operation must be prepare-pet-qa-run, prepare-blind-run, seal-reviewer-submission, verify-and-combine, or publish-pet-qa-run'
			);
		console.log(result);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
