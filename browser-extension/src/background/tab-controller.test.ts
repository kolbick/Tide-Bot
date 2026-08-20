import { describe, expect, it, vi } from 'vitest';

import { SingleTabController, TabControlError } from './tab-controller';

class Event<T extends (...args: any[]) => unknown> {
	listeners: T[] = [];
	addListener = (listener: T) => this.listeners.push(listener);
	async fire(...args: Parameters<T>) {
		for (const listener of this.listeners) await listener(...args);
	}
}

const tabs = () => {
	const records = new Map<number, { id: number; url: string; active: boolean; windowId: number }>([
		[1, { id: 1, url: 'https://one.example/start', active: true, windowId: 1 }],
		[2, { id: 2, url: 'https://two.example/home', active: false, windowId: 1 }]
	]);
	return {
		records,
		get: vi.fn(async (tabId: number) => records.get(tabId)),
		query: vi.fn(async () => [...records.values()].filter((tab) => tab.active)),
		onActivated: new Event<(info: { tabId: number; windowId: number }) => unknown>(),
		onRemoved: new Event<(tabId: number) => unknown>(),
		onReplaced: new Event<(addedTabId: number, removedTabId: number) => unknown>(),
		onUpdated: new Event<
			(tabId: number, changeInfo: { url?: string }, tab: { id: number; url?: string }) => unknown
		>()
	};
};

const controller = (tabApi = tabs()) => {
	const events: string[] = [];
	const onSessionClose = vi.fn(async (session: { tabId: number }) => {
		events.push(`close:${session.tabId}`);
	});
	const onSessionOpen = vi.fn(async (session: { tabId: number }) => {
		events.push(`open:${session.tabId}`);
	});
	const instance = new SingleTabController({
		tabs: tabApi,
		onSessionOpen,
		onSessionClose
	});
	return { instance, tabApi, onSessionOpen, onSessionClose, events };
};

describe('SingleTabController', () => {
	it('locks a session to its starting tab and denies a second target', async () => {
		const { instance } = controller();
		await instance.open({
			sessionId: 'session-a',
			tabId: 1,
			actionMode: 'autonomous',
			tabPolicy: 'locked'
		});

		expect(instance.current()).toMatchObject({ tabId: 1, origin: 'https://one.example' });
		expect(instance.requireControlledTab(1).tabId).toBe(1);
		expect(() => instance.requireControlledTab(2)).toThrowError(
			expect.objectContaining({ code: 'second_tab_denied' })
		);
		await expect(
			instance.open({
				sessionId: 'session-b',
				tabId: 2,
				actionMode: 'autonomous',
				tabPolicy: 'locked'
			})
		).rejects.toMatchObject({ code: 'single_tab_only' });
	});

	it('keeps a locked session on its starting tab when another tab activates', async () => {
		const { instance, tabApi, events } = controller();
		await instance.open({
			sessionId: 'session-a',
			tabId: 1,
			actionMode: 'autonomous',
			tabPolicy: 'locked'
		});
		events.length = 0;

		await tabApi.onActivated.fire({ tabId: 2, windowId: 1 });

		expect(instance.current()?.tabId).toBe(1);
		expect(events).toEqual([]);
	});

	it('closes the old session before following the newly active tab', async () => {
		const { instance, tabApi, events } = controller();
		await instance.open({
			sessionId: 'session-a',
			tabId: 1,
			actionMode: 'consequential-approval',
			tabPolicy: 'follow-active'
		});
		events.length = 0;

		await tabApi.onActivated.fire({ tabId: 2, windowId: 1 });

		expect(events).toEqual(['close:1', 'open:2']);
		expect(instance.current()).toMatchObject({
			tabId: 2,
			origin: 'https://two.example',
			actionMode: 'consequential-approval'
		});
	});

	it('rebinds an atomically replaced controlled tab and clears a closed tab', async () => {
		const { instance, tabApi, events } = controller();
		await instance.open({
			sessionId: 'session-a',
			tabId: 1,
			actionMode: 'autonomous',
			tabPolicy: 'locked'
		});
		tabApi.records.set(3, {
			id: 3,
			url: 'https://replacement.example',
			active: true,
			windowId: 1
		});
		events.length = 0;

		await tabApi.onReplaced.fire(3, 1);
		expect(events).toEqual(['close:1', 'open:3']);
		expect(instance.current()?.tabId).toBe(3);

		await tabApi.onRemoved.fire(3);
		expect(instance.current()).toBeNull();
		expect(events.at(-1)).toBe('close:3');
	});

	it('tracks allowed origin changes and closes when the tab enters a restricted URL', async () => {
		const { instance, tabApi, onSessionClose } = controller();
		await instance.open({
			sessionId: 'session-a',
			tabId: 1,
			actionMode: 'autonomous',
			tabPolicy: 'locked'
		});

		await tabApi.onUpdated.fire(
			1,
			{ url: 'https://other.example/path' },
			{
				id: 1,
				url: 'https://other.example/path'
			}
		);
		expect(instance.current()?.origin).toBe('https://other.example');

		await tabApi.onUpdated.fire(
			1,
			{ url: 'chrome://settings' },
			{ id: 1, url: 'chrome://settings' }
		);
		expect(instance.current()).toBeNull();
		expect(onSessionClose).toHaveBeenCalled();
	});

	it.each(['chrome://settings', 'file:///tmp/private.txt', 'chrome-extension://abc/page.html'])(
		'denies restricted starting URL %s',
		async (url) => {
			const tabApi = tabs();
			tabApi.records.set(9, { id: 9, url, active: true, windowId: 1 });
			const { instance } = controller(tabApi);

			await expect(
				instance.open({
					sessionId: 'session-a',
					tabId: 9,
					actionMode: 'autonomous',
					tabPolicy: 'locked'
				})
			).rejects.toBeInstanceOf(TabControlError);
		}
	);
});
