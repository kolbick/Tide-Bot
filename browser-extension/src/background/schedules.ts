import type { WorkflowDefinition } from './workflows';

const ALARM_PREFIX = 'tide-bot-schedule:';
const NANOSECONDS_PER_MILLISECOND = 1_000_000;
const NANOSECONDS: Record<string, number> = {
	MINUTELY: 60 * 1_000_000_000,
	HOURLY: 60 * 60 * 1_000_000_000,
	DAILY: 24 * 60 * 60 * 1_000_000_000,
	WEEKLY: 7 * 24 * 60 * 60 * 1_000_000_000
};

export interface BrowserScheduleDefinition {
	id: string;
	workflowId: string;
	deviceId: string;
	name: string;
	rrule: string;
	timezone: string;
	isActive: boolean;
	lastRunAt: number | null;
	nextRunAt: number | null;
}

interface ScheduleApi {
	workflow(id: string): Promise<{ definition: WorkflowDefinition }>;
	completeScheduleRun(
		id: string,
		value: { outcome: 'complete' | 'paused' | 'failed'; lastRunAt: number; nextRunAt: number }
	): Promise<unknown>;
}

interface ScheduleManagerOptions {
	alarms: {
		create(name: string, info: { when: number }): void;
		clear(name: string): Promise<boolean> | boolean;
		onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
	};
	api: ScheduleApi;
	deviceId(): string | null;
	replay(definition: WorkflowDefinition): Promise<unknown>;
	now?: () => number;
	onEvent?: (event: {
		scheduleId: string;
		name: string;
		status: 'running' | 'complete' | 'paused' | 'failed';
		code?: string;
	}) => void;
}

const parseRule = (value: string) => {
	if (typeof value !== 'string' || !value || value.length > 256) return null;
	const entries = value.split(';').map((item) => item.split('='));
	if (entries.some((parts) => parts.length !== 2)) return null;
	const rule = Object.fromEntries(entries);
	if (Object.keys(rule).length !== entries.length) return null;
	if (
		Object.keys(rule).some(
			(key) => !['FREQ', 'INTERVAL', 'BYDAY', 'BYHOUR', 'BYMINUTE'].includes(key)
		)
	) {
		return null;
	}
	if (!Object.hasOwn(NANOSECONDS, rule.FREQ)) return null;
	if (!/^[1-9][0-9]{0,2}$/.test(rule.INTERVAL ?? '1')) return null;
	const interval = Number(rule.INTERVAL ?? '1');
	if (interval > 365) return null;
	if (rule.BYDAY && !/^(?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*$/.test(rule.BYDAY)) {
		return null;
	}
	if (rule.BYHOUR && !/^(?:[0-9]|1[0-9]|2[0-3])$/.test(rule.BYHOUR)) return null;
	if (rule.BYMINUTE && !/^(?:[0-9]|[1-5][0-9])$/.test(rule.BYMINUTE)) return null;
	return { frequency: rule.FREQ, interval };
};

export const validateScheduleRRule = (value: string) => parseRule(value) !== null;

export const validateTimeZone = (value: string) => {
	if (typeof value !== 'string' || !value || value.length > 100) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value });
		return true;
	} catch {
		return false;
	}
};

const nextOccurrence = (schedule: BrowserScheduleDefinition, afterNanoseconds: number) => {
	const parsed = parseRule(schedule.rrule);
	if (!parsed) throw new Error('invalid_rrule');
	const increment = NANOSECONDS[parsed.frequency] * parsed.interval;
	let next = schedule.nextRunAt ?? afterNanoseconds + increment;
	while (next <= afterNanoseconds) next += increment;
	return next;
};

export class ScheduleManager {
	private readonly options: ScheduleManagerOptions;
	private schedules = new Map<string, BrowserScheduleDefinition>();
	private handledOccurrences = new Set<string>();
	private running = new Set<string>();

	constructor(options: ScheduleManagerOptions) {
		this.options = options;
		this.options.alarms.onAlarm.addListener((alarm) => {
			if (!alarm.name.startsWith(ALARM_PREFIX)) return;
			void this.run(alarm.name.slice(ALARM_PREFIX.length));
		});
	}

	async sync(values: BrowserScheduleDefinition[]) {
		const deviceId = this.options.deviceId();
		const nextSchedules = new Map<string, BrowserScheduleDefinition>();
		for (const schedule of values.slice(0, 500)) {
			const alarmName = `${ALARM_PREFIX}${schedule.id}`;
			if (
				!schedule.isActive ||
				schedule.deviceId !== deviceId ||
				!validateScheduleRRule(schedule.rrule) ||
				!validateTimeZone(schedule.timezone) ||
				schedule.nextRunAt === null
			) {
				await this.options.alarms.clear(alarmName);
				continue;
			}
			nextSchedules.set(schedule.id, { ...schedule });
			const nowNanoseconds = this.nowNanoseconds();
			if (schedule.nextRunAt <= nowNanoseconds) {
				const occurrence = `${schedule.id}:${schedule.nextRunAt}`;
				if (!this.handledOccurrences.has(occurrence)) {
					this.handledOccurrences.add(occurrence);
					this.schedules = nextSchedules;
					await this.run(schedule.id);
				}
			} else {
				this.options.alarms.create(alarmName, {
					when: Math.ceil(schedule.nextRunAt / NANOSECONDS_PER_MILLISECOND)
				});
			}
		}
		for (const id of this.schedules.keys()) {
			if (!nextSchedules.has(id)) await this.options.alarms.clear(`${ALARM_PREFIX}${id}`);
		}
		this.schedules = nextSchedules;
	}

	private async run(scheduleId: string) {
		const schedule = this.schedules.get(scheduleId);
		if (!schedule || this.running.has(scheduleId) || !schedule.isActive) return;
		if (schedule.deviceId !== this.options.deviceId()) return;
		this.running.add(scheduleId);
		this.options.onEvent?.({ scheduleId, name: schedule.name, status: 'running' });
		let outcome: 'complete' | 'paused' | 'failed' = 'complete';
		let code: string | undefined;
		try {
			const workflow = await this.options.api.workflow(schedule.workflowId);
			await this.options.replay(workflow.definition);
		} catch (error) {
			code =
				typeof error === 'object' && error !== null && 'code' in error
					? String((error as { code: unknown }).code)
					: 'schedule_run_failed';
			outcome = [
				'workflow_approval_required',
				'workflow_input_required',
				'session_not_open',
				'locked_tab_lost'
			].includes(code)
				? 'paused'
				: 'failed';
		}

		const lastRunAt = this.nowNanoseconds();
		const nextRunAt = nextOccurrence(
			schedule,
			Math.max(lastRunAt, schedule.nextRunAt ?? lastRunAt)
		);
		try {
			await this.options.api.completeScheduleRun(schedule.id, { outcome, lastRunAt, nextRunAt });
			this.schedules.set(schedule.id, { ...schedule, lastRunAt, nextRunAt });
			this.options.alarms.create(`${ALARM_PREFIX}${schedule.id}`, {
				when: Math.ceil(nextRunAt / NANOSECONDS_PER_MILLISECOND)
			});
		} finally {
			this.running.delete(scheduleId);
		}
		this.options.onEvent?.({
			scheduleId,
			name: schedule.name,
			status: outcome,
			...(code ? { code } : {})
		});
	}

	private nowNanoseconds() {
		return this.options.now
			? this.options.now() * NANOSECONDS_PER_MILLISECOND
			: Date.now() * NANOSECONDS_PER_MILLISECOND;
	}
}
