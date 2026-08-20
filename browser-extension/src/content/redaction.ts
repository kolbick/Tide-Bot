export const REDACTED = '[REDACTED]';

const sensitiveHintPattern =
	/(password|passcode|pin|card|credit|debit|payment|cvv|cvc|security.?code|expiry|expiration|auth|token|secret)/i;
const cardPattern = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const bearerPattern = /\bbearer\s+[a-z0-9._~+/=-]+/gi;
const assignmentPattern =
	/\b(password|passwd|passcode|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

const associatedLabel = (element: Element) => {
	const labelled = (element as HTMLInputElement).labels;
	if (labelled?.length) return [...labelled].map((label) => label.textContent ?? '').join(' ');
	return element.closest('label')?.textContent ?? '';
};

export function isSensitiveElement(element: Element): boolean {
	if (element instanceof HTMLInputElement && element.type.toLowerCase() === 'password') return true;
	const autocomplete = element.getAttribute('autocomplete') ?? '';
	if (/^(?:current-password|new-password|one-time-code|cc-)/i.test(autocomplete)) return true;
	const hints = [
		element.getAttribute('name'),
		element.id,
		element.getAttribute('aria-label'),
		element.getAttribute('placeholder'),
		associatedLabel(element)
	]
		.filter(Boolean)
		.join(' ');
	return sensitiveHintPattern.test(hints);
}

export function redactText(value: string, maxLength = 2_000): string {
	return value
		.replace(bearerPattern, 'Bearer [REDACTED]')
		.replace(assignmentPattern, '$1=[REDACTED]')
		.replace(cardPattern, REDACTED)
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maxLength);
}

export function safeElementValue(element: Element): string | undefined {
	let value: string | undefined;
	if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
		value = element.value;
	} else if (element instanceof HTMLSelectElement) {
		value = [...element.selectedOptions].map((option) => option.value).join(', ');
	} else if (
		element instanceof HTMLElement &&
		(element.isContentEditable || element.getAttribute('contenteditable') === 'true')
	) {
		value = element.textContent ?? '';
	}
	if (value === undefined) return undefined;
	if (isSensitiveElement(element)) return REDACTED;
	return redactText(value, 1_000);
}
