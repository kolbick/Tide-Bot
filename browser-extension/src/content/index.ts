import { DomActions } from './actions';
import { DomObserver } from './dom';
import { ContentWorkflowRecorder } from './recording';

const MESSAGE_SOURCE = 'tide-bot-browser-control';
const chromeApi = (globalThis as any).chrome;
const observer = new DomObserver({ document, window });
const actions = new DomActions({ document, window, observer });
const recorder = new ContentWorkflowRecorder({ document, window, runtime: chromeApi.runtime });

chromeApi.runtime.onMessage.addListener(
	(message: any, _sender: unknown, sendResponse: (value: unknown) => void) => {
		if (message?.source !== MESSAGE_SOURCE) {
			return;
		}
		if (message.type === 'observe') {
			sendResponse({ ok: true, snapshot: actions.observe() });
			return;
		}
		if (message.type === 'recording:start' && typeof message.recordingId === 'string') {
			try {
				sendResponse({ ok: true, status: recorder.start(message.recordingId) });
			} catch {
				sendResponse({ ok: false, error: { code: 'recording_start_failed' } });
			}
			return;
		}
		if (message.type === 'recording:stop') {
			sendResponse({ ok: true, draft: recorder.stop() });
			return;
		}
		if (message.type === 'action' && typeof message.name === 'string') {
			void actions
				.execute(message.name, message.args ?? {})
				.then(sendResponse)
				.catch((error) =>
					sendResponse({
						ok: false,
						error: {
							code:
								typeof error === 'object' && error !== null && 'code' in error
									? (error as { code: string }).code
									: 'dom_action_failed'
						}
					})
				);
			return true;
		}
	}
);

void chromeApi.runtime
	.sendMessage({ type: 'tide-bot:recording:content-ready' })
	.then((response: any) => {
		if (response?.active && typeof response.recordingId === 'string') {
			recorder.start(response.recordingId);
		}
	})
	.catch(() => undefined);
