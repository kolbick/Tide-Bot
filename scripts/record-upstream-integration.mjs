import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const marker = '## Automated upstream/main integrations';
const tableHeader = '| Date | Upstream commit | Record |';
const tableDivider = '| --- | --- | --- |';

export function updateUpstreamIntegrationMarkdown(current, { date, upstreamSha }) {
	if (!/^[0-9a-f]{40}$/i.test(upstreamSha ?? '')) {
		throw new Error('Expected a 40-character upstream commit SHA.');
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
		throw new Error('Expected an ISO-8601 date.');
	}

	const lines = current.split('\n');
	const markerIndex = lines.indexOf(marker);
	if (markerIndex < 0) {
		throw new Error(`Missing ${marker} in docs/UPSTREAM.md.`);
	}

	let tableIndex = markerIndex + 1;
	while (lines[tableIndex] === '') tableIndex += 1;
	const row = `| ${date} | \`${upstreamSha}\` | Recorded by the passing upstream/main gate; review the merge commit in Git history. |`;

	if (lines[tableIndex] !== tableHeader) {
		lines.splice(markerIndex + 1, 0, '', tableHeader, tableDivider, row);
		return lines.join('\n');
	}
	if (lines[tableIndex + 1] !== tableDivider) {
		throw new Error('Automated upstream integration table has an unexpected divider.');
	}

	let rowsEnd = tableIndex + 2;
	while (lines[rowsEnd]?.startsWith('|')) {
		if (lines[rowsEnd].includes(`\`${upstreamSha}\``)) return current;
		rowsEnd += 1;
	}
	lines.splice(rowsEnd, 0, row);
	return lines.join('\n');
}

async function main() {
	const upstreamShaIndex = process.argv.indexOf('--upstream-sha');
	const upstreamSha = upstreamShaIndex >= 0 ? process.argv[upstreamShaIndex + 1] : undefined;
	const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
	const upstreamPath = join(repoRoot, 'docs', 'UPSTREAM.md');
	const current = await readFile(upstreamPath, 'utf8');
	const updated = updateUpstreamIntegrationMarkdown(current, {
		date: new Date().toISOString().slice(0, 10),
		upstreamSha
	});
	if (updated !== current) await writeFile(upstreamPath, updated);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
