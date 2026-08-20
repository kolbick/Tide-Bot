type Listener<T extends (...args: any[]) => unknown> = T;

class FakeEvent<T extends (...args: any[]) => unknown> {
	listeners: Listener<T>[] = [];

	addListener = (listener: Listener<T>) => {
		this.listeners.push(listener);
	};

	removeListener = (listener: Listener<T>) => {
		this.listeners = this.listeners.filter((candidate) => candidate !== listener);
	};

	async fire(...args: Parameters<T>) {
		return Promise.all(this.listeners.map((listener) => listener(...args)));
	}
}

export function createChromeMock(initialStorage: Record<string, unknown> = {}) {
	const storageData = { ...initialStorage };
	const alarms = new Map<string, Record<string, unknown>>();
	const openedTabs: Array<Record<string, unknown>> = [];
	const sentMessages: unknown[] = [];

	const chromeApi = {
		storage: {
			local: {
				async get(keys?: string | string[] | Record<string, unknown> | null) {
					if (keys == null) return { ...storageData };
					const names =
						typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
					return Object.fromEntries(
						names.filter((name) => name in storageData).map((name) => [name, storageData[name]])
					);
				},
				async set(values: Record<string, unknown>) {
					Object.assign(storageData, values);
				},
				async remove(keys: string | string[]) {
					for (const key of Array.isArray(keys) ? keys : [keys]) delete storageData[key];
				}
			}
		},
		alarms: {
			create(name: string, info: Record<string, unknown>) {
				alarms.set(name, { ...info });
			},
			clear(name: string) {
				return Promise.resolve(alarms.delete(name));
			},
			onAlarm: new FakeEvent<(alarm: { name: string }) => unknown>()
		},
		runtime: {
			onInstalled: new FakeEvent<() => unknown>(),
			onStartup: new FakeEvent<() => unknown>(),
			onMessage: new FakeEvent<
				(message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown
			>(),
			sendMessage(message: unknown) {
				sentMessages.push(message);
				return Promise.resolve();
			}
		},
		tabs: {
			async create(options: Record<string, unknown>) {
				openedTabs.push(options);
				return { id: openedTabs.length, ...options };
			}
		},
		sidePanel: {
			setPanelBehavior: async () => undefined
		}
	};

	return {
		chrome: chromeApi,
		storageData,
		alarms,
		openedTabs,
		sentMessages,
		async fireAlarm(name: string) {
			await chromeApi.alarms.onAlarm.fire({ name });
		}
	};
}

export class FakeSocket {
	connected = false;
	auth: Record<string, unknown> = {};
	handlers = new Map<string, Array<(...args: any[]) => unknown>>();
	emitted: Array<{ event: string; args: unknown[] }> = [];
	acks = new Map<string, (payload: unknown) => unknown>();

	on(event: string, handler: (...args: any[]) => unknown) {
		const handlers = this.handlers.get(event) ?? [];
		handlers.push(handler);
		this.handlers.set(event, handlers);
		return this;
	}

	off(event: string) {
		this.handlers.delete(event);
		return this;
	}

	emit(event: string, ...args: unknown[]) {
		this.emitted.push({ event, args });
		return this;
	}

	async emitWithAck(event: string, payload: unknown) {
		this.emitted.push({ event, args: [payload] });
		const handler = this.acks.get(event);
		if (!handler) throw new Error(`No acknowledgement for ${event}`);
		return handler(payload);
	}

	connect() {
		this.connected = true;
		queueMicrotask(() => void this.trigger('connect'));
		return this;
	}

	disconnect() {
		const wasConnected = this.connected;
		this.connected = false;
		if (wasConnected) queueMicrotask(() => void this.trigger('disconnect', 'client disconnect'));
		return this;
	}

	async trigger(event: string, ...args: unknown[]) {
		for (const handler of this.handlers.get(event) ?? []) await handler(...args);
	}
}
