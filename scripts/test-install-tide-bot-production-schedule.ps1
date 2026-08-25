$ErrorActionPreference = 'Stop'

$installerPath = Join-Path $PSScriptRoot 'install-tide-bot-production-schedule.ps1'
. $installerPath

function Assert-True {
	param([bool] $Condition, [string] $Message)
	if (-not $Condition) { throw $Message }
}

function New-TaskRunner {
	param([Collections.Generic.List[object]] $Calls, [hashtable] $ExistingTask)
	$runner = {
		param([string] $Operation, [hashtable] $Definition)
		$Calls.Add(@{ operation = $Operation; definition = $Definition })
		switch ($Operation) {
			'register' { return $true }
			'get' { return $ExistingTask }
			'unregister' { return $true }
			default { throw "Unexpected scheduled task operation: $Operation" }
		}
	}
	return $runner.GetNewClosure()
}

function New-SuccessfulState {
	param([string] $Commit)
	return @{
		schema_version = 1
		commit = $Commit
		upstream_sha = $Commit
		image_id = 'sha256:tested-image'
		deployed_at_utc = '2026-08-25T00:00:00Z'
		local_health = $true
		public_health = $true
		socketio_health = $true
		oauth = @{ connection_present = $true; credential_decryptable = $true; credential_state = 'connected'; model_catalog_available = $true; model_count = 1 }
	}
}

