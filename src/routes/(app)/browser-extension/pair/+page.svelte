<script lang="ts">
	import { page } from '$app/stores';

	import {
		browserExtensionClient,
		type BrowserExtensionClient
	} from '$lib/apis/browser-extension';

	export let client: BrowserExtensionClient = browserExtensionClient;

	$: grantId = $page.url.searchParams.get('grant_id') ?? '';

	let code = '';
	let busy = '';
	let error = '';
	let result: 'approved' | 'denied' | null = null;

	const messageFor = (reason: unknown) => {
		const message = reason instanceof Error ? reason.message : String(reason ?? '');
		if (message === 'pairing_grant_not_found') {
			return "That code doesn't match a pending pairing request. Check the code shown in the extension and try again.";
		}
		if (message === 'expired_token') {
			return 'This pairing request expired. Start pairing again from the extension.';
		}
		if (message === 'pairing_state_changed') {
			return 'This pairing request was already used or changed. Start pairing again from the extension.';
		}
		if (message === 'browser_extension_not_allowed') {
			return 'Browser control is not enabled for this account.';
		}
		if (message.startsWith('browser_extension_request_failed_')) {
			return 'Tide-Bot could not complete that browser extension request.';
		}
		return message || 'Tide-Bot could not complete that browser extension request.';
	};

	const submit = async (approved: boolean) => {
		error = '';
		const deviceCode = code.trim().toUpperCase();
		if (!grantId) {
			error = 'This pairing link is missing its request ID. Return to the extension and try again.';
			return;
		}
		if (deviceCode.length !== 9) {
			error = 'Enter the 8-character code shown in the extension (format XXXX-XXXX).';
			return;
		}
		busy = approved ? 'approve' : 'deny';
		try {
			const response = await client.approvePairing(
				localStorage.token,
				grantId,
				deviceCode,
				approved
			);
			result = response.status;
		} catch (reason) {
			error = messageFor(reason);
		} finally {
			busy = '';
		}
	};
</script>

<div
	class="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center px-4 py-10 text-gray-900 dark:text-gray-100"
>
	<div
		class="w-full rounded-2xl border border-sky-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-gray-900"
	>
		{#if result === 'approved'}
			<h1 class="text-lg font-semibold">Browser paired</h1>
			<p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
				Tide-Bot is now paired with this browser. You can close this tab and return to the
				extension.
			</p>
		{:else if result === 'denied'}
			<h1 class="text-lg font-semibold">Pairing request denied</h1>
			<p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
				This browser was not paired. You can close this tab.
			</p>
		{:else}
			<h1 class="text-lg font-semibold">Pair a browser with Tide-Bot</h1>
			<p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
				Enter the code shown in the Tide-Bot browser extension to approve this device.
			</p>

			{#if !grantId}
				<div
					role="alert"
					class="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
				>
					This pairing link is missing its request ID. Return to the extension and try again.
				</div>
			{:else}
				<label
					class="mt-4 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
					for="pairing-code"
				>
					Pairing code
				</label>
				<input
					id="pairing-code"
					class="mt-1.5 w-full rounded-xl border border-gray-200 bg-transparent px-3 py-2 text-center text-lg font-mono tracking-[0.2em] outline-none focus:border-cyan-400 dark:border-white/10"
					placeholder="XXXX-XXXX"
					maxlength="9"
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					bind:value={code}
					disabled={!!busy}
				/>

				{#if error}
					<div
						role="alert"
						class="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
					>
						{error}
					</div>
				{/if}

				<div class="mt-4 flex gap-2">
					<button
						type="button"
						class="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-sky-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-900 disabled:cursor-wait disabled:opacity-60 dark:bg-cyan-600 dark:hover:bg-cyan-500"
						disabled={!!busy}
						on:click={() => submit(true)}
					>
						{busy === 'approve' ? 'Approving…' : 'Approve'}
					</button>
					<button
						type="button"
						class="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
						disabled={!!busy}
						on:click={() => submit(false)}
					>
						{busy === 'deny' ? 'Denying…' : 'Deny'}
					</button>
				</div>
			{/if}
		{/if}
	</div>
</div>
