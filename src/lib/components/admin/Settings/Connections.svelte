<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { createEventDispatcher, onDestroy, onMount, getContext } from 'svelte';

	const dispatch = createEventDispatcher();

	import { getOllamaConfig, updateOllamaConfig } from '$lib/apis/ollama';
	import {
		completeChatGPTSubscriptionLogin,
		disconnectChatGPTSubscription,
		getChatGPTSubscriptionStatus,
		getOpenAIConfig,
		getOpenAIModels,
		refreshChatGPTSubscriptionModels,
		startChatGPTSubscriptionLogin,
		updateOpenAIConfig,
		type ChatGPTSubscriptionStatus
	} from '$lib/apis/openai';
	import { getModels as _getModels, getBackendConfig } from '$lib/apis';
	import { getConnectionsConfig, setConnectionsConfig } from '$lib/apis/configs';

	import { config, models, settings, user } from '$lib/stores';

	import Switch from '$lib/components/common/Switch.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ArrowPath from '$lib/components/icons/ArrowPath.svelte';
	import Plus from '$lib/components/icons/Plus.svelte';

	import OpenAIConnection from './Connections/OpenAIConnection.svelte';
	import AddConnectionModal from '$lib/components/AddConnectionModal.svelte';
	import OllamaConnection from './Connections/OllamaConnection.svelte';
	import AdminSettingRow from './AdminSettingRow.svelte';
	import AdminSettingSection from './AdminSettingSection.svelte';

	const i18n: any = getContext('i18n');

	const getModels = async () => {
		const models = await _getModels(
			localStorage.token,
			$config?.features?.enable_direct_connections ? ($settings?.directConnections ?? null) : null,
			false,
			true
		);
		return models;
	};

	// External
	let OLLAMA_BASE_URLS: string[] = [''];
	let OLLAMA_API_CONFIGS: any = {};

	let OPENAI_API_KEYS: string[] = [''];
	let OPENAI_API_BASE_URLS: string[] = [''];
	let OPENAI_API_CONFIGS: any = {};

	let ENABLE_OPENAI_API: null | boolean = null;
	let ENABLE_OLLAMA_API: null | boolean = null;

	let connectionsConfig: any = null;

	let pipelineUrls: Record<string, boolean> = {};
	let showAddOpenAIConnectionModal = false;
	let showAddOllamaConnectionModal = false;
	let modelListRefreshing = false;

	let chatGPTSubscriptionStatus: ChatGPTSubscriptionStatus | null = null;
	let chatGPTDeviceLogin: any = null;
	let chatGPTLoginBusy = false;
	let chatGPTModelRefreshBusy = false;
	let chatGPTPollTimer: ReturnType<typeof setTimeout> | null = null;

	const applyOpenAIConfig = (openaiConfig: any) => {
		ENABLE_OPENAI_API = openaiConfig.ENABLE_OPENAI_API;
		OPENAI_API_BASE_URLS = openaiConfig.OPENAI_API_BASE_URLS ?? [];
		OPENAI_API_KEYS = openaiConfig.OPENAI_API_KEYS ?? [];
		OPENAI_API_CONFIGS = openaiConfig.OPENAI_API_CONFIGS ?? {};
	};

	const reloadOpenAIConfig = async () => {
		applyOpenAIConfig(await getOpenAIConfig(localStorage.token));
	};

	const pollChatGPTLogin = async () => {
		if (!chatGPTDeviceLogin?.login_handle) return;

		try {
			const result = await completeChatGPTSubscriptionLogin(
				localStorage.token,
				chatGPTDeviceLogin.login_handle
			);
			if (result.status === 'pending') {
				chatGPTPollTimer = setTimeout(
					pollChatGPTLogin,
					Math.max(chatGPTDeviceLogin.interval ?? 5, 2) * 1000
				);
				return;
			}

			chatGPTSubscriptionStatus = result;
			chatGPTDeviceLogin = null;
			chatGPTLoginBusy = false;
			await reloadOpenAIConfig();
			await models.set(await getModels());
			toast.success($i18n.t('ChatGPT subscription connected'));
		} catch (error) {
			chatGPTDeviceLogin = null;
			chatGPTLoginBusy = false;
			toast.error(`${error}`);
		}
	};

	const startChatGPTLoginHandler = async () => {
		chatGPTLoginBusy = true;
		if (chatGPTPollTimer) clearTimeout(chatGPTPollTimer);
		const loginWindow = window.open('about:blank', '_blank');
		try {
			chatGPTDeviceLogin = await startChatGPTSubscriptionLogin(localStorage.token);
			if (loginWindow) {
				loginWindow.opener = null;
				loginWindow.location.href = chatGPTDeviceLogin.verification_url;
			}
			await pollChatGPTLogin();
		} catch (error) {
			loginWindow?.close();
			chatGPTDeviceLogin = null;
			chatGPTLoginBusy = false;
			toast.error(`${error}`);
		}
	};

	const refreshChatGPTModelsHandler = async () => {
		chatGPTModelRefreshBusy = true;
		try {
			const result = await refreshChatGPTSubscriptionModels(localStorage.token);
			chatGPTSubscriptionStatus = { ...chatGPTSubscriptionStatus, ...result };
			await models.set(await getModels());
			toast.success(
				$i18n.t('{{count}} ChatGPT subscription models refreshed', {
					count: result.model_count ?? 0
				})
			);
		} catch (error) {
			toast.error(`${error}`);
		} finally {
			chatGPTModelRefreshBusy = false;
		}
	};

	const disconnectChatGPTHandler = async () => {
		chatGPTLoginBusy = true;
		if (chatGPTPollTimer) clearTimeout(chatGPTPollTimer);
		try {
			chatGPTSubscriptionStatus = await disconnectChatGPTSubscription(localStorage.token);
			chatGPTDeviceLogin = null;
			await reloadOpenAIConfig();
			await models.set(await getModels());
			toast.success($i18n.t('ChatGPT subscription disconnected'));
		} catch (error) {
			toast.error(`${error}`);
		} finally {
			chatGPTLoginBusy = false;
		}
	};

	onDestroy(() => {
		if (chatGPTPollTimer) clearTimeout(chatGPTPollTimer);
	});

	const updateOpenAIHandler = async () => {
		if (ENABLE_OPENAI_API !== null) {
			// Remove trailing slashes
			OPENAI_API_BASE_URLS = OPENAI_API_BASE_URLS.map((url) => url.replace(/\/$/, ''));

			// Check if API KEYS length is same than API URLS length
			if (OPENAI_API_KEYS.length !== OPENAI_API_BASE_URLS.length) {
				// if there are more keys than urls, remove the extra keys
				if (OPENAI_API_KEYS.length > OPENAI_API_BASE_URLS.length) {
					OPENAI_API_KEYS = OPENAI_API_KEYS.slice(0, OPENAI_API_BASE_URLS.length);
				}

				// if there are more urls than keys, add empty keys
				if (OPENAI_API_KEYS.length < OPENAI_API_BASE_URLS.length) {
					const diff = OPENAI_API_BASE_URLS.length - OPENAI_API_KEYS.length;
					for (let i = 0; i < diff; i++) {
						OPENAI_API_KEYS.push('');
					}
				}
			}

			const res = await updateOpenAIConfig(localStorage.token, {
				ENABLE_OPENAI_API: ENABLE_OPENAI_API,
				OPENAI_API_BASE_URLS: OPENAI_API_BASE_URLS,
				OPENAI_API_KEYS: OPENAI_API_KEYS,
				OPENAI_API_CONFIGS: OPENAI_API_CONFIGS
			}).catch((error) => {
				toast.error(`${error}`);
			});

			if (res) {
				toast.success($i18n.t('OpenAI API settings updated'));
				await models.set(await getModels());
			}
		}
	};

	const updateOllamaHandler = async () => {
		if (ENABLE_OLLAMA_API !== null) {
			// Remove trailing slashes
			OLLAMA_BASE_URLS = OLLAMA_BASE_URLS.map((url) => url.replace(/\/$/, ''));

			const res = await updateOllamaConfig(localStorage.token, {
				ENABLE_OLLAMA_API: ENABLE_OLLAMA_API,
				OLLAMA_BASE_URLS: OLLAMA_BASE_URLS,
				OLLAMA_API_CONFIGS: OLLAMA_API_CONFIGS
			}).catch((error) => {
				toast.error(`${error}`);
			});

			if (res) {
				toast.success($i18n.t('Ollama API settings updated'));
				await models.set(await getModels());
			}
		}
	};

	const updateConnectionsHandler = async () => {
		const res = await setConnectionsConfig(localStorage.token, connectionsConfig).catch((error) => {
			toast.error(`${error}`);
		});

		if (res) {
			toast.success($i18n.t('Connections settings updated'));
			await models.set(await getModels());
			await config.set(await getBackendConfig());
		}
	};

	const refreshModelListHandler = async () => {
		modelListRefreshing = true;

		try {
			await models.set(await getModels());
			toast.success($i18n.t('Model list refreshed'));
		} catch (error) {
			toast.error(`${error}`);
		} finally {
			modelListRefreshing = false;
		}
	};

	const addOpenAIConnectionHandler = async (connection: any) => {
		OPENAI_API_BASE_URLS = [...OPENAI_API_BASE_URLS, connection.url];
		OPENAI_API_KEYS = [...OPENAI_API_KEYS, connection.key];
		OPENAI_API_CONFIGS[OPENAI_API_BASE_URLS.length - 1] = connection.config;

		await updateOpenAIHandler();
	};

	const addOllamaConnectionHandler = async (connection: any) => {
		OLLAMA_BASE_URLS = [...OLLAMA_BASE_URLS, connection.url];
		OLLAMA_API_CONFIGS[OLLAMA_BASE_URLS.length - 1] = {
			...connection.config,
			key: connection.key
		};

		await updateOllamaHandler();
	};

	onMount(async () => {
		if ($user?.role === 'admin') {
			let ollamaConfig: any = {};
			let openaiConfig: any = {};
			let subscriptionStatus: ChatGPTSubscriptionStatus = {
				connected: false,
				state: 'disconnected'
			};

			await Promise.all([
				(async () => {
					ollamaConfig = await getOllamaConfig(localStorage.token);
				})(),
				(async () => {
					openaiConfig = await getOpenAIConfig(localStorage.token);
				})(),
				(async () => {
					connectionsConfig = await getConnectionsConfig(localStorage.token);
				})(),
				(async () => {
					subscriptionStatus = await getChatGPTSubscriptionStatus(localStorage.token);
				})()
			]);

			applyOpenAIConfig(openaiConfig);
			chatGPTSubscriptionStatus = subscriptionStatus;
			ENABLE_OLLAMA_API = ollamaConfig.ENABLE_OLLAMA_API;

			OLLAMA_BASE_URLS = ollamaConfig.OLLAMA_BASE_URLS;
			OLLAMA_API_CONFIGS = ollamaConfig.OLLAMA_API_CONFIGS;

			if (ENABLE_OPENAI_API) {
				// get url and idx
				for (const [idx, url] of OPENAI_API_BASE_URLS.entries()) {
					if (!OPENAI_API_CONFIGS[idx]) {
						// Legacy support, url as key
						OPENAI_API_CONFIGS[idx] = OPENAI_API_CONFIGS[url] || {};
					}
				}

				OPENAI_API_BASE_URLS.forEach(async (url, idx) => {
					OPENAI_API_CONFIGS[idx] = OPENAI_API_CONFIGS[idx] || {};
					if (
						!(OPENAI_API_CONFIGS[idx]?.enable ?? true) ||
						(OPENAI_API_CONFIGS[idx]?.auth_type === 'chatgpt_subscription' &&
							!chatGPTSubscriptionStatus?.connected)
					) {
						return;
					}
					const res = await getOpenAIModels(localStorage.token, idx).catch(() => null);
					if (res?.pipelines) {
						pipelineUrls[url] = true;
					}
				});
			}

			if (ENABLE_OLLAMA_API) {
				for (const [idx, url] of OLLAMA_BASE_URLS.entries()) {
					if (!OLLAMA_API_CONFIGS[idx]) {
						OLLAMA_API_CONFIGS[idx] = OLLAMA_API_CONFIGS[url] || {};
					}
				}
			}
		}
	});

	const submitHandler = async () => {
		updateOpenAIHandler();
		updateOllamaHandler();

		dispatch('save');

		await config.set(await getBackendConfig());
	};
