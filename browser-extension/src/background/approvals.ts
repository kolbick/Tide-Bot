import type { BrowserCommand } from '../shared/protocol';

const cardPattern = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const sensitiveAssignment =
	/(password|passcode|token|secret|api[_-]?key|card(?:number)?|cvv|cvc)\s*[:=]\s*[^\s,;]+/gi;

export function approvalSummary(command: BrowserCommand): string {
	const target = command.args.target;
	const record =
		typeof target === 'object' && target !== null && !Array.isArray(target)
			? (target as Record<string, unknown>)
			: {};
	const targetLabel = ['role', 'name', 'label', 'placeholder']
		.map((key) => record[key])
		.find((value): value is string => typeof value === 'string' && value.length > 0);
	const raw = targetLabel ? `${command.name} on ${targetLabel}` : command.name;
	return raw
		.replace(cardPattern, '[REDACTED]')
		.replace(sensitiveAssignment, '$1=[REDACTED]')
		.slice(0, 240);
}

interface ApprovalRequest {
	commandId: string;
	summary: string;
	reason: string;
}

interface ApprovalCoordinatorOptions {
	request: (approval: ApprovalRequest) => Promise<void> | void;
	timeoutMilliseconds?: number;
	setTimer?: (callback: () => void, milliseconds: number) => unknown;
	clearTimer?: (timer: unknown) => void;
}

export class ApprovalCoordinator {
	private readonly pending = new Map<
		string,
		{ resolve: (approved: boolean) => void; timer: unknown }
	>();
	private readonly timeoutMilliseconds: number;
	private readonly setTimer: (callback: () => void, milliseconds: number) => unknown;
	private readonly clearTimer: (timer: unknown) => void;

	constructor(private readonly options: ApprovalCoordinatorOptions) {
		this.timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;
		this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
		this.clearTimer =
			options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
	}

	async ask(commandId: string, command: BrowserCommand, reason: string): Promise<boolean> {
		if (this.pending.has(commandId)) return false;
		let resolveApproval!: (approved: boolean) => void;
		const response = new Promise<boolean>((resolve) => {
			resolveApproval = resolve;
		});
		const timer = this.setTimer(() => this.resolve(commandId, false), this.timeoutMilliseconds);
		this.pending.set(commandId, { resolve: resolveApproval, timer });
		try {
			await this.options.request({
				commandId,
				summary: approvalSummary(command),
				reason
			});
		} catch {
			this.resolve(commandId, false);
		}
		return response;
	}

	resolve(commandId: string, approved: boolean) {
		const pending = this.pending.get(commandId);
		if (!pending) return false;
		this.pending.delete(commandId);
		this.clearTimer(pending.timer);
		pending.resolve(approved);
		return true;
	}

	cancelAll() {
		for (const commandId of [...this.pending.keys()]) this.resolve(commandId, false);
	}
}
