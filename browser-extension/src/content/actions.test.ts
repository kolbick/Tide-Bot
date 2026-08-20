// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DomActions, DomActionError } from './actions';
import { DomObserver } from './dom';

const setup = (html: string) => {
	document.body.innerHTML = html;
	const observer = new DomObserver({ document, window, nonce: 'test' });
	const actions = new DomActions({ document, window, observer, sleep: vi.fn() });
	const snapshot = observer.observe();
	return { observer, actions, snapshot };
};

describe('DomActions', () => {
	beforeEach(() => {
		history.replaceState({}, '', '/actions');
	});

	it('clicks only an observed handle and re-observes after the mutation', async () => {
		const { actions, observer, snapshot } = setup('<button>Save</button>');
		const clicked = vi.fn();
		document.querySelector('button')!.addEventListener('click', clicked);
		const handle = snapshot.interactive[0].handle;

		const result = await actions.execute('browser_click', {
			target: { handle },
			action: 'click',
			button: 'left'
		});

		expect(clicked).toHaveBeenCalledOnce();
		expect(result).toMatchObject({ ok: true, snapshot: { revision: snapshot.revision + 1 } });
		expect(() => observer.resolve(handle)).toThrowError(
			expect.objectContaining({ code: 'stale_handle' })
		);
	});

	it('types with native value setters and input/change events without returning the value', async () => {
		const { actions, snapshot } = setup('<label for="email">Email</label><input id="email" />');
		const input = document.querySelector('input')!;
		const events: string[] = [];
		input.addEventListener('input', () => events.push('input'));
		input.addEventListener('change', () => events.push('change'));

		const result = await actions.execute('browser_type', {
			target: { handle: snapshot.interactive[0].handle },
			text: 'private@example.com',
			operation: 'replace',
			fieldKind: 'ordinary'
		});

		expect(input.value).toBe('private@example.com');
		expect(events).toEqual(['input', 'change']);
		expect(JSON.stringify(result)).not.toContain('private@example.com');
	});

	it('selects only declared option values and emits input/change', async () => {
		const { actions } = setup(`
			<label>Country
				<select id="country">
					<option value="us">United States</option>
					<option value="ca">Canada</option>
				</select>
			</label>
		`);
		const select = document.querySelector('select')!;
		const events: string[] = [];
		select.addEventListener('input', () => events.push('input'));
		select.addEventListener('change', () => events.push('change'));

		const result = await actions.execute('browser_select', {
			target: { role: 'combobox', name: 'Country' },
			values: ['ca']
		});

		expect(select.value).toBe('ca');
		expect(events).toEqual(['input', 'change']);
		expect(result).toMatchObject({ ok: true, selectedCount: 1 });
	});

	it('rejects raw selectors, unknown handles, stale handles, and wrong element types', async () => {
		const { actions, snapshot } = setup('<button>Save</button>');

		await expect(
			actions.execute('browser_click', { target: { selector: '#save' } })
		).rejects.toBeInstanceOf(DomActionError);
		await expect(
			actions.execute('browser_click', { target: { handle: 'tbx_unknown' } })
		).rejects.toMatchObject({ code: 'stale_handle' });
		const stale = snapshot.interactive[0].handle;
		actions.observe();
		await expect(
			actions.execute('browser_click', { target: { handle: stale } })
		).rejects.toMatchObject({ code: 'stale_handle' });
		const current = actions.observe().interactive[0].handle;
		await expect(
			actions.execute('browser_select', { target: { handle: current }, values: ['x'] })
		).rejects.toMatchObject({ code: 'invalid_target' });
	});

	it('resolves semantic targets without accepting CSS selectors', async () => {
		const { actions } = setup('<button aria-label="Save changes">Save</button>');
		const clicked = vi.fn();
		document.querySelector('button')!.addEventListener('click', clicked);

		await actions.execute('browser_click', {
			target: { role: 'button', name: 'Save changes' }
		});

		expect(clicked).toHaveBeenCalledOnce();
	});

	it('waits for bounded delay, text, URL, and element conditions', async () => {
		const sleep = vi.fn(async () => undefined);
		document.body.innerHTML = '<p>Ready now</p><button>Continue</button>';
		const observer = new DomObserver({ document, window, nonce: 'test' });
		const actions = new DomActions({ document, window, observer, sleep, clock: () => 1_000 });
		observer.observe();

		expect(
			await actions.execute('browser_wait', { condition: 'text', text: 'Ready now' })
		).toMatchObject({ ok: true });
		expect(
			await actions.execute('browser_wait', {
				condition: 'element',
				target: { role: 'button', name: 'Continue' }
			})
		).toMatchObject({ ok: true });
		expect(
			await actions.execute('browser_wait', { condition: 'url', url: location.href })
		).toMatchObject({ ok: true });
		expect(
			await actions.execute('browser_wait', { condition: 'delay', milliseconds: 20 })
		).toMatchObject({ ok: true });
		expect(sleep).toHaveBeenCalledWith(20);
	});

	it('resolves observed HTTP download links without starting or leaking them remotely', async () => {
		const { actions, snapshot } = setup(
			'<a href="https://example.com/report.pdf?signature=ephemeral" download="report.pdf">Report</a>'
		);

		const result = await actions.execute('browser_download', {
			target: { handle: snapshot.interactive[0].handle }
		});

		expect(result).toEqual({
			ok: true,
			download: {
				url: 'https://example.com/report.pdf?signature=ephemeral',
				filename: 'report.pdf'
			}
		});
		document.querySelector('a')!.setAttribute('href', 'javascript:alert(1)');
		const current = actions.observe().interactive[0].handle;
		await expect(
			actions.execute('browser_download', { target: { handle: current } })
		).rejects.toMatchObject({ code: 'restricted_url' });
	});
});
