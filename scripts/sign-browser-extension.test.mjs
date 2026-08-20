import assert from 'node:assert/strict';
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { buildCrx, buildUpdateManifest } from './sign-browser-extension.mjs';

const SIGNATURE_CONTEXT = Buffer.from('CRX3 SignedData\x00', 'binary');

function signingKey() {
	const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

function parseHeader(crx) {
	assert.equal(crx.subarray(0, 4).toString('ascii'), 'Cr24');
	assert.equal(crx.readUInt32LE(4), 3);
	const headerLength = crx.readUInt32LE(8);
	return { header: crx.subarray(12, 12 + headerLength), payload: crx.subarray(12 + headerLength) };
}

function readFields(buffer) {
	const fields = new Map();
	let offset = 0;
	const readVarint = () => {
		let result = 0;
		let shift = 0;
		let byte;
		do {
			byte = buffer[offset++];
			result |= (byte & 0x7f) << shift;
			shift += 7;
		} while (byte & 0x80);
		return result >>> 0;
	};
	while (offset < buffer.length) {
		const field = readVarint() >>> 3;
		const length = readVarint();
		fields.set(field, buffer.subarray(offset, offset + length));
		offset += length;
	}
	return fields;
}

test('the signature verifies over the context, header, and archive together', () => {
	const key = signingKey();
	const zip = Buffer.from('PK archive bytes');
	const { crx } = buildCrx(zip, key);

	const { header, payload } = parseHeader(crx);
	assert.ok(payload.equals(zip), 'archive is preserved byte for byte');

	const fields = readFields(header);
	const proof = readFields(fields.get(2));
	const signedHeaderData = fields.get(10000);
	const publicKeyDer = proof.get(1);
	const signature = proof.get(2);

	const length = Buffer.alloc(4);
	length.writeUInt32LE(signedHeaderData.length, 0);
	const verifier = createVerify('sha256');
	verifier.update(SIGNATURE_CONTEXT);
	verifier.update(length);
	verifier.update(signedHeaderData);
	verifier.update(payload);

	const publicKey = { key: publicKeyDer, format: 'der', type: 'spki' };
	assert.ok(verifier.verify(publicKey, signature), 'Chrome-side verification succeeds');
});

test('a tampered archive fails verification', () => {
	const key = signingKey();
	const { crx } = buildCrx(Buffer.from('PK original'), key);
	const { header, payload } = parseHeader(crx);
	const fields = readFields(header);
	const proof = readFields(fields.get(2));
	const signedHeaderData = fields.get(10000);

	const tampered = Buffer.from(payload);
	tampered[tampered.length - 1] ^= 0xff;

	const length = Buffer.alloc(4);
	length.writeUInt32LE(signedHeaderData.length, 0);
	const verifier = createVerify('sha256');
	verifier.update(SIGNATURE_CONTEXT);
	verifier.update(length);
	verifier.update(signedHeaderData);
	verifier.update(tampered);

	const publicKey = { key: proof.get(1), format: 'der', type: 'spki' };
	assert.equal(verifier.verify(publicKey, proof.get(2)), false);
});

test('the extension id is the key digest, so unpacked and crx installs match', () => {
	const key = signingKey();
	const { crx, extensionId } = buildCrx(Buffer.from('PK'), key);
	const publicKeyDer = readFields(readFields(parseHeader(crx).header).get(2)).get(1);

	const expected = [...createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32)]
		.map((character) => String.fromCharCode(97 + parseInt(character, 16)))
		.join('');
	assert.equal(extensionId, expected);
	assert.match(extensionId, /^[a-p]{32}$/);
});

test('the update manifest advertises the id, version, and codebase Chrome polls', () => {
	const xml = buildUpdateManifest({
		extensionId: 'blocbpfgbghpfjdpnmipdcciladcpglg',
		version: '0.1.0',
		crxUrl: 'https://tide-bot.com/x/tide-bot-browser-extension.crx'
	});
	assert.match(xml, /appid="blocbpfgbghpfjdpnmipdcciladcpglg"/);
	assert.match(xml, /version="0\.1\.0"/);
	assert.match(xml, /codebase="https:\/\/tide-bot\.com\/x\/tide-bot-browser-extension\.crx"/);
});
