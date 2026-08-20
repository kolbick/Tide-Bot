// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentWorkflowRecorder } from './recording';

describe('ContentWorkflowRecorder', () => {
	beforeEach(() => {
		document.body.innerHTML = `
			<button aria-label="Open report">Open</button>
			<label>Password <input name="password" type="password" /></label>
			<label>Region <select name="region"><option value="north">North</option></select></label>
		`;
		history.replaceState({}, '', '/reports');
	});

	it('records reviewable semantic actions and lifecycle events', async () => {
		const runtime = { sendMessage: vi.fn(async () => ({ ok: true })) };
		const recorder = new ContentWorkflowRecorder({
			document,
			window,
			runtime,
			acceptEvent: () => true
		});

		recorder.start('recording-a');
		document.querySelector('button')?.click();
		const password = document.querySelector('input') as HTMLInputElement;
		password.value = 'hunter2';
		password.dispatchEvent(new InputEvent('input', { bubbles: true }));
		const select = document.querySelector('select') as HTMLSelectElement;
		select.value = 'north';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		const draft = recorder.stop();

		expect(draft.recordingId).toBe('recording-a');
		expect(draft.steps.map((step) => step.action)).toEqual([
			'navigate',
			'click',
			'type-intent',
			'select'
		]);
		expect(draft.steps[1]).toMatchObject({
			target: { role: 'button', name: 'Open report' }
		});
		expect(JSON.stringify(draft)).not.toMatch(/hunter2|password.*hunter2/i);
		expect(runtime.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'tide-bot:recording:event', recordingId: 'recording-a' })
		);
	});

	it('ignores synthetic events, caps steps, and stops capturing immediately', () => {
		const runtime = { sendMessage: vi.fn(async () => ({ ok: true })) };
		const recorder = new ContentWorkflowRecorder({ document, window, runtime, maxSteps: 2 });
		recorder.start('recording-b');
		document.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		const draft = recorder.stop();
		document.querySelector('button')?.click();

		expect(draft.steps).toHaveLength(1);
		expect(draft.steps[0].action).toBe('navigate');
		expect(recorder.status().active).toBe(false);
	});
});
