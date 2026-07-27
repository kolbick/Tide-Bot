#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredManifest = {
	id: 'ted-bot',
	displayName: 'Ted-Bot',
	description: "Tide-Bot's black-goldendoodle companion.",
	spriteVersionNumber: 2,
	spritesheetPath: 'spritesheet.webp'
};
const requiredKeys = Object.keys(requiredManifest);
const atlasColumns = 8;
const atlasRows = 11;
const cellWidth = 192;
const cellHeight = 208;
const expectedWidth = atlasColumns * cellWidth;
const expectedHeight = atlasRows * cellHeight;

function fail(message) {
	throw new Error(`Ted-Bot pet validation failed: ${message}`);
}

function isInside(root, target) {
	const relative = path.relative(root, target);
	return (
		relative === '' ||
		(!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
	);
}

function parseWebpDimensions(buffer) {
	if (
		buffer.length < 12 ||
		buffer.toString('ascii', 0, 4) !== 'RIFF' ||
		buffer.toString('ascii', 8, 12) !== 'WEBP'
	) {
		fail('atlas is not a readable WebP RIFF container');
	}

	for (let offset = 12; offset + 8 <= buffer.length; ) {
		const type = buffer.toString('ascii', offset, offset + 4);
		const length = buffer.readUInt32LE(offset + 4);
		const dataOffset = offset + 8;
		const next = dataOffset + length + (length % 2);
		if (next > buffer.length) fail(`atlas WebP ${type} chunk is truncated`);

		if (type === 'VP8X') {
			if (length < 10) fail('atlas WebP VP8X chunk is too short');
			return {
				width: buffer.readUIntLE(dataOffset + 4, 3) + 1,
				height: buffer.readUIntLE(dataOffset + 7, 3) + 1
			};
		}
		if (type === 'VP8 ') {
			if (
				length < 10 ||
				buffer[dataOffset + 3] !== 0x9d ||
				buffer[dataOffset + 4] !== 0x01 ||
				buffer[dataOffset + 5] !== 0x2a
			) {
				fail('atlas WebP VP8 frame header is unreadable');
			}
			return {
				width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
				height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff
			};
		}
		if (type === 'VP8L') {
			if (length < 5 || buffer[dataOffset] !== 0x2f)
				fail('atlas WebP VP8L frame header is unreadable');
			const bits = buffer.readUInt32LE(dataOffset + 1);
			return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
		}
		offset = next;
	}

	fail('atlas WebP has no supported image chunk');
}

export async function validatePackage(packageDir, options = {}) {
	const root = path.resolve(packageDir);
	const manifestPath = path.join(root, 'pet.json');
	let manifest;
	try {
		manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	} catch (error) {
		fail(`manifest pet.json cannot be read: ${error.message}`);
	}
	if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object')
		fail('manifest must be a JSON object');

	const keys = Object.keys(manifest).sort();
	const expectedKeys = [...requiredKeys].sort();
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key, index) => key !== expectedKeys[index])
	) {
		fail(`manifest fields must be exactly: ${requiredKeys.join(', ')}`);
	}
	for (const [key, expected] of Object.entries(requiredManifest)) {
		if (typeof manifest[key] !== typeof expected || manifest[key] !== expected) {
			fail(`manifest ${key} must equal ${JSON.stringify(expected)}`);
		}
	}

	const spritePath = manifest.spritesheetPath;
	if (
		path.isAbsolute(spritePath) ||
		spritePath !== path.basename(spritePath) ||
		spritePath !== 'spritesheet.webp'
	) {
		fail('manifest spritesheetPath must be the non-escaping file spritesheet.webp');
	}
	const atlasPath = path.resolve(root, spritePath);
	if (!isInside(root, atlasPath)) fail('manifest spritesheetPath escapes the package directory');

	let dimensions;
	try {
		dimensions = parseWebpDimensions(await readFile(atlasPath));
	} catch (error) {
		if (error.message.startsWith('Ted-Bot pet validation failed:')) throw error;
		fail(`atlas ${spritePath} cannot be read: ${error.message}`);
	}

	const columns = options.columns ?? atlasColumns;
	const rows = options.rows ?? atlasRows;
	const widthPerCell = options.cellWidth ?? cellWidth;
	const heightPerCell = options.cellHeight ?? cellHeight;
	if (
		!Number.isInteger(columns) ||
		!Number.isInteger(rows) ||
		!Number.isInteger(widthPerCell) ||
		!Number.isInteger(heightPerCell)
	) {
		fail('atlas contract values must be integers');
	}
	if (
		dimensions.width % columns !== 0 ||
		dimensions.height % rows !== 0 ||
		dimensions.width / columns !== widthPerCell ||
		dimensions.height / rows !== heightPerCell
	) {
		fail(
			`atlas dimensions are not divisible into ${columns}-by-${rows} ${widthPerCell}-by-${heightPerCell} cells`
		);
	}
	if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
		fail(
			`atlas dimensions must be ${expectedWidth}-by-${expectedHeight}, received ${dimensions.width}-by-${dimensions.height}`
		);
	}

	return { manifest, atlasPath, dimensions };
}

function packageDirFromArgs(args) {
	if (args.length === 0)
		return fileURLToPath(new URL('../static/tide-bot/ted-bot/', import.meta.url));
	if (args.length === 2 && args[0] === '--package-dir') return args[1];
	fail('usage: node scripts/validate-ted-bot-pet.mjs [--package-dir PATH]');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const result = await validatePackage(packageDirFromArgs(process.argv.slice(2)));
		console.log(
			`Ted-Bot pet package valid: ${result.dimensions.width}x${result.dimensions.height}`
		);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
