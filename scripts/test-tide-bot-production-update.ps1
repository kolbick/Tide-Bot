$ErrorActionPreference = 'Stop'

$updaterPath = Join-Path $PSScriptRoot 'tide-bot-production-update.ps1'
. $updaterPath

function Assert-True {
	param([bool] $Condition, [string] $Message)
	if (-not $Condition) { throw $Message }
}

function New-UpdateFixture {
	$root = Join-Path ([System.IO.Path]::GetTempPath()) ("tide-bot-production-update-$PID-" + [guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Path $root -Force | Out-Null
	$statePath = Join-Path $root 'deployment-state.json'
	$prior = [ordered]@{ schema_version = 1; commit = '1111111111111111111111111111111111111111'; upstream_sha = '1111111111111111111111111111111111111111'; image_id = 'sha256:prior'; deployed_at_utc = '2026-08-01T00:00:00Z'; local_health = $true; public_health = $true; socketio_health = $true; oauth_healthy = $true; oauth_warning = $null }
	$prior | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8NoBOM
	return @{ root = $root; state_path = $statePath; commit = '2222222222222222222222222222222222222222' }
}

function New-FakeUpdateRunner {
	param([hashtable] $Fixture, [hashtable] $Failures, [System.Collections.Generic.List[string]] $Trace)
	$runner = {
		param([string] $Operation, [string[]] $Arguments)
		$Trace.Add($Operation)
		if ($Failures.ContainsKey($Operation)) { return @{ exit_code = 1; stdout = ''; stderr = 'secret stderr' } }
		switch ($Operation) {
			'git-resolve-deployable' { return @{ exit_code = 0; stdout = "$($Fixture.commit)`n"; stderr = '' } }
			'docker-inspect-current-image' { return @{ exit_code = 0; stdout = 'sha256:prior'; stderr = '' } }
			'docker-inspect-current-labels' { return @{ exit_code = 0; stdout = '{"com.docker.compose.project":"tidebot-webui"}'; stderr = '' } }
			'docker-archive-volume' { Set-Content -LiteralPath $Arguments[0] -Value 'fixture archive' -Encoding utf8NoBOM; return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'docker-list-archive' { return @{ exit_code = 0; stdout = '.`n'; stderr = '' } }
			'docker-build-candidate' { return @{ exit_code = 0; stdout = 'sha256:candidate'; stderr = '' } }
			default { return @{ exit_code = 0; stdout = ''; stderr = '' } }
		}
	}
	return $runner.GetNewClosure()
}

function New-FakeHealthRunner {
	param([hashtable] $Failures, [System.Collections.Generic.List[string]] $Trace)
	$calls = 0
	$runner = {
		$calls++
		$Trace.Add('health')
		if (($Failures.ContainsKey('health') -and $calls -eq 1) -or ($Failures.ContainsKey('rollback-health') -and $calls -gt 1)) { return @{ healthy = $false; exit_code = 1; local_health = $false; public_health = $false; socketio_health = $false; oauth_healthy = $false; oauth_warning = $null } }
		return @{ healthy = $true; exit_code = 0; local_health = $true; public_health = $true; socketio_health = $true; oauth_healthy = $false; oauth_warning = 'reconnect_required'; oauth = @{ connection_present = $true; credential_decryptable = $true; credential_state = 'reconnect_required'; model_catalog_available = $false; model_count = 0 } }
	}
	return $runner.GetNewClosure()
}

function Invoke-UpdateFixture {
	param([hashtable] $Failures = @{}, [switch] $WhatIf)
	$fixture = New-UpdateFixture
	$trace = [System.Collections.Generic.List[string]]::new()
	try {
		$result = Invoke-TideBotProductionUpdate -RepositoryPath $fixture.root -StateRoot $fixture.root -StatePath $fixture.state_path -CommandRunner (New-FakeUpdateRunner -Fixture $fixture -Failures $Failures -Trace $trace) -HealthRunner (New-FakeHealthRunner -Failures $Failures -Trace $trace) -SkipLock -WhatIf:$WhatIf
		return @{ result = $result; trace = @($trace); fixture = $fixture }
	} catch {
		return @{ error = $_; trace = @($trace); fixture = $fixture }
	}
}

function Assert-Trace {
	param([string[]] $Actual, [string[]] $Expected, [string] $Name)
	Assert-True (($Actual -join '|') -eq ($Expected -join '|')) "$Name command ordering was incorrect: $($Actual -join '|')"
}

try {
	$success = Invoke-UpdateFixture
	Assert-True ($null -eq $success.error) 'Successful deployment unexpectedly failed.'
	Assert-True ($success.result.status -eq 'deployed') 'Successful deployment did not report deployed.'
	Assert-Trace $success.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main', 'docker-inspect-current-image', 'docker-inspect-current-labels', 'docker-archive-volume', 'docker-list-archive', 'docker-build-candidate', 'docker-compose-up-candidate', 'health', 'write-state') 'successful deployment'
	Assert-True ($success.result.oauth_warning -eq 'reconnect_required') 'OAuth reconnect state was not retained as a warning.'
	$stored = Read-TideBotDeploymentState -StatePath $success.fixture.state_path
	$expectedStateKeys = @('schema_version', 'commit', 'upstream_sha', 'image_id', 'deployed_at_utc', 'local_health', 'public_health', 'socketio_health', 'oauth')
	Assert-True ($stored.Keys.Count -eq $expectedStateKeys.Count -and @($stored.Keys | Where-Object { $_ -notin $expectedStateKeys }).Count -eq 0) 'Deployment state contained fields outside the safe schema.'
	Assert-True ($stored.image_id -eq 'sha256:candidate') 'Deployment state did not record the candidate image ID.'

	$recorded = Invoke-UpdateFixture
	$recordedState = Read-TideBotDeploymentState -StatePath $recorded.fixture.state_path
	$recordedState.commit = $recorded.fixture.commit
	Write-TideBotDeploymentState -StatePath $recorded.fixture.state_path -State $recordedState
	$recordedResult = Invoke-TideBotProductionUpdate -RepositoryPath $recorded.fixture.root -StateRoot $recorded.fixture.root -StatePath $recorded.fixture.state_path -CommandRunner (New-FakeUpdateRunner -Fixture $recorded.fixture -Failures @{} -Trace ([System.Collections.Generic.List[string]]::new())) -HealthRunner (New-FakeHealthRunner -Failures @{} -Trace ([System.Collections.Generic.List[string]]::new())) -SkipLock
	Assert-True ($recordedResult.status -eq 'already_deployed') 'An already recorded deployable tag was not skipped.'

	$duplicate = Invoke-UpdateFixture -Failures @{ 'git-resolve-deployable' = $true }
	Assert-True ($null -ne $duplicate.error) 'An unresolved deployable tag was accepted.'
	Assert-Trace $duplicate.trace @('git-fetch-tag', 'git-resolve-deployable') 'unrecorded deployable tag'

	$notOnMain = Invoke-UpdateFixture -Failures @{ 'git-test-ancestor-main' = $true }
	Assert-True ($null -ne $notOnMain.error) 'A candidate outside origin/main was accepted.'
	Assert-Trace $notOnMain.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main') 'candidate ancestry rejection'

	$buildFailure = Invoke-UpdateFixture -Failures @{ 'docker-build-candidate' = $true }
	Assert-True ($null -ne $buildFailure.error) 'A failed candidate build was accepted.'
	Assert-Trace $buildFailure.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main', 'docker-inspect-current-image', 'docker-inspect-current-labels', 'docker-archive-volume', 'docker-list-archive', 'docker-build-candidate') 'build failure'

	$postDeployFailure = Invoke-UpdateFixture -Failures @{ health = $true }
	Assert-True ($null -ne $postDeployFailure.error) 'A failed replacement health check was accepted.'
	Assert-Trace $postDeployFailure.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main', 'docker-inspect-current-image', 'docker-inspect-current-labels', 'docker-archive-volume', 'docker-list-archive', 'docker-build-candidate', 'docker-compose-up-candidate', 'health', 'docker-compose-down', 'docker-list-archive', 'docker-restore-volume', 'docker-compose-up-prior', 'health', 'write-failed-state') 'post-deploy recovery'
	Assert-True (Test-Path -LiteralPath (Join-Path $postDeployFailure.fixture.root 'failed-deployment-222222222222.json')) 'Recovery did not write a failed-deployment record.'

	$rollbackFailure = Invoke-UpdateFixture -Failures @{ health = $true; 'docker-restore-volume' = $true }
	Assert-True ($null -ne $rollbackFailure.error) 'A rollback failure was accepted.'
	Assert-Trace $rollbackFailure.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main', 'docker-inspect-current-image', 'docker-inspect-current-labels', 'docker-archive-volume', 'docker-list-archive', 'docker-build-candidate', 'docker-compose-up-candidate', 'health', 'docker-compose-down', 'docker-list-archive', 'docker-restore-volume', 'write-failed-state') 'rollback failure'

	$stateWriteFailure = Invoke-UpdateFixture -Failures @{ 'write-state' = $true }
	Assert-True ($null -ne $stateWriteFailure.error) 'A failed state write was accepted.'
	Assert-Trace $stateWriteFailure.trace @('git-fetch-tag', 'git-resolve-deployable', 'git-test-ancestor-main', 'docker-inspect-current-image', 'docker-inspect-current-labels', 'docker-archive-volume', 'docker-list-archive', 'docker-build-candidate', 'docker-compose-up-candidate', 'health', 'write-state', 'docker-compose-down', 'docker-list-archive', 'docker-restore-volume', 'docker-compose-up-prior', 'health', 'write-failed-state') 'state write failure recovery'

	$dryRun = Invoke-UpdateFixture -WhatIf
	Assert-True ($null -eq $dryRun.error) 'WhatIf failed.'
	Assert-True ($dryRun.result.status -eq 'planned') 'WhatIf did not report planned.'
	Assert-Trace $dryRun.trace @() 'WhatIf production access'

	Write-Output 'PASS: Tide-Bot production updater safeguards'
} finally {
	Get-ChildItem -Path ([System.IO.Path]::GetTempPath()) -Filter "tide-bot-production-update-$PID-*" -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
}
