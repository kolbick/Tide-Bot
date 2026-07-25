// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import CompanionTextComposer from './CompanionTextComposer.svelte';

test('typed composer sends entered text and exposes stop without optional controls', async () => {
	const send = vi.fn();
	const stop = vi.fn();
	render(CompanionTextComposer, {
		props: { isGenerating: true },
		events: {
			send: (event) => send(event.detail),
			stop
		}
	});

	const input = screen.getByRole('textbox');
	await fireEvent.input(input, { target: { value: 'Hello Ted-Bot' } });
	expect(input).toHaveValue('Hello Ted-Bot');
	await fireEvent.click(screen.getByRole('button', { name: /send/i }));
	expect(send).toHaveBeenCalledWith('Hello Ted-Bot');
	await fireEvent.click(screen.getByRole('button', { name: /stop/i }));
	expect(stop).toHaveBeenCalledTimes(1);
	expect(screen.queryByLabelText(/attach/i)).not.toBeInTheDocument();
	expect(screen.queryByLabelText(/microphone/i)).not.toBeInTheDocument();
});
