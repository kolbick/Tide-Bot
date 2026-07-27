#!/usr/bin/env node
// Resolves the production and optional loopback dev origins to the two
// generated JSON artifacts the Tauri shell reads at compile time. The brief
// rejects hand-edited fallbacks; this script is the only writer of either
// `src-tauri/capabilities/companion.json` or
// `src-tauri/generated/desktop-origin-provenance.json`. Production origin
// is required; loopback dev origin is optional.
//
// Invocation modes:
//   resolve --out-dir <path>     → { capabilityPath, provenancePath, nonce }
//   print-remote-urls            → JSON {"urls":[...]} (parse-only check)

import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.dirname(__filename);
const DESKTOP_DIR = path.dirname(SCRIPTS_DIR);
const TEMPLATE_PATH = path.join(
    DESKTOP_DIR,
    'src-tauri',
    'templates',
    'companion.capability.template.json'
);
const SCHEMA_VERSION = 'tide-bot-desktop-origins/v1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function fail(message) {
    process.stderr.write(`desktop-origins: ${message}\n`);
    process.exit(1);
}

function sha256(text) {
    return createHash('sha256').update(text).digest('hex');
}

function parseOrigin(raw, label) {
    if (typeof raw !== 'string' || raw.length === 0) {
        fail(`${label} must be a non-empty string`);
    }
    let url;
    try {
        url = new URL(raw);
    } catch {
        fail(`${label} is not a parseable URL: ${JSON.stringify(raw)}`);
    }
    if (url.username || url.password) {
        fail(`${label} must not contain userinfo credentials`);
    }
    if (url.search || url.hash) {
        fail(`${label} must not contain query or fragment`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        fail(`${label} must be an http(s) URL, got ${url.protocol}`);
    }
    if (!url.hostname) {
        fail(`${label} is missing a host`);
    }
    if (url.hostname === '0.0.0.0' || url.hostname === '*' || url.hostname.startsWith('*.')) {
        fail(`${label} host must not be a wildcard`);
    }
    if (url.pathname !== '/' && url.pathname !== '') {
        fail(`${label} must have an empty path (got "${url.pathname}")`);
    }
    if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
        fail(`${label} http URL requires loopback host; got "${url.hostname}"`);
    }
    if (url.protocol === 'https:' && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
        fail(`${label} loopback hosts must use http://`);
    }
    const hostLower = url.hostname.toLowerCase();
    let canonical;
    if (url.port) {
        canonical = `${url.protocol}//${hostLower}:${url.port}`;
    } else {
        canonical = `${url.protocol}//${hostLower}`;
    }
    return {
        canonical,
        protocol: url.protocol,
        hostname: hostLower
    };
}

function resolveOrigins(env) {
    const productionRaw = env.TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN;
    if (!productionRaw) {
        fail('TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN is required and must be an https origin');
    }
    const production = parseOrigin(productionRaw, 'TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN');
    if (production.protocol !== 'https:') {
        fail('TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN must be https');
    }
    const devRaw = env.TIDE_BOT_DESKTOP_DEV_ORIGIN;
    let dev = null;
    if (devRaw) {
        const parsed = parseOrigin(devRaw, 'TIDE_BOT_DESKTOP_DEV_ORIGIN');
        if (parsed.protocol !== 'http:') {
            fail('TIDE_BOT_DESKTOP_DEV_ORIGIN must be an http loopback origin');
        }
        dev = parsed;
    }
    return { production, dev };
}

function normalizeOrigins({ production, dev }) {
    const urls = [production.canonical];
    if (dev) urls.push(dev.canonical);
    return urls;
}

function loadTemplate() {
    if (!existsSync(TEMPLATE_PATH)) {
        fail(`missing capability template at ${TEMPLATE_PATH}`);
    }
    const templateRaw = readFileSync(TEMPLATE_PATH, 'utf8');
    let parsed;
    try {
        parsed = JSON.parse(templateRaw);
    } catch (error) {
        fail(`template is not valid JSON: ${error.message}`);
    }
    return { templateRaw, template: parsed };
}

