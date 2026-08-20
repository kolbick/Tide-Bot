// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WorkflowManager from './WorkflowManager.svelte';

const api = () => ({
	workflows: vi.fn(async () => []),
	schedules: vi.fn(async () => []),
	startRecording: vi.fn(async () => ({ recordingId: 'recording-a' })),
	stopRecording: vi.fn(async () => ({
		recordingId: 'recording-a',
		origin: 'https://example.com',
		startedAt: 1,
		stoppedAt: 2,
		steps: [
			{
				action: 'click',
				target: { role: 'button', name: 'Open report', tag: 'button' }
			}
		]
	})),
	createWorkflow: vi.fn(async (value) => ({ id: 'workflow-a', version: 1, ...value })),
	deleteWorkflow: vi.fn(async () => undefined),
	createSchedule: vi.fn(async (value) => ({ id: 'schedule-a', ...value })),
	deleteSchedule: vi.fn(async () => undefined)
});

afterEach(cleanup);

describe('WorkflowManager panel', () => {
	it('records, reviews, and saves a semantic workflow', async () => {
		const extensionApi = api();
		render(WorkflowManager, {
			props: {
				api: extensionApi as any,
				connected: true,
				sessionActive: true,
				deviceId: 'device-a'
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Manage workflows' }));
		await waitFor(() => expect(extensionApi.workflows).toHaveBeenCalledOnce());
		await fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }));
		expect(await screen.findByText('Recording this tab')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Stop and review' }));

		expect(await screen.findByText('Review 1 recorded step')).toBeTruthy();
		await fireEvent.input(screen.getByRole('textbox', { name: 'Workflow name' }), {
			target: { value: 'Morning report' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Save reviewed workflow' }));

		expect(extensionApi.createWorkflow).toHaveBeenCalledWith({
			name: 'Morning report',
			definition: {
				schemaVersion: 1,
				origin: 'https://example.com',
				steps: expect.any(Array)
			}
		});
	});

	it('does not offer recording without a live controlled-tab session', async () => {
		render(WorkflowManager, {
			props: { api: api() as any, connected: true, sessionActive: false, deviceId: 'device-a' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Manage workflows' }));

		expect(await screen.findByRole('button', { name: 'Start recording' })).toBeDisabled();
		expect(screen.getByText('Start controlling a tab before recording.')).toBeTruthy();
	});
});
