import type { RecordedWorkflowStep, WorkflowDraft, WorkflowTarget } from '../content/recording';
import type { BrowserCommand } from '../shared/protocol';

export interface WorkflowDefinition {
	schemaVersion: 1;
	origin: string;
	steps: RecordedWorkflowStep[];
}

export interface SyncedWorkflow {
	id: string;
	name: string;
	version: number;
	definition: WorkflowDefinition;
	updatedAt?: number;
}

interface WorkflowApi {
	createWorkflow(value: { name: string; definition: WorkflowDefinition }): Promise<unknown>;
	updateWorkflow?(
		id: string,
		value: { name: string; version: number; definition: WorkflowDefinition }
	): Promise<unknown>;
	workflows(): Promise<SyncedWorkflow[]>;
}

interface WorkflowManagerOptions {
	tabs: {
		sendMessage(tabId: number, message: Record<string, unknown>): Promise<unknown>;
	};
	api: WorkflowApi;
	execute(command: BrowserCommand): Promise<unknown>;
	now?: () => number;
	maxSteps?: number;
}

interface ActiveRecording {
	recordingId: string;
	tabId: number;
	origin: string;
	startedAt: number;
	steps: RecordedWorkflowStep[];
}

export class WorkflowError extends Error {
	constructor(
		public readonly code: string,
		public readonly stepIndex?: number
	) {
		super(code);
		this.name = 'WorkflowError';
	}
}

const isRecord = (value: unknown): value is Record<string, any> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, allowed: string[]) =>
	Object.keys(value).every((key) => allowed.includes(key));

const target = (value: unknown): WorkflowTarget | null => {
	if (!isRecord(value) || !exactKeys(value, ['role', 'name', 'tag', 'type', 'testId'])) return null;
	if (
		!['role', 'name', 'tag'].every(
			(key) => typeof value[key] === 'string' && value[key].length <= 256
		) ||
		(typeof value.type !== 'undefined' &&
			(typeof value.type !== 'string' || value.type.length > 64)) ||
		(typeof value.testId !== 'undefined' &&
			(typeof value.testId !== 'string' || value.testId.length > 128))
	)
		return null;
	return value as WorkflowTarget;
};

const safeNavigation = (value: unknown) => {
	if (typeof value !== 'string' || value.length > 4_096) return false;
	try {
		const parsed = new URL(value);
		return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
	} catch {
		return false;
	}
};

export function validateWorkflowStep(value: unknown): value is RecordedWorkflowStep {
	if (!isRecord(value) || typeof value.action !== 'string') return false;
	if (value.action === 'navigate') {
		return exactKeys(value, ['action', 'url']) && safeNavigation(value.url);
	}
	if (value.action === 'click') {
		return exactKeys(value, ['action', 'target']) && target(value.target) !== null;
	}
	if (value.action === 'type-intent') {
		return (
			exactKeys(value, ['action', 'target', 'sensitive']) &&
			target(value.target) !== null &&
			typeof value.sensitive === 'boolean'
		);
	}
	if (value.action === 'select') {
		return (
			exactKeys(value, ['action', 'target', 'values']) &&
			target(value.target) !== null &&
			Array.isArray(value.values) &&
			value.values.length <= 20 &&
			value.values.every((item) => typeof item === 'string' && item.length <= 256)
		);
	}
	return (
		value.action === 'wait' &&
		exactKeys(value, ['action', 'condition']) &&
		value.condition === 'load'
	);
}

export function validateWorkflowDefinition(value: unknown): value is WorkflowDefinition {
	return (
		isRecord(value) &&
		exactKeys(value, ['schemaVersion', 'origin', 'steps']) &&
		value.schemaVersion === 1 &&
		typeof value.origin === 'string' &&
		value.origin.length <= 512 &&
		Array.isArray(value.steps) &&
		value.steps.length > 0 &&
		value.steps.length <= 500 &&
		value.steps.every(validateWorkflowStep)
	);
}

export class WorkflowManager {
	private readonly tabs: WorkflowManagerOptions['tabs'];
	private readonly api: WorkflowApi;
	private readonly executeCommand: WorkflowManagerOptions['execute'];
	private readonly now: () => number;
	private readonly maxSteps: number;
	private active: ActiveRecording | null = null;

	constructor(options: WorkflowManagerOptions) {
		this.tabs = options.tabs;
		this.api = options.api;
		this.executeCommand = options.execute;
		this.now = options.now ?? Date.now;
		this.maxSteps = Math.min(500, Math.max(1, options.maxSteps ?? 200));
	}

