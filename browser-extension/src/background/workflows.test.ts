import { describe, expect, it, vi } from 'vitest';

import { WorkflowManager } from './workflows';

const setup = () => {
	const tabs = { sendMessage: vi.fn(async () => ({ ok: true })) };
	const api = {
		createWorkflow: vi.fn(async (value) => ({ id: 'workflow-a', version: 1, ...value })),
		updateWorkflow: vi.fn(async (_id, value) => ({ id: _id, ...value })),
		workflows: vi.fn(async () => [])
	};
	const execute = vi.fn(async () => ({ ok: true }));
	const manager = new WorkflowManager({ tabs, api, execute, now: () => 1_000 });
	return { manager, tabs, api, execute };
};

describe('WorkflowManager', () => {
	it('records one controlled tab and requires review before encrypted server save', async () => {
		const { manager, tabs, api } = setup();
		const started = await manager.start(7, 'https://example.com/report');
		manager.capture(7, started.recordingId, {
			action: 'click',
			target: { role: 'button', name: 'Open report', tag: 'button' }
		});
		manager.capture(7, started.recordingId, {
			action: 'type-intent',
			target: { role: 'textbox', name: 'Password', tag: 'input', type: 'password' },
			sensitive: true
		});
		const draft = await manager.stop(7);

		expect(tabs.sendMessage).toHaveBeenNthCalledWith(
			1,
			7,
			expect.objectContaining({ type: 'recording:start', recordingId: started.recordingId })
		);
		expect(draft.steps).toHaveLength(2);
		expect(JSON.stringify(draft)).not.toMatch(/hunter2|value.*password/i);
		await expect(
			manager.saveDraft(draft, { name: 'Morning report', reviewed: false })
		).rejects.toMatchObject({ code: 'review_required' });
		await manager.saveDraft(draft, { name: 'Morning report', reviewed: true });
		expect(api.createWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Morning report',
				definition: expect.objectContaining({ schemaVersion: 1, steps: draft.steps })
			})
		);
	});

	it('rejects cross-tab, raw-selector, and secret-bearing recording events', async () => {
		const { manager } = setup();
		const started = await manager.start(4, 'https://example.com');

		expect(() =>
			manager.capture(5, started.recordingId, {
				action: 'click',
				target: { role: 'button', name: 'Go', tag: 'button' }
			})
		).toThrowError('recording_tab_mismatch');
		expect(() =>
			manager.capture(4, started.recordingId, {
				action: 'click',
				target: { selector: '#admin' }
			} as any)
		).toThrowError('invalid_workflow_step');
		expect(() =>
			manager.capture(4, started.recordingId, {
				action: 'type-intent',
				target: { role: 'textbox', name: 'Password', tag: 'input' },
				text: 'hunter2'
			} as any)
		).toThrowError('invalid_workflow_step');
	});

	it('replays semantic actions and pauses when user input or approval is required', async () => {
		const { manager, execute } = setup();
		const definition = {
			schemaVersion: 1 as const,
			origin: 'https://example.com',
			steps: [
				{ action: 'navigate' as const, url: 'https://example.com/report' },
				{
					action: 'click' as const,
					target: { role: 'button', name: 'Open report', tag: 'button' }
				},
				{
					action: 'type-intent' as const,
					target: { role: 'textbox', name: 'Email', tag: 'input' },
					sensitive: false
				}
			]
		};

		await expect(manager.replay(definition)).rejects.toMatchObject({
			code: 'workflow_input_required',
			stepIndex: 2
		});
		expect(execute).toHaveBeenNthCalledWith(1, {
			name: 'browser_navigate',
			args: { url: 'https://example.com/report' },
			mutating: true
		});
		expect(execute).toHaveBeenNthCalledWith(2, {
			name: 'browser_click',
			args: { target: { role: 'button', name: 'Open report', tag: 'button' } },
			mutating: true
		});
	});
});
