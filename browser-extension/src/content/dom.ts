import { detectPageSignals } from './injection-defense';
import { redactText, safeElementValue } from './redaction';

const INTERACTIVE_SELECTOR = [
	'a[href]',
	'button',
	'input:not([type="hidden"])',
	'select',
	'textarea',
	'[contenteditable="true"]',
	'[role="button"]',
	'[role="link"]',
	'[role="textbox"]',
	'[role="checkbox"]',
	'[role="radio"]',
	'[role="combobox"]',
	'[role="menuitem"]',
	'[tabindex]:not([tabindex="-1"])'
].join(',');
const LANDMARK_ROLES = new Set([
	'banner',
	'navigation',
	'main',
	'complementary',
	'contentinfo',
	'form',
	'search',
	'region'
]);
const LANDMARK_SELECTOR = [
	'header',
	'nav',
	'main',
	'aside',
	'footer',
	'form',
	...[...LANDMARK_ROLES].map((role) => `[role="${role}"]`)
].join(',');
const MAX_ELEMENTS = 500;

export interface SemanticElementRecord {
	handle: string;
	role: string;
	name: string;
	text?: string;
	value?: string;
	disabled?: boolean;
}

export interface PageSnapshot {
	revision: number;
	url: string;
	title: string;
	viewport: { width: number; height: number; scrollX: number; scrollY: number };
	headings: Array<{ level: number; text: string }>;
	landmarks: Array<{ role: string; name: string }>;
	forms: Array<{ handle: string; name: string }>;
	interactive: SemanticElementRecord[];
	pageSignals: string[];
	untrustedContent: true;
	truncated: boolean;
}

interface DomObserverOptions {
	document: Document;
	window: Window;
	nonce?: string;
	maxBytes?: number;
}

export class DomObservationError extends Error {
	constructor(public readonly code: string) {
		super(code);
		this.name = 'DomObservationError';
	}
}

