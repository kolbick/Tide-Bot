$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$initializerPath = Join-Path $PSScriptRoot 'initialize-tide-bot-production-environment.ps1'
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tide-bot-production-env-test-$PID")
$sentinel = 'TIDE_BOT_TEST_SENTINEL_DO_NOT_PRINT'

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
		[switch] $WhatIf
	)

	$output = if ($WhatIf) {
		& $initializerPath -SourceEnvFile $SourceEnvFile -DestinationPath $DestinationPath -WhatIf 2>&1 | Out-String
	} else {
		& $initializerPath -SourceEnvFile $SourceEnvFile -DestinationPath $DestinationPath 2>&1 | Out-String
	}

	return $output
}

try {
	New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
	$sourcePath = Join-Path $fixtureRoot 'legacy.env'
	$destinationPath = Join-Path $fixtureRoot 'production.env'
	@(
		"WEBUI_SECRET_KEY=$sentinel"
		"OAUTH_CLIENT_INFO_ENCRYPTION_KEY=$sentinel"
		"OPENAI_API_KEYS=$sentinel"
		"TIDE_TERMINAL_API_KEY=$sentinel"
	) | Set-Content -LiteralPath $sourcePath -Encoding utf8NoBOM

	$dryRunOutput = Invoke-Initializer -SourceEnvFile $sourcePath -DestinationPath $destinationPath -WhatIf
	Assert-True (-not (Test-Path -LiteralPath $destinationPath)) 'WhatIf created the destination file.'
	Assert-True (-not $dryRunOutput.Contains($sentinel)) 'WhatIf output contained a fixture value.'
	Assert-True ((Get-Content -LiteralPath $sourcePath -Raw).Contains($sentinel)) 'WhatIf altered the source file.'

	$repositorySourcePath = Join-Path $repositoryRoot '.tide-bot-production-env-refusal.fixture'
	Set-Content -LiteralPath $repositorySourcePath -Value "WEBUI_SECRET_KEY=$sentinel" -Encoding utf8NoBOM
	$refused = $false
	try {
		$refusalDestination = Join-Path $fixtureRoot 'refused.env'
		$null = Invoke-Initializer -SourceEnvFile $repositorySourcePath -DestinationPath $refusalDestination -WhatIf
	} catch {
		$refused = $true
		Assert-True ($_.Exception.Message -notmatch [regex]::Escape($sentinel)) 'Repository refusal disclosed a fixture value.'
		Assert-True (-not (Test-Path -LiteralPath $refusalDestination)) 'Repository source-path refusal wrote a destination file.'
	} finally {
		Remove-Item -LiteralPath $repositorySourcePath -Force -ErrorAction SilentlyContinue
	}
	Assert-True $refused 'Expected a repository source path to be refused.'

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

	Write-Output 'PASS: production environment initialization safeguards'
} finally {
	Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}
