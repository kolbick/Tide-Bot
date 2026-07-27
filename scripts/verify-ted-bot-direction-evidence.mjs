#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const RUN_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SCHEMA_VERSION = 'ted-bot-direction-blind-review/v1';
const PET_QA_INSPECTION_SCHEMA_VERSION = 'ted-bot-pet-qa-inspection/v1';
const HATCH_RUNTIME_ATTESTATION_SCHEMA_VERSION = 'ted-bot-hatch-runtime-attestation/v1';

// This is the reviewed Hatch Pet release surface used by the Ted-Bot package.
// Pinning it means a release cannot quietly substitute look/atlas/consensus
// scripts from an arbitrary local directory. Updating Hatch Pet deliberately
// requires reviewing and changing this policy in the Tide-Bot repository.
export const HATCH_PET_RELEASE_POLICY_V1 = Object.freeze({
	skill: Object.freeze({
		relativePath: 'SKILL.md',
		sha256: 'ccfabd5d761faa721586f8793dd93bdd735e2a2c07099a5d593a7e31286e58f3'
	}),
	files: Object.freeze({
		'scripts/validate_atlas.py': 'ebbbc77cfbd27ef8476ac6fda716e864cf372a2ed4c2beb27ebdb2487e972194',
		'scripts/make_contact_sheet.py':
			'51e2085b8acb172dcdd5fff9993bdee413f3851b714229ca095dc99cd551aa96',
		'scripts/make_direction_qa_sheet.py':
			'823e81e0aece24d1d6537889c9daaa2660208ff52604509b24fd5e24e7302acb',
		'scripts/measure_direction_continuity.py':
			'e24b7065af82eab5638f1fcdeb627d497391a2f1e9ba19801827d1db3a6d8c2d',
		'scripts/make_direction_blind_qa_sheet.py':
			'52f2a29251872449fed51c7744c3f9f503274ee288eb23efc29a2c568b0d52bd',
		'scripts/combine_direction_blind_verdicts.py':
			'4dad56adaad032a4e6d070494b0ab2ca316429cf69363450f9fbf7135d1c2d42',
		'scripts/validate_direction_blind_verdicts.py':
			'7871667432918e0ffcdbb9beaf88a01c0af4b9e2809c5000f7b533a9ddc6e13d'
	})
});

export const EXPECTED_DIRECTIONS = Object.freeze([
	['000', 'up'],
	['022.5', 'up-right'],
	['045', 'up-right'],
	['067.5', 'up-right'],
	['090', 'right'],
	['112.5', 'down-right'],
	['135', 'down-right'],
	['157.5', 'down-right'],
	['180', 'down'],
	['202.5', 'down-left'],
	['225', 'down-left'],
	['247.5', 'down-left'],
	['270', 'left'],
	['292.5', 'up-left'],
	['315', 'up-left'],
	['337.5', 'up-left']
]);

const CARDINAL_DIRECTION_IDS = new Set(['000', '090', '180', '270']);
const DIRECTION_IDS = new Set(EXPECTED_DIRECTIONS.map(([id]) => id));
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const HATCH_ATLAS_ROWS = Object.freeze([
	['idle', 6],
	['running-right', 8],
	['running-left', 8],
	['waving', 4],
	['jumping', 5],
	['failed', 8],
	['waiting', 6],
	['running', 6],
	['review', 6],
	['look-000-to-157.5', 8],
	['look-180-to-337.5', 8]
]);
const BLIND_PAIR_EXPECTATIONS = Object.freeze([
	['horizontal-1', 'horizontal', 'review', '022.5', 'screen-right', '337.5', 'screen-left'],
	['horizontal-2', 'horizontal', 'review', '045', 'screen-right', '315', 'screen-left'],
	['horizontal-3', 'horizontal', 'review', '067.5', 'screen-right', '292.5', 'screen-left'],
	['horizontal-4', 'horizontal', 'hard', '090', 'screen-right', '270', 'screen-left'],
	['horizontal-5', 'horizontal', 'review', '112.5', 'screen-right', '247.5', 'screen-left'],
	['horizontal-6', 'horizontal', 'review', '135', 'screen-right', '225', 'screen-left'],
	['horizontal-7', 'horizontal', 'review', '157.5', 'screen-right', '202.5', 'screen-left'],
	['vertical-1', 'vertical', 'hard', '000', 'up', '180', 'down'],
	['vertical-2', 'vertical', 'review', '022.5', 'up', '157.5', 'down'],
	['vertical-3', 'vertical', 'review', '045', 'up', '135', 'down'],
	['vertical-4', 'vertical', 'review', '067.5', 'up', '112.5', 'down'],
	['vertical-5', 'vertical', 'review', '337.5', 'up', '202.5', 'down'],
	['vertical-6', 'vertical', 'review', '315', 'up', '225', 'down'],
	['vertical-7', 'vertical', 'review', '292.5', 'up', '247.5', 'down']
]);

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonnegativeInteger(value) {
	return Number.isInteger(value) && value >= 0;
}

function isNonemptyString(value) {
	return typeof value === 'string' && value.trim() !== '';
}

function expectedBlindPairs() {
	return new Map(
		BLIND_PAIR_EXPECTATIONS.map(
			([pair, axis, gate, firstSource, firstDirection, secondSource, secondDirection]) => [
				pair,
				{ axis, gate, firstSource, firstDirection, secondSource, secondDirection }
			]
		)
	);
}

function fail(message) {
	throw new Error(`Ted-Bot direction evidence failed: ${message}`);
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
	return createHash('sha256').update(canonical(withoutHash)).digest('hex');
}

function selfHash(payload, field) {
	const { [field]: _ignored, ...withoutHash } = payload;
	return createHash('sha256').update(canonical(withoutHash)).digest('hex');
}

function isSha256(value) {
	return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function hasExactKeys(value, expected) {
	return (
		isObject(value) &&
		Object.keys(value).length === expected.length &&
		expected.every((key) => Object.hasOwn(value, key))
	);
}

function defaultCommandRunner(program, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, { stdio: 'pipe' });
		let stderr = '';
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0
				? resolve()
				: reject(new Error(`${nodePath.basename(program)} exited ${code}: ${stderr.trim()}`))
		);
	});
}

/**
 * Creates the evidence verifier with injectable filesystem/path/command
 * dependencies. Production uses Node's built-ins; focused tests use the same
 * public operations with a fake Hatch command runner.
 */
