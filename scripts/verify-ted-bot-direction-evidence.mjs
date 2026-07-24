#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
	await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
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

export async function verifyAndCombine({
	python,
	combineScript,
	validateScript,
	runId,
	runsRoot,
	verdicts
}) {
	const paths = runPaths(runId, runsRoot);
	if (!(await exists(paths.pending)) || (await exists(paths.final)))
		fail('blind pending run must exist without a final run');
	if (!Array.isArray(verdicts) || verdicts.length !== 3)
		fail('exactly three reviewer verdicts are required');
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
		for (let index = 0; index < verdicts.length; index += 1) {
			const source = path.resolve(verdicts[index]);
			const raw = await readFile(source);
			const verdict = verifiedVerdict(JSON.parse(raw), manifest, answerKey);
			if (reviewerIds.has(verdict.reviewerId)) fail('reviewer IDs must be unique');
			reviewerIds.add(verdict.reviewerId);
			const sealed = path.join(paths.pending, `sealed-reviewer-${index + 1}.json`);
			await writeFile(sealed, raw, { mode: 0o600 });
			reviewers.push({
				sourceSha256: createHash('sha256').update(raw).digest('hex'),
				sealed,
				sealedSha256: await sha256(sealed)
			});
		}
		const consensus = path.join(paths.pending, 'ted-bot-direction-blind-consensus.json');
		await command(python, [
			combineScript,
			...reviewers.flatMap(({ sealed }) => ['--verdicts', sealed]),
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
			sourceVerdicts: reviewers,
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
	if (metadata.atlasSha256 !== (await sha256(atlasPath)))
		fail('atlas changed after pet-QA preparation');
	for (const artifact of [
		'ted-bot-atlas-validation.json',
		'ted-bot-atlas-contact-sheet.png',
		'ted-bot-direction-qa-sheet.png',
		'ted-bot-direction-continuity.json',
		'ted-bot-direction-semantics.json'
	]) {
		if (!(await exists(path.join(paths.pending, artifact))))
			fail(`required pet-QA artifact is missing: ${artifact}`);
	}
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
		else if (operation === 'verify-and-combine')
			result = await verifyAndCombine({
				...options,
				verdicts: options.verdict
					? Array.isArray(options.verdict)
						? options.verdict
						: [options.verdict]
					: []
			});
		else if (operation === 'publish-pet-qa-run') result = await publishPetQaRun(options);
		else
			fail(
				'operation must be prepare-pet-qa-run, prepare-blind-run, verify-and-combine, or publish-pet-qa-run'
			);
		console.log(result);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
