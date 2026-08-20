import type { ActionMode, TabPolicy } from './constants';

export type BrowserMessageType =
	| 'hello'
	| 'session.open'
	| 'session.close'
	| 'command.request'
	| 'command.result'
	| 'command.cancel'
	| 'approval.request'
	| 'approval.result'
	| 'workflow.sync'
	| 'schedule.sync'
	| 'heartbeat';

export interface BrowserEnvelope<TType extends BrowserMessageType, TPayload> {
	version: 1;
	id: string;
	type: TType;
	deviceId: string;
	userId: string;
	sessionId: string;
	timestamp: number;
	payload: TPayload;
}

export interface BrowserSessionOptions {
	actionMode: ActionMode;
	tabPolicy: TabPolicy;
	tabId: number;
}

export interface BrowserCommand {
	name: string;
	args: Record<string, unknown>;
	mutating: boolean;
}

export type CommandRequest = BrowserEnvelope<'command.request', BrowserCommand> & {
	deadlineAt: number;
	nonce: string;
	sequence: number;
};
export type CommandResult = BrowserEnvelope<
	'command.result',
	{
		ok: boolean;
		value?: unknown;
		error?: { code: string; message: string };
		nonce: string;
		sequence: number;
	}
>;

export const BROWSER_COMMAND_NAMES = [
	'browser_observe',
	'browser_click',
	'browser_type',
	'browser_select',
	'browser_scroll',
	'browser_navigate',
	'browser_go_back',
	'browser_go_forward',
	'browser_reload',
	'browser_wait',
	'browser_screenshot',
	'browser_download',
	'browser_console',
	'browser_network',
	'browser_dom',
	'browser_recording'
] as const;

const commandNames = new Set<string>(BROWSER_COMMAND_NAMES);
const commandKeys = new Set([
	'version',
	'id',
	'type',
	'deviceId',
	'userId',
	'sessionId',
	'timestamp',
	'deadlineAt',
	'nonce',
	'sequence',
	'payload'
]);
const payloadKeys = new Set(['name', 'args', 'mutating']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isBoundedId = (value: unknown) =>
	typeof value === 'string' && value.length > 0 && value.length <= 128;

export function isCommandRequest(value: unknown, now = Date.now()): value is CommandRequest {
	let size = 0;
	try {
		size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
	} catch {
		return false;
	}
	if (size > 1_048_576 || !isRecord(value)) return false;
	if (Object.keys(value).some((key) => !commandKeys.has(key)) || Object.keys(value).length !== 11) {
		return false;
	}
	if (
		value.version !== 1 ||
		value.type !== 'command.request' ||
		!isBoundedId(value.id) ||
		!isBoundedId(value.deviceId) ||
		!isBoundedId(value.userId) ||
		!isBoundedId(value.sessionId) ||
		!isBoundedId(value.nonce) ||
		typeof value.timestamp !== 'number' ||
		!Number.isFinite(value.timestamp) ||
		typeof value.deadlineAt !== 'number' ||
		!Number.isFinite(value.deadlineAt) ||
		value.deadlineAt < value.timestamp ||
		value.deadlineAt - value.timestamp > 30_000 ||
		value.deadlineAt < now ||
		typeof value.sequence !== 'number' ||
		!Number.isSafeInteger(value.sequence) ||
		value.sequence < 1 ||
		!isRecord(value.payload)
	) {
		return false;
	}
	if (
		Object.keys(value.payload).some((key) => !payloadKeys.has(key)) ||
		Object.keys(value.payload).length !== 3 ||
		!commandNames.has(String(value.payload.name)) ||
		!isRecord(value.payload.args) ||
		typeof value.payload.mutating !== 'boolean'
	) {
		return false;
	}
	return true;
}

export function commandResult(
	request: CommandRequest,
	result: { ok: true; value: unknown } | { ok: false; code: string; message: string },
	now = Date.now()
): CommandResult {
	return {
		version: 1,
		id: request.id,
		type: 'command.result',
		deviceId: request.deviceId,
		userId: request.userId,
		sessionId: request.sessionId,
		timestamp: now,
		payload: result.ok
			? {
					ok: true,
					value: result.value,
					nonce: request.nonce,
					sequence: request.sequence
				}
			: {
					ok: false,
					error: { code: result.code, message: result.message },
					nonce: request.nonce,
					sequence: request.sequence
				}
	};
}