export function createEvidenceVerifier({
	fs = nodeFs,
	path: pathApi = nodePath,
	commandRunner = defaultCommandRunner,
	// Tests inject a fixture policy. The CLI always uses the reviewed policy
	// above, so release callers cannot select an arbitrary Hatch revision.
	hatchPetReleasePolicy = HATCH_PET_RELEASE_POLICY_V1
} = {}) {
	function validateReleasePolicy(policy) {
		if (
			!isObject(policy) ||
			!isObject(policy.skill) ||
			policy.skill.relativePath !== 'SKILL.md' ||
			!isSha256(policy.skill.sha256) ||
			!isObject(policy.files) ||
			Object.keys(policy.files).length === 0 ||
			Object.entries(policy.files).some(
				([relativePath, digest]) =>
					typeof relativePath !== 'string' ||
					relativePath.startsWith('/') ||
					relativePath.includes('..') ||
					!isSha256(digest)
			)
		) {
			fail('Hatch Pet release policy is invalid');
		}
		return policy;
	}

	const releasePolicy = validateReleasePolicy(hatchPetReleasePolicy);

	function assertRunId(runId) {
		if (typeof runId !== 'string' || !RUN_ID.test(runId)) {
			fail('run id must match ^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$');
		}
	}

	function isContained(root, target) {
		const relative = pathApi.relative(root, target);
		return (
			relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative)
		);
	}

	function runPaths(runId, runsRoot) {
		// This validation intentionally precedes *every* path or filesystem call.
		assertRunId(runId);
		const root = pathApi.resolve(runsRoot);
		const pending = pathApi.join(root, `.${runId}.pending`);
		const final = pathApi.join(root, runId);
		if (!isContained(root, pending) || !isContained(root, final)) {
			fail('run paths escape the configured runs root');
		}
		return { root, pending, final };
	}

	async function exists(file) {
		try {
			await fs.access(file);
			return true;
		} catch {
			return false;
		}
	}

	async function sha256(file) {
		return createHash('sha256')
			.update(await fs.readFile(file))
			.digest('hex');
	}

	async function readJson(file, label) {
		try {
			return JSON.parse(await fs.readFile(file, 'utf8'));
		} catch (error) {
			fail(`${label} is not readable JSON: ${error.message}`);
		}
	}

	async function writeJson(file, value, mode = 0o600) {
		const temporary = `${file}.${process.pid}.tmp`;
		try {
			await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
			await fs.rename(temporary, file);
		} catch (error) {
			await fs.rm(temporary, { force: true }).catch(() => {});
			throw error;
		}
	}

	async function writeBytes(file, value, mode = 0o600) {
		const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
		try {
			await fs.writeFile(temporary, value, { mode });
			await fs.rename(temporary, file);
		} catch (error) {
			await fs.rm(temporary, { force: true }).catch(() => {});
			throw error;
		}
	}

	async function requireFile(file, label, { nonempty = false } = {}) {
		try {
			const details = await fs.lstat(file);
			if (!details.isFile()) fail(`${label} is not a regular file`);
			if (nonempty && details.size <= 0) fail(`${label} is empty`);
			return details;
		} catch (error) {
			if (error.message?.startsWith('Ted-Bot direction evidence failed:')) throw error;
			fail(`${label} is missing`);
		}
	}

	async function requireDirectory(directory, label) {
		try {
			const details = await fs.lstat(directory);
			if (!details.isDirectory()) fail(`${label} is not a directory`);
			return details;
		} catch (error) {
			if (error.message?.startsWith('Ted-Bot direction evidence failed:')) throw error;
			fail(`${label} is missing`);
		}
	}

	function requireAbsolutePath(value, label) {
		if (!isNonemptyString(value) || !pathApi.isAbsolute(value)) {
			fail(`${label} must be an absolute path`);
		}
		return pathApi.resolve(value);
	}

	function isSystemRuntimePath(file) {
		return (
			file === '/bin' ||
			file.startsWith('/bin/') ||
			file === '/usr/bin' ||
			file.startsWith('/usr/bin/')
		);
	}

	async function resolveRuntime(file, label) {
		const reportedPath = requireAbsolutePath(file, label);
		if (isSystemRuntimePath(reportedPath)) {
			fail(
				`${label} must be the bundled runtime returned by load_workspace_dependencies, not a system binary`
			);
		}
		try {
			const reported = await fs.lstat(reportedPath);
			if (!reported.isFile() && !reported.isSymbolicLink())
				fail(`${label} is not an executable file`);
			const realPath = await fs.realpath(reportedPath);
			if (isSystemRuntimePath(realPath)) {
				fail(`${label} resolves to a system binary instead of the bundled runtime`);
			}
			await requireFile(realPath, label, { nonempty: true });
			await fs.access(realPath, fsConstants.X_OK);
			return { reportedPath, realPath };
		} catch (error) {
			if (error.message?.startsWith('Ted-Bot direction evidence failed:')) throw error;
			fail(`${label} is missing`);
		}
	}

	async function resolveHatchPetSkillDirectory(directory, label = 'Hatch Pet skill directory') {
		const reportedPath = requireAbsolutePath(directory, label);
		try {
			const realPath = await fs.realpath(reportedPath);
			await requireDirectory(realPath, label);
			return realPath;
		} catch (error) {
			if (error.message?.startsWith('Ted-Bot direction evidence failed:')) throw error;
			fail(`${label} is missing`);
		}
	}

	async function readPinnedHatchSkill(skillDirectory) {
		const hashes = {};
		const entries = [
			[releasePolicy.skill.relativePath, releasePolicy.skill.sha256],
			...Object.entries(releasePolicy.files)
		];
		for (const [relativePath, expectedSha256] of entries) {
			const file = pathApi.resolve(skillDirectory, relativePath);
			if (!isContained(skillDirectory, file))
				fail('Hatch Pet release policy escapes the verified skill directory');
			await requireFile(file, `pinned Hatch Pet artifact ${relativePath}`, { nonempty: true });
			const actualSha256 = await sha256(file);
			if (actualSha256 !== expectedSha256) {
				fail(`pinned Hatch Pet artifact changed: ${relativePath}`);
			}
			hashes[relativePath] = actualSha256;
		}
		return {
			skillDirectory,
			skillSha256: hashes[releasePolicy.skill.relativePath],
			files: Object.fromEntries(
				Object.keys(releasePolicy.files).map((relativePath) => [relativePath, hashes[relativePath]])
			),
			paths: Object.fromEntries(
				Object.keys(releasePolicy.files).map((relativePath) => [
					relativePath,
					pathApi.join(skillDirectory, relativePath)
				])
			)
		};
	}

	async function attestHatchRuntime({ runtime, hatchPetSkillDir, output }) {
		const outputPath = requireAbsolutePath(output, 'Hatch runtime attestation output');
		if (await exists(outputPath)) fail('Hatch runtime attestation output already exists');
		const resolvedRuntime = await resolveRuntime(runtime, 'Hatch runtime');
		const skillDirectory = await resolveHatchPetSkillDirectory(hatchPetSkillDir);
		const skill = await readPinnedHatchSkill(skillDirectory);
		const payload = {
			schemaVersion: HATCH_RUNTIME_ATTESTATION_SCHEMA_VERSION,
			dependencyLoader: {
				name: 'load_workspace_dependencies',
				reportedPythonPath: resolvedRuntime.reportedPath,
				attestedAt: new Date().toISOString()
			},
			runtime: {
				reportedPath: resolvedRuntime.reportedPath,
				realPath: resolvedRuntime.realPath,
				sha256: await sha256(resolvedRuntime.realPath)
			},
			hatchPetSkill: {
				realPath: skill.skillDirectory,
				skillSha256: skill.skillSha256,
				files: skill.files
			}
		};
		payload.attestationSha256 = selfHash(payload, 'attestationSha256');
		await writeJson(outputPath, payload);
		return outputPath;
	}

	async function validateHatchRuntimeAttestation(file, label = 'Hatch runtime attestation') {
		const attestationPath = requireAbsolutePath(file, label);
		await requireFile(attestationPath, label, { nonempty: true });
		const payload = await readJson(attestationPath, label);
		const expectedFileKeys = Object.keys(releasePolicy.files).sort();
		if (
			!hasExactKeys(payload, [
				'schemaVersion',
				'dependencyLoader',
				'runtime',
				'hatchPetSkill',
				'attestationSha256'
			]) ||
			payload.schemaVersion !== HATCH_RUNTIME_ATTESTATION_SCHEMA_VERSION ||
			!isObject(payload.dependencyLoader) ||
			!hasExactKeys(payload.dependencyLoader, ['name', 'reportedPythonPath', 'attestedAt']) ||
			payload.dependencyLoader.name !== 'load_workspace_dependencies' ||
			!isNonemptyString(payload.dependencyLoader.reportedPythonPath) ||
			Number.isNaN(Date.parse(payload.dependencyLoader.attestedAt)) ||
			!isObject(payload.runtime) ||
			!hasExactKeys(payload.runtime, ['reportedPath', 'realPath', 'sha256']) ||
			!isObject(payload.hatchPetSkill) ||
			!hasExactKeys(payload.hatchPetSkill, ['realPath', 'skillSha256', 'files']) ||
			!isSha256(payload.runtime.sha256) ||
			!isSha256(payload.hatchPetSkill.skillSha256) ||
			!isSha256(payload.attestationSha256) ||
			payload.attestationSha256 !== selfHash(payload, 'attestationSha256') ||
			!isObject(payload.hatchPetSkill.files) ||
			Object.keys(payload.hatchPetSkill.files).sort().join(',') !== expectedFileKeys.join(',') ||
			expectedFileKeys.some((relativePath) => !isSha256(payload.hatchPetSkill.files[relativePath]))
		) {
			fail('Hatch runtime attestation does not match the required provenance contract');
		}
		const runtime = await resolveRuntime(payload.runtime.reportedPath, 'attested Hatch runtime');
		if (
			payload.dependencyLoader.reportedPythonPath !== runtime.reportedPath ||
			payload.runtime.realPath !== runtime.realPath ||
			payload.runtime.sha256 !== (await sha256(runtime.realPath))
		) {
			fail('Hatch runtime attestation no longer matches the bundled runtime');
		}
		const skillDirectory = await resolveHatchPetSkillDirectory(
			payload.hatchPetSkill.realPath,
			'attested Hatch Pet skill directory'
		);
		if (skillDirectory !== payload.hatchPetSkill.realPath) {
			fail('Hatch runtime attestation does not use a canonical Hatch Pet skill path');
		}
		const skill = await readPinnedHatchSkill(skillDirectory);
		if (
			skill.skillSha256 !== payload.hatchPetSkill.skillSha256 ||
			expectedFileKeys.some(
				(relativePath) => skill.files[relativePath] !== payload.hatchPetSkill.files[relativePath]
			)
		) {
			fail('Hatch runtime attestation no longer matches the pinned Hatch Pet skill');
		}
		return {
			attestationPath,
			attestationSha256: await sha256(attestationPath),
			runtimePath: runtime.reportedPath,
			runtimeExecutablePath: runtime.realPath,
			runtimeSha256: payload.runtime.sha256,
			skillDirectory,
			skillSha256: skill.skillSha256,
			paths: skill.paths,
			fileSha256: skill.files
		};
	}

	async function requirePng(file, label) {
		await requireFile(file, label, { nonempty: true });
		const signature = await fs
			.readFile(file, { encoding: null })
			.then((contents) => contents.subarray(0, 8));
		if (!signature.equals(PNG_SIGNATURE)) fail(`${label} is not a PNG file`);
	}

	function validateBlindAnswerKey(answerKey, atlasSha256) {
		if (
			!isObject(answerKey) ||
			answerKey.schema_version !== 3 ||
			answerKey.atlas_sha256 !== atlasSha256 ||
			!isNonemptyString(answerKey.instructions) ||
			!Array.isArray(answerKey.pairs)
		) {
			fail('answer key does not match the Hatch direction-blind contract');
		}
		const expected = expectedBlindPairs();
		if (answerKey.pairs.length !== expected.size) {
			fail('answer key does not cover all required direction-blind pairs');
		}
		const seen = new Set();
		for (const pair of answerKey.pairs) {
			if (!isObject(pair) || seen.has(pair.pair) || !expected.has(pair.pair)) {
				fail('answer key has an unexpected or duplicate direction-blind pair');
			}
			seen.add(pair.pair);
			const requirement = expected.get(pair.pair);
			if (
				pair.axis !== requirement.axis ||
				pair.gate !== requirement.gate ||
				!isObject(pair.A) ||
				!isObject(pair.B)
			) {
				fail('answer key direction-blind pair metadata is invalid');
			}
			const actualEntries = [pair.A, pair.B]
				.map((entry) => `${entry.source_direction}|${entry.expected_direction}`)
				.sort();
			const expectedEntries = [
				`${requirement.firstSource}|${requirement.firstDirection}`,
				`${requirement.secondSource}|${requirement.secondDirection}`
			].sort();
			if (actualEntries.join(',') !== expectedEntries.join(',')) {
				fail('answer key direction-blind pair does not match the required source directions');
			}
		}
		return answerKey;
	}

	async function createPending(paths) {
		await fs.mkdir(paths.root, { recursive: true });
		if (await exists(paths.final))
			fail(`final run already exists: ${pathApi.basename(paths.final)}`);
		if (await exists(paths.pending))
			fail(`pending run already exists: ${pathApi.basename(paths.pending)}`);
		await fs.mkdir(paths.pending, { mode: 0o700 });
		const details = await fs.stat(paths.pending);
		if ((details.mode & 0o777) !== 0o700) fail('pending run directory must have mode 0700');
		return paths.pending;
	}

	function safeReviewerFileName(reviewerId) {
		if (typeof reviewerId !== 'string' || reviewerId.trim() === '') fail('reviewer ID is invalid');
		return encodeURIComponent(reviewerId);
	}

	function validateVerdict(value, manifest, answerKey) {
		validateBlindAnswerKey(answerKey, manifest.atlasSha256);
		if (
			!value ||
			typeof value !== 'object' ||
			value.schemaVersion !== SCHEMA_VERSION ||
			typeof value.reviewerId !== 'string' ||
			value.reviewerId.trim() === ''
		) {
			fail('reviewer verdict has an invalid schema version or reviewerId');
		}
		for (const key of ['atlasSha256', 'blindSheetSha256', 'manifestSha256']) {
			if (value[key] !== manifest[key])
				fail(`reviewer verdict ${key} does not attest to the manifest`);
		}
		if (!Array.isArray(answerKey.pairs) || !Array.isArray(value.pairs)) {
			fail('reviewer verdict or answer key lacks pair votes');
		}
		if (value.pairs.length !== answerKey.pairs.length)
			fail('reviewer verdict has incomplete pair votes');
		const expectedPairs = new Map(answerKey.pairs.map((pair) => [pair.pair, pair]));
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
			const expected = expectedPairs.get(pair.pair);
			const allowed =
				expected.axis === 'horizontal'
					? new Set(['screen-left', 'screen-right', 'ambiguous'])
					: new Set(['up', 'down', 'ambiguous']);
			if (!allowed.has(pair.A) || !allowed.has(pair.B)) {
				fail('reviewer verdict uses an invalid direction for its blind axis');
			}
			seen.add(pair.pair);
		}
		return value;
	}

	async function preparePetQaRun({ runId, runsRoot, atlas }) {
		const paths = runPaths(runId, runsRoot);
		const atlasPath = pathApi.resolve(atlas);
		await requireFile(atlasPath, 'atlas', { nonempty: true });
		const pending = await createPending(paths);
		try {
			await writeJson(pathApi.join(pending, 'ted-bot-pet-qa-run.json'), {
				schemaVersion: SCHEMA_VERSION,
				runId,
				atlasPath,
				atlasSha256: await sha256(atlasPath)
			});
			return pending;
		} catch (error) {
			await fs.rm(pending, { recursive: true, force: true });
			throw error;
		}
	}

	async function prepareBlindRun({
		runId,
		runsRoot,
		atlas,
		blindSheet,
		answerKey,
		hatchRuntimeAttestation
	}) {
		const paths = runPaths(runId, runsRoot);
		const atlasPath = pathApi.resolve(atlas);
		const blindSheetPath = pathApi.resolve(blindSheet);
		const answerKeyPath = pathApi.resolve(answerKey);
		const hatchRuntimeAttestationPath = requireAbsolutePath(
			hatchRuntimeAttestation,
			'Hatch runtime attestation'
		);
		await requireFile(atlasPath, 'atlas', { nonempty: true });
		await requirePng(blindSheetPath, 'blind sheet');
		await requireFile(answerKeyPath, 'answer key', { nonempty: true });
		const sourceHatchRuntime = await validateHatchRuntimeAttestation(hatchRuntimeAttestationPath);
		const pending = await createPending(paths);
		try {
			const copiedHatchRuntimeAttestationPath = pathApi.join(
				pending,
				'ted-bot-hatch-runtime-attestation.json'
			);
			await fs.copyFile(hatchRuntimeAttestationPath, copiedHatchRuntimeAttestationPath);
			const copiedHatchRuntime = await validateHatchRuntimeAttestation(
				copiedHatchRuntimeAttestationPath,
				'copied Hatch runtime attestation'
			);
			if (copiedHatchRuntime.attestationSha256 !== sourceHatchRuntime.attestationSha256) {
				fail('copied Hatch runtime attestation changed during blind-run preparation');
			}
			const payload = {
				schemaVersion: SCHEMA_VERSION,
				atlasSha256: await sha256(atlasPath),
				blindSheetSha256: await sha256(blindSheetPath),
				answerKeySha256: await sha256(answerKeyPath),
				hatchRuntimeAttestationSha256: copiedHatchRuntime.attestationSha256
			};
			const key = await readJson(answerKeyPath, 'answer key');
			validateBlindAnswerKey(key, payload.atlasSha256);
			payload.manifestSha256 = manifestHash(payload);
			await fs.copyFile(blindSheetPath, pathApi.join(pending, 'blind-sheet.png'));
			await writeJson(pathApi.join(pending, 'blind-review-manifest.json'), payload);
			await writeJson(pathApi.join(pending, 'blind-run-context.json'), {
				runId,
				atlasPath,
				answerKeyPath,
				atlasSha256: payload.atlasSha256,
				hatchRuntimeAttestationSha256: copiedHatchRuntime.attestationSha256
			});
			return pending;
		} catch (error) {
			await fs.rm(pending, { recursive: true, force: true });
			throw error;
		}
	}

	async function blindContext(paths) {
		const manifestPath = pathApi.join(paths.pending, 'blind-review-manifest.json');
		const contextPath = pathApi.join(paths.pending, 'blind-run-context.json');
		const hatchRuntimeAttestationPath = pathApi.join(
			paths.pending,
			'ted-bot-hatch-runtime-attestation.json'
		);
		const manifest = await readJson(manifestPath, 'blind review manifest');
		const context = await readJson(contextPath, 'blind run context');
		if (manifest.manifestSha256 !== manifestHash(manifest))
			fail('blind review manifest self hash does not verify');
		const atlasPath = pathApi.resolve(context.atlasPath);
		const answerKeyPath = pathApi.resolve(context.answerKeyPath);
		const blindSheetPath = pathApi.join(paths.pending, 'blind-sheet.png');
		await requireFile(atlasPath, 'exact atlas', { nonempty: true });
		await requireFile(answerKeyPath, 'private answer key', { nonempty: true });
		await requirePng(blindSheetPath, 'copied blind sheet');
		const atlasSha256 = await sha256(atlasPath);
		const hatchRuntime = await validateHatchRuntimeAttestation(
			hatchRuntimeAttestationPath,
			'copied Hatch runtime attestation'
		);
		if (
			manifest.atlasSha256 !== atlasSha256 ||
			manifest.blindSheetSha256 !== (await sha256(blindSheetPath)) ||
			manifest.answerKeySha256 !== (await sha256(answerKeyPath)) ||
			manifest.hatchRuntimeAttestationSha256 !== hatchRuntime.attestationSha256 ||
			context.hatchRuntimeAttestationSha256 !== hatchRuntime.attestationSha256
		) {
			fail('atlas, blind sheet, answer key, or Hatch runtime provenance has changed');
		}
		const answerKey = await readJson(answerKeyPath, 'answer key');
		validateBlindAnswerKey(answerKey, atlasSha256);
		return {
			manifest,
			context,
			atlasPath,
			answerKeyPath,
			blindSheetPath,
			atlasSha256,
			answerKey,
			hatchRuntime,
			hatchRuntimeAttestationPath
		};
	}

	async function sealReviewerSubmission({ runId, runsRoot, verdict }) {
		const paths = runPaths(runId, runsRoot);
		if (!(await exists(paths.pending)) || (await exists(paths.final))) {
			fail('blind pending run must exist without a final run');
		}
		const source = pathApi.resolve(verdict);
		await requireFile(source, 'reviewer verdict', { nonempty: true });
		const { manifest, answerKey } = await blindContext(paths);
		const raw = await fs.readFile(source);
		const parsed = validateVerdict(JSON.parse(raw), manifest, answerKey);
		const name = safeReviewerFileName(parsed.reviewerId);
		const bundle = pathApi.join(paths.pending, `sealed-reviewer-${name}`);
		if (await exists(bundle)) {
			fail(`reviewer submission already sealed: ${parsed.reviewerId}`);
		}
		// A reviewer submission becomes visible only after both linked files have
		// been written. A crashed writer can leave a dot-prefixed staging bundle,
		// but never a partially sealed submission that later runs could mistake for
		// evidence.
		const temporary = pathApi.join(
			paths.pending,
			`.${pathApi.basename(bundle)}.${process.pid}.${randomUUID()}.pending`
		);
		const sealed = pathApi.join(temporary, 'verdict.json');
		const receipt = pathApi.join(temporary, 'receipt.json');
		try {
			await fs.mkdir(temporary, { mode: 0o700 });
			await fs.writeFile(sealed, raw, { mode: 0o600 });
			const sealedSha256 = await sha256(sealed);
			await writeJson(receipt, {
				schemaVersion: SCHEMA_VERSION,
				reviewerId: parsed.reviewerId,
				atlasSha256: manifest.atlasSha256,
				blindSheetSha256: manifest.blindSheetSha256,
				manifestSha256: manifest.manifestSha256,
				sourceSha256: createHash('sha256').update(raw).digest('hex'),
				sealedSha256
			});
			await fs.rename(temporary, bundle);
			return {
				sealed: pathApi.join(bundle, 'verdict.json'),
				receipt: pathApi.join(bundle, 'receipt.json')
			};
		} catch (error) {
			await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
			throw error;
		}
	}

	async function sealedReviewers(paths, manifest, answerKey) {
		const bundleNames = (await fs.readdir(paths.pending))
			.filter((name) => name.startsWith('sealed-reviewer-'))
			.sort();
		if (bundleNames.length !== 3) fail('exactly three sealed reviewer bundles are required');
		const reviewerIds = new Set();
		const reviewers = [];
		for (const bundleName of bundleNames) {
			const bundle = pathApi.join(paths.pending, bundleName);
			await requireDirectory(bundle, 'sealed reviewer bundle');
			const receiptFile = pathApi.join(bundle, 'receipt.json');
			const sealedFile = pathApi.join(bundle, 'verdict.json');
			await requireFile(sealedFile, 'sealed reviewer verdict', { nonempty: true });
			const receipt = await readJson(receiptFile, 'sealed reviewer receipt');
			const raw = await fs.readFile(sealedFile);
			const verdict = validateVerdict(JSON.parse(raw), manifest, answerKey);
			const sealedSha256 = await sha256(sealedFile);
			if (
				receipt.schemaVersion !== SCHEMA_VERSION ||
				receipt.reviewerId !== verdict.reviewerId ||
				receipt.sourceSha256 !== createHash('sha256').update(raw).digest('hex') ||
				receipt.sealedSha256 !== sealedSha256 ||
				receipt.atlasSha256 !== manifest.atlasSha256 ||
				receipt.blindSheetSha256 !== manifest.blindSheetSha256 ||
				receipt.manifestSha256 !== manifest.manifestSha256
			) {
				fail('sealed reviewer verdict or receipt does not verify');
			}
			if (reviewerIds.has(verdict.reviewerId)) fail('reviewer IDs must be unique');
			reviewerIds.add(verdict.reviewerId);
			reviewers.push({
				reviewerId: verdict.reviewerId,
				receiptFile: `${bundleName}/receipt.json`,
				receiptSha256: await sha256(receiptFile),
				sourceSha256: receipt.sourceSha256,
				sealedFile: `${bundleName}/verdict.json`,
				sealedSha256,
				sealedPath: sealedFile
			});
		}
		return reviewers;
	}

	async function verifyAndCombine({ runId, runsRoot, commandRunner: runner = commandRunner }) {
		const paths = runPaths(runId, runsRoot);
		if (!(await exists(paths.pending)) || (await exists(paths.final))) {
			fail('blind pending run must exist without a final run');
		}
		try {
			const context = await blindContext(paths);
			const reviewers = await sealedReviewers(paths, context.manifest, context.answerKey);
			const consensus = pathApi.join(paths.pending, 'ted-bot-direction-blind-consensus.json');
			const combineRuntime = await validateHatchRuntimeAttestation(
				context.hatchRuntimeAttestationPath,
				'copied Hatch runtime attestation before Hatch combine'
			);
			if (combineRuntime.attestationSha256 !== context.hatchRuntime.attestationSha256) {
				fail('Hatch runtime attestation changed after blind context verification');
			}
			await runner(combineRuntime.runtimeExecutablePath, [
				combineRuntime.paths['scripts/combine_direction_blind_verdicts.py'],
				...reviewers.flatMap(({ sealedPath }) => ['--verdicts', sealedPath]),
				'--json-out',
				consensus
			]);
			await requireFile(consensus, 'Hatch consensus', { nonempty: true });
			const consensusBytes = await fs.readFile(consensus);
			const consensusSha256 = createHash('sha256').update(consensusBytes).digest('hex');
			const validationInput = pathApi.join(
				paths.pending,
				'ted-bot-direction-blind-validation-input.json'
			);
			await writeBytes(validationInput, consensusBytes);
			await requireFile(validationInput, 'sealed Hatch validation input', { nonempty: true });
			const validationInputSha256 = await sha256(validationInput);
			if (validationInputSha256 !== consensusSha256) {
				fail('sealed Hatch validation input does not match the just-combined consensus');
			}
			const validation = pathApi.join(paths.pending, 'ted-bot-direction-blind-validation.json');
			const validationRuntime = await validateHatchRuntimeAttestation(
				context.hatchRuntimeAttestationPath,
				'copied Hatch runtime attestation before Hatch validation'
			);
			if (validationRuntime.attestationSha256 !== context.hatchRuntime.attestationSha256) {
				fail('Hatch runtime attestation changed before Hatch validation');
			}
			if ((await sha256(validationInput)) !== validationInputSha256) {
				fail('sealed Hatch validation input changed before Hatch validation');
			}
			const validationOutputDirectory = pathApi.join(paths.pending, '.hatch-validation-output');
			const validationOutput = pathApi.join(validationOutputDirectory, 'result.json');
			await fs.mkdir(validationOutputDirectory, { mode: 0o700 });
			await fs.chmod(validationInput, 0o400);
			await fs.chmod(paths.pending, 0o500);
			try {
				await runner(validationRuntime.runtimeExecutablePath, [
					validationRuntime.paths['scripts/validate_direction_blind_verdicts.py'],
					'--answer-key',
					context.answerKeyPath,
					'--verdicts',
					validationInput,
					'--json-out',
					validationOutput
				]);
			} finally {
				await fs.chmod(paths.pending, 0o700).catch(() => {});
			}
			await requireFile(validationOutput, 'Hatch blind validation', { nonempty: true });
			await fs.rename(validationOutput, validation);
			await fs.rm(validationOutputDirectory, { recursive: true, force: true });
			if (
				(await sha256(consensus)) !== consensusSha256 ||
				(await sha256(validationInput)) !== validationInputSha256
			) {
				fail('Hatch consensus changed while the validator was running');
			}
			const completedRuntime = await validateHatchRuntimeAttestation(
				context.hatchRuntimeAttestationPath,
				'copied Hatch runtime attestation after Hatch validation'
			);
			if (completedRuntime.attestationSha256 !== context.hatchRuntime.attestationSha256) {
				fail('Hatch runtime attestation changed while Hatch was running');
			}
			const validationResult = await readJson(validation, 'Hatch blind validation');
			validateBlindValidationResult(validationResult, context.answerKey);
			const envelope = {
				schemaVersion: SCHEMA_VERSION,
				atlasSha256: context.atlasSha256,
				blindSheetSha256: await sha256(context.blindSheetPath),
				answerKeySha256: await sha256(context.answerKeyPath),
				manifestSha256: context.manifest.manifestSha256,
				sourceVerdicts: reviewers.map(({ sealedPath: _ignored, ...reviewer }) => reviewer),
				plainConsensusSha256: consensusSha256,
				hatchCombineSha256: consensusSha256,
				validationInputSha256,
				hatchRuntimeAttestationSha256: validationRuntime.attestationSha256,
				hatchRuntimeSha256: validationRuntime.runtimeSha256,
				hatchSkillSha256: validationRuntime.skillSha256,
				hatchCombine: {
					relativePath: 'scripts/combine_direction_blind_verdicts.py',
					sha256: combineRuntime.fileSha256['scripts/combine_direction_blind_verdicts.py']
				},
				hatchValidation: {
					relativePath: 'scripts/validate_direction_blind_verdicts.py',
					sha256: validationRuntime.fileSha256['scripts/validate_direction_blind_verdicts.py']
				},
				hatchValidationSha256: await sha256(validation)
			};
			await writeJson(
				pathApi.join(paths.pending, 'ted-bot-direction-blind-consensus-envelope.json'),
				envelope
			);
			await fs.rename(paths.pending, paths.final);
			return paths.final;
		} catch (error) {
			await fs.rm(paths.pending, { recursive: true, force: true }).catch(() => {});
			throw error;
		}
	}

	function expectedDirectionMap() {
		return new Map(EXPECTED_DIRECTIONS);
	}

	function validateBlindValidationResult(validation, answerKey) {
		if (
			!isObject(validation) ||
			validation.ok !== true ||
			!Array.isArray(validation.errors) ||
			!Array.isArray(validation.warnings) ||
			!Array.isArray(validation.unconfirmed) ||
			!Array.isArray(validation.pairs) ||
			typeof validation.reviewRequired !== 'boolean' ||
			validation.errors.length !== 0 ||
			validation.unconfirmed.length !== 0 ||
			validation.reviewRequired !== validation.warnings.length > 0
		) {
			fail('Hatch blind validation did not pass its full contract');
		}
		if (validation.pairs.length !== answerKey.pairs.length) {
			fail('Hatch blind validation did not cover every blind pair');
		}
		const expectedPairs = new Map(answerKey.pairs.map((pair) => [pair.pair, pair]));
		const seen = new Set();
		for (const result of validation.pairs) {
			if (!isObject(result) || seen.has(result.pair) || !expectedPairs.has(result.pair)) {
				fail('Hatch blind validation has an unexpected pair result');
			}
			seen.add(result.pair);
			const expected = expectedPairs.get(result.pair);
			if (
				result.axis !== expected.axis ||
				result.gate !== expected.gate ||
				!isObject(result.A) ||
				!isObject(result.B)
			) {
				fail('Hatch blind validation pair metadata is invalid');
			}
			for (const slot of ['A', 'B']) {
				const outcome = result[slot];
				const source = expected[slot];
				if (
					outcome.expected !== source.expected_direction ||
					outcome.source_direction !== source.source_direction ||
					typeof outcome.observed !== 'string' ||
					typeof outcome.pass !== 'boolean' ||
					outcome.pass !== (outcome.observed === outcome.expected)
				) {
					fail('Hatch blind validation pair outcome is invalid');
				}
				if (expected.gate === 'hard' && outcome.pass !== true) {
					fail('Hatch blind validation left a cardinal direction unconfirmed');
				}
			}
		}
	}

	function validateHatchAtlasResult(result, atlasPath) {
		if (
			!isObject(result) ||
			result.ok !== true ||
			!Array.isArray(result.errors) ||
			!Array.isArray(result.warnings) ||
			result.errors.length !== 0 ||
			result.warnings.length !== 0 ||
			typeof result.file !== 'string' ||
			pathApi.resolve(result.file) !== atlasPath ||
			result.format !== 'WEBP' ||
			!isNonemptyString(result.mode) ||
			!result.mode.includes('A') ||
			result.width !== 1536 ||
			result.height !== 2288 ||
			result.columns !== 8 ||
			result.rows !== 11 ||
			result.sprite_version_number !== 2 ||
			result.transparent_rgb_residue_pixels !== 0 ||
			!Array.isArray(result.cells) ||
			result.cells.length !== 88
		) {
			fail('atlas validation does not attest to the required exact Codex v2 atlas');
		}
		for (let index = 0; index < result.cells.length; index += 1) {
			const cell = result.cells[index];
			const row = Math.floor(index / 8);
			const column = index % 8;
			const [expectedState, expectedFrameCount] = HATCH_ATLAS_ROWS[row];
			const expectedUsed = column < expectedFrameCount || (row === 0 && column === 6);
			if (
				!isObject(cell) ||
				cell.state !== expectedState ||
				cell.row !== row ||
				cell.column !== column ||
				cell.used !== expectedUsed ||
				!isNonnegativeInteger(cell.nontransparent_pixels) ||
				!isNonnegativeInteger(cell.opaque_chroma_key_pixels) ||
				!isNonnegativeInteger(cell.chroma_fringe_pixels) ||
				(expectedUsed && cell.nontransparent_pixels < 50) ||
				(!expectedUsed && cell.nontransparent_pixels !== 0) ||
				cell.opaque_chroma_key_pixels > 400 ||
				cell.chroma_fringe_pixels !== 0 ||
				(expectedUsed && cell.nontransparent_pixels > 37939)
			) {
				fail('atlas validation cells do not match the Hatch deterministic output contract');
			}
		}
	}

	async function validatePetQaInspection(
		file,
		{
			atlasPath,
			atlasSha256,
			contactSheetPath,
			validationPath,
			hatchRuntime,
			hatchRuntimeAttestationSha256
		}
	) {
		const inspection = await readJson(file, 'pet-QA visual inspection');
		const rubricKeys = [
			'identity',
			'cellAlignment',
			'directionContinuity',
			'unusedCellTransparency'
		];
		const expectedValidatorCommand = [
			hatchRuntime.runtimePath,
			hatchRuntime.paths['scripts/validate_atlas.py'],
			atlasPath,
			'--require-v2',
			'--json-out',
			validationPath
		];
		if (
			!isObject(inspection) ||
			inspection.schemaVersion !== PET_QA_INSPECTION_SCHEMA_VERSION ||
			inspection.atlasPath !== atlasPath ||
			inspection.preAtlasSha256 !== atlasSha256 ||
			inspection.postAtlasSha256 !== atlasSha256 ||
			inspection.runtimePath !== hatchRuntime.runtimePath ||
			inspection.runtimeSha256 !== hatchRuntime.runtimeSha256 ||
			inspection.hatchRuntimeAttestationSha256 !== hatchRuntimeAttestationSha256 ||
			!Array.isArray(inspection.validatorCommand) ||
			canonical(inspection.validatorCommand) !== canonical(expectedValidatorCommand) ||
			inspection.validatorResultPath !== validationPath ||
			inspection.contactSheetPath !== contactSheetPath ||
			!isNonemptyString(inspection.inspector) ||
			!isNonemptyString(inspection.inspectedAt) ||
			Number.isNaN(Date.parse(inspection.inspectedAt)) ||
			!isObject(inspection.rubric) ||
			rubricKeys.some((key) => inspection.rubric[key] !== 'pass')
		) {
			fail('pet-QA visual inspection does not satisfy the release acceptance record contract');
		}
		return inspection;
	}

	function validateContinuityResult(continuity) {
		if (
			!isObject(continuity) ||
			continuity.ok !== true ||
			typeof continuity.reviewRequired !== 'boolean' ||
			!Number.isFinite(continuity.medianDiffPixels) ||
			continuity.medianDiffPixels < 0 ||
			!Array.isArray(continuity.warnings) ||
			!Array.isArray(continuity.alphaHoles) ||
			!Array.isArray(continuity.pairs) ||
			continuity.pairs.length !== EXPECTED_DIRECTIONS.length ||
			continuity.reviewRequired !== continuity.warnings.length > 0 ||
			continuity.warnings.some((warning) => !isNonemptyString(warning))
		) {
			fail('direction continuity result is invalid');
		}
		for (let index = 0; index < continuity.pairs.length; index += 1) {
			const pair = continuity.pairs[index];
			const [from] = EXPECTED_DIRECTIONS[index];
			const [to] = EXPECTED_DIRECTIONS[(index + 1) % EXPECTED_DIRECTIONS.length];
			if (
				!isObject(pair) ||
				pair.from !== from ||
				pair.to !== to ||
				!isNonnegativeInteger(pair.firstPixels) ||
				!isNonnegativeInteger(pair.secondPixels) ||
				!isNonnegativeInteger(pair.diffPixels) ||
				(pair.centerDelta !== null &&
					(!Number.isFinite(pair.centerDelta) || pair.centerDelta < 0)) ||
				(pair.areaRatio !== null && (!Number.isFinite(pair.areaRatio) || pair.areaRatio < 0))
			) {
				fail('direction continuity pairs do not match the Hatch deterministic output contract');
			}
		}
		for (const alphaHole of continuity.alphaHoles) {
			if (
				!isObject(alphaHole) ||
				!DIRECTION_IDS.has(alphaHole.direction) ||
				!Array.isArray(alphaHole.holes)
			) {
				fail('direction continuity alpha-hole evidence is invalid');
			}
			for (const hole of alphaHole.holes) {
				if (
					!isObject(hole) ||
					!isNonnegativeInteger(hole.row) ||
					!isNonnegativeInteger(hole.transparentPixels) ||
					!isNonnegativeInteger(hole.spanPixels)
				) {
					fail('direction continuity alpha-hole measurements are invalid');
				}
			}
		}
	}

	async function inspectBlindBundle(
		blindDir,
		{ atlasPath, atlasSha256, answerKeyPath, hatchRuntimeAttestationSha256 }
	) {
		await requireDirectory(blindDir, 'published blind run');
		const fixed = {
			manifest: pathApi.join(blindDir, 'blind-review-manifest.json'),
			context: pathApi.join(blindDir, 'blind-run-context.json'),
			blindSheet: pathApi.join(blindDir, 'blind-sheet.png'),
			hatchRuntimeAttestation: pathApi.join(blindDir, 'ted-bot-hatch-runtime-attestation.json'),
			consensus: pathApi.join(blindDir, 'ted-bot-direction-blind-consensus.json'),
			validationInput: pathApi.join(blindDir, 'ted-bot-direction-blind-validation-input.json'),
			validation: pathApi.join(blindDir, 'ted-bot-direction-blind-validation.json'),
			envelope: pathApi.join(blindDir, 'ted-bot-direction-blind-consensus-envelope.json')
		};
		for (const [label, file] of Object.entries(fixed))
			await requireFile(file, `blind ${label}`, { nonempty: true });
		await requirePng(fixed.blindSheet, 'blind sheet');
		const manifest = await readJson(fixed.manifest, 'blind review manifest');
		const context = await readJson(fixed.context, 'blind run context');
		const hatchRuntime = await validateHatchRuntimeAttestation(
			fixed.hatchRuntimeAttestation,
			'published blind Hatch runtime attestation'
		);
		if (
			context.runId !== pathApi.basename(blindDir) ||
			manifest.manifestSha256 !== manifestHash(manifest) ||
			context.atlasPath !== atlasPath ||
			context.answerKeyPath !== answerKeyPath ||
			manifest.atlasSha256 !== atlasSha256 ||
			manifest.blindSheetSha256 !== (await sha256(fixed.blindSheet)) ||
			manifest.answerKeySha256 !== (await sha256(answerKeyPath)) ||
			manifest.hatchRuntimeAttestationSha256 !== hatchRuntime.attestationSha256 ||
			context.hatchRuntimeAttestationSha256 !== hatchRuntime.attestationSha256 ||
			hatchRuntime.attestationSha256 !== hatchRuntimeAttestationSha256
		) {
			fail('published blind context or manifest does not link to this pet-QA run');
		}
		const answerKey = await readJson(answerKeyPath, 'answer key');
		validateBlindAnswerKey(answerKey, atlasSha256);
		const consensusSha256 = await sha256(fixed.consensus);
		const validation = await readJson(fixed.validation, 'blind validation');
		const envelope = await readJson(fixed.envelope, 'blind envelope');
		validateBlindValidationResult(validation, answerKey);
		if (
			envelope.atlasSha256 !== atlasSha256 ||
			envelope.blindSheetSha256 !== manifest.blindSheetSha256 ||
			envelope.answerKeySha256 !== manifest.answerKeySha256 ||
			envelope.manifestSha256 !== manifest.manifestSha256 ||
			envelope.plainConsensusSha256 !== consensusSha256 ||
			envelope.hatchCombineSha256 !== consensusSha256 ||
			envelope.validationInputSha256 !== (await sha256(fixed.validationInput)) ||
			envelope.validationInputSha256 !== consensusSha256 ||
			envelope.hatchRuntimeAttestationSha256 !== hatchRuntime.attestationSha256 ||
			envelope.hatchRuntimeSha256 !== hatchRuntime.runtimeSha256 ||
			envelope.hatchSkillSha256 !== hatchRuntime.skillSha256 ||
			!isObject(envelope.hatchCombine) ||
			envelope.hatchCombine.relativePath !== 'scripts/combine_direction_blind_verdicts.py' ||
			envelope.hatchCombine.sha256 !==
				hatchRuntime.fileSha256['scripts/combine_direction_blind_verdicts.py'] ||
			!isObject(envelope.hatchValidation) ||
			envelope.hatchValidation.relativePath !== 'scripts/validate_direction_blind_verdicts.py' ||
			envelope.hatchValidation.sha256 !==
				hatchRuntime.fileSha256['scripts/validate_direction_blind_verdicts.py'] ||
			envelope.hatchValidationSha256 !== (await sha256(fixed.validation)) ||
			!Array.isArray(envelope.sourceVerdicts) ||
			envelope.sourceVerdicts.length !== 3
		) {
			fail('published blind consensus envelope does not verify');
		}
		const reviewerIds = new Set();
		const files = Object.values(fixed);
		for (const reviewer of envelope.sourceVerdicts) {
			if (
				!reviewer ||
				typeof reviewer.reviewerId !== 'string' ||
				reviewerIds.has(reviewer.reviewerId) ||
				typeof reviewer.sealedFile !== 'string' ||
				typeof reviewer.receiptFile !== 'string'
			) {
				fail('published blind envelope has invalid reviewer metadata');
			}
			reviewerIds.add(reviewer.reviewerId);
			const expectedBundle = `sealed-reviewer-${safeReviewerFileName(reviewer.reviewerId)}`;
			if (
				reviewer.sealedFile !== `${expectedBundle}/verdict.json` ||
				reviewer.receiptFile !== `${expectedBundle}/receipt.json`
			) {
				fail('published blind envelope does not use the atomic reviewer bundle layout');
			}
			const bundle = pathApi.join(blindDir, expectedBundle);
			await requireDirectory(bundle, 'published sealed reviewer bundle');
			const sealed = pathApi.join(blindDir, reviewer.sealedFile);
			const receiptFile = pathApi.join(blindDir, reviewer.receiptFile);
			if (!isContained(blindDir, sealed) || !isContained(blindDir, receiptFile)) {
				fail('published blind envelope references an escaping reviewer file');
			}
			await requireFile(sealed, 'published sealed reviewer verdict', { nonempty: true });
			await requireFile(receiptFile, 'published sealed reviewer receipt', { nonempty: true });
			const receipt = await readJson(receiptFile, 'published sealed reviewer receipt');
			const raw = await fs.readFile(sealed);
			const verdict = validateVerdict(JSON.parse(raw), manifest, answerKey);
			if (
				verdict.reviewerId !== reviewer.reviewerId ||
				receipt.reviewerId !== reviewer.reviewerId ||
				receipt.sourceSha256 !== createHash('sha256').update(raw).digest('hex') ||
				receipt.sealedSha256 !== (await sha256(sealed)) ||
				reviewer.sealedSha256 !== (await sha256(sealed)) ||
				reviewer.receiptSha256 !== (await sha256(receiptFile)) ||
				reviewer.sourceSha256 !== receipt.sourceSha256 ||
				receipt.atlasSha256 !== atlasSha256 ||
				receipt.blindSheetSha256 !== manifest.blindSheetSha256 ||
				receipt.manifestSha256 !== manifest.manifestSha256
			) {
				fail('published blind sealed reviewer linkage does not verify');
			}
			files.push(sealed, receiptFile);
		}
		const expectedBundles = [...reviewerIds]
			.map((reviewerId) => `sealed-reviewer-${safeReviewerFileName(reviewerId)}`)
			.sort();
		const actualBundles = (await fs.readdir(blindDir))
			.filter((name) => name.startsWith('sealed-reviewer-'))
			.sort();
		if (
			expectedBundles.length !== actualBundles.length ||
			expectedBundles.some((name, index) => name !== actualBundles[index])
		) {
			fail('published blind run has an unexpected reviewer bundle');
		}
		return { envelope, files };
	}

	async function validateDirectionSemantics(file, atlasSha256, warnings) {
		const semantics = await readJson(file, 'direction semantics');
		if (semantics.atlas_sha256 !== atlasSha256 || !Array.isArray(semantics.directions)) {
			fail('direction semantics do not attest to the exact atlas');
		}
		const expected = expectedDirectionMap();
		if (semantics.directions.length !== expected.size)
			fail('direction semantics must contain exactly 16 directions');
		const observedIds = new Set();
		for (const entry of semantics.directions) {
			if (
				!entry ||
				typeof entry.id !== 'string' ||
				observedIds.has(entry.id) ||
				!expected.has(entry.id)
			) {
				fail('direction semantics contains an unexpected direction');
			}
			observedIds.add(entry.id);
			if (
				entry.expected !== expected.get(entry.id) ||
				typeof entry.observed !== 'string' ||
				typeof entry.reason !== 'string' ||
				entry.reason.trim() === ''
			) {
				fail('direction semantics has an invalid expected, observed, or reason value');
			}
			if (!CARDINAL_DIRECTION_IDS.has(entry.id)) {
				if (
					!isObject(entry.landmarks) ||
					!isNonemptyString(entry.landmarks.horizontal) ||
					!isNonemptyString(entry.landmarks.vertical)
				) {
					fail('diagonal direction semantics requires horizontal and vertical landmark evidence');
				}
			}
			if (entry.verdict === 'pass') {
				if (entry.observed !== entry.expected)
					fail('a passing direction must observe its expected direction');
			} else if (
				entry.verdict === 'ambiguous' &&
				!CARDINAL_DIRECTION_IDS.has(entry.id) &&
				typeof entry.intermediateRationale === 'string' &&
				entry.intermediateRationale.trim() !== ''
			) {
				// An intermediate look can be visually ambiguous only with explicit rationale.
			} else {
				fail('direction semantics has a failed or unjustified ambiguous direction');
			}
		}
		if (observedIds.size !== expected.size) fail('direction semantics omits an expected direction');
		if (!Array.isArray(semantics.warningAssessments))
			fail('direction semantics lacks continuity assessments');
		const assessed = new Set();
		for (const assessment of semantics.warningAssessments) {
			if (
				!assessment ||
				typeof assessment.warning !== 'string' ||
				typeof assessment.reason !== 'string' ||
				assessment.reason.trim() === '' ||
				!warnings.includes(assessment.warning) ||
				assessed.has(assessment.warning)
			) {
				fail('direction semantics has an invalid continuity assessment');
			}
			assessed.add(assessment.warning);
		}
		if (assessed.size !== warnings.length)
			fail('every continuity warning requires exactly one assessment');
		return semantics;
	}

	async function validatePetQaArtifacts(paths, atlasPath, atlasSha256) {
		const artifactPaths = Object.fromEntries(
			[
				'ted-bot-hatch-runtime-attestation.json',
				'ted-bot-atlas-validation.json',
				'ted-bot-atlas-contact-sheet.png',
				'ted-bot-direction-qa-sheet.png',
				'ted-bot-direction-continuity.json',
				'ted-bot-direction-blind-sheet.png',
				'ted-bot-direction-blind-answer-key.json',
				'ted-bot-direction-semantics.json',
				'ted-bot-pet-qa-inspection.json'
			].map((name) => [name, pathApi.join(paths.pending, name)])
		);
		for (const [name, file] of Object.entries(artifactPaths)) {
			await requireFile(file, `pet-QA artifact ${name}`, { nonempty: true });
		}
		await requirePng(artifactPaths['ted-bot-atlas-contact-sheet.png'], 'pet-QA contact sheet');
		await requirePng(artifactPaths['ted-bot-direction-qa-sheet.png'], 'pet-QA direction QA sheet');
		await requirePng(
			artifactPaths['ted-bot-direction-blind-sheet.png'],
			'pet-QA direction blind sheet'
		);
		const atlasValidation = await readJson(
			artifactPaths['ted-bot-atlas-validation.json'],
			'atlas validation'
		);
		validateHatchAtlasResult(atlasValidation, atlasPath);
		const hatchRuntime = await validateHatchRuntimeAttestation(
			artifactPaths['ted-bot-hatch-runtime-attestation.json'],
			'pet-QA Hatch runtime attestation'
		);
		await validatePetQaInspection(artifactPaths['ted-bot-pet-qa-inspection.json'], {
			atlasPath,
			atlasSha256,
			contactSheetPath: artifactPaths['ted-bot-atlas-contact-sheet.png'],
			validationPath: artifactPaths['ted-bot-atlas-validation.json'],
			hatchRuntime,
			hatchRuntimeAttestationSha256: hatchRuntime.attestationSha256
		});
		const continuity = await readJson(
			artifactPaths['ted-bot-direction-continuity.json'],
			'direction continuity'
		);
		validateContinuityResult(continuity);
		await validateDirectionSemantics(
			artifactPaths['ted-bot-direction-semantics.json'],
			atlasSha256,
			continuity.warnings
		);
		const blindRunsRoot = pathApi.join(paths.pending, 'blind-runs');
		await requireDirectory(blindRunsRoot, 'blind runs root');
		const blindNames = (await fs.readdir(blindRunsRoot)).filter((name) => !name.startsWith('.'));
		if (blindNames.length !== 1 || !RUN_ID.test(blindNames[0])) {
			fail('exactly one published blind run is required');
		}
		const blindDir = pathApi.join(blindRunsRoot, blindNames[0]);
		if (!isContained(blindRunsRoot, blindDir)) fail('published blind run escapes its root');
		const blind = await inspectBlindBundle(blindDir, {
			atlasPath,
			atlasSha256,
			answerKeyPath: artifactPaths['ted-bot-direction-blind-answer-key.json'],
			hatchRuntimeAttestationSha256: hatchRuntime.attestationSha256
		});
		return { artifactPaths, blind, blindRunId: blindNames[0] };
	}

	function relativeArtifactPath(paths, file) {
		const relative = pathApi.relative(paths.pending, file);
		if (
			!relative ||
			relative.startsWith(`..${pathApi.sep}`) ||
			relative === '..' ||
			pathApi.isAbsolute(relative)
		) {
			fail('artifact escapes the pet-QA pending directory');
		}
		return relative.split(pathApi.sep).join('/');
	}

	async function sealPetQaArtifacts({ runId, runsRoot, atlas }) {
		const paths = runPaths(runId, runsRoot);
		const atlasPath = pathApi.resolve(atlas);
		if (!(await exists(paths.pending)) || (await exists(paths.final))) {
			fail('pet-QA pending run must exist without a final run');
		}
		const receiptPath = pathApi.join(paths.pending, 'ted-bot-pet-qa-artifact-manifest.json');
		if (await exists(receiptPath)) fail('pet-QA artifacts are already sealed for this run');
		const metadata = await readJson(
			pathApi.join(paths.pending, 'ted-bot-pet-qa-run.json'),
			'pet-QA run metadata'
		);
		const atlasSha256 = await sha256(atlasPath);
		if (
			metadata.runId !== runId ||
			metadata.atlasPath !== atlasPath ||
			metadata.atlasSha256 !== atlasSha256
		) {
			fail('pet-QA metadata does not match the exact atlas');
		}
		const validated = await validatePetQaArtifacts(paths, atlasPath, atlasSha256);
		const files = [...Object.values(validated.artifactPaths), ...validated.blind.files];
		const artifacts = {};
		for (const file of files) artifacts[relativeArtifactPath(paths, file)] = await sha256(file);
		await writeJson(receiptPath, {
			schemaVersion: SCHEMA_VERSION,
			runId,
			atlasPath,
			atlasSha256,
			blindRunId: validated.blindRunId,
			artifacts
		});
		return receiptPath;
	}

	async function publishPetQaRun({ runId, runsRoot, atlas }) {
		const paths = runPaths(runId, runsRoot);
		const atlasPath = pathApi.resolve(atlas);
		if (!(await exists(paths.pending)) || (await exists(paths.final))) {
			fail('pet-QA pending run must exist without a final run');
		}
		const metadataPath = pathApi.join(paths.pending, 'ted-bot-pet-qa-run.json');
		const metadata = await readJson(metadataPath, 'pet-QA run metadata');
		const atlasSha256 = await sha256(atlasPath);
		if (
			metadata.runId !== runId ||
			metadata.atlasPath !== atlasPath ||
			metadata.atlasSha256 !== atlasSha256
		) {
			fail('atlas changed after pet-QA preparation');
		}
		const receiptPath = pathApi.join(paths.pending, 'ted-bot-pet-qa-artifact-manifest.json');
		const receipt = await readJson(receiptPath, 'sealed pet-QA artifact manifest');
		const validated = await validatePetQaArtifacts(paths, atlasPath, atlasSha256);
		if (
			receipt.schemaVersion !== SCHEMA_VERSION ||
			receipt.runId !== runId ||
			receipt.atlasPath !== atlasPath ||
			receipt.atlasSha256 !== atlasSha256 ||
			receipt.blindRunId !== validated.blindRunId ||
			!receipt.artifacts ||
			typeof receipt.artifacts !== 'object'
		) {
			fail('sealed pet-QA artifact manifest does not match this run');
		}
		const files = [...Object.values(validated.artifactPaths), ...validated.blind.files];
		const actual = {};
		for (const file of files) actual[relativeArtifactPath(paths, file)] = await sha256(file);
		const expectedKeys = Object.keys(receipt.artifacts).sort();
		const actualKeys = Object.keys(actual).sort();
		if (
			expectedKeys.length !== actualKeys.length ||
			expectedKeys.some((key, index) => key !== actualKeys[index]) ||
			actualKeys.some((key) => receipt.artifacts[key] !== actual[key])
		) {
			fail('pet-QA artifacts changed after they were sealed');
		}
		metadata.blindRunId = validated.blindRunId;
		metadata.artifactManifestSha256 = await sha256(receiptPath);
		metadata.artifactSha256 = actual;
		await writeJson(metadataPath, metadata);
		await fs.rename(paths.pending, paths.final);
		return paths.final;
	}

	return {
		attestHatchRuntime,
		preparePetQaRun,
		prepareBlindRun,
		sealReviewerSubmission,
		verifyAndCombine,
		sealPetQaArtifacts,
		publishPetQaRun
	};
}

