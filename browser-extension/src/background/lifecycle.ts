const HEARTBEAT_ALARM = 'tide-bot-heartbeat';
const RECONNECT_ALARM = 'tide-bot-reconnect';

interface LifecycleOptions {
	auth: {
		restore(): Promise<boolean>;
	};
	transport: {
		connect(): Promise<void>;
		heartbeat(): Promise<boolean>;
		status(): { connected: boolean };
	};
	chromeApi?: any;
}

export function installLifecycle(options: LifecycleOptions) {
	const chromeApi = options.chromeApi ?? (globalThis as any).chrome;
	const wake = async () => {
		try {
			if (await options.auth.restore()) await options.transport.connect();
		} catch {
			// The side panel surfaces safe status. Credential material is never logged.
		}
	};

	chromeApi.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
	chromeApi.runtime.onStartup.addListener(() => wake());
	chromeApi.runtime.onInstalled.addListener(async () => {
		await chromeApi.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
		await wake();
	});
	chromeApi.alarms.onAlarm.addListener(async (alarm: { name: string }) => {
		if (alarm.name === RECONNECT_ALARM) {
			try {
				await options.transport.connect();
			} catch {
				// Transport schedules the next bounded reconnect without logging credentials.
			}
			return;
		}
		if (alarm.name !== HEARTBEAT_ALARM) return;
		if (options.transport.status().connected) await options.transport.heartbeat();
		else await wake();
	});

	return { start: wake };
}

export function scheduleReconnectAlarm(
	delayMilliseconds: number,
	chromeApi = (globalThis as any).chrome
) {
	chromeApi.alarms.create(RECONNECT_ALARM, {
		delayInMinutes: Math.max(0.01, delayMilliseconds / 60_000)
	});
}
