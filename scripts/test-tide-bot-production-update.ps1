$ErrorActionPreference = 'Stop'

$updaterPath = Join-Path $PSScriptRoot 'tide-bot-production-update.ps1'
. $updaterPath

function Assert-True { param([bool] $Condition, [string] $Message); if (-not $Condition) { throw $Message } }
function Assert-Trace { param([string[]] $Actual, [string[]] $Expected, [string] $Name); Assert-True (($Actual -join '|') -eq ($Expected -join '|')) "$Name ordering was incorrect: $($Actual -join '|')" }

function New-UpdateFixture {
	param([switch] $NoState)
	$root = Join-Path ([IO.Path]::GetTempPath()) ("tide-bot-production-update-$PID-" + [guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Path $root -Force | Out-Null
	$statePath = Join-Path $root 'state\last-successful-deployment.json'
	if (-not $NoState) {
		New-Item -ItemType Directory -Path (Split-Path -Parent $statePath) -Force | Out-Null
		@{ schema_version = 1; commit = ('1' * 40); upstream_sha = ('1' * 40); image_id = 'sha256:prior'; deployed_at_utc = '2026-08-01T00:00:00Z'; local_health = $true; public_health = $true; socketio_health = $true; oauth = @{ connection_present = $true; credential_decryptable = $true; credential_state = 'connected'; model_catalog_available = $true; model_count = 1 } } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding utf8NoBOM
	}
	$composePath = Join-Path $root 'docker-compose.live.yml'
	Set-Content -LiteralPath $composePath -Value 'name: tidebot-webui' -Encoding utf8NoBOM
	return @{ root = $root; state_path = $statePath; compose_path = $composePath; commit = ('2' * 40); calls = [Collections.Generic.List[object]]::new() }
}

function New-FakeUpdateRunner {
	param([hashtable] $Fixture, [hashtable] $Failures, [Collections.Generic.List[string]] $Trace)
	$runner = {
		param([string] $Operation, [string[]] $Arguments)
		$Trace.Add($Operation); $entry = @{ operation = $Operation; arguments = @($Arguments) }
		if ($Operation -in @('docker-compose-up-candidate', 'docker-compose-up-prior', 'docker-compose-down')) { $entry.environment_text = Get-Content -LiteralPath $Arguments[2] -Raw }
		$Fixture.calls.Add($entry)
		if ($Failures.ContainsKey($Operation)) { return @{ exit_code = 1; stdout = ''; stderr = 'secret stderr' } }
		switch ($Operation) {
			'git-fetch-tag' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-resolve-deployable' { return @{ exit_code = 0; stdout = "$($Fixture.commit)`n"; stderr = '' } }
			'git-test-ancestor-main' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-status-clean' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-switch-detach' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-head' { return @{ exit_code = 0; stdout = "$($Fixture.commit)`n"; stderr = '' } }
			'docker-inspect-current-image' { return @{ exit_code = 0; stdout = 'sha256:prior'; stderr = '' } }
			'docker-inspect-current-labels' { if ($Failures.ContainsKey('bad-predecessor-label')) { return @{ exit_code = 0; stdout = '{"com.docker.compose.project":"tidebot-webui"}'; stderr = '' } }; return @{ exit_code = 0; stdout = '{"com.docker.compose.project":"tidebot-webui","org.opencontainers.image.revision":"1111111111111111111111111111111111111111"}'; stderr = '' } }
			'docker-archive-volume' { Set-Content -LiteralPath $Arguments[0] -Value 'fixture archive' -Encoding utf8NoBOM; return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'docker-list-archive' { return @{ exit_code = 0; stdout = '.`n'; stderr = '' } }
			'docker-build-candidate' { return @{ exit_code = 0; stdout = 'sha256:candidate'; stderr = '' } }
			'docker-inspect-candidate-image' { return @{ exit_code = 0; stdout = 'sha256:candidate'; stderr = '' } }
			'docker-compose-up-candidate' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'docker-compose-down' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'docker-restore-volume' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'docker-compose-up-prior' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			default { throw "Unexpected operation: $Operation" }
		}
	}
	return $runner.GetNewClosure()
}

function New-FakeHealthRunner {
	param([hashtable] $Failures, [Collections.Generic.List[string]] $Trace, [hashtable] $Fixture)
	$state = @{ calls = 0 }
	$runner = {
		$state.calls++; $Trace.Add('health')
		if ($Failures.ContainsKey('tamper-predecessor') -and $state.calls -eq 1) { Set-Content -LiteralPath (Join-Path $Fixture.root 'predecessor-recovery.json') -Value '{}' -Encoding utf8NoBOM }
		if ((@('health', 'local-health', 'public-health', 'socketio-health', 'tamper-predecessor') | Where-Object { $Failures.ContainsKey($_) }).Count -gt 0 -and $state.calls -eq 1) {
			return @{ healthy = $false; local_health = -not $Failures.ContainsKey('local-health'); public_health = -not $Failures.ContainsKey('public-health'); socketio_health = -not $Failures.ContainsKey('socketio-health') }
		}
		if ($Failures.ContainsKey('rollback-health') -and $state.calls -gt 1) { return @{ healthy = $false; local_health = $false } }
		return @{ healthy = $true; local_health = $true; public_health = $true; socketio_health = $true; oauth_warning = 'reconnect_required'; oauth = @{ connection_present = $true; credential_decryptable = $true; credential_state = 'reconnect_required'; model_catalog_available = $false; model_count = 0 } }
	}
	return $runner.GetNewClosure()
}

function Invoke-UpdateFixture {
	param([hashtable] $Failures = @{}, [switch] $NoState, [scriptblock] $StateWriter)
	$fixture = New-UpdateFixture -NoState:$NoState; $trace = [Collections.Generic.List[string]]::new()
	try {
		$arguments = @{ RepositoryPath = $fixture.root; StateRoot = $fixture.root; StatePath = $fixture.state_path; ComposeFile = $fixture.compose_path; CommandRunner = (New-FakeUpdateRunner $fixture $Failures $trace); HealthRunner = (New-FakeHealthRunner $Failures $trace $fixture); Synthetic = $true; SkipLock = $true }
		if ($null -ne $StateWriter) { $arguments.StateWriter = $StateWriter }
		$result = Invoke-TideBotProductionUpdate @arguments
		return @{ result = $result; trace = @($trace); fixture = $fixture }
	} catch { return @{ error = $_; trace = @($trace); fixture = $fixture } }
}

try {
	$success = Invoke-UpdateFixture
	Assert-True ($null -eq $success.error) "Successful deployment unexpectedly failed: $($success.error.Exception.Message)"
	Assert-Trace $success.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main', 'git-status-clean', 'git-switch-detach', 'git-head', 'docker-inspect-current-image', 'docker-inspect-current-labels', 'docker-archive-volume', 'docker-list-archive', 'docker-build-candidate', 'docker-inspect-candidate-image', 'docker-compose-up-candidate', 'health') 'controlled successful deployment'
	Assert-True ((Read-TideBotDeploymentState $success.fixture.state_path).image_id -eq 'sha256:candidate') 'Successful state did not persist the candidate image.'
	$gitSwitch = @($success.fixture.calls | Where-Object operation -eq 'git-switch-detach')[0]
	Assert-True ($gitSwitch.arguments[-1] -eq $success.fixture.commit) 'Candidate checkout was not detached to the validated commit.'
	$candidateUp = @($success.fixture.calls | Where-Object operation -eq 'docker-compose-up-candidate')[0]
	Assert-True ($candidateUp.environment_text.Trim() -eq "TIDE_BOT_COMMIT=$($success.fixture.commit)") 'Candidate Compose interpolation was not supplied.'
	Assert-True ($success.result.oauth_warning -eq 'reconnect_required') 'Safe OAuth reconnect warning was not retained on a healthy deployment.'

	$alreadyFixture = New-UpdateFixture
	$alreadyFixture.commit = ('1' * 40)
	$alreadyTrace = [Collections.Generic.List[string]]::new()
	$alreadyResult = Invoke-TideBotProductionUpdate -RepositoryPath $alreadyFixture.root -StateRoot $alreadyFixture.root -StatePath $alreadyFixture.state_path -ComposeFile $alreadyFixture.compose_path -CommandRunner (New-FakeUpdateRunner $alreadyFixture @{} $alreadyTrace) -HealthRunner (New-FakeHealthRunner @{} $alreadyTrace $alreadyFixture) -Synthetic -SkipLock
	Assert-True ($alreadyResult.status -eq 'already_deployed') 'Recorded deployable tag was not a no-op.'
	Assert-Trace @($alreadyTrace) @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main', 'git-status-clean', 'git-switch-detach', 'git-head') 'already deployed no-op'

	$notOnMain = Invoke-UpdateFixture -Failures @{ 'git-test-ancestor-main' = $true }
	Assert-True ($null -ne $notOnMain.error) 'Candidate outside origin/main was accepted.'
	Assert-Trace $notOnMain.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main') 'non-ancestor rejection'

	$buildFailure = Invoke-UpdateFixture -Failures @{ 'docker-build-candidate' = $true }
	Assert-True ($null -ne $buildFailure.error) 'Candidate build failure was accepted.'
	Assert-Trace $buildFailure.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main', 'git-status-clean', 'git-switch-detach', 'git-head', 'docker-inspect-current-image', 'docker-inspect-current-labels', 'docker-archive-volume', 'docker-list-archive', 'docker-build-candidate') 'build failure without rollback'

	$dirty = Invoke-UpdateFixture -Failures @{ 'git-status-clean' = $true }
	Assert-True ($null -ne $dirty.error) 'Dirty controlled checkout was accepted.'
	Assert-Trace $dirty.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main', 'git-status-clean') 'dirty checkout rejection'

	$partial = Invoke-UpdateFixture -Failures @{ 'docker-compose-up-candidate' = $true }
	Assert-True ($null -ne $partial.error) 'Partial candidate replacement failure was accepted.'
	Assert-Trace $partial.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main', 'git-status-clean', 'git-switch-detach', 'git-head', 'docker-inspect-current-image', 'docker-inspect-current-labels', 'docker-archive-volume', 'docker-list-archive', 'docker-build-candidate', 'docker-inspect-candidate-image', 'docker-compose-up-candidate', 'docker-compose-down', 'docker-list-archive', 'docker-restore-volume', 'docker-compose-up-prior', 'health') 'partial replacement recovery'
	$recoveryDown = @($partial.fixture.calls | Where-Object operation -eq 'docker-compose-down')[0]
	Assert-True ($recoveryDown.environment_text.Trim() -eq ('TIDE_BOT_COMMIT=' + ('1' * 40))) 'Recovery Compose down did not receive the validated predecessor interpolation.'
	$priorUp = @($partial.fixture.calls | Where-Object operation -eq 'docker-compose-up-prior')[0]
	Assert-True ($priorUp.environment_text.Trim() -eq ('TIDE_BOT_COMMIT=' + ('1' * 40))) 'Recovery Compose interpolation was not supplied from the validated predecessor.'

	foreach ($healthFailure in @('local-health', 'public-health', 'socketio-health')) {
		$postHealthFailure = Invoke-UpdateFixture -Failures @{ $healthFailure = $true }
		Assert-True ($null -ne $postHealthFailure.error) "$healthFailure post-replacement failure was accepted."
		Assert-True ($postHealthFailure.trace -contains 'docker-compose-down') "$healthFailure did not trigger recovery."
	}

	$stateWriteFailure = Invoke-UpdateFixture -StateWriter { param($path, $state) throw 'synthetic state write failure' }
	Assert-True ($null -ne $stateWriteFailure.error) 'State write failure was accepted.'
	Assert-True ($stateWriteFailure.trace -contains 'docker-compose-down') 'State write failure did not trigger recovery.'

	$rollbackFailure = Invoke-UpdateFixture -Failures @{ health = $true; 'docker-restore-volume' = $true }
	Assert-True ($null -ne $rollbackFailure.error) 'Rollback failure was accepted.'
	Assert-True (-not ($rollbackFailure.trace -contains 'docker-compose-up-prior')) 'Rollback continued after a failed restore.'

	$firstMigration = Invoke-UpdateFixture -NoState -Failures @{ health = $true }
	Assert-True ($null -ne $firstMigration.error) 'First-migration failure was accepted.'
	Assert-True (Test-Path -LiteralPath (Join-Path $firstMigration.fixture.root 'predecessor-recovery.json')) 'First migration did not create a predecessor recovery record.'
	$failedRecord = Get-ChildItem -LiteralPath $firstMigration.fixture.root -Filter 'failed-deployment-*.json' | Select-Object -First 1
	$failedStatus = (Get-Content -LiteralPath $failedRecord.FullName -Raw | ConvertFrom-Json).status
	Assert-True ($failedStatus -eq 'failed') "Recovered deployment was incorrectly recorded as $failedStatus; recovery error: $($firstMigration.error.Exception.Message)"
	Assert-True ($failedRecord.Name -match '^failed-deployment-\d{8}T\d{6}Z-') 'Failed deployment record lacks a UTC-sortable timestamp.'

	$tamperedPredecessor = Invoke-UpdateFixture -NoState -Failures @{ 'tamper-predecessor' = $true }
	Assert-True ($null -ne $tamperedPredecessor.error) 'Tampered persisted predecessor record was accepted.'
	Assert-True (-not ($tamperedPredecessor.trace -contains 'docker-compose-down')) 'Recovery trusted the in-memory predecessor record.'

	$invalidPredecessor = Invoke-UpdateFixture -NoState -Failures @{ 'bad-predecessor-label' = $true }
	Assert-True ($null -ne $invalidPredecessor.error) 'Initial migration accepted an invalid predecessor recovery record.'
	Assert-Trace $invalidPredecessor.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main', 'git-status-clean', 'git-switch-detach', 'git-head', 'docker-inspect-current-image', 'docker-inspect-current-labels', 'docker-archive-volume', 'docker-list-archive') 'invalid predecessor rejection'

	$rootRefused = $false
	try { Invoke-TideBotProductionUpdate -RepositoryPath $success.fixture.root -StateRoot $success.fixture.root -StatePath $success.fixture.state_path -ComposeFile $success.fixture.compose_path -CommandRunner (New-FakeUpdateRunner $success.fixture @{} ([Collections.Generic.List[string]]::new())) -HealthRunner (New-FakeHealthRunner @{} ([Collections.Generic.List[string]]::new()) $success.fixture) -SkipLock | Out-Null } catch { $rootRefused = $true }
	Assert-True $rootRefused 'Non-canonical production StateRoot was accepted without synthetic mode.'

	$unsafeState = Read-TideBotDeploymentState $success.fixture.state_path
	$unsafeState.oauth = @{ unexpected = 'value' }
	$unsafeRejected = $false
	try { Write-TideBotDeploymentState (Join-Path $success.fixture.root 'unsafe-state.json') $unsafeState } catch { $unsafeRejected = $true }
	Assert-True $unsafeRejected 'State writer accepted OAuth fields outside the safe schema.'

	$updaterSource = Get-Content -LiteralPath $updaterPath -Raw
	Assert-True ($updaterSource -match 'tar --zstd') 'Production dispatcher does not use zstd for .tar.zst archives.'

	$entryOutput = & $updaterPath -WhatIf 2>&1 | Out-String
	Assert-True ($entryOutput -match 'state\\\\last-successful-deployment.json') 'Normal script entry point did not preserve its StatePath default.'
	Assert-True ($entryOutput -match 'docker-compose.live.yml') 'Normal script entry point did not preserve its ComposeFile default.'

	Write-Output 'PASS: Tide-Bot production updater safeguards'
} finally {
	Get-ChildItem -Path ([IO.Path]::GetTempPath()) -Filter "tide-bot-production-update-$PID-*" -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
}