try {
	$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("tide-bot-schedule-$PID-" + [guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
	$commit = 'b' * 40
	$statePath = Join-Path $fixtureRoot 'last-successful-deployment.json'
	(New-SuccessfulState $commit) | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding utf8NoBOM
	$updaterPath = Join-Path $fixtureRoot 'tide-bot-production-update.ps1'
	Set-Content -LiteralPath $updaterPath -Value '# fixture' -Encoding utf8NoBOM

	$calls = [Collections.Generic.List[object]]::new()
	$result = Invoke-TideBotProductionScheduleInstall -Enable -Synthetic -RepositoryPath $fixtureRoot -StatePath $statePath -UpdaterPath $updaterPath -TaskRunner (New-TaskRunner $calls $null) -StateReader { param($path) return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable) } -DeployableCommitReader { param($path) return $commit }
	Assert-True ($result.status -eq 'enabled') 'Enable did not report an enabled schedule.'
	Assert-True ($calls.Count -eq 1 -and $calls[0].operation -eq 'register') 'Enable did not register exactly one task.'
	$definition = $calls[0].definition
	Assert-True ($definition.name -eq 'TideBot-Upstream-Deploy' -and $definition.path -eq '\') 'Schedule did not use the exact task name and path.'
	Assert-True ($definition.principal.user_id -eq 'SYSTEM' -and $definition.principal.logon_type -eq 'ServiceAccount') 'Schedule did not use explicit LocalSystem semantics.'
	Assert-True ($definition.trigger.kind -eq 'Once' -and $definition.trigger.repetition_minutes -eq 15) 'Schedule did not create a 15-minute one-time repetition trigger.'
	Assert-True ($definition.settings.multiple_instances -eq 'IgnoreNew' -and $definition.settings.start_when_available) 'Schedule did not enforce IgnoreNew and StartWhenAvailable.'
	$expectedActionArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$updaterPath`" -RepositoryPath `"C:\ProgramData\Tide-Bot\repo`" -StatePath `"C:\ProgramData\Tide-Bot\state\last-successful-deployment.json`""
	Assert-True ($definition.action.execute -eq 'pwsh.exe' -and $definition.action.arguments -eq $expectedActionArguments) 'Schedule action did not use the canonical updater defaults with guarded PowerShell arguments.'
	Assert-True ($definition.description -match 'tested Git marker') 'Schedule description did not state its tested-marker boundary.'

	$disabledCalls = [Collections.Generic.List[object]]::new()
	$disabled = Invoke-TideBotProductionScheduleInstall -Synthetic -TaskRunner (New-TaskRunner $disabledCalls $null) -StateReader { throw 'Disabled mode read deployment state.' } -DeployableCommitReader { throw 'Disabled mode resolved Git.' }
	Assert-True ($disabled.status -eq 'disabled' -and $disabledCalls.Count -eq 0) 'Default disabled mode had a side effect.'

	$whatIfCalls = [Collections.Generic.List[object]]::new()
	$dryRun = Invoke-TideBotProductionScheduleInstall -Enable -WhatIf -Synthetic -TaskRunner (New-TaskRunner $whatIfCalls $null) -StateReader { throw 'WhatIf read deployment state.' } -DeployableCommitReader { throw 'WhatIf resolved Git.' }
	Assert-True ($dryRun.status -eq 'planned' -and $whatIfCalls.Count -eq 0) 'Schedule WhatIf had a side effect.'

	$invalidStates = [ordered]@{
		truncated = @{ schema_version = 1; commit = $commit }
		invalid = @{ schema_version = 1; commit = $commit; upstream_sha = $commit; image_id = 'mutable-image'; deployed_at_utc = '2026-08-25T00:00:00Z'; local_health = $true; public_health = $true; socketio_health = $true; oauth = @{ connection_present = $true; credential_decryptable = $true; credential_state = 'connected'; model_catalog_available = $true; model_count = 1 } }
		failed = @{ schema_version = 1; status = 'failed'; commit = $commit }
		missing_health = @{ schema_version = 1; commit = $commit; upstream_sha = $commit; image_id = 'sha256:tested-image'; deployed_at_utc = '2026-08-25T00:00:00Z'; public_health = $true; socketio_health = $true; oauth = @{ connection_present = $true; credential_decryptable = $true; credential_state = 'connected'; model_catalog_available = $true; model_count = 1 } }
		missing_image = @{ schema_version = 1; commit = $commit; upstream_sha = $commit; deployed_at_utc = '2026-08-25T00:00:00Z'; local_health = $true; public_health = $true; socketio_health = $true; oauth = @{ connection_present = $true; credential_decryptable = $true; credential_state = 'connected'; model_catalog_available = $true; model_count = 1 } }
		missing_oauth = @{ schema_version = 1; commit = $commit; upstream_sha = $commit; image_id = 'sha256:tested-image'; deployed_at_utc = '2026-08-25T00:00:00Z'; local_health = $true; public_health = $true; socketio_health = $true }
		marker_mismatch = New-SuccessfulState ('c' * 40)
	}
	foreach ($case in $invalidStates.GetEnumerator()) {
		$invalidCalls = [Collections.Generic.List[object]]::new()
		$rejected = $false
		try { Invoke-TideBotProductionScheduleInstall -Enable -Synthetic -RepositoryPath $fixtureRoot -StatePath $statePath -UpdaterPath $updaterPath -TaskRunner (New-TaskRunner $invalidCalls $null) -StateReader { return $case.Value } -DeployableCommitReader { return $commit } | Out-Null } catch { $rejected = $true }
		Assert-True ($rejected -and $invalidCalls.Count -eq 0) "Schedule enabled for $($case.Key) successful-state evidence."
	}

	$alternateRepositoryRejected = $false
	try { Invoke-TideBotProductionScheduleInstall -Enable -RepositoryPath 'C:\ProgramData\Tide-Bot\alternate-repo' -StatePath 'C:\ProgramData\Tide-Bot\state\last-successful-deployment.json' -TaskRunner { throw 'Alternate repository read state or task runner.' } -StateReader { throw 'Alternate repository read state.' } -DeployableCommitReader { throw 'Alternate repository resolved a marker.' } | Out-Null } catch { $alternateRepositoryRejected = $true }
	Assert-True $alternateRepositoryRejected 'Schedule accepted an alternate production repository descendant.'
	$alternateStateRejected = $false
	try { Invoke-TideBotProductionScheduleInstall -Enable -RepositoryPath 'C:\ProgramData\Tide-Bot\repo' -StatePath 'C:\ProgramData\Tide-Bot\state\other-successful-deployment.json' -TaskRunner { throw 'Alternate state read task runner.' } -StateReader { throw 'Alternate state read.' } -DeployableCommitReader { throw 'Alternate state resolved a marker.' } | Out-Null } catch { $alternateStateRejected = $true }
	Assert-True $alternateStateRejected 'Schedule accepted an alternate production state descendant.'

	$disableCalls = [Collections.Generic.List[object]]::new()
	$disableResult = Invoke-TideBotProductionScheduleInstall -Disable -Synthetic -TaskRunner (New-TaskRunner $disableCalls @{ TaskName = 'TideBot-Upstream-Deploy'; TaskPath = '\' })
	Assert-True ($disableResult.status -eq 'disabled' -and (($disableCalls.operation -join '|') -eq 'get|unregister')) 'Disable did not unregister only the expected task.'
	$mismatchedTaskCalls = [Collections.Generic.List[object]]::new()
	$wrongTaskRejected = $false
	try { Invoke-TideBotProductionScheduleInstall -Disable -Synthetic -TaskRunner (New-TaskRunner $mismatchedTaskCalls @{ TaskName = 'another-task'; TaskPath = '\' }) | Out-Null } catch { $wrongTaskRejected = $true }
	Assert-True ($wrongTaskRejected -and (($mismatchedTaskCalls.operation -join '|') -eq 'get')) 'Disable unregistered a task whose name or path did not match.'
	Write-Output 'PASS: Tide-Bot production schedule safeguards'
} finally {
	if ($fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
