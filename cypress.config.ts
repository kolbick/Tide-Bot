import { defineConfig } from 'cypress';

// Deliberately declares no baseUrl. The isolated companion smoke receives its
// generated loopback origin from scripts/run-companion-cypress.mjs, so a bare
// `cypress run` cannot reach a live, user-managed, or production Tide-Bot stack.
export default defineConfig({
	e2e: {
		specPattern: 'cypress/e2e/**/*.cy.ts',
		supportFile: false,
		fixturesFolder: false,
		video: false,
		screenshotOnRunFailure: false
	}
});
