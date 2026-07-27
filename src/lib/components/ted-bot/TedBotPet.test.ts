// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import { expect, test } from 'vitest';

import TedBotPet from './TedBotPet.svelte';

test('provides one labelled image and a decorative sprite', () => {
	const { getAllByRole, getByRole } = render(TedBotPet, {
		state: 'idle',
		label: 'Ted-Bot ready'
	});

	expect(getByRole('img', { name: 'Ted-Bot ready' })).toBeInTheDocument();
	expect(getAllByRole('img')).toHaveLength(1);
});
