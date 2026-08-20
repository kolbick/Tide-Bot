import { DomObservationError, DomObserver, type PageSnapshot } from './dom';

interface DomActionsOptions {
	document: Document;
	window: Window;
	observer: DomObserver;
	clock?: () => number;
	sleep?: (milliseconds: number) => Promise<void>;
}

export class DomActionError extends Error {
	constructor(public readonly code: string) {
		super(code);
		this.name = 'DomActionError';
	}
}

const asRecord = (value: unknown): Record<string, any> => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new DomActionError('invalid_arguments');
	}
	return value as Record<string, any>;
};

const typedEchoRedacted = (value: unknown, typedText: string): unknown => {
	if (Array.isArray(value)) return value.map((item) => typedEchoRedacted(item, typedText));
	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, typedEchoRedacted(item, typedText)])
		);
	}
	if (typeof value === 'string' && typedText && value.includes(typedText)) {
		return value.replaceAll(typedText, '[REDACTED]');
	}
	return value;
};

export class DomActions {
	private readonly document: Document;
	private readonly window: Window;
	private readonly observer: DomObserver;
	private readonly clock: () => number;
	private readonly sleep: (milliseconds: number) => Promise<void>;

	constructor(options: DomActionsOptions) {
		this.document = options.document;
		this.window = options.window;
		this.observer = options.observer;
		this.clock = options.clock ?? Date.now;
		this.sleep =
			options.sleep ??
			((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
	}

	observe() {
		return this.observer.observe();
	}

	async execute(name: string, rawArguments: unknown): Promise<Record<string, unknown>> {
		const args = asRecord(rawArguments);
		try {
			switch (name) {
				case 'browser_observe':
				case 'browser_dom':
					return { ok: true, snapshot: this.observer.observe() };
				case 'browser_click':
					return await this.click(args);
				case 'browser_type':
					return await this.type(args);
				case 'browser_select':
					return await this.select(args);
				case 'browser_scroll':
					return await this.scroll(args);
				case 'browser_wait':
					return await this.wait(args);
				case 'browser_download':
					return await this.download(args);
				default:
					throw new DomActionError('unsupported_dom_action');
			}
		} catch (error) {
			if (error instanceof DomActionError) throw error;
			if (error instanceof DomObservationError) throw new DomActionError(error.code);
			throw new DomActionError('dom_action_failed');
		}
	}

	private target(args: Record<string, any>) {
		return this.observer.findTarget(args.target);
	}

	private async click(args: Record<string, any>) {
		const element = this.target(args);
		if (!(element instanceof HTMLElement)) throw new DomActionError('invalid_target');
		if (
			(element as HTMLButtonElement).disabled ||
			element.getAttribute('aria-disabled') === 'true'
		) {
			throw new DomActionError('target_disabled');
		}
		element.focus({ preventScroll: true });
		const action = args.action ?? 'click';
		if (action === 'focus') {
			// Focus above is the complete requested action.
		} else if (action === 'hover') {
			element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }));
			element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, composed: true }));
		} else if (action === 'click' || action === 'double-click') {
			element.click();
			if (action === 'double-click') {
				element.click();
				element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
			}
		} else {
			throw new DomActionError('invalid_arguments');
		}
		return { ok: true, snapshot: this.observer.observe() };
	}

	private async type(args: Record<string, any>) {
		const element = this.target(args);
		const operation = args.operation ?? 'type';
		const text = operation === 'clear' ? '' : args.text;
		if (typeof text !== 'string' || text.length > 10_000) {
			throw new DomActionError('invalid_arguments');
		}
		if (
			!(element instanceof HTMLInputElement) &&
			!(element instanceof HTMLTextAreaElement) &&
			!(
				element instanceof HTMLElement &&
				(element.isContentEditable || element.getAttribute('contenteditable') === 'true')
			)
		) {
			throw new DomActionError('invalid_target');
		}
		(element as HTMLElement).focus({ preventScroll: true });
		if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
			const prototype =
				element instanceof HTMLInputElement
					? HTMLInputElement.prototype
					: HTMLTextAreaElement.prototype;
			const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
			if (!setter) throw new DomActionError('invalid_target');
			const nextValue = operation === 'type' ? element.value + text : text;
			setter.call(element, nextValue);
		} else {
			element.textContent = operation === 'type' ? `${element.textContent ?? ''}${text}` : text;
		}
		element.dispatchEvent(
			new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' })
		);
		element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
		const snapshot = typedEchoRedacted(this.observer.observe(), text) as PageSnapshot;
		return { ok: true, changed: true, snapshot };
	}

	private async select(args: Record<string, any>) {
		const element = this.target(args);
		if (!(element instanceof HTMLSelectElement) || !Array.isArray(args.values)) {
			throw new DomActionError('invalid_target');
		}
		const values = args.values;
		if (!values.length || values.some((value: unknown) => typeof value !== 'string')) {
			throw new DomActionError('invalid_arguments');
		}
		const available = new Set([...element.options].map((option) => option.value));
		if (values.some((value: string) => !available.has(value))) {
			throw new DomActionError('option_not_found');
		}
		for (const option of element.options) option.selected = values.includes(option.value);
		element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
		return {
			ok: true,
			selectedCount: [...element.selectedOptions].length,
			snapshot: this.observer.observe()
		};
	}

	private async scroll(args: Record<string, any>) {
		const deltaX = Number(args.deltaX ?? 0);
		const deltaY = Number(args.deltaY ?? 0);
		if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (!deltaX && !deltaY)) {
			throw new DomActionError('invalid_arguments');
		}
		const options: ScrollToOptions = {
			left: deltaX,
			top: deltaY,
			behavior: args.behavior === 'smooth' ? 'smooth' : 'auto'
		};
		if (args.target) {
			const target = this.target(args);
			if (!(target instanceof HTMLElement)) throw new DomActionError('invalid_target');
			target.scrollBy(options);
		} else {
			this.window.scrollBy(options);
		}
		return { ok: true, snapshot: this.observer.observe() };
	}

	private async wait(args: Record<string, any>) {
		const condition = args.condition;
		if (condition === 'delay') {
			const milliseconds = Number(args.milliseconds);
			if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 30_000) {
				throw new DomActionError('invalid_arguments');
			}
			await this.sleep(milliseconds);
			return { ok: true, snapshot: this.observer.observe() };
		}

		const startedAt = this.clock();
		for (let attempt = 0; attempt < 300; attempt += 1) {
			let ready = false;
			if (condition === 'text' && typeof args.text === 'string') {
				ready = (this.document.body?.textContent ?? '').includes(args.text);
			} else if (condition === 'url' && typeof args.url === 'string') {
				ready = this.window.location.href === args.url;
			} else if (condition === 'load') {
				ready = ['interactive', 'complete'].includes(this.document.readyState);
			} else if (condition === 'element') {
				try {
					if (!args.target?.handle) this.observer.observe();
					this.observer.findTarget(args.target);
					ready = true;
				} catch {
					ready = false;
				}
			} else {
				throw new DomActionError('invalid_arguments');
			}
			if (ready) return { ok: true, snapshot: this.observer.observe() };
			if (this.clock() - startedAt >= 30_000) break;
			await this.sleep(100);
		}
		throw new DomActionError('wait_timeout');
	}

	private async download(args: Record<string, any>) {
		const element = this.target(args);
		const anchor =
			element instanceof HTMLAnchorElement
				? element
				: element instanceof HTMLElement
					? element.closest('a[href]')
					: null;
		if (!(anchor instanceof HTMLAnchorElement)) throw new DomActionError('invalid_target');
		let parsed: URL;
		try {
			parsed = new URL(anchor.href);
		} catch {
			throw new DomActionError('restricted_url');
		}
		if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
			throw new DomActionError('restricted_url');
		}
		const filename = anchor.getAttribute('download')?.slice(0, 255);
		return {
			ok: true,
			download: {
				url: parsed.href,
				...(filename ? { filename } : {})
			}
		};
	}
}
