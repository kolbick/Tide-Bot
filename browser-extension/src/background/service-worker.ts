import { BrowserAuth } from './auth';
import { BrowserApiProxy } from './api-proxy';
import { ApprovalCoordinator } from './approvals';
import { DebuggerFacade } from './debugger';
import { DownloadManager } from './downloads';
import { BrowserExecutor } from './executor';
import { installLifecycle, scheduleReconnectAlarm } from './lifecycle';
import { decideBrowserAction } from './policy';
import { ScheduleManager, type BrowserScheduleDefinition } from './schedules';
import { SingleTabController } from './tab-controller';
import { BrowserTransport } from './transport';
import { WorkflowManager } from './workflows';
import { ACTION_MODES, TAB_POLICIES, type ActionMode, type TabPolicy } from '../shared/constants';

const chromeApi = (globalThis as any).chrome;
const auth = new BrowserAuth();
const apiProxy = new BrowserApiProxy({
	auth,
	sendMessage: (message) => chromeApi.runtime.sendMessage(message)
});
const approvals = new ApprovalCoordinator({
	request: (approval) =>
		chromeApi.runtime.sendMessage({ type: 'tide-bot:approval:request', approval })
});
const debuggerFacade = new DebuggerFacade({ debuggerApi: chromeApi.debugger });
let tabController: SingleTabController;
let executor: BrowserExecutor;
let workflows: WorkflowManager;
const transport = new BrowserTransport({
	auth,
	executeCommand: async (request) => {
		const session = tabController.requireControlledTab();
		if (request.sessionId !== session.sessionId) {
			throw Object.assign(new Error('session_access_denied'), { code: 'session_access_denied' });
		}
		const policy = decideBrowserAction({
			mode: session.actionMode,
			command: request.payload,
			currentUrl: session.url,
			pageSignals: executor.pageSignals()
		});
		if (policy.decision === 'deny') {
			throw Object.assign(new Error(policy.reason), { code: policy.reason });
		}
		if (
			policy.decision === 'ask' &&
			!(await approvals.ask(request.id, request.payload, policy.reason))
		) {
			throw Object.assign(new Error('approval_denied'), { code: 'approval_denied' });
		}
		return executor.execute(request.payload);
	},
	onReconnectNeeded: (delay) => scheduleReconnectAlarm(delay),
	onDisconnected: () => executor.closeSession()
});
tabController = new SingleTabController({
	tabs: chromeApi.tabs,
	onSessionOpen: async (session) => {
		if (!transport.status().connected) return;
		await transport.openSession({
			sessionId: session.sessionId,
			tabId: session.tabId,
			tabOrigin: session.origin,
			actionMode: session.actionMode,
			tabPolicy: session.tabPolicy
		});
	},
	onSessionClose: async (session) => {
		try {
			await transport.closeSession(session.sessionId);
		} finally {
			approvals.cancelAll();
			await executor.closeSession();
		}
	}
});
const downloads = new DownloadManager({
	downloadsApi: chromeApi.downloads,
	notificationsApi: chromeApi.notifications,
	assertControlledTab: (tabId) => {
		tabController.requireControlledTab(tabId);
	}
});
executor = new BrowserExecutor({
	tabs: chromeApi.tabs,
	tabController,
	debuggerFacade,
	downloads,
	recordingHandler: async (tabId, args) => {
		if (args.action === 'start') {
			const session = tabController.requireControlledTab(tabId);
			return workflows.start(tabId, session.url);
		}
		if (args.action === 'stop') return workflows.stop(tabId);
		if (args.action === 'status') return workflows.status();
		throw Object.assign(new Error('invalid_recording_action'), {
			code: 'invalid_recording_action'
		});
	}
});
const executeWorkflowCommand = async (command: Parameters<BrowserExecutor['execute']>[0]) => {
	const session = tabController.requireControlledTab();
	const policy = decideBrowserAction({
		mode: session.actionMode,
		command,
		currentUrl: session.url,
		pageSignals: executor.pageSignals()
	});
	if (policy.decision === 'deny') {
		throw Object.assign(new Error(policy.reason), { code: policy.reason });
	}
	if (policy.decision === 'ask') {
		throw Object.assign(new Error('approval_required'), { code: 'approval_required' });
	}
	return executor.execute(command);
};
workflows = new WorkflowManager({
	tabs: chromeApi.tabs,
	api: {
		createWorkflow: (value) =>
			apiProxy.request('POST', '/api/v1/browser-extension/workflows', value),
		updateWorkflow: (id, value) =>
			apiProxy.request('PUT', `/api/v1/browser-extension/workflows/${id}`, value),
		workflows: async () =>
			(await apiProxy.request('GET', '/api/v1/browser-extension/workflows')) as any[]
	},
	execute: executeWorkflowCommand
});
const schedules = new ScheduleManager({
	alarms: chromeApi.alarms,
	api: {
		workflow: (id) =>
			apiProxy.request('GET', `/api/v1/browser-extension/workflows/${id}`) as Promise<any>,
		completeScheduleRun: (id, value) =>
			apiProxy.request('POST', `/api/v1/browser-extension/schedules/${id}/runs`, {
				outcome: value.outcome,
				last_run_at: value.lastRunAt,
				next_run_at: value.nextRunAt
			})
	},
	deviceId: () => auth.status().deviceId,
	replay: (definition) => workflows.replay(definition),
	onEvent: (event) => {
		void chromeApi.runtime
			.sendMessage({ type: 'tide-bot:schedule:event', event })
			.catch(() => undefined);
	}
});
const syncSchedules = async () => {
	if (!auth.status().paired || !auth.status().deviceId) return;
	const value = await apiProxy.request('GET', '/api/v1/browser-extension/schedules');
	const mapped = (Array.isArray(value) ? value : []).map(
		(item: any): BrowserScheduleDefinition => ({
			id: String(item.id),
			workflowId: String(item.workflow_id),
			deviceId: String(item.device_id),
			name: String(item.name),
			rrule: String(item.rrule),
			timezone: String(item.timezone),
			isActive: item.is_active === true,
			lastRunAt: typeof item.last_run_at === 'number' ? item.last_run_at : null,
			nextRunAt: typeof item.next_run_at === 'number' ? item.next_run_at : null
		})
	);
	await schedules.sync(mapped);
};
const lifecycle = installLifecycle({ auth, transport });
void lifecycle
	.start()
	.then(syncSchedules)
	.catch(() => undefined);

