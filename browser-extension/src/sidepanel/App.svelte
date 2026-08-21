<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';

	import ActivityTimeline from './components/ActivityTimeline.svelte';
	import ApprovalCard from './components/ApprovalCard.svelte';
	import Chat from './components/Chat.svelte';
	import Composer from './components/Composer.svelte';
	import ModelPicker from './components/ModelPicker.svelte';
	import Pairing from './components/Pairing.svelte';
	import SessionBar from './components/SessionBar.svelte';
	import VoiceControls from './components/VoiceControls.svelte';
	import WorkflowManager from './components/WorkflowManager.svelte';
	import {
		createSidePanelApi,
		type ApprovalNotice,
		type PanelChatSummary,
		type PanelModel,
		type PanelStatus,
		type SidePanelApi
	} from './api';
	import {
		chatDocument,
		messagesFromChat,
		newId,
		type ActivityItem,
		type PanelMessage
	} from './state';
	import { VoiceController, type VoiceStatus } from './voice';
	import {
		DEFAULT_SERVER_ORIGIN,
		PRODUCT_NAME,
		type ActionMode,
		type TabPolicy
	} from '../shared/constants';

	export let api: SidePanelApi = createSidePanelApi();

	let status: PanelStatus = {
		paired: false,
		connected: false,
		serverOrigin: DEFAULT_SERVER_ORIGIN,
		deviceId: null,
		session: null
	};
	let loading = true;
	let pairing = false;
	let pairingCode = '';
	let error = '';
	let models: PanelModel[] = [];
	let chats: PanelChatSummary[] = [];
	let selectedModel = '';
	let selectedChat = '';
	let messages: PanelMessage[] = [];
	let activities: ActivityItem[] = [];
	let approvals: ApprovalNotice[] = [];
	let draft = '';
	let generating = false;
	let voiceActive = false;
	let voiceStatus: VoiceStatus = {
		inputMode: 'text',
		voiceMode: 'hands-free',
		listening: false,
		recording: false,
		processing: false,
		error: null
	};
	let voiceController: VoiceController | null = null;
	let actionMode: ActionMode = 'autonomous';
	let tabPolicy: TabPolicy = 'locked';
	let textarea: HTMLTextAreaElement | null = null;
	let controlsOpen = false;
	let unsubscribe: () => void = () => undefined;

	const loadAccount = async () => {
		status = await api.status();
		if (status.paired) {
			[models, chats] = await Promise.all([api.models(), api.chats()]);
			if (!selectedModel && models.length) selectedModel = models[0].id;
			if (status.session) {
				actionMode = status.session.actionMode ?? actionMode;
				tabPolicy = status.session.tabPolicy ?? tabPolicy;
			}
		}
		loading = false;
		if (status.paired) {
			await tick();
			textarea?.focus();
		}
	};

	onMount(() => {
		unsubscribe = api.subscribe((event) => {
			if (event.type === 'approval') approvals = [...approvals, event.approval];
			if (event.type === 'status') status = event.status;
			if (event.type === 'schedule') {
				const scheduleStatus: ActivityItem['status'] =
					event.event.status === 'complete'
						? 'complete'
						: event.event.status === 'running'
							? 'running'
							: 'failed';
				activities = [
					...activities,
					{
						id: newId(),
						label: `Schedule: ${event.event.name}`,
						status: scheduleStatus
					}
				].slice(-20);
			}
			if (event.type === 'pairing-complete') {
				pairing = false;
				void loadAccount();
			}
			if (event.type === 'pairing-error') {
				pairing = false;
				error = event.code.replaceAll('_', ' ');
			}
		});
		void loadAccount().catch((cause) => {
			loading = false;
			error = cause?.code ?? 'Could not reach Tide-Bot';
		});
	});

	onDestroy(() => {
		unsubscribe();
		voiceController?.stop();
	});

	$: voiceActive = voiceStatus.inputMode === 'voice';
	// Drives the signal line, which is the only progress indicator in the panel.
	$: busy = generating || activities.some((item) => item.status === 'running');

	const pair = async () => {
		pairing = true;
		error = '';
		try {
			const value = await api.beginPairing('My Chrome');
			// A session claim pairs outright, so there is no code to read off.
			pairingCode = value.claimed ? '' : (value.deviceCode ?? '');
		} catch (cause: any) {
			pairing = false;
			error = cause?.code ?? 'Pairing failed';
		}
	};

	const reconnect = async () => {
		await api.reconnect().catch(() => undefined);
		await loadAccount().catch(() => undefined);
	};

	const openSession = async () => {
		if (!status.connected) return;
		try {
			const session = await api.openSession({ sessionId: newId(), actionMode, tabPolicy });
			status = { ...status, session };
		} catch (cause: any) {
			error = cause?.code ?? 'Could not control this tab';
		}
	};

	const closeSession = async () => {
		await api.closeSession();
		status = { ...status, session: null };
		activities = [];
	};

	const selectChat = async (id: string) => {
		selectedChat = id;
		if (!id) {
			messages = [];
			return;
		}
		const value = await api.chat(id);
		messages = messagesFromChat(value);
		const chatModels = value?.chat?.models;
		if (Array.isArray(chatModels) && models.some((model) => model.id === chatModels[0])) {
			selectedModel = chatModels[0];
		}
		await tick();
		textarea?.focus();
	};

	const send = async (contentOverride?: string) => {
		const content = (contentOverride ?? draft).trim();
		if (!content || generating || !selectedModel || !status.paired) return;
		generating = true;
		error = '';
		draft = '';
		try {
			if (!selectedChat) {
				const chatId = newId();
				const created = await api.createChat(chatDocument(chatId, selectedModel, []));
				selectedChat = String(created?.id ?? chatId);
				chats = [{ id: selectedChat, title: 'New Chat' }, ...chats];
			}

			const parent = messages.at(-1)?.id ?? null;
			const userId = newId();
			const assistantId = newId();
			const timestamp = Math.floor(Date.now() / 1_000);
			const userMessage: PanelMessage = {
				id: userId,
				parentId: parent,
				childrenIds: [assistantId],
				role: 'user',
				content,
				timestamp
			};
			const assistant: PanelMessage = {
				id: assistantId,
				parentId: userId,
				childrenIds: [],
				role: 'assistant',
				content: '',
				model: selectedModel,
				done: false,
				timestamp
			};
			messages = [...messages, userMessage, assistant];

			await api.streamCompletion(
				{
					model: selectedModel,
					stream: true,
					messages: messages
						.filter((message) => message.id !== assistantId)
						.map(({ role, content }) => ({ role, content })),
					chat_id: selectedChat,
					parent_id: parent,
					id: assistantId,
					user_message: userMessage,
					features: { browser_control: Boolean(status.session) },
					...(status.session ? { browser_session: status.session.sessionId } : {}),
					params: { function_calling: 'native' }
				},
				{
					onDelta: (value) => {
						messages = messages.map((message) =>
							message.id === assistantId
								? { ...message, content: message.content + value }
								: message
						);
					},
					onActivity: (value) => {
						activities = [
							...activities,
							{ id: newId(), label: value.label, status: value.status }
						].slice(-20);
					}
				}
			);
			messages = messages.map((message) =>
				message.id === assistantId ? { ...message, done: true } : message
			);
			await api.updateChat(selectedChat, chatDocument(selectedChat, selectedModel, messages));
			const spokenResponse = messages.find((message) => message.id === assistantId)?.content ?? '';
			if (voiceStatus.inputMode === 'voice' && spokenResponse) {
				await voiceController?.speak(spokenResponse).catch(() => {
					error = 'Voice playback is unavailable';
				});
			}
		} catch (cause: any) {
			error = cause?.code ?? 'Tide-Bot could not finish that response';
			messages = messages.map((message) =>
				message.role === 'assistant' && message.done === false
					? { ...message, done: true }
					: message
			);
		} finally {
			generating = false;
			await tick();
			textarea?.focus();
		}
	};

	const controller = () => {
		if (!voiceController) {
			voiceController = new VoiceController({
				api,
				onTranscript: (text) => (draft = text),
				onSubmit: (text) => send(text),
				onStatus: (next) => (voiceStatus = next)
			});
		}
		return voiceController;
	};

	const startVoice = async () => {
		await controller()
			.selectVoice('hands-free')
			.catch(() => undefined);
	};

	const stopVoice = () => voiceController?.stop();

	const toggleVoice = () => {
		if (voiceActive) stopVoice();
		else void startVoice();
	};

	const resolveApproval = async (approval: ApprovalNotice, approved: boolean) => {
		await api.resolveApproval(approval.commandId, approved);
		approvals = approvals.filter((item) => item.commandId !== approval.commandId);
	};
