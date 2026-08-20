import { describe, expect, it, vi } from 'vitest';

import { ScheduleManager, validateScheduleRRule } from './schedules';

const schedule = (changes: Record<string, unknown> = {}) => ({
	id: 'schedule-a',
	workflowId: 'workflow-a',
	deviceId: 'device-a',
	name: 'Morning report',
	rrule: 'FREQ=DAILY;INTERVAL=1',
	timezone: 'America/New_York',
	isActive: true,
	lastRunAt: null,
	nextRunAt: 900_000_000,
	...changes
});

const setup = (changes: Record<string, unknown> = {}) => {
	let alarmListener = (_alarm: { name: string }) => undefined;
	const alarms = {
		create: vi.fn(),
		clear: vi.fn(async () => true),
		onAlarm: {
			addListener: vi.fn((listener) => {
				alarmListener = listener;
			})
		}
	};
	const api = {
		workflow: vi.fn(async () => ({
			id: 'workflow-a',
			name: 'Morning report',
			version: 1,
			definition: {
				schemaVersion: 1,
				origin: 'https://example.com',
				steps: [{ action: 'navigate', url: 'https://example.com/report' }]
			}
		})),
		completeScheduleRun: vi.fn(async () => ({ ok: true }))
	};
	const replay = vi.fn(async () => ({ ok: true }));
	const events: unknown[] = [];
	const manager = new ScheduleManager({
		alarms,
		api,
		deviceId: () => 'device-a',
		replay,
		now: () => 1_000,
		onEvent: (event) => events.push(event),
		...(changes as any)
	});
	return { manager, alarms, api, replay, events, fire: (name: string) => alarmListener({ name }) };
};

describe('ScheduleManager', () => {
	it('accepts a bounded recurring rule and rejects unsupported or unbounded rules', () => {
		expect(validateScheduleRRule('FREQ=DAILY;INTERVAL=1')).toBe(true);
		expect(validateScheduleRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')).toBe(true);
		expect(validateScheduleRRule('FREQ=SECONDLY;INTERVAL=1')).toBe(false);
		expect(validateScheduleRRule('FREQ=DAILY;COUNT=999999')).toBe(false);
		expect(validateScheduleRRule('FREQ=DAILY;BYHOUR=99')).toBe(false);
	});

	it('runs only the latest missed occurrence once after Chrome starts', async () => {
		const { manager, replay, api } = setup();
		const due = schedule();

		await manager.sync([due]);
		await manager.sync([due]);

		expect(replay).toHaveBeenCalledOnce();
		expect(api.completeScheduleRun).toHaveBeenCalledOnce();
		expect(api.completeScheduleRun).toHaveBeenCalledWith(
			'schedule-a',
			expect.objectContaining({ outcome: 'complete', lastRunAt: 1_000_000_000 })
		);
	});

	it('creates future Chrome alarms only for active schedules assigned to this device', async () => {
		const { manager, alarms } = setup();

		await manager.sync([
			schedule({ id: 'future', nextRunAt: 2_000_000_000 }),
			schedule({ id: 'disabled', isActive: false }),
			schedule({ id: 'other-device', deviceId: 'device-b' })
		]);

		expect(alarms.create).toHaveBeenCalledOnce();
		expect(alarms.create).toHaveBeenCalledWith('tide-bot-schedule:future', { when: 2_000 });
		expect(alarms.clear).toHaveBeenCalledWith('tide-bot-schedule:disabled');
	});

	it('pauses approval or input-bound runs without retry floods', async () => {
		const replay = vi.fn(async () => {
			throw Object.assign(new Error('workflow_approval_required'), {
				code: 'workflow_approval_required'
			});
		});
		const { manager, api, events, fire } = setup({ replay });
		await manager.sync([schedule({ nextRunAt: 2_000_000_000 })]);

		fire('tide-bot-schedule:schedule-a');
		await vi.waitFor(() => expect(api.completeScheduleRun).toHaveBeenCalledOnce());

		expect(events).toContainEqual(
			expect.objectContaining({ scheduleId: 'schedule-a', status: 'paused' })
		);
		expect(api.completeScheduleRun).toHaveBeenCalledWith(
			'schedule-a',
			expect.objectContaining({ outcome: 'paused' })
		);
	});
});
