[CmdletBinding()]
param(
	[switch] $Enable,
	[switch] $Disable,
	[string] $RepositoryPath = 'C:\ProgramData\Tide-Bot\repo',
	[string] $StatePath = 'C:\ProgramData\Tide-Bot\state\last-successful-deployment.json',
	[string] $UpdaterPath = (Join-Path $PSScriptRoot 'tide-bot-production-update.ps1'),
	[ValidateNotNullOrEmpty()]
	[string] $ScheduledTaskIdentity = 'NT AUTHORITY\SYSTEM',
	[scriptblock] $TaskRunner = ${function:Invoke-TideBotScheduledTaskCommand},
	[scriptblock] $StateReader = ${function:Read-TideBotScheduleState},
	[scriptblock] $DeployableCommitReader = ${function:Get-TideBotScheduleDeployableCommit},
	[switch] $Synthetic,
	[switch] $WhatIf
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'tide-bot-production-update.ps1')

$script:TideBotScheduleName = 'TideBot-Upstream-Deploy'
$script:TideBotSchedulePath = '\'
$script:TideBotScheduleIdentity = 'NT AUTHORITY\SYSTEM'
$script:TideBotCanonicalRepositoryPath = 'C:\ProgramData\Tide-Bot\repo'
$script:TideBotCanonicalStatePath = 'C:\ProgramData\Tide-Bot\state\last-successful-deployment.json'

function Test-TideBotScheduleCanonicalPath {
	param([string] $Path, [string] $ExpectedPath)
	$normalized = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
	$expected = [IO.Path]::GetFullPath($ExpectedPath).TrimEnd('\', '/')
	return $normalized.Equals($expected, [StringComparison]::OrdinalIgnoreCase)
}

function Read-TideBotScheduleState {
	param([string] $Path)
	return Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable -DateKind String -ErrorAction Stop
}

function Get-TideBotScheduleDeployableCommit {
	param([string] $RepositoryPath)
	$commit = Get-TideBotDeployableCommit -RepositoryPath $RepositoryPath
	if (-not (Test-TideBotCandidateIsOnMain -RepositoryPath $RepositoryPath -Commit $commit)) {
		throw 'The exact tide-bot-deployable tag is not contained in refreshed origin/main.'
	}
	return $commit
}

function New-TideBotScheduleDefinition {
	param([string] $UpdaterPath)
	$absoluteUpdaterPath = [IO.Path]::GetFullPath($UpdaterPath)
	return @{
		name = $script:TideBotScheduleName
		path = $script:TideBotSchedulePath
		description = 'Deploys Tide-Bot only after tide-bot-deployable is a tested Git marker.'
		action = @{ execute = 'pwsh.exe'; arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$absoluteUpdaterPath`" -RepositoryPath `"$script:TideBotCanonicalRepositoryPath`" -StatePath `"$script:TideBotCanonicalStatePath`"" }
		trigger = @{ kind = 'Once'; repetition_minutes = 1440 }
		settings = @{ multiple_instances = 'IgnoreNew'; start_when_available = $true }
		principal = @{ user_id = 'SYSTEM'; logon_type = 'ServiceAccount'; account_name = $script:TideBotScheduleIdentity }
	}
}

function Invoke-TideBotScheduledTaskCommand {
	param([string] $Operation, [hashtable] $Definition)
	switch ($Operation) {
		'register' {
			$action = New-ScheduledTaskAction -Execute $Definition.action.execute -Argument $Definition.action.arguments
			$trigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes $Definition.trigger.repetition_minutes)
			$settings = New-ScheduledTaskSettingsSet -MultipleInstances $Definition.settings.multiple_instances -StartWhenAvailable
			$principal = New-ScheduledTaskPrincipal -UserId $Definition.principal.user_id -LogonType $Definition.principal.logon_type -RunLevel Highest
			Register-ScheduledTask -TaskName $Definition.name -TaskPath $Definition.path -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $Definition.description -Force | Out-Null
			return $true
		}
		'get' { return Get-ScheduledTask -TaskName $Definition.name -TaskPath $Definition.path -ErrorAction Stop }
		'unregister' { Unregister-ScheduledTask -TaskName $Definition.name -TaskPath $Definition.path -Confirm:$false -ErrorAction Stop; return $true }
		default { throw "Unknown scheduled task operation '$Operation'." }
	}
}

function Invoke-TideBotProductionScheduleInstall {
	param(
		[switch] $Enable,
		[switch] $Disable,
		[string] $RepositoryPath = 'C:\ProgramData\Tide-Bot\repo',
		[string] $StatePath = 'C:\ProgramData\Tide-Bot\state\last-successful-deployment.json',
		[string] $UpdaterPath = (Join-Path $PSScriptRoot 'tide-bot-production-update.ps1'),
		[string] $ScheduledTaskIdentity = 'NT AUTHORITY\SYSTEM',
		[scriptblock] $TaskRunner = ${function:Invoke-TideBotScheduledTaskCommand},
		[scriptblock] $StateReader = ${function:Read-TideBotScheduleState},
		[scriptblock] $DeployableCommitReader = ${function:Get-TideBotScheduleDeployableCommit},
		[switch] $Synthetic,
		[switch] $WhatIf
	)

	if ($Enable -and $Disable) { throw 'Enable and Disable cannot be used together.' }
	if (-not $ScheduledTaskIdentity.Equals($script:TideBotScheduleIdentity, [StringComparison]::OrdinalIgnoreCase)) { throw 'ScheduledTaskIdentity must be NT AUTHORITY\SYSTEM so it matches the production.env ACL contract.' }
	$definition = New-TideBotScheduleDefinition -UpdaterPath $UpdaterPath
	if ($WhatIf) { return @{ status = 'planned'; task_name = $definition.name; task_path = $definition.path; mode = if ($Disable) { 'disable' } elseif ($Enable) { 'enable' } else { 'disabled' } } }
	if ($Disable) {
		$existing = & $TaskRunner 'get' $definition
		if ($existing.TaskName -ne $definition.name -or $existing.TaskPath -ne $definition.path) { throw 'Refusing to unregister a task whose exact name and path were not confirmed.' }
		& $TaskRunner 'unregister' $definition | Out-Null
		return @{ status = 'disabled'; task_name = $definition.name }
	}
	if (-not $Enable) { return @{ status = 'disabled'; task_name = $definition.name } }
	if (-not $Synthetic -and (-not (Test-TideBotScheduleCanonicalPath $RepositoryPath $script:TideBotCanonicalRepositoryPath) -or -not (Test-TideBotScheduleCanonicalPath $StatePath $script:TideBotCanonicalStatePath))) { throw 'Production schedule repository and state paths must exactly match their canonical C:\ProgramData\Tide-Bot locations.' }

	$state = & $StateReader $StatePath
	$deployableCommit = & $DeployableCommitReader $RepositoryPath
	if (-not (Test-TideBotSuccessfulState $state)) { throw 'The successful deployment state record does not satisfy the Task 3 safe-state schema.' }
	if ($deployableCommit -notmatch '^[0-9a-f]{40}$' -or -not $state.commit.Equals($deployableCommit, [StringComparison]::Ordinal)) { throw 'The successful deployment state record does not match tide-bot-deployable.' }
	& $TaskRunner 'register' $definition | Out-Null
	return @{ status = 'enabled'; task_name = $definition.name; commit = $deployableCommit }
}

if ($MyInvocation.InvocationName -ne '.') {
	Invoke-TideBotProductionScheduleInstall @PSBoundParameters
}
