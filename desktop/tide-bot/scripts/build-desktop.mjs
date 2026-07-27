#!/usr/bin/env node
// Single tracked entry point for all Tauri/Cargo operations: tests, debug
// builds, Windows release builds. The brief forbids direct cargo or tauri
// invocation; this wrapper is the only supported invocation path.
//
// Responsibilities:
//   1. Reject any origin environment variable other than the two allowed
//      build inputs: TIDE_BOT_DESKTOP_PRODUCTION_ORIGIN and
//      TIDE_BOT_DESKTOP_DEV_ORIGIN. Raw TIDE_BOT_URL or other runtime
//      overrides can never influence the compiled URL.
//   2. Materialize both generated JSON artifacts fresh via
//      scripts/desktop-origins.mjs in the workspace root.
//   3. Pass only TIDE_BOT_DESKTOP_GENERATION_NONCE (the freshly generated
//      nonce) and the test/build command to cargo/tauri.
//   4. Capture and surface cargo's exit; print the resolved capability path
//      and nonce so the report records them.
//
// The launcher itself never reads runtime URL environment variables; the
// brief explicitly forbids any runtime origin override.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.dirname(__filename);
const DESKTOP_DIR = path.dirname(SCRIPTS_DIR);
const SRC_TAURI_DIR = path.join(DESKTOP_DIR, 'src-tauri');

const FORBIDDEN_ENV = [
    'TIDE_BOT_URL',
    'TIDE_BOT_REMOTE_URL',
    'TIDE_BOT_COMPANION_URL',
    'TIDE_BOT_APP_URL',
    'TIDE_BOT_REMOTE',
    'TIDE_BOT_COMPANION_ORIGIN',
    'TAURI_REMOTE_URL'
];

function findCargo() {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const cargoHome = process.env.CARGO_HOME || path.join(home, '.cargo');
    const candidates = [
        process.env.CARGO_BIN,
        path.join(cargoHome, 'bin', 'cargo'),
        path.join(cargoHome, 'bin', 'cargo.exe'),
        '/usr/local/cargo/bin/cargo',
        '/usr/local/cargo/bin/cargo.exe',
        '/opt/homebrew/bin/cargo',
        '/usr/bin/cargo'
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
    }
    // Fall back to PATH lookup so the GitHub Actions runner (which installs
    // rustup to %USERPROFILE%\.cargo\bin and adds it to PATH) can find cargo
    // regardless of the exact home directory layout.
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
        for (const name of ['cargo', 'cargo.exe']) {
            const full = path.join(dir, name);
            if (existsSync(full)) return full;
        }
    }
    return null;
}

function fail(message) {
    process.stderr.write(`build-desktop: ${message}\n`);
    process.exit(1);
}

function validateEnv(env) {
    for (const key of FORBIDDEN_ENV) {
        if (Object.prototype.hasOwnProperty.call(env, key)) {
            fail(`${key} is a forbidden runtime origin override; remove it before invoking build-desktop.mjs`);
        }
    }
}

function prepareOrigins(env, outDir) {
    const scriptPath = path.join(SCRIPTS_DIR, 'desktop-origins.mjs');
    if (!existsSync(scriptPath)) {
        fail(`missing origin resolver at ${scriptPath}`);
    }
    const invocation = [process.execPath, scriptPath, 'resolve', `--out-dir=${outDir}`];
    const result = spawnSync(invocation[0], invocation.slice(1), {
        env,
        cwd: outDir,
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        const stderr = String(result.stderr ?? '').trim();
        fail(`origin resolver failed (exit ${result.status})${stderr ? `: ${stderr}` : ''}`);
    }
    const stdout = String(result.stdout ?? '').trim();
    if (!stdout) {
        fail('origin resolver produced no output');
    }
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch (error) {
        fail(`origin resolver output is not JSON: ${error.message}; raw=${stdout.slice(0, 200)}`);
    }
    return parsed;
}

function invokeCargo({ cargo, env, args, cwd, label }) {
    const result = spawnSync(cargo, args, {
        env,
        cwd,
        encoding: 'utf8',
        stdio: 'inherit'
    });
    if (result.error) {
        fail(`${label} could not spawn cargo: ${result.error.message}; install Rust toolchain (rustup) or set CARGO_BIN`);
    }
    return result.status ?? 1;
}

export async function runBuildDesktop({ argv = process.argv, env = process.env, prepare = prepareOrigins } = {}) {
    validateEnv(env);
    const args = argv.slice(2);
    const command = args[0];
    if (!command) {
        fail('usage: node build-desktop.mjs <test-tauri-generated|build-debug|build-windows>');
    }
    if (!['test-tauri-generated', 'build-debug', 'build-windows'].includes(command)) {
        fail(`unknown subcommand: ${command}`);
    }
    if (!existsSync(SRC_TAURI_DIR)) {
        fail(`missing src-tauri directory at ${SRC_TAURI_DIR}; the Tauri shell has not been scaffolded`);
    }
    const prepared = prepare(env, DESKTOP_DIR);
    if (prepared.mode !== 'resolve') {
        fail(`unexpected resolver mode: ${prepared.mode}`);
    }
    const cargo = findCargo();
    if (!cargo) {
        fail('Rust toolchain not found; install rustup so ~/.cargo/bin/cargo exists, then set CARGO_BIN. Without Cargo, Tauri compilation cannot run.');
    }
    const augmentedEnv = {
        ...env,
        TIDE_BOT_DESKTOP_GENERATION_NONCE: prepared.nonce
    };
    process.stderr.write(
        `build-desktop: nonce=${prepared.nonce.slice(0, 16)}… capability=${prepared.capabilitySha256.slice(0, 16)}…\n`
    );
    if (command === 'test-tauri-generated') {
        const exit = invokeCargo({
            cargo,
            env: augmentedEnv,
            args: ['test', '--test', 'placement_test', '--test', 'capabilities_test', '--test', 'companion_url_test'],
            cwd: SRC_TAURI_DIR,
            label: 'test-tauri-generated'
        });
        if (exit !== 0) fail(`test-tauri-generated failed with exit ${exit}`);
        return { exit: 0, command, prepared };
    }
    if (command === 'build-debug') {
        const exit = invokeCargo({
            cargo,
            env: augmentedEnv,
            args: ['build'],
            cwd: SRC_TAURI_DIR,
            label: 'build-debug'
        });
        if (exit !== 0) fail(`build-debug failed with exit ${exit}`);
        return { exit: 0, command, prepared };
    }
    if (command === 'build-windows') {
        const exit = invokeCargo({
            cargo,
            env: augmentedEnv,
            args: ['build', '--release', '--target', 'x86_64-pc-windows-msvc'],
            cwd: SRC_TAURI_DIR,
            label: 'build-windows'
        });
        if (exit !== 0) fail(`build-windows failed with exit ${exit}`);
        return { exit: 0, command, prepared };
    }
    fail(`unknown subcommand: ${command}`);
}

if (process.argv[1] === __filename) {
    runBuildDesktop().catch((error) => {
        process.stderr.write(`build-desktop: ${error?.stack ?? error}\n`);
        process.exit(1);
    });
}
