export type ChatLifecycleStage = 'load' | 'completion' | 'stop' | 'queue';

export type PendingEventCallback = {
	settle(value: unknown): boolean;
};

type Continuation = () => void | Promise<void>;
type EventCallback = ((value: unknown) => unknown) | null | undefined;

export const createChatLifecycleBinding = () => {
	let epoch = 0;
	let destroyed = false;
	const pendingEventCallbacks = new Set<PendingEventCallback>();

	const settlePendingEvents = () => {
		for (const callback of [...pendingEventCallbacks]) {
			callback.settle(false);
		}
	};

	return {
		capture(stage: ChatLifecycleStage, continueCurrent: Continuation) {
			const capturedEpoch = epoch;
			let continued = false;

			return {
				stage,
				async continueIfCurrent() {
					if (continued || destroyed || capturedEpoch !== epoch) {
						return false;
					}

					continued = true;
					await continueCurrent();
					return true;
				}
			};
		},
		registerPendingEventCallback(callback: EventCallback): PendingEventCallback {
			let settled = false;
			const pendingCallback: PendingEventCallback = {
				settle(value) {
					if (settled) {
						return false;
					}

					settled = true;
					pendingEventCallbacks.delete(pendingCallback);
					callback?.(value);
					return true;
				}
			};

			if (destroyed) {
				pendingCallback.settle(false);
			} else {
				pendingEventCallbacks.add(pendingCallback);
			}

			return pendingCallback;
		},
		resetForNavigation() {
			epoch += 1;
			settlePendingEvents();
		},
		destroy() {
			if (destroyed) {
				return;
			}

			destroyed = true;
			epoch += 1;
			settlePendingEvents();
		}
	};
};
