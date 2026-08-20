import type { ActionMode, TabPolicy } from '../shared/constants';
import type { WorkflowDraft } from '../content/recording';
import type { WorkflowDefinition } from '../background/workflows';

export interface PanelStatus {
	paired: boolean;
	connected: boolean;
	serverOrigin: string;
	deviceId: string | null;
	session: any | null;
}

export interface PanelModel {
	id: string;
	name?: string;
	owned_by?: string;
}

export interface PanelChatSummary {
	id: string;
	title?: string;
	updated_at?: number;
}

export interface ApprovalNotice {
	commandId: string;
	summary: string;
	reason: string;
}

export interface PanelWorkflow {
	id: string;
	name: string;
	version: number;
	definition: WorkflowDefinition;
	created_at?: number;
	updated_at?: number;
}

export interface PanelSchedule {
	id: string;
	workflow_id: string;
	device_id: string;
	name: string;
	rrule: string;
	timezone: string;
	is_active: boolean;
	last_run_at: number | null;
	next_run_at: number | null;
}

export type PanelWorkflowDraft = WorkflowDraft & { origin: string };

export type SidePanelEvent =
	| { type: 'approval'; approval: ApprovalNotice }
	| { type: 'status'; status: PanelStatus }
	| {
			type: 'schedule';
			event: { scheduleId: string; name: string; status: string; code?: string };
	  }
	| { type: 'pairing-complete' }
	| { type: 'pairing-error'; code: string };

export interface StreamHandlers {
	onDelta(value: string): void;
	onActivity(value: { label: string; status: 'running' | 'complete' | 'failed' | 'waiting' }): void;
}

export interface SidePanelApi {
	status(): Promise<PanelStatus>;
	beginPairing(label: string): Promise<any>;
	reconnect(): Promise<void>;
	openSession(options: {
		sessionId: string;
		actionMode: ActionMode;
		tabPolicy: TabPolicy;
	}): Promise<any>;
	closeSession(): Promise<void>;
	models(): Promise<PanelModel[]>;
	chats(): Promise<PanelChatSummary[]>;
	chat(id: string): Promise<any>;
	createChat(chat: Record<string, unknown>): Promise<any>;
	updateChat(id: string, chat: Record<string, unknown>): Promise<any>;
	streamCompletion(
		body: Record<string, any>,
		handlers: StreamHandlers
	): Promise<{ chatId?: string }>;
	transcribe(audio: Blob): Promise<string>;
	speak(text: string): Promise<Blob>;
	workflows(): Promise<PanelWorkflow[]>;
	workflow(id: string): Promise<PanelWorkflow>;
	createWorkflow(value: { name: string; definition: WorkflowDefinition }): Promise<PanelWorkflow>;
	updateWorkflow(
		id: string,
		value: { name: string; version: number; definition: WorkflowDefinition }
	): Promise<PanelWorkflow>;
	deleteWorkflow(id: string): Promise<void>;
	schedules(): Promise<PanelSchedule[]>;
	createSchedule(value: Record<string, unknown>): Promise<PanelSchedule>;
	updateSchedule(id: string, value: Record<string, unknown>): Promise<PanelSchedule>;
	deleteSchedule(id: string): Promise<void>;
	startRecording(): Promise<{ recordingId: string }>;
	stopRecording(): Promise<PanelWorkflowDraft>;
	resolveApproval(commandId: string, approved: boolean): Promise<boolean>;
	subscribe(listener: (event: SidePanelEvent) => void): () => void;
}

interface RuntimeApi {
	sendMessage(message: unknown): Promise<any>;
	onMessage: {
		addListener(listener: (message: any) => void): void;
		removeListener(listener: (message: any) => void): void;
	};
}

const requireOk = (response: any) => {
	if (!response?.ok)
		throw Object.assign(new Error(response?.error ?? 'request_failed'), {
			code: response?.error ?? 'request_failed'
		});
	return response;
};

const encodeBase64 = (bytes: Uint8Array) => {
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 32_768) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
	}
	return btoa(binary);
};

