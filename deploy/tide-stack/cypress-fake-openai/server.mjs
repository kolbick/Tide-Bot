import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const MODEL_ID = 'tedbot-cypress-model';
const SLOW_STREAM_MARKER = 'TEDBOT_CYPRESS_SLOW_STREAM';

function json(response, statusCode, body) {
	response.writeHead(statusCode, {
		'content-type': 'application/json',
		'cache-control': 'no-store'
	});
	response.end(JSON.stringify(body));
}

async function readJson(request) {
	const chunks = [];
	for await (const chunk of request) {
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function streamChunk(content, finishReason = null) {
	return {
		id: 'chatcmpl-tedbot-cypress',
		object: 'chat.completion.chunk',
		created: 1,
		model: MODEL_ID,
		choices: [
			{
				index: 0,
				delta: content === null ? {} : { content },
				finish_reason: finishReason
			}
		]
	};
}

function containsSlowMarker(value) {
	if (typeof value === 'string') {
		return value.includes(SLOW_STREAM_MARKER);
	}
	if (Array.isArray(value)) {
		return value.some(containsSlowMarker);
	}
	if (value && typeof value === 'object') {
		return Object.values(value).some(containsSlowMarker);
	}
	return false;
}

export function createFakeOpenAIServer() {
	const state = {
		requestCount: 0,
		streamStarted: false,
		aborted: false,
		completedCount: 0
	};

	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? '/', 'http://fixture.invalid');

		if (request.method === 'GET' && url.pathname === '/health') {
			json(response, 200, { status: 'ok' });
			return;
		}
		if (request.method === 'GET' && url.pathname === '/__fixture/status') {
			json(response, 200, {
				requestCount: state.requestCount,
				streamStarted: state.streamStarted,
				aborted: state.aborted,
				completedCount: state.completedCount
			});
			return;
		}
		if (request.method === 'GET' && url.pathname === '/v1/models') {
			json(response, 200, {
				object: 'list',
				data: [
					{
						id: MODEL_ID,
						object: 'model',
						created: 1,
						owned_by: 'ted-bot-cypress'
					}
				]
			});
			return;
		}
		if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
			json(response, 404, { error: { message: 'not found', type: 'not_found' } });
			return;
		}

		let body;
		try {
			body = await readJson(request);
		} catch {
			json(response, 400, { error: { message: 'invalid JSON', type: 'invalid_request_error' } });
			return;
		}

		state.requestCount += 1;
		if (!body.stream) {
			state.completedCount += 1;
			json(response, 200, {
				id: 'chatcmpl-tedbot-cypress',
				object: 'chat.completion',
				created: 1,
				model: MODEL_ID,
				choices: [
					{
						index: 0,
						message: { role: 'assistant', content: 'Ted-Bot Cypress completion.' },
						finish_reason: 'stop'
					}
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
			});
			return;
		}

		response.writeHead(200, {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive'
		});
		if (containsSlowMarker(body)) {
			state.streamStarted = true;
			let stillPending = true;
			response.on('close', () => {
				if (stillPending) {
					stillPending = false;
					state.aborted = true;
				}
			});
			response.write(`data: ${JSON.stringify(streamChunk('Ted-Bot Cypress first delta'))}\n\n`);
			return;
		}

		response.write(`data: ${JSON.stringify(streamChunk('Ted-Bot Cypress stream'))}\n\n`);
		response.write(`data: ${JSON.stringify(streamChunk(null, 'stop'))}\n\n`);
		response.end('data: [DONE]\n\n');
		state.completedCount += 1;
	});

	return {
		listen(port, host) {
			return new Promise((resolve, reject) => {
				server.once('error', reject);
				server.listen(port, host, () => {
					server.off('error', reject);
					resolve();
				});
			});
		},
		address() {
			return server.address();
		},
		close() {
			return new Promise((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				});
			});
		}
	};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const fixture = createFakeOpenAIServer();
	await fixture.listen(8081, '0.0.0.0');

	const close = async () => {
		await fixture.close();
		process.exit(0);
	};
	process.once('SIGINT', close);
	process.once('SIGTERM', close);
}
