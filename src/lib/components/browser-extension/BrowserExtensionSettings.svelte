<script lang="ts">
	import { onMount } from 'svelte';

	import {
		browserExtensionClient,
		type BrowserExtensionClient,
		type BrowserExtensionDevice,
		type BrowserExtensionSchedule,
		type BrowserExtensionSettings as ExtensionSettings,
		type BrowserExtensionWorkflow
	} from '$lib/apis/browser-extension';

	export let token: string;
	export let role: string = 'user';
	export let client: BrowserExtensionClient = browserExtensionClient;

	let devices: BrowserExtensionDevice[] = [];
	let workflows: BrowserExtensionWorkflow[] = [];
	let schedules: BrowserExtensionSchedule[] = [];
	let extensionSettings: ExtensionSettings | null = null;
	let drafts: Record<string, string> = {};
	let loading = true;
	let busy = '';
	let error = '';
	let notice = '';
	let confirmRevokeId: string | null = null;

	const messageFor = (reason: unknown) => {
		const message = reason instanceof Error ? reason.message : String(reason ?? '');
		if (message === 'browser_extension_build_unavailable') {
			return 'The extension package is being prepared. Try again in a moment.';
		}
		if (message === 'browser_extension_not_allowed') {
			return 'Browser control is not enabled for this account.';
		}
		return 'Tide-Bot could not complete that browser extension request.';
	};

	const load = async () => {
		loading = true;
		error = '';
		try {
			[devices, workflows, schedules, extensionSettings] = await Promise.all([
				client.listDevices(token),
				client.listWorkflows(token),
				client.listSchedules(token),
				client.getSettings(token)
			]);
			drafts = Object.fromEntries(devices.map((device) => [device.id, device.label]));
		} catch (reason) {
			error = messageFor(reason);
		} finally {
			loading = false;
		}
	};

	const download = async () => {
		busy = 'download';
		error = '';
		notice = '';
		try {
			await client.download(token);
			notice = 'Download started. Your package is ready to install.';
		} catch (reason) {
			error = messageFor(reason);
		} finally {
			busy = '';
		}
	};

	const renameDevice = async (device: BrowserExtensionDevice) => {
		const label = drafts[device.id]?.trim();
		if (!label || label === device.label) return;
		busy = `rename:${device.id}`;
		error = '';
		try {
			const renamed = await client.renameDevice(token, device.id, label);
			devices = devices.map((item) => (item.id === device.id ? renamed : item));
			drafts = { ...drafts, [device.id]: renamed.label };
			notice = 'Device name updated.';
		} catch (reason) {
			error = messageFor(reason);
		} finally {
			busy = '';
		}
	};

	const revokeDevice = async (device: BrowserExtensionDevice) => {
		if (confirmRevokeId !== device.id) {
			confirmRevokeId = device.id;
			return;
		}
		busy = `revoke:${device.id}`;
		error = '';
		try {
			await client.revokeDevice(token, device.id);
			devices = devices.filter((item) => item.id !== device.id);
			confirmRevokeId = null;
			notice = 'Device access revoked.';
		} catch (reason) {
			error = messageFor(reason);
		} finally {
			busy = '';
		}
	};

	const toggleCustomOrigins = async () => {
		if (!extensionSettings || role !== 'admin' || !extensionSettings.can_manage) return;
		busy = 'settings';
		error = '';
		try {
			extensionSettings = await client.updateSettings(token, {
				custom_origins_unlocked: !extensionSettings.custom_origins_unlocked
			});
			notice = 'Browser extension security setting updated.';
		} catch (reason) {
			error = messageFor(reason);
		} finally {
			busy = '';
		}
	};

	onMount(load);
</script>

