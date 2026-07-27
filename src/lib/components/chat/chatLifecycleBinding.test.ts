import { describe, expect, test, vi } from 'vitest';
import { createChatLifecycleBinding, type ChatLifecycleStage } from './chatLifecycleBinding';

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
};

describe.each([
	['load', 'reset'],
	['completion', 'reset'],
	['stop', 'destroy'],
	['queue', 'destroy']
] as const)('%s continuation', (stage, invalidation) => {
	test(`does not apply its real mutation after ${invalidation}`, async () => {
		const binding = createChatLifecycleBinding();
		const operation = deferred<void>();
		const mutation = vi.fn();
		const callback = vi.fn();
		const eventCallback = binding.registerPendingEventCallback(callback);
		const continuation = binding.capture(stage satisfies ChatLifecycleStage, mutation);
		const settled = operation.promise.then(() => continuation.continueIfCurrent());

		if (invalidation === 'reset') {
			binding.resetForNavigation();
		} else {
			binding.destroy();
		}
		operation.resolve();

		await expect(settled).resolves.toBe(false);
		expect(mutation).not.toHaveBeenCalled();
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(false);

		eventCallback.settle(true);
		expect(callback).toHaveBeenCalledTimes(1);
	});
});

test('executes a current continuation exactly once', async () => {
	const binding = createChatLifecycleBinding();
	const mutation = vi.fn();
	const continuation = binding.capture('completion', mutation);

	await expect(continuation.continueIfCurrent()).resolves.toBe(true);
	await expect(continuation.continueIfCurrent()).resolves.toBe(false);
	expect(mutation).toHaveBeenCalledTimes(1);
});

test.each([
	['confirmation', true],
	['input', 'provided value'],
	['execute', { ok: true }],
	['embedded action confirm prompt', true],
	['embedded input confirm prompt', false]
])('%s event callback settles normally once before later invalidation', (_path, value) => {
	const binding = createChatLifecycleBinding();
	const callback = vi.fn();
	const eventCallback = binding.registerPendingEventCallback(callback);

	expect(eventCallback.settle(value)).toBe(true);
	binding.resetForNavigation();
	binding.destroy();
	expect(eventCallback.settle(false)).toBe(false);

	expect(callback).toHaveBeenCalledTimes(1);
	expect(callback).toHaveBeenCalledWith(value);
});
