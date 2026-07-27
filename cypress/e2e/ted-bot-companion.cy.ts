const fixtureOrigin = Cypress.env('fixtureOrigin');
const slowStreamMarker = 'TEDBOT_CYPRESS_SLOW_STREAM';

if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(fixtureOrigin ?? '')) {
	throw new Error('fixtureOrigin must be a generated loopback HTTP origin');
}

Cypress.on('log:added', (attributes, log) => {
	if (['request', 'xhr', 'fetch', 'intercept'].includes(attributes.name)) {
		log.set({
			message: '[REDACTED TEST REQUEST]',
			consoleProps: () => ({ request: '[REDACTED]' })
		});
	}
});

function randomAccount() {
	const suffix = `${Date.now()}-${Cypress._.random(100000, 999999)}`;
	return {
		name: `Ted Bot Cypress ${suffix}`,
		email: `tedbot-cypress-${suffix}@example.invalid`,
		password: `Cypress-only-${suffix}!`
	};
}

function clearBrowserSession() {
	cy.clearCookies({ log: false });
	cy.clearLocalStorage({ log: false });
	cy.window({ log: false }).then({ log: false }, (window) => window.sessionStorage.clear());
	Cypress.session.clearAllSavedSessions();
}

// Tide-Bot permanently clears `ui.enable_signup` once the first account is created
// and promoted to admin, so the sign-up UI can be exercised exactly once per
// isolated stack. The disposable account is therefore created once and each test
// signs in through the normal UI afterwards. That first account is also the admin,
// which is what makes the canonical web-search control reachable at all.
let account: { name: string; email: string; password: string };

function signUp() {
	account = randomAccount();
	cy.visit('/auth');
	// The onboarding overlay renders only after /api/config resolves.
	cy.get('button[aria-label="Get started"]', { timeout: 60000 }).click();
	cy.get('#name').type(account.name, { log: false });
	cy.get('#email').type(account.email, { log: false });
	cy.get('#password').type(account.password, { log: false });
	cy.get('body').then(($body) => {
		if ($body.find('#confirm-password').length > 0) {
			cy.get('#confirm-password').type(account.password, { log: false });
		}
	});
	cy.contains('button[type="submit"]', /Create (?:Admin )?Account/).click();
	cy.location('pathname', { timeout: 60000 }).should('not.eq', '/auth');
}

function signIn() {
	cy.visit('/auth?form=signin');
	cy.get('#email', { timeout: 60000 }).type(account.email, { log: false });
	cy.get('#password').type(account.password, { log: false });
	cy.contains('button[type="submit"]', /^Sign in$/).click();
	cy.location('pathname', { timeout: 60000 }).should('not.eq', '/auth');
}

// The disposable account is necessarily the admin, and the app shows the changelog
// modal to admins whose stored settings version differs from the running one. Each
// test clears storage, so that modal would reappear and cover the canonical chat
// input. Suppress it through the same supported settings API the UI uses.
function suppressChangelogModal() {
	return cy.window({ log: false }).then({ log: false }, async (window) => {
		const token = window.localStorage.getItem('token');
		if (!token) {
			throw new Error('authenticated browser session did not contain a token');
		}
		const response = await window.fetch('/api/v1/users/user/settings/update', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				authorization: `Bearer ${token}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ ui: { showChangelog: false } })
		});
		if (!response.ok) {
			throw new Error(`isolated changelog suppression failed with ${response.status}`);
		}
	});
}

function seedEmptyChat() {
	return cy.window({ log: false }).then({ log: false }, async (window) => {
		const token = window.localStorage.getItem('token');
		if (!token) {
			throw new Error('authenticated browser session did not contain a token');
		}
		const response = await window.fetch('/api/v1/chats/new', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				authorization: `Bearer ${token}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				folder_id: null,
				chat: {
					id: crypto.randomUUID(),
					title: 'Ted-Bot Cypress companion chat',
					models: ['tedbot-cypress-model'],
					params: {},
					history: { messages: {}, currentId: null },
					messages: [],
					tags: [],
					timestamp: Date.now()
				}
			})
		});
		if (!response.ok) {
			throw new Error(`isolated chat fixture creation failed with ${response.status}`);
		}
		const chat = await response.json();
		return chat.id as string;
	});
}

function fixtureStatus(
	predicate: (status: {
		requestCount: number;
		streamStarted: boolean;
		aborted: boolean;
		completedCount: number;
	}) => boolean,
	attempts = 80
) {
	const poll = (remaining: number): Cypress.Chainable<Record<string, unknown>> =>
		cy
			.request({
				method: 'GET',
				url: `${fixtureOrigin}/__fixture/status`,
				log: false,
				failOnStatusCode: true
			})
			.then({ log: false }, ({ body }) => {
				if (predicate(body)) {
					return body;
				}
				if (remaining <= 1) {
					throw new Error('fixture status did not reach the expected isolated state');
				}
				return cy.wait(250, { log: false }).then(() => poll(remaining - 1));
			});
	return poll(attempts);
}