<div class="h-full overflow-y-auto pr-1 text-gray-900 dark:text-gray-100">
	<section
		class="relative overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-br from-slate-950 via-sky-950 to-cyan-800 p-5 text-white shadow-sm dark:border-white/10"
	>
		<div
			class="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-cyan-300/15 blur-3xl"
		></div>
		<div class="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="max-w-xl">
				<div
					class="mb-2 flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-cyan-200"
				>
					<span
						class="inline-block size-2 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.9)]"
					></span>
					Tide-Bot companion
				</div>
				<h1 class="text-xl font-semibold tracking-tight">Tide-Bot Browser Control</h1>
				<p class="mt-2 max-w-lg text-sm leading-6 text-sky-100/90">
					Chat by text or voice while Tide-Bot works in one Chrome tab. Your paired session stays
					private, and local models remain on your Tide-Bot server.
				</p>
			</div>
			<button
				type="button"
				class="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-sky-950 shadow-sm transition hover:bg-cyan-50 disabled:cursor-wait disabled:opacity-60"
				disabled={busy === 'download'}
				on:click={download}
				aria-label="Download Chrome extension"
			>
				{busy === 'download' ? 'Preparing download…' : 'Download for Chrome'}
			</button>
		</div>
	</section>

	{#if error}
		<div
			role="alert"
			class="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
		>
			{error}
		</div>
	{/if}
	{#if notice}
		<div
			role="status"
			class="mt-3 rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2 text-sm text-cyan-900 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-100"
		>
			{notice}
		</div>
	{/if}

	<div class="mt-4 grid gap-4 lg:grid-cols-2">
		<section class="rounded-2xl border border-gray-100 p-4 dark:border-white/[0.06]">
			<h2 class="text-sm font-semibold">Install in Chrome</h2>
			<ol class="mt-3 space-y-2.5 text-sm text-gray-600 dark:text-gray-300">
				<li class="flex gap-3">
					<span class="font-semibold text-cyan-700 dark:text-cyan-300">1</span><span
						>Download and unzip the private Tide-Bot package.</span
					>
				</li>
				<li class="flex gap-3">
					<span class="font-semibold text-cyan-700 dark:text-cyan-300">2</span><span
						>Open <code class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-white/10"
							>chrome://extensions</code
						> and enable Developer mode.</span
					>
				</li>
				<li class="flex gap-3">
					<span class="font-semibold text-cyan-700 dark:text-cyan-300">3</span><span
						>Choose <strong>Load unpacked</strong>, select the unzipped folder, then open Tide-Bot
						from Chrome’s side panel.</span
					>
				</li>
				<li class="flex gap-3">
					<span class="font-semibold text-cyan-700 dark:text-cyan-300">4</span><span
						>Pair it with this account. Text chat starts by default; voice starts hands-free when
						selected.</span
					>
				</li>
			</ol>
		</section>

		<section class="rounded-2xl border border-gray-100 p-4 dark:border-white/[0.06]">
			<div class="flex items-center justify-between gap-3">
				<h2 class="text-sm font-semibold">Paired devices</h2>
				<span
					class="rounded-full bg-cyan-50 px-2 py-1 text-[0.68rem] font-medium text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200"
					>One controlled tab</span
				>
			</div>
			{#if loading}
				<p class="mt-3 text-sm text-gray-500">Loading secure browser state…</p>
			{:else if devices.length === 0}
				<p class="mt-3 text-sm text-gray-500">No paired Chrome devices yet.</p>
			{:else}
				<div class="mt-3 space-y-3">
					{#each devices as device (device.id)}
						<div class="rounded-xl bg-gray-50 p-3 dark:bg-white/[0.035]">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="truncate text-sm font-medium">{device.label}</div>
									<div class="mt-0.5 truncate text-xs text-gray-500">
										v{device.extension_version} · {device.allowed_origin}
									</div>
								</div>
								<button
									type="button"
									class="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
									on:click={() => revokeDevice(device)}
									disabled={busy === `revoke:${device.id}`}
									aria-label={confirmRevokeId === device.id
										? `Confirm revoke ${device.label}`
										: `Revoke ${device.label}`}
								>
									{confirmRevokeId === device.id ? 'Confirm revoke' : 'Revoke'}
								</button>
							</div>
							<div class="mt-3 flex gap-2">
								<label class="sr-only" for={`browser-device-${device.id}`}
									>Rename {device.label}</label
								>
								<input
									id={`browser-device-${device.id}`}
									aria-label={`Rename ${device.label}`}
									class="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-cyan-500 dark:border-white/10 dark:bg-gray-900"
									value={drafts[device.id] ?? device.label}
									on:input={(event) => {
										drafts = { ...drafts, [device.id]: event.currentTarget.value };
									}}
								/>
								<button
									type="button"
									class="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-cyan-600 dark:hover:bg-cyan-500"
									on:click={() => renameDevice(device)}
									disabled={busy === `rename:${device.id}` ||
										!drafts[device.id]?.trim() ||
										drafts[device.id]?.trim() === device.label}
									aria-label="Save device name">Save</button
								>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>

	<div class="mt-4 grid gap-4 lg:grid-cols-2">
		<section class="rounded-2xl border border-gray-100 p-4 dark:border-white/[0.06]">
			<h2 class="text-sm font-semibold">Saved workflows</h2>
			{#if workflows.length === 0}
				<p class="mt-3 text-sm text-gray-500">
					Record a workflow from the Chrome side panel to see it here.
				</p>
			{:else}
				<ul class="mt-3 space-y-2">
					{#each workflows as workflow (workflow.id)}
						<li class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.035]">
							<div class="text-sm font-medium">{workflow.name}</div>
							<div class="text-xs text-gray-500">Encrypted · version {workflow.version}</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="rounded-2xl border border-gray-100 p-4 dark:border-white/[0.06]">
			<h2 class="text-sm font-semibold">Schedules</h2>
			{#if schedules.length === 0}
				<p class="mt-3 text-sm text-gray-500">
					Schedules run only on their assigned paired device.
				</p>
			{:else}
				<ul class="mt-3 space-y-2">
					{#each schedules as schedule (schedule.id)}
						<li class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.035]">
							<div class="flex items-center justify-between gap-2">
								<div class="text-sm font-medium">{schedule.name}</div>
								<span
									class="text-[0.68rem] font-medium {schedule.is_active
										? 'text-emerald-600 dark:text-emerald-300'
										: 'text-gray-500'}">{schedule.is_active ? 'Active' : 'Paused'}</span
								>
							</div>
							<div class="mt-0.5 truncate text-xs text-gray-500">
								{schedule.rrule} · {schedule.timezone}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	{#if role === 'admin' && extensionSettings?.can_manage}
		<section
			class="mt-4 rounded-2xl border border-amber-200/70 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-950/10"
		>
			<div class="flex items-center justify-between gap-4">
				<div>
					<h2 class="text-sm font-semibold">Local server access</h2>
					<p class="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300">
						Allow pairing with administrator-approved custom HTTPS or local development origins. The
						default remains {extensionSettings.default_origin}.
					</p>
				</div>
				<button
					type="button"
					role="switch"
					aria-label="Allow custom server origins"
					aria-checked={extensionSettings.custom_origins_unlocked}
					disabled={busy === 'settings'}
					on:click={toggleCustomOrigins}
					class="relative h-6 w-11 shrink-0 rounded-full transition {extensionSettings.custom_origins_unlocked
						? 'bg-cyan-600'
						: 'bg-gray-300 dark:bg-gray-700'}"
				>
					<span
						class="absolute top-1 size-4 rounded-full bg-white shadow-sm transition-all {extensionSettings.custom_origins_unlocked
							? 'left-6'
							: 'left-1'}"
					></span>
				</button>
			</div>
		</section>
	{/if}
</div>
