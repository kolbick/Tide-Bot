const injectionPatterns = [
	/(ignore|disregard).{0,50}(previous|system|developer|instruction)/i,
	/reveal.{0,40}(system prompt|developer message|secret|credential)/i,
	/(bypass|disable|override).{0,40}(policy|approval|permission|safety)/i,
	/(send|upload|exfiltrate).{0,50}(cookie|token|password|credential|secret)/i
];

export function detectPageSignals(text: string): string[] {
	const bounded = text.slice(0, 100_000);
	return injectionPatterns.some((pattern) => pattern.test(bounded)) ? ['prompt_injection'] : [];
}