const decodeBase64 = (value: unknown) => {
	if (typeof value !== 'string' || !/^[a-z0-9+/]*={0,2}$/i.test(value)) {
		throw Object.assign(new Error('invalid_audio_response'), { code: 'invalid_audio_response' });
	}
	let binary: string;
	try {
		binary = atob(value);
	} catch {
		throw Object.assign(new Error('invalid_audio_response'), { code: 'invalid_audio_response' });
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
};

export function createSidePanelApi(
	runtime: RuntimeApi = (globalThis as any).chrome?.runtime
): SidePanelApi {
	if (!runtime) throw new Error('Chrome extension runtime is unavailable');
	const send = async (message: Record<string, unknown>) =>
		requireOk(await runtime.sendMessage(message));
	const request = async (method: string, path: string, body?: unknown) =>
		(await send({ type: 'tide-bot:api:request', method, path, body })).value;

	return {
		async status() {
			return (await runtime.sendMessage({ type: 'tide-bot:status' })) as PanelStatus;
		},
		async beginPairing(label) {
			return send({ type: 'tide-bot:pair:start', label });
		},
		async reconnect() {
			await send({ type: 'tide-bot:reconnect' });
		},
		async openSession(options) {
			return (await send({ type: 'tide-bot:session:open', ...options })).session;
		},
		async closeSession() {
			await send({ type: 'tide-bot:session:close' });
		},
		async models() {
			const value = await request('GET', '/api/models');
			const models = Array.isArray(value) ? value : (value?.data ?? value?.models ?? []);
			return models
				.filter((model: any) => typeof model?.id === 'string')
				.map((model: any) => ({
					id: model.id,
					name: model.name ?? model.id,
					owned_by: model.owned_by
				}));
		},
		async chats() {
			const value = await request('GET', '/api/v1/chats/?page=1');
			return Array.isArray(value) ? value : [];
		},
		chat(id) {
			return request('GET', `/api/v1/chats/${encodeURIComponent(id)}`);
		},
		createChat(chat) {
			return request('POST', '/api/v1/chats/new', { chat, folder_id: null });
		},
		updateChat(id, chat) {
			return request('POST', `/api/v1/chats/${encodeURIComponent(id)}`, { chat });
		},
		async streamCompletion(body, handlers) {
			const requestId = crypto.randomUUID();
			return new Promise<{ chatId?: string }>((resolve, reject) => {
				const listener = (message: any) => {
					if (message?.type !== 'tide-bot:api:stream' || message.requestId !== requestId) return;
					if (message.event === 'delta' && typeof message.value === 'string') {
						handlers.onDelta(message.value);
					} else if (message.event === 'activity' && message.value) {
						handlers.onActivity(message.value);
					} else if (message.event === 'done') {
						runtime.onMessage.removeListener(listener);
						resolve({ chatId: message.chatId });
					} else if (message.event === 'error') {
						runtime.onMessage.removeListener(listener);
						reject(Object.assign(new Error('completion_failed'), { code: message.code }));
					}
				};
				runtime.onMessage.addListener(listener);
				void send({ type: 'tide-bot:api:stream-chat', requestId, body }).catch((error) => {
					runtime.onMessage.removeListener(listener);
					reject(error);
				});
			});
		},
		async transcribe(audio) {
			const bytes = new Uint8Array(await audio.arrayBuffer());
			const response = await send({
				type: 'tide-bot:api:audio:transcribe',
				audio: { data: encodeBase64(bytes), mimeType: audio.type || 'audio/webm' }
			});
			if (typeof response.text !== 'string') {
				throw Object.assign(new Error('invalid_audio_response'), {
					code: 'invalid_audio_response'
				});
			}
			return response.text;
		},
		async speak(text) {
			const response = await send({ type: 'tide-bot:api:audio:speech', text });
			const mimeType =
				typeof response.mimeType === 'string' && response.mimeType.startsWith('audio/')
					? response.mimeType
					: 'audio/mpeg';
			return new Blob([decodeBase64(response.data)], { type: mimeType });
		},
		async workflows() {
			const value = await request('GET', '/api/v1/browser-extension/workflows');
			return Array.isArray(value) ? value : [];
		},
		workflow(id) {
			return request('GET', `/api/v1/browser-extension/workflows/${encodeURIComponent(id)}`);
		},
		createWorkflow(value) {
			return request('POST', '/api/v1/browser-extension/workflows', value);
		},
		updateWorkflow(id, value) {
			return request('PUT', `/api/v1/browser-extension/workflows/${encodeURIComponent(id)}`, value);
		},
		async deleteWorkflow(id) {
			await request('DELETE', `/api/v1/browser-extension/workflows/${encodeURIComponent(id)}`);
			await send({ type: 'tide-bot:schedules:refresh' });
		},
		async schedules() {
			const value = await request('GET', '/api/v1/browser-extension/schedules');
			return Array.isArray(value) ? value : [];
		},
		async createSchedule(value) {
			const schedule = await request('POST', '/api/v1/browser-extension/schedules', value);
			await send({ type: 'tide-bot:schedules:refresh' });
			return schedule;
		},
		async updateSchedule(id, value) {
			const schedule = await request(
				'PUT',
				`/api/v1/browser-extension/schedules/${encodeURIComponent(id)}`,
				value
			);
			await send({ type: 'tide-bot:schedules:refresh' });
			return schedule;
		},
		async deleteSchedule(id) {
			await request('DELETE', `/api/v1/browser-extension/schedules/${encodeURIComponent(id)}`);
			await send({ type: 'tide-bot:schedules:refresh' });
		},
		async startRecording() {
			const response = await send({ type: 'tide-bot:recording:start' });
			return { recordingId: String(response.recordingId) };
		},
		async stopRecording() {
			return (await send({ type: 'tide-bot:recording:stop' })).draft;
		},
		async resolveApproval(commandId, approved) {
			return (await send({ type: 'tide-bot:approval:result', commandId, approved })).ok;
		},
		subscribe(listener) {
			const runtimeListener = (message: any) => {
				if (message?.type === 'tide-bot:approval:request' && message.approval) {
					listener({ type: 'approval', approval: message.approval });
				} else if (message?.type === 'tide-bot:status:changed' && message.status) {
					listener({ type: 'status', status: message.status });
				} else if (message?.type === 'tide-bot:pairing:complete') {
					listener({ type: 'pairing-complete' });
				} else if (message?.type === 'tide-bot:pairing:error') {
					listener({ type: 'pairing-error', code: String(message.code ?? 'pairing_failed') });
				} else if (message?.type === 'tide-bot:schedule:event' && message.event) {
					listener({ type: 'schedule', event: message.event });
				}
			};
			runtime.onMessage.addListener(runtimeListener);
			return () => runtime.onMessage.removeListener(runtimeListener);
		}
	};
}
