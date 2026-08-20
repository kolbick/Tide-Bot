<script lang="ts">
	import type { PanelSchedule, PanelWorkflow, PanelWorkflowDraft, SidePanelApi } from '../api';

	export let api: SidePanelApi;
	export let connected = false;
	export let sessionActive = false;
	export let deviceId: string | null = null;

	let expanded = false;
	let loading = false;
	let busy = false;
	let error = '';
	let workflows: PanelWorkflow[] = [];
	let schedules: PanelSchedule[] = [];
	let recording = false;
	let draft: PanelWorkflowDraft | null = null;
	let workflowName = '';
	let scheduleWorkflow = '';
	let scheduleName = '';
	let frequency = 'DAILY';
	let nextRun = '';

	const localDateTime = (date: Date) => {
		const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
		return shifted.toISOString().slice(0, 16);
	};

	const load = async () => {
		if (!connected) return;
		loading = true;
		error = '';
		try {
			[workflows, schedules] = await Promise.all([api.workflows(), api.schedules()]);
			if (!scheduleWorkflow && workflows.length) scheduleWorkflow = workflows[0].id;
			if (!nextRun) nextRun = localDateTime(new Date(Date.now() + 60 * 60_000));
		} catch (cause: any) {
			error = cause?.code ?? 'Could not load workflows';
		} finally {
			loading = false;
		}
	};

	const toggle = () => {
		expanded = !expanded;
		if (expanded) void load();
	};

	const start = async () => {
		busy = true;
		error = '';
		try {
			await api.startRecording();
			recording = true;
			draft = null;
		} catch (cause: any) {
			error = cause?.code ?? 'Could not start recording';
		} finally {
			busy = false;
		}
	};

	const stop = async () => {
		busy = true;
		error = '';
		try {
			draft = await api.stopRecording();
			recording = false;
		} catch (cause: any) {
			error = cause?.code ?? 'Could not stop recording';
		} finally {
			busy = false;
		}
	};

	const save = async () => {
		if (!draft || !workflowName.trim()) return;
		busy = true;
		error = '';
		try {
			await api.createWorkflow({
				name: workflowName.trim(),
				definition: { schemaVersion: 1, origin: draft.origin, steps: draft.steps }
			});
			draft = null;
			workflowName = '';
			await load();
		} catch (cause: any) {
			error = cause?.code ?? 'Could not save workflow';
		} finally {
			busy = false;
		}
	};

	const removeWorkflow = async (id: string) => {
		busy = true;
		try {
			await api.deleteWorkflow(id);
			await load();
		} catch (cause: any) {
			error = cause?.code ?? 'Could not delete workflow';
		} finally {
			busy = false;
		}
	};

	const createSchedule = async () => {
		if (!deviceId || !scheduleWorkflow || !scheduleName.trim() || !nextRun) return;
		const milliseconds = new Date(nextRun).getTime();
		if (!Number.isFinite(milliseconds) || milliseconds <= Date.now()) {
			error = 'Choose a future first run';
			return;
		}
		busy = true;
		error = '';
		try {
			await api.createSchedule({
				workflow_id: scheduleWorkflow,
				device_id: deviceId,
				name: scheduleName.trim(),
				rrule: `FREQ=${frequency};INTERVAL=1`,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
				is_active: true,
				next_run_at: (BigInt(milliseconds) * 1_000_000n).toString()
			});
			scheduleName = '';
			nextRun = localDateTime(new Date(Date.now() + 60 * 60_000));
			await load();
		} catch (cause: any) {
			error = cause?.code ?? 'Could not create schedule';
		} finally {
			busy = false;
		}
	};

	const removeSchedule = async (id: string) => {
		busy = true;
		try {
			await api.deleteSchedule(id);
			await load();
		} catch (cause: any) {
			error = cause?.code ?? 'Could not delete schedule';
		} finally {
			busy = false;
		}
	};

	const stepLabel = (step: PanelWorkflowDraft['steps'][number]) => {
		if (step.action === 'navigate') return `Navigate to ${new URL(step.url).hostname}`;
		if (step.action === 'wait') return 'Wait for page load';
		if (step.action === 'type-intent') return `Enter input in ${step.target.name || 'field'}`;
		if (step.action === 'select') return `Choose option in ${step.target.name || 'menu'}`;
		return `Click ${step.target.name || step.target.role}`;
	};