</script>

<AddConnectionModal
	bind:show={showAddOpenAIConnectionModal}
	onSubmit={addOpenAIConnectionHandler}
/>

<AddConnectionModal
	ollama
	bind:show={showAddOllamaConnectionModal}
	onSubmit={addOllamaConnectionHandler}
/>

<form class="flex h-full flex-col justify-between text-sm" on:submit|preventDefault={submitHandler}>
	<h2 class="text-sm font-medium text-gray-900 dark:text-white mb-4">{$i18n.t('Connections')}</h2>

	<div class="flex-1 min-h-0 overflow-y-auto scrollbar-hover pr-1.5">
		{#if ENABLE_OPENAI_API !== null && ENABLE_OLLAMA_API !== null && connectionsConfig !== null}
			<AdminSettingSection first>
				<AdminSettingRow label={$i18n.t('OpenAI API')} let:labelId>
					<Switch
						bind:state={ENABLE_OPENAI_API}
						on:change={async () => {
							updateOpenAIHandler();
						}}
						ariaLabelledbyId={labelId}
					/>
				</AdminSettingRow>

				<div class="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div
								class="flex items-center gap-2 text-xs font-medium text-gray-900 dark:text-white"
							>
								<span>{$i18n.t('ChatGPT Subscription')}</span>
								<span
									class={`rounded-full px-2 py-0.5 text-[0.625rem] ${
										chatGPTSubscriptionStatus?.connected
											? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
											: chatGPTSubscriptionStatus?.state === 'reconnect_required'
												? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
												: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
									}`}
								>
									{chatGPTSubscriptionStatus?.connected
										? $i18n.t('Connected')
										: chatGPTSubscriptionStatus?.state === 'reconnect_required'
											? $i18n.t('Reconnect required')
											: $i18n.t('Not connected')}
								</span>
							</div>
							<div class="mt-1 text-[0.6875rem] text-gray-500 dark:text-gray-400">
								{#if chatGPTSubscriptionStatus?.connected}
									{chatGPTSubscriptionStatus.email ?? $i18n.t('ChatGPT account')}
									{#if chatGPTSubscriptionStatus.plan_type}
										· {chatGPTSubscriptionStatus.plan_type}
									{/if}
								{:else}
									{$i18n.t(
										'Use the OpenAI models included with a ChatGPT plan instead of a separately billed API key.'
									)}
								{/if}
							</div>
						</div>

						<div class="flex shrink-0 items-center gap-1.5">
							{#if chatGPTSubscriptionStatus?.connected}
								<button
									class="rounded-full border border-gray-200 px-2.5 py-1 text-[0.6875rem] hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
									type="button"
									disabled={chatGPTModelRefreshBusy}
									on:click={refreshChatGPTModelsHandler}
								>
									{chatGPTModelRefreshBusy ? $i18n.t('Refreshing…') : $i18n.t('Refresh models')}
								</button>
								<button
									class="rounded-full border border-red-200 px-2.5 py-1 text-[0.6875rem] text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/30"
									type="button"
									disabled={chatGPTLoginBusy}
									on:click={disconnectChatGPTHandler}
								>
									{$i18n.t('Disconnect')}
								</button>
							{:else}
								<button
									class="rounded-full bg-black px-3 py-1 text-[0.6875rem] text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-gray-200"
									type="button"
									disabled={chatGPTLoginBusy}
									on:click={startChatGPTLoginHandler}
								>
									{chatGPTLoginBusy ? $i18n.t('Waiting…') : $i18n.t('Connect')}
								</button>
							{/if}
						</div>
					</div>

					{#if chatGPTDeviceLogin}
						<div class="mt-3 rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900">
							<div class="text-gray-600 dark:text-gray-300">
								{$i18n.t('A ChatGPT sign-in page was opened. Enter this one-time code:')}
							</div>
							<div class="mt-2 flex items-center gap-2">
								<code
									class="rounded bg-white px-2.5 py-1.5 text-sm font-semibold tracking-wider dark:bg-gray-800"
									>{chatGPTDeviceLogin.user_code}</code
								>
								<button
									class="rounded-full border border-gray-200 px-2.5 py-1 text-[0.6875rem] hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
									type="button"
									on:click={() => navigator.clipboard.writeText(chatGPTDeviceLogin.user_code)}
								>
									{$i18n.t('Copy')}
								</button>
								<a
									class="text-[0.6875rem] underline"
									href={chatGPTDeviceLogin.verification_url}
									target="_blank"
									rel="noreferrer">{$i18n.t('Open sign-in')}</a
								>
							</div>
						</div>
					{/if}

					{#if chatGPTSubscriptionStatus?.error}
						<div class="mt-2 text-[0.6875rem] text-amber-700 dark:text-amber-300">
							{chatGPTSubscriptionStatus.error}
						</div>
					{/if}
				</div>

				{#if ENABLE_OPENAI_API}
					<div>
						<div class="mb-2 flex items-center justify-between gap-4">
							<div class="text-xs text-gray-600 dark:text-gray-400">
								{$i18n.t('Manage OpenAI API Connections')}
							</div>

							<Tooltip content={$i18n.t(`Add Connection`)}>
								<button
									class="flex size-6 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-700 dark:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-300"
									on:click={() => {
										showAddOpenAIConnectionModal = true;
									}}
									type="button"
								>
									<Plus />
								</button>
							</Tooltip>
						</div>

						<div class="flex flex-col gap-1.5">
							{#each OPENAI_API_BASE_URLS as url, idx}
								{#if OPENAI_API_CONFIGS[idx]?.auth_type !== 'chatgpt_subscription'}
									<OpenAIConnection
										bind:url={OPENAI_API_BASE_URLS[idx]}
										bind:key={OPENAI_API_KEYS[idx]}
										bind:config={OPENAI_API_CONFIGS[idx]}
										pipeline={pipelineUrls[url] ? true : false}
										onSubmit={() => {
											updateOpenAIHandler();
										}}
										onDelete={() => {
											OPENAI_API_BASE_URLS = OPENAI_API_BASE_URLS.filter(
												(url, urlIdx) => idx !== urlIdx
											);
											OPENAI_API_KEYS = OPENAI_API_KEYS.filter((key, keyIdx) => idx !== keyIdx);

											let newConfig: any = {};
											OPENAI_API_BASE_URLS.forEach((url, newIdx) => {
												newConfig[newIdx] = OPENAI_API_CONFIGS[newIdx < idx ? newIdx : newIdx + 1];
											});
											OPENAI_API_CONFIGS = newConfig;
											updateOpenAIHandler();
										}}
									/>
								{/if}
							{/each}
						</div>
					</div>
				{/if}

				<AdminSettingRow label={$i18n.t('Ollama API')} let:labelId>
					<Switch
						bind:state={ENABLE_OLLAMA_API}
						on:change={async () => {
							updateOllamaHandler();
						}}
						ariaLabelledbyId={labelId}
					/>
				</AdminSettingRow>

				{#if ENABLE_OLLAMA_API}
					<div>
						<div class="mb-2 flex items-center justify-between gap-4">
							<div class="text-xs text-gray-600 dark:text-gray-400">
								{$i18n.t('Manage Ollama API Connections')}
							</div>

							<Tooltip content={$i18n.t(`Add Connection`)}>
								<button
									class="flex size-6 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-700 dark:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-300"
									on:click={() => {
										showAddOllamaConnectionModal = true;
									}}
									type="button"
								>
									<Plus />
								</button>
							</Tooltip>
						</div>

						<div class="flex flex-col gap-1.5">
							{#each OLLAMA_BASE_URLS as url, idx}
								<OllamaConnection
									bind:url={OLLAMA_BASE_URLS[idx]}
									bind:config={OLLAMA_API_CONFIGS[idx]}
									{idx}
									onSubmit={() => {
										updateOllamaHandler();
									}}
									onDelete={() => {
										OLLAMA_BASE_URLS = OLLAMA_BASE_URLS.filter((url, urlIdx) => idx !== urlIdx);

										let newConfig: any = {};
										OLLAMA_BASE_URLS.forEach((url, newIdx) => {
											newConfig[newIdx] = OLLAMA_API_CONFIGS[newIdx < idx ? newIdx : newIdx + 1];
										});
										OLLAMA_API_CONFIGS = newConfig;
										updateOllamaHandler();
									}}
								/>
							{/each}
						</div>

						<div class="mt-1 text-[0.6875rem] text-gray-400 dark:text-gray-600">
							{$i18n.t('Trouble accessing Ollama?')}
							<a
								class="font-normal underline hover:text-gray-700 dark:hover:text-gray-300"
								href="https://github.com/open-webui/open-webui#troubleshooting"
								target="_blank"
							>
								{$i18n.t('Click here for help.')}
							</a>
						</div>
					</div>
				{/if}
			</AdminSettingSection>

			<AdminSettingSection title={$i18n.t('User Connections')}>
				<AdminSettingRow
					label={$i18n.t('Direct Connections')}
					description={$i18n.t(
						'Direct Connections allow users to connect to their own OpenAI compatible API endpoints.'
					)}
					let:labelId
				>
					<Switch
						bind:state={connectionsConfig.ENABLE_DIRECT_CONNECTIONS}
						on:change={async () => {
							updateConnectionsHandler();
						}}
						ariaLabelledbyId={labelId}
					/>
				</AdminSettingRow>

				<AdminSettingRow
					label={$i18n.t('Cache Base Model List')}
					description={$i18n.t(
						'Base Model List Cache speeds up access by fetching base models only at startup or on settings save—faster, but may not show recent base model changes.'
					)}
					let:labelId
				>
					<div class="flex items-center gap-1.5">
						{#if connectionsConfig.ENABLE_BASE_MODELS_CACHE}
							<Tooltip content={$i18n.t('Refresh')}>
								<button
									class="flex size-6 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-300"
									type="button"
									disabled={modelListRefreshing}
									on:click={refreshModelListHandler}
									aria-label={$i18n.t('Refresh')}
								>
									{#if modelListRefreshing}
										<Spinner className="size-3.5" />
									{:else}
										<ArrowPath className="size-4" />
									{/if}
								</button>
							</Tooltip>
						{/if}

						<Switch
							bind:state={connectionsConfig.ENABLE_BASE_MODELS_CACHE}
							on:change={async () => {
								updateConnectionsHandler();
							}}
							ariaLabelledbyId={labelId}
						/>
					</div>
				</AdminSettingRow>
			</AdminSettingSection>
		{:else}
			<div class="flex h-full justify-center">
				<div class="my-auto">
					<Spinner className="size-6" />
				</div>
			</div>
		{/if}
	</div>

	<div class="flex justify-end pt-6 text-sm font-normal">
		<button
			class="px-3.5 py-1.5 text-sm font-normal bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
			type="submit"
		>
			{$i18n.t('Save')}
		</button>
	</div>
</form>