	status() {
		return this.active
			? { active: true, recordingId: this.active.recordingId, tabId: this.active.tabId }
			: { active: false, recordingId: null, tabId: null };
	}

	async start(tabId: number, url: string) {
		if (this.active) throw new WorkflowError('recording_already_active');
		if (!Number.isInteger(tabId) || tabId < 0) throw new WorkflowError('invalid_tab');
		let origin: string;
		try {
			const parsed = new URL(url);
			if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
			origin = parsed.origin;
		} catch {
			throw new WorkflowError('restricted_url');
		}
		const recordingId = crypto.randomUUID();
		this.active = { recordingId, tabId, origin, startedAt: this.now(), steps: [] };
		try {
			await this.tabs.sendMessage(tabId, {
				source: 'tide-bot-browser-control',
				type: 'recording:start',
				recordingId
			});
		} catch {
			this.active = null;
			throw new WorkflowError('content_script_unavailable');
		}
		return { recordingId };
	}

	capture(tabId: number, recordingId: string, step: unknown) {
		if (!this.active || this.active.recordingId !== recordingId) {
			throw new WorkflowError('recording_not_active');
		}
		if (this.active.tabId !== tabId) throw new WorkflowError('recording_tab_mismatch');
		if (!validateWorkflowStep(step)) throw new WorkflowError('invalid_workflow_step');
		if (this.active.steps.length >= this.maxSteps) throw new WorkflowError('workflow_too_large');
		this.active.steps.push(structuredClone(step));
		return { captured: this.active.steps.length };
	}

	contentStatus(tabId: number) {
		if (!this.active || this.active.tabId !== tabId) return { active: false };
		return { active: true, recordingId: this.active.recordingId };
	}

	async stop(tabId: number): Promise<WorkflowDraft & { origin: string }> {
		if (!this.active) throw new WorkflowError('recording_not_active');
		if (this.active.tabId !== tabId) throw new WorkflowError('recording_tab_mismatch');
		const current = this.active;
		this.active = null;
		await this.tabs
			.sendMessage(tabId, { source: 'tide-bot-browser-control', type: 'recording:stop' })
			.catch(() => undefined);
		return {
			recordingId: current.recordingId,
			origin: current.origin,
			startedAt: current.startedAt,
			stoppedAt: this.now(),
			steps: current.steps
		};
	}

	async saveDraft(
		draft: WorkflowDraft & { origin: string },
		options: { name: string; reviewed: boolean }
	) {
		if (!options.reviewed) throw new WorkflowError('review_required');
		const name = options.name.trim();
		const definition: WorkflowDefinition = {
			schemaVersion: 1,
			origin: draft.origin,
			steps: draft.steps
		};
		if (!name || name.length > 120 || !validateWorkflowDefinition(definition)) {
			throw new WorkflowError('invalid_workflow');
		}
		return this.api.createWorkflow({ name, definition });
	}

	workflows() {
		return this.api.workflows();
	}

	async replay(definition: WorkflowDefinition, options: { inputs?: Record<number, string> } = {}) {
		if (!validateWorkflowDefinition(definition)) throw new WorkflowError('invalid_workflow');
		for (let index = 0; index < definition.steps.length; index += 1) {
			const step = definition.steps[index];
			let command: BrowserCommand;
			if (step.action === 'navigate') {
				command = { name: 'browser_navigate', args: { url: step.url }, mutating: true };
			} else if (step.action === 'click') {
				command = { name: 'browser_click', args: { target: step.target }, mutating: true };
			} else if (step.action === 'select') {
				command = {
					name: 'browser_select',
					args: { target: step.target, values: step.values },
					mutating: true
				};
			} else if (step.action === 'wait') {
				command = {
					name: 'browser_wait',
					args: { condition: step.condition },
					mutating: false
				};
			} else {
				const text = options.inputs?.[index];
				if (typeof text !== 'string') throw new WorkflowError('workflow_input_required', index);
				command = {
					name: 'browser_type',
					args: { target: step.target, text, operation: 'replace' },
					mutating: true
				};
			}
			try {
				await this.executeCommand(command);
			} catch (error) {
				if (
					typeof error === 'object' &&
					error !== null &&
					'code' in error &&
					(error as { code: string }).code === 'approval_required'
				) {
					throw new WorkflowError('workflow_approval_required', index);
				}
				throw error;
			}
		}
		return { ok: true, stepsCompleted: definition.steps.length };
	}
}
