// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import VoiceControls from './VoiceControls.svelte';

afterEach(cleanup);

describe('VoiceControls', () => {
	it('shows hands-free as the default and keeps stop voice one tap away', async () => {
		const onMode = vi.fn();
		const onStop = vi.fn();
		render(VoiceControls, {
			props: {
				status: {
					inputMode: 'voice',
					voiceMode: 'hands-free',
					listening: true,
					recording: false,
					processing: false,
					error: null
				},
				onMode,
				onStop,
				onRetry: vi.fn(),
				onPushStart: vi.fn(),
				onPushEnd: vi.fn()
			}
		});

		expect(screen.getByRole('status')).toHaveTextContent('Listening');
		expect(screen.getByRole('combobox', { name: 'Voice mode' })).toHaveValue('hands-free');
		await fireEvent.change(screen.getByRole('combobox', { name: 'Voice mode' }), {
			target: { value: 'push-to-talk' }
		});
		expect(onMode).toHaveBeenCalledWith('push-to-talk');
		await fireEvent.click(screen.getByRole('button', { name: 'Stop voice' }));
		expect(onStop).toHaveBeenCalledOnce();
	});

	it('uses a hold gesture for push-to-talk and offers microphone retry', async () => {
		const onPushStart = vi.fn();
		const onPushEnd = vi.fn();
		const onRetry = vi.fn();
		const { rerender } = render(VoiceControls, {
			props: {
				status: {
					inputMode: 'voice',
					voiceMode: 'push-to-talk',
					listening: true,
					recording: false,
					processing: false,
					error: null
				},
				onMode: vi.fn(),
				onStop: vi.fn(),
				onRetry,
				onPushStart,
				onPushEnd
			}
		});

		const hold = screen.getByRole('button', { name: 'Hold to talk' });
		await fireEvent.pointerDown(hold);
		await fireEvent.pointerUp(hold);
		expect(onPushStart).toHaveBeenCalledOnce();
		expect(onPushEnd).toHaveBeenCalledOnce();

		await rerender({
			status: {
				inputMode: 'text',
				voiceMode: 'hands-free',
				listening: false,
				recording: false,
				processing: false,
				error: 'microphone_denied'
			},
			onMode: vi.fn(),
			onStop: vi.fn(),
			onRetry,
			onPushStart,
			onPushEnd
		});
		expect(await screen.findByText('Microphone access is blocked.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Try microphone again' }));
		expect(onRetry).toHaveBeenCalledOnce();
	});
});