const defaultVerifier = createEvidenceVerifier();
export const {
	attestHatchRuntime,
	preparePetQaRun,
	prepareBlindRun,
	sealReviewerSubmission,
	verifyAndCombine,
	sealPetQaArtifacts,
	publishPetQaRun
} = defaultVerifier;

function parseOptions(args) {
	const values = {};
	for (let index = 0; index < args.length; index += 2) {
		if (!args[index]?.startsWith('--') || args[index + 1] === undefined) {
			fail('arguments must be --key value pairs');
		}
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
		else if (operation === 'attest-hatch-runtime') result = await attestHatchRuntime(options);
		else if (operation === 'prepare-blind-run') result = await prepareBlindRun(options);
		else if (operation === 'seal-reviewer-submission')
			result = await sealReviewerSubmission(options);
		else if (operation === 'verify-and-combine') {
			if (options.verdict !== undefined)
				fail('seal reviewer submissions before verify-and-combine');
			if (
				options.python !== undefined ||
				options.combineScript !== undefined ||
				options.validateScript !== undefined
			) {
				fail(
					'verify-and-combine derives the bundled runtime and Hatch scripts from the sealed attestation'
				);
			}
			result = await verifyAndCombine(options);
		} else if (operation === 'seal-pet-qa-artifacts') result = await sealPetQaArtifacts(options);
		else if (operation === 'publish-pet-qa-run') result = await publishPetQaRun(options);
		else {
			fail(
				'operation must be prepare-pet-qa-run, attest-hatch-runtime, prepare-blind-run, seal-reviewer-submission, verify-and-combine, seal-pet-qa-artifacts, or publish-pet-qa-run'
			);
		}
		console.log(result);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