function mountCompanionFrame() {
	cy.document().then((document) => {
		const frame = document.createElement('iframe');
		frame.id = 'tedbot-companion-frame';
		frame.src = '/companion';
		frame.style.position = 'fixed';
		frame.style.inset = '0';
		frame.style.width = '100%';
		frame.style.height = '100%';
		frame.style.zIndex = '2147483647';
		document.body.appendChild(frame);
	});
	return cy
		.get<HTMLIFrameElement>('#tedbot-companion-frame')
		.its('0.contentDocument.body')
		.should('not.be.empty')
		.then((body) => cy.wrap(body));
}

describe('Ted-Bot authenticated companion smoke', () => {
	before(() => {
		clearBrowserSession();
		signUp();
	});

	beforeEach(() => {
		clearBrowserSession();
	});

	it('redirects anonymous companion access through normal authentication', () => {
		cy.visit('/companion');
		cy.location('pathname', { timeout: 30000 }).should('eq', '/auth');
	});

	it('uses compact companion chrome and aborts exactly one slow upstream stream', () => {
		signIn();
		suppressChangelogModal();
		seedEmptyChat().then((chatId) => {
			cy.visit(`/c/${chatId}`);
			cy.get('#chat-input', { timeout: 60000 }).should('be.visible');

			let proxyRequestCount = 0;
			cy.intercept('POST', '**/api/chat/completions', (request) => {
				proxyRequestCount += 1;
				request.continue();
			}).as('companionCompletion');

			mountCompanionFrame().within(() => {
				cy.get('#companion-chat-input', { timeout: 60000 }).should('be.visible');
				cy.get('#chat-input').should('not.exist');
				cy.get('#integration-menu-button').should('not.exist');
				cy.get('#input-menu-button').should('not.exist');
				cy.get('nav').should('not.exist');
				cy.get('#companion-chat-input').type(slowStreamMarker, { log: false });
				cy.get('button[aria-label="Send message"]').click();
			});

			cy.wait('@companionCompletion', { timeout: 30000 });
			fixtureStatus((status) => status.requestCount === 1 && status.streamStarted === true).then(
				(status) => {
					expect(status).to.include({
						requestCount: 1,
						streamStarted: true,
						completedCount: 0
					});
				}
			);

			cy.get('#tedbot-companion-frame')
				.its('0.contentDocument.body')
				.then((body) => {
					cy.wrap(body).within(() => {
						cy.contains('Ted-Bot Cypress first delta', { timeout: 30000 }).should('be.visible');
						cy.get('button[aria-label="Stop response"]').should('be.visible').click();
					});
				});

			fixtureStatus((status) => status.aborted === true).then((status) => {
				expect(status).to.deep.equal({
					requestCount: 1,
					streamStarted: true,
					aborted: true,
					completedCount: 0
				});
			});
			cy.wait(500, { log: false }).then(() => {
				expect(proxyRequestCount).to.equal(1);
			});
			cy.get('#tedbot-companion-frame')
				.its('0.contentDocument.body')
				.then((body) => {
					cy.wrap(body).within(() => {
						cy.contains('Ted-Bot Cypress stream').should('not.exist');
						cy.get('button[aria-label="Stop response"]').should('not.exist');
					});
				});
		});
	});

	it('denies canonical full-chat web search confirmation before any completion', () => {
		signIn();
		suppressChangelogModal();
		// Reload so the layout re-reads the stored settings before the canonical
		// chat input is exercised.
		cy.visit('/');
		let proxyRequestCount = 0;
		cy.intercept('POST', '**/api/chat/completions', (request) => {
			proxyRequestCount += 1;
			request.continue();
		});

		cy.get('#chat-input', { timeout: 60000 }).click().type('Do not submit this search', {
			log: false
		});
		cy.get('#integration-menu-button').click();
		cy.get('button[aria-label="Enable Web Search"]').click();
		cy.contains('Use Web Search?').should('be.visible');
		cy.then(() => expect(proxyRequestCount).to.equal(0));
		cy.contains('button', /^Cancel$/).click();
		cy.contains('Use Web Search?').should('not.exist');

		fixtureStatus((status) => status.completedCount === 0).then((status) => {
			expect(status.completedCount).to.equal(0);
		});
		cy.then(() => expect(proxyRequestCount).to.equal(0));
	});
});
