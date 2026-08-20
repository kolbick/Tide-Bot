// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';

import BrowserExtensionSettings from './BrowserExtensionSettings.svelte';

afterEach(cleanup);

const device = {
	id: 'device-a',
	label: 'Kolby Chrome',
	allowed_origin: 'https://tide-bot.com',
	extension_version: '1.0.0',
	last_seen_at: null,
	revoked_at: null,
	created_at: 1,
	updated_at: 1
};

const workflow = {
	id: 'workflow-a',
	name: 'Check the dashboard',
	version: 1,
	definition: { steps: [{ action: 'observe' }] },
	created_at: 1,
	updated_at: 1
};

const schedule = {
	id: 'schedule-a',
	workflow_id: workflow.id,
	device_id: device.id,
	name: 'Weekday check',
	rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
	timezone: 'America/New_York',
	is_active: true,
	last_run_at: null,
	next_run_at: null,
	catch_up_pending: false,
	created_at: 1,
	updated_at: 1
};

const makeClient = () => ({
	listDevices: vi.fn().mockResolvedValue([device]),
	renameDevice: vi.fn().mockImplementation(async (_token, _id, label) => ({ ...device, label })),
	revokeDevice: vi.fn().mockResolvedValue({ status: 'revoked' }),
	listWorkflows: vi.fn().mockResolvedValue([workflow]),
	listSchedules: vi.fn().mockResolvedValue([schedule]),
	getSettings: vi.fn().mockResolvedValue({
		custom_origins_unlocked: false,
		default_origin: 'https://tide-bot.com',
		can_manage: false
	}),
	updateSettings: vi.fn().mockResolvedValue({
		custom_origins_unlocked: true,
		default_origin: 'https://tide-bot.com',
		can_manage: true
	}),
	download: vi.fn().mockResolvedValue(undefined)
});

test('downloads the extension and explains Chrome installation without exposing admin controls', async () => {
	const client = makeClient();
	const view = render(BrowserExtensionSettings, {
		token: 'session-token',
		role: 'user',
		client
	});

	expect(await view.findByText('Tide-Bot Browser Control')).toBeInTheDocument();
	expect(await view.findByText('Kolby Chrome')).toBeInTheDocument();
	expect(view.getByText('Check the dashboard')).toBeInTheDocument();
	expect(view.getByText('Weekday check')).toBeInTheDocument();
	expect(view.getByText('chrome://extensions')).toBeInTheDocument();
	expect(view.getByText(/Load unpacked/i)).toBeInTheDocument();
	expect(view.queryByRole('switch', { name: /custom server origins/i })).not.toBeInTheDocument();

	await fireEvent.click(view.getByRole('button', { name: 'Download Chrome extension' }));
	expect(client.download).toHaveBeenCalledWith('session-token');
});

test('renames and revokes only the selected paired device', async () => {
	const client = makeClient();
	const view = render(BrowserExtensionSettings, {
		token: 'session-token',
		role: 'user',
		client
	});

	const rename = await view.findByRole('textbox', { name: 'Rename Kolby Chrome' });
	await fireEvent.input(rename, { target: { value: 'Office Chrome' } });
	await fireEvent.click(view.getByRole('button', { name: 'Save device name' }));

	expect(client.renameDevice).toHaveBeenCalledWith('session-token', 'device-a', 'Office Chrome');
	expect(view.getByText('Office Chrome')).toBeInTheDocument();

	await fireEvent.click(view.getByRole('button', { name: 'Revoke Office Chrome' }));
	await fireEvent.click(view.getByRole('button', { name: 'Confirm revoke Office Chrome' }));
	expect(client.revokeDevice).toHaveBeenCalledWith('session-token', 'device-a');
	expect(view.queryByText('Office Chrome')).not.toBeInTheDocument();
});

test('allows an administrator to unlock custom local-server origins', async () => {
	const client = makeClient();
	client.getSettings.mockResolvedValue({
		custom_origins_unlocked: false,
		default_origin: 'https://tide-bot.com',
		can_manage: true
	});
	const view = render(BrowserExtensionSettings, {
		token: 'admin-token',
		role: 'admin',
		client
	});

	const toggle = await view.findByRole('switch', { name: /custom server origins/i });
	await fireEvent.click(toggle);

	expect(client.updateSettings).toHaveBeenCalledWith('admin-token', {
		custom_origins_unlocked: true
	});
	expect(toggle).toHaveAttribute('aria-checked', 'true');
});