function renderCapability(template, urls) {
    const capability = JSON.parse(JSON.stringify(template));
    if (!capability.windows || !Array.isArray(capability.windows) || capability.windows.length === 0) {
        fail('template must declare a non-empty windows array');
    }
    if (!capability.permissions || !Array.isArray(capability.permissions) || capability.permissions.length === 0) {
        fail('template must declare a non-empty permissions array');
    }
    if (!capability.remote || !Array.isArray(capability.remote.urls)) {
        capability.remote = { urls: [] };
    }
    capability.remote = { urls };
    return capability;
}

export function resolveMode({ argv = process.argv, env = process.env, repoRootDir = process.cwd() } = {}) {
    const args = argv.slice(2);
    if (args[0] === 'print-remote-urls') {
        const { production, dev } = resolveOrigins(env);
        const urls = normalizeOrigins({ production, dev });
        return { mode: 'print-remote-urls', urls };
    }
    if (args[0] !== 'resolve') {
        fail(`unknown subcommand: ${JSON.stringify(args[0]) ?? '(missing)'}`);
    }
    let outDirArg = null;
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--out-dir') {
            outDirArg = args[i + 1];
            i++;
        } else if (args[i].startsWith('--out-dir=')) {
            outDirArg = args[i].slice('--out-dir='.length);
        } else {
            fail(`unexpected argument: ${args[i]}`);
        }
    }
    if (!outDirArg) {
        fail('--out-dir <absolute path> is required for resolve');
    }
    const outDir = path.isAbsolute(outDirArg)
        ? outDirArg
        : path.resolve(repoRootDir, outDirArg);
    const { production, dev } = resolveOrigins(env);
    const urls = normalizeOrigins({ production, dev });
    const { templateRaw, template } = loadTemplate();
    const capability = renderCapability(template, urls);
    const capabilityText = `${JSON.stringify(capability, null, 2)}\n`;
    const capabilitiesDir = path.join(outDir, 'src-tauri', 'capabilities');
    const generatedDir = path.join(outDir, 'src-tauri', 'generated');
    const capabilityFinal = path.join(capabilitiesDir, 'companion.json');
    const provenanceFinal = path.join(generatedDir, 'desktop-origin-provenance.json');
    mkdirSync(capabilitiesDir, { recursive: true });
    mkdirSync(generatedDir, { recursive: true });

    const stamp = `${process.pid}.${Date.now()}.${randomBytes(8).toString('hex')}`;
    const capabilityTmp = `${capabilityFinal}.${stamp}.tmp`;
    const provenanceTmp = `${provenanceFinal}.${stamp}.tmp`;
    const resolverText = readFileSync(__filename, 'utf8');
    const provenance = {
        schemaVersion: SCHEMA_VERSION,
        resolverSha256: sha256(resolverText),
        templateSha256: sha256(templateRaw),
        capabilitySha256: sha256(capabilityText),
        normalizedOriginsHash: sha256(JSON.stringify(urls)),
        generationNonce: randomBytes(32).toString('hex')
    };
    const provenanceText = `${JSON.stringify(provenance, null, 2)}\n`;
    writeFileSync(capabilityTmp, capabilityText, 'utf8');
    renameSync(capabilityTmp, capabilityFinal);
    writeFileSync(provenanceTmp, provenanceText, 'utf8');
    renameSync(provenanceTmp, provenanceFinal);
    return {
        mode: 'resolve',
        outDir,
        capabilityPath: capabilityFinal,
        provenancePath: provenanceFinal,
        urls,
        nonce: provenance.generationNonce,
        capabilitySha256: provenance.capabilitySha256,
        provenanceSha256: sha256(provenanceText)
    };
}

function main() {
    const result = resolveMode();
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] === __filename) {
    main();
}