</script>

<section class="workflow-manager">
	<button
		class="workflow-toggle"
		type="button"
		aria-label={expanded ? 'Close workflows' : 'Manage workflows'}
		aria-expanded={expanded}
		on:click={toggle}
	>
		<span>Workflows</span>
		<strong>{expanded ? 'Close' : 'Manage workflows'}</strong>
	</button>

	{#if expanded}
		<div class="workflow-content">
			<p class="workflow-note">
				Record this tab, review every step, then schedule it while Chrome is open.
			</p>
			{#if error}<p class="error" role="alert">{error.replaceAll('_', ' ')}</p>{/if}
			{#if loading}
				<p class="workflow-empty">Loading workflows…</p>
			{:else}
				<div class="recording-row">
					<div>
						<strong>{recording ? 'Recording this tab' : 'Record a workflow'}</strong>
						<small
							>{sessionActive
								? 'Only semantic actions are kept.'
								: 'Start controlling a tab before recording.'}</small
						>
					</div>
					{#if recording}
						<button type="button" aria-label="Stop and review" on:click={stop} disabled={busy}
							>Stop and review</button
						>
					{:else}
						<button
							type="button"
							aria-label="Start recording"
							on:click={start}
							disabled={busy || !connected || !sessionActive}>Start recording</button
						>
					{/if}
				</div>

				{#if draft}
					<div class="workflow-review">
						<strong
							>Review {draft.steps.length} recorded {draft.steps.length === 1
								? 'step'
								: 'steps'}</strong
						>
						<ol>
							{#each draft.steps as step}
								<li>{stepLabel(step)}</li>
							{/each}
						</ol>
						<label>
							<span>Workflow name</span>
							<input
								aria-label="Workflow name"
								bind:value={workflowName}
								maxlength="120"
								placeholder="Morning report"
							/>
						</label>
						<button
							type="button"
							aria-label="Save reviewed workflow"
							on:click={save}
							disabled={busy || !workflowName.trim()}>Save reviewed workflow</button
						>
					</div>
				{/if}

				<div class="workflow-list">
					<strong>Saved</strong>
					{#if workflows.length === 0}
						<p class="workflow-empty">No saved workflows yet.</p>
					{:else}
						{#each workflows as workflow (workflow.id)}
							<div>
								<span>{workflow.name}<small>{workflow.definition.steps.length} steps</small></span>
								<button
									type="button"
									aria-label={`Delete ${workflow.name}`}
									on:click={() => removeWorkflow(workflow.id)}
									disabled={busy}>Delete</button
								>
							</div>
						{/each}
					{/if}
				</div>

				{#if workflows.length && deviceId}
					<form class="schedule-form" on:submit|preventDefault={createSchedule}>
						<strong>Schedule a run</strong>
						<div class="schedule-grid">
							<label
								><span>Workflow</span><select
									bind:value={scheduleWorkflow}
									aria-label="Scheduled workflow"
									>{#each workflows as workflow}<option value={workflow.id}>{workflow.name}</option
										>{/each}</select
								></label
							>
							<label
								><span>Repeats</span><select bind:value={frequency} aria-label="Schedule frequency"
									><option value="HOURLY">Hourly</option><option value="DAILY">Daily</option><option
										value="WEEKLY">Weekly</option
									></select
								></label
							>
							<label
								><span>Schedule name</span><input
									bind:value={scheduleName}
									maxlength="120"
									aria-label="Schedule name"
									placeholder="Daily report"
								/></label
							>
							<label
								><span>First run</span><input
									bind:value={nextRun}
									type="datetime-local"
									aria-label="First run"
								/></label
							>
						</div>
						<button type="submit" disabled={busy || !scheduleName.trim() || !nextRun}
							>Create schedule</button
						>
					</form>
				{/if}

				{#if schedules.length}
					<div class="workflow-list schedule-list">
						<strong>Schedules</strong>
						{#each schedules as schedule (schedule.id)}
							<div>
								<span>{schedule.name}<small>{schedule.rrule.replaceAll(';', ' · ')}</small></span>
								<button
									type="button"
									aria-label={`Delete ${schedule.name}`}
									on:click={() => removeSchedule(schedule.id)}
									disabled={busy}>Delete</button
								>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</section>
