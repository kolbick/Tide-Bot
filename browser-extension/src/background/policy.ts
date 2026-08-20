import type { ActionMode } from '../shared/constants';
import { BROWSER_COMMAND_NAMES, type BrowserCommand } from '../shared/protocol';
import { pageIdentity } from './tab-controller';

export type PolicyDecision =
	| { decision: 'allow'; reason: string }
	| { decision: 'ask'; reason: string }
	| { decision: 'deny'; reason: string };

interface PolicyContext {
	mode: ActionMode;
	command: BrowserCommand;
	currentUrl: string;
	pageSignals: string[];
}

const approvedCommands = new Set<string>(BROWSER_COMMAND_NAMES);
const consequentialPattern =
	/(?<![a-z])(purchase|buy|pay|send|submit|confirm|delete|remove|cancel account|book|reserve)(?![a-z])/i;
const secretPattern =
	/(password|passcode|pin|card|credit|debit|payment|cvv|cvc|security code|expiry|expiration)/i;
const injectionPattern =
	/(ignore|disregard).{0,40}(previous|system|developer|instruction)|reveal.{0,30}(prompt|secret)|bypass.{0,30}(policy|approval|permission)/i;

function semanticTargetText(args: Record<string, unknown>) {
	const target = args.target;
	if (typeof target !== 'object' || target === null || Array.isArray(target)) return '';
	const record = target as Record<string, unknown>;
	return ['role', 'name', 'label', 'placeholder', 'text', 'testId']
		.map((key) => record[key])
		.filter((value): value is string => typeof value === 'string')
		.join(' ');
}

function navigationIdentity(command: BrowserCommand) {
	if (command.name !== 'browser_navigate' || typeof command.args.url !== 'string') return null;
	try {
		return pageIdentity(command.args.url);
	} catch {
		return false;
	}
}

export function decideBrowserAction(context: PolicyContext): PolicyDecision {
	const { command } = context;
	if (!approvedCommands.has(command.name)) {
		return { decision: 'deny', reason: 'forbidden_capability' };
	}

	const navigation = navigationIdentity(command);
	if (navigation === false) return { decision: 'deny', reason: 'restricted_url' };
	if (!command.mutating) return { decision: 'allow', reason: 'read_only' };

	const targetText = semanticTargetText(command.args);
	const secretField =
		command.name === 'browser_type' &&
		(command.args.fieldKind === 'password' ||
			command.args.fieldKind === 'payment' ||
			secretPattern.test(targetText));
	if (secretField) return { decision: 'ask', reason: 'secret_field' };

	if (
		context.pageSignals.some(
			(signal) => signal === 'prompt_injection' || injectionPattern.test(signal)
		)
	) {
		return { decision: 'ask', reason: 'prompt_injection_risk' };
	}

	if (command.name === 'browser_download' || consequentialPattern.test(targetText)) {
		return { decision: 'ask', reason: 'consequential_action' };
	}

	if (context.mode === 'manual-approval') {
		return { decision: 'ask', reason: 'manual_approval' };
	}

	if (navigation && context.mode === 'consequential-approval') {
		let currentOrigin: string;
		try {
			currentOrigin = pageIdentity(context.currentUrl).origin;
		} catch {
			return { decision: 'deny', reason: 'restricted_url' };
		}
		if (navigation.origin !== currentOrigin) {
			return { decision: 'ask', reason: 'cross_origin_navigation' };
		}
	}

	return context.mode === 'autonomous'
		? { decision: 'allow', reason: 'autonomous_ordinary' }
		: { decision: 'allow', reason: 'ordinary_action' };
}
