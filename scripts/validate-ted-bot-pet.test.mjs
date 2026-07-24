import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

import { validatePackage } from './validate-ted-bot-pet.mjs';

const manifest = {
	id: 'ted-bot',
	displayName: 'Ted-Bot',
	description: "Tide-Bot's black-goldendoodle companion.",
	spriteVersionNumber: 2,
	spritesheetPath: 'spritesheet.webp'
};
const packageDir = fileURLToPath(new URL('../static/tide-bot/ted-bot/', import.meta.url));
const fixtures = await mkdtemp(join(tmpdir(), 'ted-bot-pet-validator-'));

after(async () => rm(fixtures, { recursive: true, force: true }));

function vp8x(width, height) {
	const data = Buffer.alloc(10);
	data.writeUIntLE(width - 1, 4, 3);
	data.writeUIntLE(height - 1, 7, 3);
	const chunk = Buffer.concat([Buffer.from('VP8X'), Buffer.from([10, 0, 0, 0]), data]);
	return Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), chunk]);
}

async function fixture(name, update = (value) => value, atlas = vp8x(1536, 2288)) {
	const dir = join(fixtures, name);
	const value = structuredClone(manifest);
	await import('node:fs/promises').then(({ mkdir }) => mkdir(dir, { recursive: true }));
	await writeFile(join(dir, 'pet.json'), JSON.stringify(update(value)));
	if (atlas) await writeFile(join(dir, 'spritesheet.webp'), atlas);
	return dir;
}

test('accepts the tracked Codex v2 package', async () => {
	await assert.doesNotReject(validatePackage(packageDir));
});

test('rejects every manifest-field failure', async () => {
	for (const [name, update] of [
		['missing-id', (value) => (delete value.id, value)],
		['extra-field', (value) => ({ ...value, extra: true })],
		['mistyped-id', (value) => ({ ...value, id: 1 })],
		['wrong-display-name', (value) => ({ ...value, displayName: 'Teddy' })],
		['mistyped-description', (value) => ({ ...value, description: 1 })],
		['wrong-version', (value) => ({ ...value, spriteVersionNumber: 1 })],
		['mistyped-sprite-path', (value) => ({ ...value, spritesheetPath: 1 })]
	]) {
		await assert.rejects(validatePackage(await fixture(name, update)), /manifest/i, name);
	}
});

test('rejects unsafe or absent atlas paths', async () => {
	for (const [name, spritesheetPath] of [
		['absolute', '/spritesheet.webp'],
		['escaping', '../spritesheet.webp'],
		['wrong-name', 'other.webp'],
		['missing', 'spritesheet.webp']
	]) {
		await assert.rejects(
			validatePackage(
				await fixture(
					name,
					(value) => ({ ...value, spritesheetPath }),
					name === 'missing' ? null : undefined
				)
			),
			/atlas|spritesheetPath/i,
			name
		);
	}
});

test('rejects wrong image dimensions and an invalid atlas cell relationship', async () => {
	await assert.rejects(
		validatePackage(await fixture('wrong-size', (value) => value, vp8x(1535, 2288))),
		/divisible|1536-by-2288/i
	);
	await assert.rejects(
		validatePackage(await fixture('bad-cell-size'), { cellWidth: 193 }),
		/not divisible/i
	);
});