chromeApi.runtime.onMessage.addListener(
	(
		message: {
			type?: string;
			sessionId?: string;
			actionMode?: ActionMode;
			tabPolicy?: TabPolicy;
			commandId?: string;
			approved?: boolean;
			label?: string;
			method?: string;
			path?: string;
			body?: unknown;
			requestId?: string;
			audio?: { data?: unknown; mimeType?: unknown };
			text?: string;
			voice?: string;
			recordingId?: string;
			step?: unknown;
		},
		sender: { tab?: { id?: number } },
		sendResponse: (response: unknown) => void
	) => {
		if (message?.type === 'tide-bot:status') {
			sendResponse({ ...auth.status(), ...transport.status(), session: tabController.current() });
			return;
		}
		if (message?.type === 'tide-bot:pair:start' && typeof message.label === 'string') {
			const label = message.label;
			const errorCodeOf = (error: unknown, fallback: string) =>
				typeof error === 'object' && error !== null && 'code' in error
					? (error as { code: string }).code
					: fallback;
			const finishPairing = async () => {
				await transport.connect();
				await syncSchedules();
				await chromeApi.runtime.sendMessage({ type: 'tide-bot:pairing:complete' });
			};
			void (async () => {
				// One click when the browser already holds a Tide-Bot session;
				// the verification tab is only for when it does not.
				try {
					await auth.claimWithSession(label);
					sendResponse({ ok: true, claimed: true });
					await finishPairing();
					return;
				} catch {
					// Fall through to the device-code flow.
				}
				try {
					const pairing = await auth.beginPairing(label);
					sendResponse({ ok: true, claimed: false, ...pairing });
					auth
						.pollPairing()
						.then(finishPairing)
						.catch((error) =>
							chromeApi.runtime.sendMessage({
								type: 'tide-bot:pairing:error',
								code: errorCodeOf(error, 'pairing_failed')
							})
						);
				} catch (error) {
					sendResponse({ ok: false, error: errorCodeOf(error, 'pairing_failed') });
				}
			})();
			return true;
		}
		if (message?.type === 'tide-bot:reconnect') {
			void transport
				.connect()
				.then(syncSchedules)
				.then(() => sendResponse({ ok: true }))
				.catch(() => sendResponse({ ok: false, error: 'offline' }));
			return true;
		}
		if (message?.type === 'tide-bot:recording:content-ready') {
			const tabId = sender.tab?.id;
			sendResponse(typeof tabId === 'number' ? workflows.contentStatus(tabId) : { active: false });
			return;
		}
		if (
			message?.type === 'tide-bot:recording:event' &&
			typeof sender.tab?.id === 'number' &&
			typeof message.recordingId === 'string'
		) {
			try {
				sendResponse({
					ok: true,
					...workflows.capture(sender.tab.id, message.recordingId, message.step)
				});
			} catch (error) {
				sendResponse({
					ok: false,
					error:
						typeof error === 'object' && error !== null && 'code' in error
							? (error as { code: string }).code
							: 'recording_event_rejected'
				});
			}
			return;
		}
		if (message?.type === 'tide-bot:recording:start') {
			void (async () => {
				try {
					const session = tabController.requireControlledTab();
					const value = await workflows.start(session.tabId, session.url);
					sendResponse({ ok: true, ...value });
				} catch (error) {
					sendResponse({
						ok: false,
						error:
							typeof error === 'object' && error !== null && 'code' in error
								? (error as { code: string }).code
								: 'recording_start_failed'
					});
				}
			})();
			return true;
		}
		if (message?.type === 'tide-bot:recording:stop') {
			void (async () => {
				try {
					const session = tabController.requireControlledTab();
					const draft = await workflows.stop(session.tabId);
					sendResponse({ ok: true, draft });
				} catch (error) {
					sendResponse({
						ok: false,
						error:
							typeof error === 'object' && error !== null && 'code' in error
								? (error as { code: string }).code
								: 'recording_stop_failed'
					});
				}
			})();
			return true;
		}
		if (message?.type === 'tide-bot:schedules:refresh') {
			void syncSchedules()
				.then(() => sendResponse({ ok: true }))
				.catch(() => sendResponse({ ok: false, error: 'schedule_sync_failed' }));
			return true;
		}
		if (
			message?.type === 'tide-bot:api:request' &&
			typeof message.method === 'string' &&
			typeof message.path === 'string'
		) {
			void apiProxy
				.request(message.method, message.path, message.body)
				.then((value) => sendResponse({ ok: true, value }))
				.catch((error) =>
					sendResponse({
						ok: false,
						error:
							typeof error === 'object' && error !== null && 'code' in error
								? (error as { code: string }).code
								: 'api_request_failed'
					})
				);
			return true;
		}
		if (
			message?.type === 'tide-bot:api:stream-chat' &&
			typeof message.requestId === 'string' &&
			typeof message.body === 'object' &&
			message.body !== null
		) {
			sendResponse({ ok: true });
			void apiProxy
				.streamChat(message.requestId, message.body as Record<string, unknown>)
				.catch((error) =>
					chromeApi.runtime.sendMessage({
						type: 'tide-bot:api:stream',
						requestId: message.requestId,
						event: 'error',
						code:
							typeof error === 'object' && error !== null && 'code' in error
								? (error as { code: string }).code
								: 'completion_failed'
					})
				);
			return;
		}
		if (message?.type === 'tide-bot:api:audio:transcribe' && message.audio) {
			void apiProxy
				.transcribeAudio(message.audio)
				.then((text) => sendResponse({ ok: true, text }))
				.catch((error) =>
					sendResponse({
						ok: false,
						error:
							typeof error === 'object' && error !== null && 'code' in error
								? (error as { code: string }).code
								: 'transcription_failed'
					})
				);
			return true;
		}
		if (message?.type === 'tide-bot:api:audio:speech' && typeof message.text === 'string') {
			void apiProxy
				.synthesizeSpeech({ text: message.text, voice: message.voice })
				.then((value) => sendResponse({ ok: true, ...value }))
				.catch((error) =>
					sendResponse({
						ok: false,
						error:
							typeof error === 'object' && error !== null && 'code' in error
								? (error as { code: string }).code
								: 'speech_failed'
					})
				);
			return true;
		}
		if (
			message?.type === 'tide-bot:session:open' &&
			typeof message.sessionId === 'string' &&
			ACTION_MODES.includes(message.actionMode as ActionMode) &&
			TAB_POLICIES.includes(message.tabPolicy as TabPolicy)
		) {
			void (async () => {
				try {
					await transport.connect();
					const session = await tabController.openActive({
						sessionId: message.sessionId as string,
						actionMode: message.actionMode as ActionMode,
						tabPolicy: message.tabPolicy as TabPolicy
					});
					sendResponse({ ok: true, session });
				} catch (error) {
					sendResponse({
						ok: false,
						error:
							typeof error === 'object' && error !== null && 'code' in error
								? (error as { code: string }).code
								: 'session_open_failed'
					});
				}
			})();
			return true;
		}
		if (message?.type === 'tide-bot:session:close') {
			void tabController.close().then(() => sendResponse({ ok: true }));
			return true;
		}
		if (
			message?.type === 'tide-bot:approval:result' &&
			typeof message.commandId === 'string' &&
			typeof message.approved === 'boolean'
		) {
			sendResponse({ ok: approvals.resolve(message.commandId, message.approved) });
		}
	}
);