const normalized = (value: string | null | undefined) =>
	(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function implicitRole(element: Element): string {
	const explicit = element.getAttribute('role');
	if (explicit) return explicit.split(/\s+/)[0].toLowerCase();
	const tag = element.tagName.toLowerCase();
	if (tag === 'a') return 'link';
	if (tag === 'button') return 'button';
	if (tag === 'textarea') return 'textbox';
	if (tag === 'select') return (element as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
	if (tag === 'input') {
		const type = (element as HTMLInputElement).type.toLowerCase();
		if (['button', 'submit', 'reset'].includes(type)) return 'button';
		if (type === 'checkbox') return 'checkbox';
		if (type === 'radio') return 'radio';
		if (type === 'range') return 'slider';
		return 'textbox';
	}
	if (
		(element as HTMLElement).isContentEditable ||
		element.getAttribute('contenteditable') === 'true'
	)
		return 'textbox';
	return tag;
}

function labelText(label: Element, control: Element): string {
	if (!label.contains(control)) return label.textContent ?? '';
	const visit = (node: Node): string => {
		if (node === control) return '';
		if (node.nodeType === 3) return node.textContent ?? '';
		return [...node.childNodes].map(visit).join(' ');
	};
	return visit(label);
}

function accessibleName(element: Element, document: Document): string {
	const ariaLabel = element.getAttribute('aria-label');
	if (ariaLabel) return redactText(ariaLabel, 256);
	const labelledBy = element.getAttribute('aria-labelledby');
	if (labelledBy) {
		const text = labelledBy
			.split(/\s+/)
			.map((id) => document.getElementById(id)?.textContent ?? '')
			.join(' ');
		if (text.trim()) return redactText(text, 256);
	}
	const labels = (element as HTMLInputElement).labels;
	if (labels?.length) {
		const text = [...labels].map((label) => labelText(label, element)).join(' ');
		if (text.trim()) return redactText(text, 256);
	}
	const closest = element.closest('label');
	const closestLabel = closest ? labelText(closest, element) : '';
	if (closestLabel?.trim()) return redactText(closestLabel, 256);
	for (const attribute of ['alt', 'placeholder', 'title']) {
		const value = element.getAttribute(attribute);
		if (value) return redactText(value, 256);
	}
	return redactText(element.textContent ?? '', 256);
}

function isVisible(element: Element): boolean {
	if (element instanceof HTMLInputElement && element.type.toLowerCase() === 'hidden') return false;
	for (let current: Element | null = element; current; current = current.parentElement) {
		if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true')
			return false;
		const style = (current as HTMLElement).style;
		if (
			style?.display === 'none' ||
			style?.visibility === 'hidden' ||
			style?.visibility === 'collapse'
		) {
			return false;
		}
	}
	return true;
}

function landmarkRole(element: Element) {
	const explicit = element.getAttribute('role');
	if (explicit) {
		const role = explicit.split(/\s+/)[0].toLowerCase();
		return LANDMARK_ROLES.has(role) ? role : undefined;
	}
	return (
		{
			header: 'banner',
			nav: 'navigation',
			main: 'main',
			aside: 'complementary',
			footer: 'contentinfo',
			form: 'form'
		} as Record<string, string>
	)[element.tagName.toLowerCase()];
}

export class DomObserver {
	private readonly document: Document;
	private readonly window: Window;
	private readonly nonce: string;
	private readonly maxBytes: number;
	private revision = 0;
	private handles = new Map<string, Element>();
	private records: Array<{ element: Element; record: SemanticElementRecord }> = [];

	constructor(options: DomObserverOptions) {
		this.document = options.document;
		this.window = options.window;
		this.nonce = (options.nonce ?? crypto.randomUUID().replaceAll('-', '').slice(0, 8)).replace(
			/[^a-z0-9]/gi,
			''
		);
		this.maxBytes = Math.max(4_096, options.maxBytes ?? 64_000);
	}

	observe(): PageSnapshot {
		this.revision += 1;
		this.handles = new Map();
		this.records = [];
		let handleIndex = 0;
		const register = (element: Element) => {
			handleIndex += 1;
			const handle = `tbx_${this.revision.toString(36)}_${handleIndex.toString(36)}_${this.nonce}`;
			this.handles.set(handle, element);
			return handle;
		};

		const interactive = [...this.document.querySelectorAll(INTERACTIVE_SELECTOR)]
			.filter(isVisible)
			.slice(0, MAX_ELEMENTS)
			.map((element) => {
				const record: SemanticElementRecord = {
					handle: register(element),
					role: implicitRole(element),
					name: accessibleName(element, this.document)
				};
				const text = redactText(element.textContent ?? '', 500);
				if (text && text !== record.name) record.text = text;
				const value = safeElementValue(element);
				if (value !== undefined) record.value = value;
				if (
					(element as HTMLButtonElement).disabled ||
					element.getAttribute('aria-disabled') === 'true'
				) {
					record.disabled = true;
				}
				this.records.push({ element, record });
				return record;
			});

		const headings = [...this.document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')]
			.filter(isVisible)
			.slice(0, 100)
			.map((element) => ({
				level: Number(element.getAttribute('aria-level') ?? element.tagName.slice(1)) || 2,
				text: redactText(element.textContent ?? '', 500)
			}))
			.filter((heading) => heading.text);
		const landmarks = [...this.document.querySelectorAll(LANDMARK_SELECTOR)]
			.filter(isVisible)
			.map((element) => ({
				role: landmarkRole(element),
				name: accessibleName(element, this.document)
			}))
			.filter((item): item is { role: string; name: string } => Boolean(item.role))
			.slice(0, 100);
		const forms = [...this.document.forms]
			.filter(isVisible)
			.slice(0, 50)
			.map((form) => ({ handle: register(form), name: accessibleName(form, this.document) }));
		const pageSignals = detectPageSignals(this.document.body?.textContent ?? '');
		const snapshot: PageSnapshot = {
			revision: this.revision,
			url: this.window.location.href.slice(0, 4_096),
			title: redactText(this.document.title, 512),
			viewport: {
				width: this.window.innerWidth,
				height: this.window.innerHeight,
				scrollX: this.window.scrollX,
				scrollY: this.window.scrollY
			},
			headings,
			landmarks,
			forms,
			interactive,
			pageSignals,
			untrustedContent: true,
			truncated: this.document.querySelectorAll(INTERACTIVE_SELECTOR).length > interactive.length
		};
		this.fitSnapshot(snapshot);
		const exposedHandles = new Set([
			...snapshot.interactive.map((record) => record.handle),
			...snapshot.forms.map((form) => form.handle)
		]);
		for (const handle of this.handles.keys()) {
			if (!exposedHandles.has(handle)) this.handles.delete(handle);
		}
		this.records = this.records.filter(({ record }) => exposedHandles.has(record.handle));
		return snapshot;
	}

	resolve(handle: string): Element {
		const element = this.handles.get(handle);
		if (!element || !element.isConnected) throw new DomObservationError('stale_handle');
		return element;
	}

	findTarget(target: unknown): Element {
		if (typeof target !== 'object' || target === null || Array.isArray(target)) {
			throw new DomObservationError('invalid_target');
		}
		const record = target as Record<string, unknown>;
		if ('selector' in record || 'xpath' in record || 'css' in record) {
			throw new DomObservationError('raw_selector_denied');
		}
		if (typeof record.handle === 'string') return this.resolve(record.handle);
		const matchFields = ['role', 'name', 'text', 'label', 'placeholder', 'testId'].filter(
			(key) => typeof record[key] === 'string' && record[key] !== ''
		);
		if (!matchFields.length) throw new DomObservationError('invalid_target');
		const index =
			typeof record.index === 'number' && Number.isInteger(record.index) && record.index >= 0
				? record.index
				: 0;
		const matches = this.records.filter(({ element, record: candidate }) =>
			matchFields.every((field) => {
				const expected = normalized(String(record[field]));
				if (field === 'role') return normalized(candidate.role) === expected;
				if (field === 'name' || field === 'label') return normalized(candidate.name) === expected;
				if (field === 'text')
					return normalized(candidate.text ?? element.textContent).includes(expected);
				if (field === 'placeholder')
					return normalized(element.getAttribute('placeholder')) === expected;
				return normalized(element.getAttribute('data-testid')) === expected;
			})
		);
		const match = matches[index];
		if (!match || !isVisible(match.element)) throw new DomObservationError('target_not_found');
		return match.element;
	}

	private fitSnapshot(snapshot: PageSnapshot) {
		const size = () => new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
		while (size() > this.maxBytes) {
			snapshot.truncated = true;
			if (snapshot.interactive.length) snapshot.interactive.pop();
			else if (snapshot.forms.length) snapshot.forms.pop();
			else if (snapshot.landmarks.length) snapshot.landmarks.pop();
			else if (snapshot.headings.length) snapshot.headings.pop();
			else break;
		}
	}
}
