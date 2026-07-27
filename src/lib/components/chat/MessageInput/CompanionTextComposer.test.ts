// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import CompanionTextComposer from './CompanionTextComposer.svelte';

afterEach(cleanup);

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

test('clears the local draft when the active companion chat changes', async () => {
	const view = render(CompanionTextComposer, {
		props: { chatId: 'chat-a', isGenerating: false }
	});

	const input = view.getByRole('textbox');
	await fireEvent.input(input, { target: { value: 'Draft for chat A' } });
	expect(input).toHaveValue('Draft for chat A');

	await view.rerender({ chatId: 'chat-b', isGenerating: false });

	expect(view.getByRole('textbox')).toHaveValue('');
});
