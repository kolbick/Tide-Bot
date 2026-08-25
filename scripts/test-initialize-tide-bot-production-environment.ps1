$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$initializerPath = Join-Path $PSScriptRoot 'initialize-tide-bot-production-environment.ps1'
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tide-bot-production-env-test-$PID")
$sentinel = 'TIDE_BOT_TEST_' + 'SENTINEL_DO_NOT_PRINT'
$scheduledTaskIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$destinationPath = Join-Path $fixtureRoot 'production.env'

function Assert-True {
	param(
		[bool] $Condition,
		[string] $Message
	)

	if (-not $Condition) {
		throw $Message
	}
}

function Invoke-Initializer {
	param(
		[string] $SourceEnvFile,
		[string] $DestinationPath,
		[string] $ScheduledTaskIdentity = $scheduledTaskIdentity,
		[switch] $WhatIf
	)

	$output = if ($WhatIf) {
		& $initializerPath -SourceEnvFile $SourceEnvFile -DestinationPath $DestinationPath -ScheduledTaskIdentity $ScheduledTaskIdentity -WhatIf 2>&1 | Out-String
	} else {
		& $initializerPath -SourceEnvFile $SourceEnvFile -DestinationPath $DestinationPath -ScheduledTaskIdentity $ScheduledTaskIdentity 2>&1 | Out-String
	}

	return $output
}

function Get-AccessRulesForSid {
	param(
		[System.Security.AccessControl.FileSecurity] $Acl,
		[string] $Sid
	)

	return @(
		$Acl.Access | Where-Object {
			$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $Sid
		}
	)
}

try {
	New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
	$sourcePath = Join-Path $fixtureRoot 'legacy.env'
	@(
		"WEBUI_SECRET_KEY=$sentinel"
		"OAUTH_CLIENT_INFO_ENCRYPTION_KEY=$sentinel"
		"OPENAI_API_KEYS=$sentinel"
		"TIDE_TERMINAL_API_KEY=$sentinel"
	) | Set-Content -LiteralPath $sourcePath -Encoding utf8NoBOM

	$dryRunOutput = Invoke-Initializer -SourceEnvFile $sourcePath -DestinationPath $destinationPath -WhatIf
	Assert-True (-not (Test-Path -LiteralPath $destinationPath)) 'WhatIf created the destination file.'
	Assert-True (-not $dryRunOutput.Contains($sentinel)) 'WhatIf output contained a fixture value.'
	Assert-True ($dryRunOutput -notmatch 'cannot find a parameter') 'WhatIf did not accept the scheduled-task identity.'
	Assert-True ((Get-Content -LiteralPath $sourcePath -Raw).Contains($sentinel)) 'WhatIf altered the source file.'

	$sourceHash = (Get-FileHash -LiteralPath $sourcePath).Hash
	$initializerOutput = Invoke-Initializer -SourceEnvFile $sourcePath -DestinationPath $destinationPath
	Assert-True (Test-Path -LiteralPath $destinationPath) 'Initialization did not create the destination file.'
	Assert-True (-not $initializerOutput.Contains($sentinel)) 'Initialization output contained a fixture value.'
	Assert-True ($sourceHash -eq (Get-FileHash -LiteralPath $sourcePath).Hash) 'Initialization altered the source file.'
	Assert-True ($sourceHash -eq (Get-FileHash -LiteralPath $destinationPath).Hash) 'Initialization did not copy the source unchanged.'

	$acl = Get-Acl -LiteralPath $destinationPath
	$readRights = [System.Security.AccessControl.FileSystemRights]::Read
	$administratorsSid = 'S-1-5-32-544'
	Assert-True $acl.AreAccessRulesProtected 'Initialization did not protect the destination ACL.'
	foreach ($sid in @($scheduledTaskIdentity, $administratorsSid)) {
		$rules = Get-AccessRulesForSid -Acl $acl -Sid $sid
		Assert-True ($rules.Count -gt 0) 'Required read identity is missing from the destination ACL.'
		Assert-True (($rules | Where-Object { $_.AccessControlType -eq 'Allow' -and (($_.FileSystemRights -band $readRights) -eq $readRights) }).Count -gt 0) 'Required identity lacks read access.'
	}
	foreach ($broadSid in @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')) {
		Assert-True ((Get-AccessRulesForSid -Acl $acl -Sid $broadSid).Count -eq 0) 'Destination ACL retains broad read access.'
	}

	$repositorySourceRejected = $false
	try {
		$null = Invoke-Initializer -SourceEnvFile $PSScriptRoot -DestinationPath (Join-Path $fixtureRoot 'refused.env') -WhatIf
	} catch {
		$repositorySourceRejected = $true
		Assert-True ($_.Exception.Message -notmatch [regex]::Escape($sentinel)) 'Repository refusal disclosed a fixture value.'
	}
	Assert-True $repositorySourceRejected 'Expected a repository source path to be refused.'

	$broadIdentityRejected = $false
	try {
		$null = Invoke-Initializer -SourceEnvFile $sourcePath -DestinationPath (Join-Path $fixtureRoot 'broad-identity.env') -ScheduledTaskIdentity 'S-1-1-0' -WhatIf
	} catch {
		$broadIdentityRejected = $true
		Assert-True ($_.Exception.Message -notmatch [regex]::Escape($sentinel)) 'Identity validation disclosed a fixture value.'
	}
	Assert-True $broadIdentityRejected 'Expected a broad scheduled-task identity to be rejected.'

	$missingNameSourcePath = Join-Path $fixtureRoot 'missing-required-name.env'
	$missingNameDestinationRoot = Join-Path $fixtureRoot 'missing-required-destination'
	$missingNameDestinationPath = Join-Path $missingNameDestinationRoot 'production.env'
	Set-Content -LiteralPath $missingNameSourcePath -Value "OPENAI_API_KEYS=$sentinel" -Encoding utf8NoBOM
	$missingNameRejected = $false
	try {
		$null = Invoke-Initializer -SourceEnvFile $missingNameSourcePath -DestinationPath $missingNameDestinationPath -WhatIf
	} catch {
		$missingNameRejected = $true
		Assert-True ($_.Exception.Message -notmatch [regex]::Escape($sentinel)) 'Missing-name failure disclosed a fixture value.'
		Assert-True (-not (Test-Path -LiteralPath $missingNameDestinationRoot)) 'Missing-name validation wrote a destination directory.'
	}
	Assert-True $missingNameRejected 'Expected a missing required name to be rejected.'

	$repositoryMatches = (& git -C $repositoryRoot grep --fixed-strings -- $sentinel 2>$null | Out-String).Trim()
	$global:LASTEXITCODE = 0
	Assert-True ($repositoryMatches.Length -eq 0) 'A sentinel fixture value was persisted in the repository.'
	Assert-True ((& git -C $repositoryRoot status --porcelain | Out-String) -notmatch '\.tide-bot-production-env-refusal\.fixture') 'A sentinel fixture path was persisted in the repository.'

	Write-Output 'PASS: production environment initialization safeguards'
} finally {
	if (Test-Path -LiteralPath $destinationPath) {
		& icacls $destinationPath /reset /C | Out-Null
	}
	Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}