</script>

<svelte:head><meta name="theme-color" content="#fffbf3" /></svelte:head>

<main class="shell">
	<header class="brand">
		<!-- Wordmark only. The packaged icon carries its own dark plate, which
		     reads as a sticker on this ground, and the panel is already
		     unmistakably Tide-Bot from the browser chrome. -->
		<h1>Tide-Bot</h1>
		{#if status.paired}
			<span class="connection">
				<span class:live={status.connected} class="status-dot"></span>
				{status.connected ? 'Connected' : 'Offline'}
				{#if !status.connected}
					<!-- Kept beside the status it fixes, not buried in the disclosure. -->
					<button class="text-button" type="button" on:click={reconnect}>Reconnect</button>
				{/if}
			</span>
		{/if}
	</header>

	<div class="signal-line" class:is-active={busy} aria-hidden="true"></div>

	{#if loading}
		<section class="loading" aria-live="polite">Connecting to Tide-Bot…</section>
	{:else if !status.paired}
		<div class="scroll">
			<Pairing busy={pairing} code={pairingCode} {error} onPair={pair} />
		</div>
	{:else}
		<div class="scroll">
			{#if error}<p class="error banner-error" role="alert">{error}</p>{/if}
			<Chat {messages} {generating} />
			{#each approvals as approval (approval.commandId)}
				<ApprovalCard {approval} onResolve={(approved) => resolveApproval(approval, approved)} />
			{/each}
			{#if voiceActive || voiceStatus.error}
				<VoiceControls
					status={voiceStatus}
					onMode={(mode) => void controller().setVoiceMode(mode)}
					onStop={stopVoice}
					onRetry={startVoice}
					onPushStart={() => controller().beginPushToTalk()}
					onPushEnd={() => controller().endPushToTalk()}
				/>
			{/if}
		</div>

		<!-- Not <details>: its content is inert when closed, so the expansion
		     cannot be animated. A button plus a grid-row reveal can be. -->
		<section class="controls" class:open={controlsOpen}>
			<button
				class="controls-toggle"
				type="button"
				aria-expanded={controlsOpen}
				aria-controls="controls-body"
				on:click={() => (controlsOpen = !controlsOpen)}
			>
				Session and workflows
			</button>
			<div class="controls-reveal">
				<div>
					<div class="controls-body" id="controls-body">
				<SessionBar
					connected={status.connected}
					session={status.session}
					bind:actionMode
					bind:tabPolicy
					onStart={openSession}
					onStop={closeSession}
				/>
				<ModelPicker
					{models}
					{chats}
					bind:selectedModel
					bind:selectedChat
					disabled={generating}
					onChatChange={selectChat}
				/>
				<ActivityTimeline items={activities} />
				<WorkflowManager
					{api}
					connected={status.connected}
					sessionActive={Boolean(status.session)}
					deviceId={status.deviceId}
					/>
					</div>
				</div>
			</div>
		</section>

		<Composer
			bind:value={draft}
			bind:textarea
			disabled={!status.connected}
			{generating}
			{voiceActive}
			onSubmit={send}
			onVoice={toggleVoice}
		/>
	{/if}
</main>
