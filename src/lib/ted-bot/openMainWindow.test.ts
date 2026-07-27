import { expect, test, vi } from 'vitest';
import { openMainWindow } from './openMainWindow';

test('uses the native show-main command only inside Tauri', async () => {
	const invoke = vi.fn().mockResolvedValue(undefined);
	await openMainWindow({
		invoke,
		navigate: vi.fn(),
		windowRef: { __TAURI_INTERNALS__: {} } as unknown as Window
	});
	expect(invoke).toHaveBeenCalledWith('show_main_window');
});

test('falls back to Tide-Bot navigation outside Tauri and during SSR', async () => {
	const navigate = vi.fn();
	await openMainWindow({ invoke: vi.fn(), navigate, windowRef: undefined });
	expect(navigate).toHaveBeenCalledWith('/');
});

test('falls back when a Tauri runtime has no callable invoke bridge', async () => {
	const navigate = vi.fn();
	await openMainWindow({
		invoke: undefined,
		navigate,
		windowRef: { __TAURI_INTERNALS__: {} } as unknown as Window
	});
	expect(navigate).toHaveBeenCalledWith('/');
});
