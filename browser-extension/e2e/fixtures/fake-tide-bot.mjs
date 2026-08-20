import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(dirname(fixtureDir)));
const serverScript = join(fixtureDir, 'fake-tide-bot.py');
const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 5_000;

async function fixedPython() {
	const virtualEnvironmentPython = join(repoRoot, '.venv/bin/python');
	try {
		await access(virtualEnvironmentPython);
		return virtualEnvironmentPython;
	} catch {
		return 'python3';
	}
}

export async function startFakeTideBot(...args) {
	if (args.length) throw new Error('fake_tide_bot_options_are_fixed');
	const child = spawn(await fixedPython(), [serverScript], {
		cwd: repoRoot,
		env: { PATH: process.env.PATH ?? '' },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let buffer = '';
	let settled = false;
	const startup = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill('SIGTERM');
			reject(new Error('fake_tide_bot_start_timeout'));
		}, START_TIMEOUT_MS);
		const fail = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(new Error('fake_tide_bot_start_failed'));
		};
		child.once('error', fail);
		child.once('exit', fail);
		child.stdout.on('data', (chunk) => {
			if (settled) return;
			buffer = `${buffer}${chunk}`.slice(-8_192);
			const lineEnd = buffer.indexOf('\n');
			if (lineEnd < 0) return;
			let value;
			try {
				value = JSON.parse(buffer.slice(0, lineEnd));
			} catch {
				fail();
				return;
			}
			if (typeof value?.origin !== 'string') {
				fail();
				return;
			}
			settled = true;
			clearTimeout(timer);
			resolve(value);
		});
	});

	return {
		origin: startup.origin,
		async stop() {
			if (child.exitCode !== null || child.signalCode !== null) return;
			child.kill('SIGTERM');
			await new Promise((resolve) => {
				const timer = setTimeout(() => {
					child.kill('SIGKILL');
					resolve();
				}, STOP_TIMEOUT_MS);
				child.once('exit', () => {
					clearTimeout(timer);
					resolve();
				});
			});
		}
	};
}
