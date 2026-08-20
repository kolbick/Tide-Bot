/**
 * Sign the built extension ZIP into a CRX3 package and emit its update manifest.
 *
 * Self-hosted installs need a signed .crx plus an update.xml that Chrome's
 * background updater can poll. The signing key must never enter the repository
 * or a Docker build context, so it is read from disk at publish time and the
 * artifacts are written next to the ZIP.
 *
 * Usage:
 *   node scripts/sign-browser-extension.mjs --key <pem> --base-url <url> [--out <dir>]
 */
import { createHash, createPrivateKey, createPublicKey, createSign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const CRX_MAGIC = Buffer.from('Cr24', 'ascii');
const SIGNATURE_CONTEXT = Buffer.from('CRX3 SignedData\x00', 'binary');

/** Minimal protobuf helpers — the CrxFileHeader schema is tiny and fixed. */
function varint(value) {
	const bytes = [];
	let remaining = value;
	do {
		let byte = remaining & 0x7f;
		remaining >>>= 7;
		if (remaining > 0) byte |= 0x80;
		bytes.push(byte);
	} while (remaining > 0);
	return Buffer.from(bytes);
}

function lengthDelimited(fieldNumber, payload) {
	return Buffer.concat([varint((fieldNumber << 3) | 2), varint(payload.length), payload]);
}

export function buildCrx(zipBytes, privateKeyPem) {
	const privateKey = createPrivateKey(privateKeyPem);
	const publicKeyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });

	// SignedData { bytes crx_id = 1 } — the id is the first 16 bytes of the key digest.
	const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
	const signedHeaderData = lengthDelimited(1, crxId);

	const signer = createSign('sha256');
	signer.update(SIGNATURE_CONTEXT);
	const signedHeaderLength = Buffer.alloc(4);
	signedHeaderLength.writeUInt32LE(signedHeaderData.length, 0);
	signer.update(signedHeaderLength);
	signer.update(signedHeaderData);
	signer.update(zipBytes);
	const signature = signer.sign(privateKey);

	// CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2; bytes signed_header_data = 10000 }
	const proof = Buffer.concat([lengthDelimited(1, publicKeyDer), lengthDelimited(2, signature)]);
	const header = Buffer.concat([lengthDelimited(2, proof), lengthDelimited(10000, signedHeaderData)]);

	const prefix = Buffer.alloc(8);
	prefix.writeUInt32LE(3, 0); // CRX3
	prefix.writeUInt32LE(header.length, 4);
	return {
		crx: Buffer.concat([CRX_MAGIC, prefix, header, zipBytes]),
		extensionId: [...crxId.toString('hex')]
			.map((character) => String.fromCharCode(97 + parseInt(character, 16)))
			.join('')
	};
}

export function buildUpdateManifest({ extensionId, version, crxUrl }) {
	// Chrome compares `version` against the installed copy to decide to update.
	return `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${extensionId}">
    <updatecheck codebase="${crxUrl}" version="${version}" />
  </app>
</gupdate>
`;
}

function argument(name, fallback = null) {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1 || index === process.argv.length - 1) return fallback;
	return process.argv[index + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const keyPath = argument('key');
	const baseUrl = argument('base-url');
	if (!keyPath || !baseUrl) {
		process.stderr.write('usage: --key <pem> --base-url <url> [--out <dir>]\n');
		process.exit(2);
	}
	const outDir = argument('out', join(repoRoot, 'backend/open_webui/static/browser-extension'));
	const zipPath = join(outDir, 'tide-bot-browser-extension.zip');
	const { version } = JSON.parse(
		await readFile(join(repoRoot, 'browser-extension/manifest.json'), 'utf8')
	);

	const { crx, extensionId } = buildCrx(await readFile(zipPath), await readFile(keyPath, 'utf8'));
	const trimmedBase = baseUrl.replace(/\/+$/, '');
	await mkdir(outDir, { recursive: true });
	await writeFile(join(outDir, 'tide-bot-browser-extension.crx'), crx, { mode: 0o644 });
	await writeFile(
		join(outDir, 'update.xml'),
		buildUpdateManifest({
			extensionId,
			version,
			crxUrl: `${trimmedBase}/tide-bot-browser-extension.crx`
		}),
		{ mode: 0o644 }
	);
	process.stdout.write(`extension id: ${extensionId}\nversion: ${version}\n`);
}
