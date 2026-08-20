// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from './App.svelte';
import type { SidePanelApi, SidePanelEvent } from './api';

const fakeApi = (changes: Partial<SidePanelApi> = {}) => {
	let listener: ((event: SidePanelEvent) => void) | null = null;
	const api: SidePanelApi = {
		status: vi.fn(async () => ({
			paired: true,
			connected: true,
			serverOrigin: 'https://tide-bot.com',
			deviceId: 'device-a',
			session: null
		})),
		beginPairing: vi.fn(),
		reconnect: vi.fn(async () => undefined),
		openSession: vi.fn(async (options) => ({
			sessionId: options.sessionId,
			tabId: 7,
			url: 'https://example.com',
			origin: 'https://example.com',
			actionMode: options.actionMode,
			tabPolicy: options.tabPolicy
		})),
		closeSession: vi.fn(async () => undefined),
		models: vi.fn(async () => [
			{ id: 'local-model', name: 'Tide Local 8B', owned_by: 'ollama' },
			{ id: 'cloud-model', name: 'Optional Cloud Model', owned_by: 'openai' }
		]),
		chats: vi.fn(async () => []),
		chat: vi.fn(),
		createChat: vi.fn(async (chat) => ({ id: chat.id, chat })),
		updateChat: vi.fn(async (_id, chat) => ({ id: _id, chat })),
		streamCompletion: vi.fn(async (_body, handlers) => {
			handlers.onActivity({ label: 'Observed page', status: 'complete' });
			handlers.onDelta('I can help with that.');
			return { chatId: _body.chat_id };
		}),
		transcribe: vi.fn(async () => 'Voice message'),
		speak: vi.fn(async () => new Blob(['speech'], { type: 'audio/mpeg' })),
		workflows: vi.fn(async () => []),
		workflow: vi.fn(),
		createWorkflow: vi.fn(),
		updateWorkflow: vi.fn(),
		deleteWorkflow: vi.fn(async () => undefined),
		schedules: vi.fn(async () => []),
		createSchedule: vi.fn(),
		updateSchedule: vi.fn(),
		deleteSchedule: vi.fn(async () => undefined),
		startRecording: vi.fn(async () => ({ recordingId: 'recording-a' })),
		stopRecording: vi.fn(),
		resolveApproval: vi.fn(async () => true),
		subscribe: vi.fn((next) => {
			listener = next;
			return () => {
				listener = null;
			};
		}),
		...changes
	};
	return {
		api,
		emit(event: SidePanelEvent) {
			listener?.(event);
		}
	};
};

afterEach(cleanup);

describe('Tide-Bot side panel', () => {
	it('loads paired models and chats with text, autonomous, and locked-tab defaults', async () => {
		const { api } = fakeApi();
		render(App, { props: { api } });

		expect(await screen.findByRole('heading', { name: 'Tide-Bot Browser Control' })).toBeTruthy();
		await waitFor(() => expect(api.models).toHaveBeenCalledOnce());
		expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('local-model');
		expect(screen.getByRole('combobox', { name: 'Action mode' })).toHaveValue('autonomous');
		expect(screen.getByRole('combobox', { name: 'Tab policy' })).toHaveValue('locked');
		expect(screen.getByRole('textbox', { name: 'Message Tide-Bot' })).toBe(document.activeElement);
		expect(screen.getByRole('button', { name: 'Use voice' })).toHaveAttribute(
			'aria-pressed',
			'false'
		);
	});

	it('opens one browser session, creates a normal chat, and streams text and activity', async () => {
		const { api } = fakeApi();
		render(App, { props: { api } });
		await screen.findByRole('option', { name: 'Tide Local 8B' });

		await fireEvent.click(screen.getByRole('button', { name: 'Start controlling tab' }));
		await waitFor(() => expect(api.openSession).toHaveBeenCalledOnce());
		const input = screen.getByRole('textbox', { name: 'Message Tide-Bot' });
		await fireEvent.input(input, { target: { value: 'Open the report' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

		await waitFor(() => expect(api.createChat).toHaveBeenCalledOnce());
		expect(api.streamCompletion).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'local-model',
				features: { browser_control: true },
				browser_session: expect.any(String)
			}),
			expect.any(Object)
		);
		expect(await screen.findByText('Open the report')).toBeTruthy();
		expect(await screen.findByText('I can help with that.')).toBeTruthy();
		expect(await screen.findByText('Observed page')).toBeTruthy();
	});

	it('shows inline approvals and lets the user allow or deny', async () => {
		const { api, emit } = fakeApi();
		render(App, { props: { api } });
		await screen.findByText('Connected');

		emit({
			type: 'approval',
			approval: {
				commandId: 'command-a',
				summary: 'browser_click on Purchase now',
				reason: 'consequential_action'
			}
		});

		expect(await screen.findByText('Approval needed')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Allow action' }));
		expect(api.resolveApproval).toHaveBeenCalledWith('command-a', true);
	});

	it('surfaces offline recovery without losing the paired state', async () => {
		const { api } = fakeApi({
			status: vi.fn(async () => ({
				paired: true,
				connected: false,
				serverOrigin: 'https://tide-bot.com',
				deviceId: 'device-a',
				session: null
			}))
		});
		render(App, { props: { api } });

		expect(await screen.findByText('Offline')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
		expect(api.reconnect).toHaveBeenCalledOnce();
	});
});
