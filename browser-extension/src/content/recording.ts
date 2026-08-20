import { isSensitiveElement, redactText } from './redaction';

export interface WorkflowTarget {
	role: string;
	name: string;
	tag: string;
	type?: string;
	testId?: string;
}

export type RecordedWorkflowStep =
	| { action: 'navigate'; url: string }
	| { action: 'click'; target: WorkflowTarget }
	| { action: 'type-intent'; target: WorkflowTarget; sensitive: boolean }
	| { action: 'select'; target: WorkflowTarget; values: string[] }
	| { action: 'wait'; condition: 'load' };

export interface WorkflowDraft {
	recordingId: string;
	startedAt: number;
	stoppedAt: number;
	steps: RecordedWorkflowStep[];
}

interface RuntimeLike {
	sendMessage(message: Record<string, unknown>): Promise<unknown> | unknown;
}

interface RecordingOptions {
	document: Document;
	window: Window;
	runtime: RuntimeLike;
	maxSteps?: number;
	now?: () => number;
	acceptEvent?: (event: Event) => boolean;
}

const implicitRole = (element: Element) => {
	const explicit = element.getAttribute('role')?.split(/\s+/)[0];
	if (explicit) return explicit.toLowerCase();
	const tag = element.tagName.toLowerCase();
	if (tag === 'a') return 'link';
	if (tag === 'button') return 'button';
	if (tag === 'select') return (element as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
	if (tag === 'textarea') return 'textbox';
	if (tag === 'input') {
		const type = (element as HTMLInputElement).type.toLowerCase();
		if (['button', 'submit', 'reset'].includes(type)) return 'button';
		if (['checkbox', 'radio', 'range'].includes(type)) return type;
		return 'textbox';
	}
	return tag;
};

const accessibleName = (element: Element, document: Document) => {
	const aria = element.getAttribute('aria-label');
	if (aria) return redactText(aria, 200);
	const labelledBy = element.getAttribute('aria-labelledby');
	if (labelledBy) {
		const text = labelledBy
			.split(/\s+/)
			.map((id) => document.getElementById(id)?.textContent ?? '')
			.join(' ');
		if (text.trim()) return redactText(text, 200);
	}
	const labels = (element as HTMLInputElement).labels;
	if (labels?.length) {
		const text = [...labels].map((label) => label.textContent ?? '').join(' ');
		if (text.trim()) return redactText(text, 200);
	}
	for (const attribute of ['placeholder', 'title', 'alt']) {
		const value = element.getAttribute(attribute);
		if (value) return redactText(value, 200);
	}
	return redactText(element.textContent ?? '', 200);
};

const targetFor = (element: Element, document: Document): WorkflowTarget => ({
	role: implicitRole(element),
	name: accessibleName(element, document),
	tag: element.tagName.toLowerCase(),
	...(element instanceof HTMLInputElement ? { type: element.type.toLowerCase() } : {}),
	...(element.getAttribute('data-testid')
		? { testId: redactText(element.getAttribute('data-testid') ?? '', 128) }
		: {})
});

const safeUrl = (value: string) => {
	try {
		const parsed = new URL(value);
		if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
			return '';
		parsed.hash = '';
		for (const [key, item] of parsed.searchParams) {
			if (/(?:token|secret|password|passcode|auth|key|session)/i.test(key)) {
				parsed.searchParams.set(key, '[REDACTED]');
			} else {
				parsed.searchParams.set(key, redactText(item, 256));
			}
		}
		return parsed.href.slice(0, 4_096);
	} catch {
		return '';
	}
};

export class ContentWorkflowRecorder {
	private readonly document: Document;
	private readonly window: Window;
	private readonly runtime: RuntimeLike;
	private readonly maxSteps: number;
	private readonly now: () => number;
	private readonly acceptEvent: (event: Event) => boolean;
	private recordingId = '';
	private startedAt = 0;
	private steps: RecordedWorkflowStep[] = [];
	private typedElements = new WeakSet<Element>();
	private active = false;

	constructor(options: RecordingOptions) {
		this.document = options.document;
		this.window = options.window;
		this.runtime = options.runtime;
		this.maxSteps = Math.min(500, Math.max(1, options.maxSteps ?? 200));
		this.now = options.now ?? Date.now;
		this.acceptEvent = options.acceptEvent ?? ((event) => event.isTrusted);
	}

	status() {
		return { active: this.active, recordingId: this.active ? this.recordingId : null };
	}

	start(recordingId: string) {
		if (!/^[a-z0-9_-]{1,128}$/i.test(recordingId)) throw new Error('invalid_recording_id');
		this.detach();
		this.recordingId = recordingId;
		this.startedAt = this.now();
		this.steps = [];
		this.typedElements = new WeakSet();
		this.active = true;
		this.document.addEventListener('click', this.onClick, true);
		this.document.addEventListener('input', this.onInput, true);
		this.document.addEventListener('change', this.onChange, true);
		const url = safeUrl(this.window.location.href);
		if (url) this.capture({ action: 'navigate', url });
		return this.status();
	}

	stop(): WorkflowDraft {
		const draft = {
			recordingId: this.recordingId,
			startedAt: this.startedAt,
			stoppedAt: this.now(),
			steps: [...this.steps]
		};
		this.detach();
		return draft;
	}

	private readonly onClick = (event: Event) => {
		if (!this.acceptEvent(event)) return;
		const element = (event.target as Element | null)?.closest(
			'a[href],button,input,select,textarea,[role],[tabindex],[contenteditable="true"]'
		);
		if (element) this.capture({ action: 'click', target: targetFor(element, this.document) });
	};

	private readonly onInput = (event: Event) => {
		if (!this.acceptEvent(event) || !(event.target instanceof Element)) return;
		const element = event.target;
		if (this.typedElements.has(element)) return;
		if (
			!(element instanceof HTMLInputElement) &&
			!(element instanceof HTMLTextAreaElement) &&
			!(element instanceof HTMLElement && element.isContentEditable)
		)
			return;
		this.typedElements.add(element);
		this.capture({
			action: 'type-intent',
			target: targetFor(element, this.document),
			sensitive: isSensitiveElement(element)
		});
	};

	private readonly onChange = (event: Event) => {
		if (!this.acceptEvent(event) || !(event.target instanceof HTMLSelectElement)) return;
		const select = event.target;
		const values = isSensitiveElement(select)
			? []
			: [...select.selectedOptions].map((option) => redactText(option.value, 256)).slice(0, 20);
		this.capture({
			action: 'select',
			target: targetFor(select, this.document),
			values
		});
	};

	private capture(step: RecordedWorkflowStep) {
		if (!this.active || this.steps.length >= this.maxSteps) return;
		this.steps.push(step);
		void Promise.resolve(
			this.runtime.sendMessage({
				type: 'tide-bot:recording:event',
				recordingId: this.recordingId,
				step
			})
		).catch(() => undefined);
	}

	private detach() {
		this.document.removeEventListener('click', this.onClick, true);
		this.document.removeEventListener('input', this.onInput, true);
		this.document.removeEventListener('change', this.onChange, true);
		this.active = false;
	}
}
