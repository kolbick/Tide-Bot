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

try {
	$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("tide-bot-schedule-$PID-" + [guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
	$commit = 'b' * 40
	$statePath = Join-Path $fixtureRoot 'last-successful-deployment.json'
	@{ schema_version = 1; commit = $commit } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8NoBOM
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
	Assert-True ($definition.action.execute -eq 'pwsh.exe' -and $definition.action.arguments -match [regex]::Escape("-NoProfile -ExecutionPolicy Bypass -File `"$updaterPath`"")) 'Schedule action did not invoke the updater by absolute path with guarded PowerShell arguments.'
	Assert-True ($definition.description -match 'tested Git marker') 'Schedule description did not state its tested-marker boundary.'

	$disabledCalls = [Collections.Generic.List[object]]::new()
	$disabled = Invoke-TideBotProductionScheduleInstall -Synthetic -TaskRunner (New-TaskRunner $disabledCalls $null) -StateReader { throw 'Disabled mode read deployment state.' } -DeployableCommitReader { throw 'Disabled mode resolved Git.' }
	Assert-True ($disabled.status -eq 'disabled' -and $disabledCalls.Count -eq 0) 'Default disabled mode had a side effect.'

	$whatIfCalls = [Collections.Generic.List[object]]::new()
	$dryRun = Invoke-TideBotProductionScheduleInstall -Enable -WhatIf -Synthetic -TaskRunner (New-TaskRunner $whatIfCalls $null) -StateReader { throw 'WhatIf read deployment state.' } -DeployableCommitReader { throw 'WhatIf resolved Git.' }
	Assert-True ($dryRun.status -eq 'planned' -and $whatIfCalls.Count -eq 0) 'Schedule WhatIf had a side effect.'

	$mismatchCalls = [Collections.Generic.List[object]]::new()
	$mismatchRejected = $false
	try { Invoke-TideBotProductionScheduleInstall -Enable -Synthetic -RepositoryPath $fixtureRoot -StatePath $statePath -UpdaterPath $updaterPath -TaskRunner (New-TaskRunner $mismatchCalls $null) -StateReader { return @{ schema_version = 1; commit = ('c' * 40) } } -DeployableCommitReader { return $commit } | Out-Null } catch { $mismatchRejected = $true }
	Assert-True ($mismatchRejected -and $mismatchCalls.Count -eq 0) 'Schedule enabled despite a state-marker mismatch.'

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
