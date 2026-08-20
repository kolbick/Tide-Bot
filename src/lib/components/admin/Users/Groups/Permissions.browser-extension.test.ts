// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { afterEach, expect, test } from 'vitest';

import Permissions from './Permissions.svelte';

afterEach(cleanup);

const i18n = writable({ t: (message: string) => message });

test('shows browser control enabled by default in feature permissions', () => {
	const view = render(Permissions, {
		props: { permissions: {}, defaultPermissions: {} },
		context: new Map([['i18n', i18n]])
	});

	const label = view.getByText('Browser control extension');
	const section = label.parentElement?.parentElement;
	const toggle = section?.querySelector('[role="switch"]');

	expect(toggle).toHaveAttribute('aria-checked', 'true');
});

test('explains that an explicit off value overrides the default', () => {
	const view = render(Permissions, {
		props: {
			permissions: { features: { browser_extension: false } },
			defaultPermissions: { features: { browser_extension: true } }
		},
		context: new Map([['i18n', i18n]])
	});

	expect(
		view.getByText('An explicit group deny overrides the default browser-control permission.')
	).toBeInTheDocument();
});
