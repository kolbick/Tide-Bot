import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const upstreamShaIndex = process.argv.indexOf('--upstream-sha');
const upstreamSha = upstreamShaIndex >= 0 ? process.argv[upstreamShaIndex + 1] : undefined;

if (!/^[0-9a-f]{40}$/i.test(upstreamSha ?? '')) {
	throw new Error('Expected --upstream-sha followed by a 40-character commit SHA.');
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const upstreamPath = join(repoRoot, 'docs', 'UPSTREAM.md');
const marker = '## Automated upstream/main integrations';
const date = new Date().toISOString().slice(0, 10);
const entry = `| ${date} | \`${upstreamSha}\` | Recorded by the passing upstream/main gate; review the merge commit in Git history. |`;
const current = await readFile(upstreamPath, 'utf8');

if (!current.includes(marker)) {
	throw new Error(`Missing ${marker} in docs/UPSTREAM.md.`);
}
if (current.includes(`\`${upstreamSha}\``)) {
	process.exit(0);
}

await writeFile(upstreamPath, current.replace(marker, `${marker}\n\n| Date | Upstream commit | Record |\n| --- | --- | --- |\n${entry}`));
