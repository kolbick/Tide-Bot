[CmdletBinding()]
param(
	[string] $RepositoryPath = 'C:\ProgramData\Tide-Bot\repo',
	[string] $ProductionRoot = 'C:\ProgramData\Tide-Bot',
	[string] $Commit,
	[scriptblock] $GitRunner = ${function:Invoke-TideBotCheckoutGitCommand},
	[scriptblock] $FileSystemRunner = ${function:Invoke-TideBotCheckoutFileSystem},
	[switch] $Synthetic,
	[switch] $WhatIf
)

$ErrorActionPreference = 'Stop'

$script:TideBotControlledOrigin = 'https://github.com/kolbick/Tide-Bot.git'
$script:TideBotUpstreamOrigin = 'https://github.com/open-webui/open-webui.git'

function Test-TideBotPathWithin {
	param([string] $Path, [string] $ParentPath)
	$normalizedPath = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
	$normalizedParent = [IO.Path]::GetFullPath($ParentPath).TrimEnd('\', '/')
	$separator = [IO.Path]::DirectorySeparatorChar
	return $normalizedPath.StartsWith("$normalizedParent$separator", [StringComparison]::OrdinalIgnoreCase)
}

function Invoke-TideBotCheckoutProcess {
	param([string] $FilePath, [string[]] $Arguments)
	$start = [Diagnostics.ProcessStartInfo]::new()
	$start.FileName = $FilePath
	$start.UseShellExecute = $false
	$start.RedirectStandardOutput = $true
	$start.RedirectStandardError = $true
	foreach ($argument in $Arguments) { $null = $start.ArgumentList.Add($argument) }
	$process = [Diagnostics.Process]::new()
	$process.StartInfo = $start
	$null = $process.Start()
	$stdout = $process.StandardOutput.ReadToEnd()
	$stderr = $process.StandardError.ReadToEnd()
	$process.WaitForExit()
	return @{ exit_code = $process.ExitCode; stdout = $stdout; stderr = $stderr }
}

function Invoke-TideBotCheckoutGitCommand {
	param([string] $Operation, [string[]] $Arguments)
	switch ($Operation) {
		'git-clone' {
			$gitArguments = @('clone') + $Arguments
			return Invoke-TideBotCheckoutProcess git $gitArguments
		}
		'git-status-clean' {
			$result = Invoke-TideBotCheckoutProcess git @('-C', $Arguments[0], 'status', '--porcelain=v1', '--untracked-files=all')
			if ($result.exit_code -eq 0 -and $result.stdout.Trim().Length -ne 0) { $result.exit_code = 1 }
			return $result
		}
		'git-get-origin' { return Invoke-TideBotCheckoutProcess git @('-C', $Arguments[0], 'remote', 'get-url', 'origin') }
		'git-fetch-tags' { return Invoke-TideBotCheckoutProcess git @('-C', $Arguments[0], 'fetch', '--quiet', '--tags', '--prune', 'origin') }
		'git-configure-upstream' {
			$existing = Invoke-TideBotCheckoutProcess git @('-C', $Arguments[0], 'remote', 'get-url', 'upstream')
			if ($existing.exit_code -eq 0) { return Invoke-TideBotCheckoutProcess git @('-C', $Arguments[0], 'remote', 'set-url', 'upstream', $Arguments[1]) }
			return Invoke-TideBotCheckoutProcess git @('-C', $Arguments[0], 'remote', 'add', 'upstream', $Arguments[1])
		}
		'git-get-upstream' { return Invoke-TideBotCheckoutProcess git @('-C', $Arguments[0], 'remote', 'get-url', 'upstream') }
		'git-fetch-commit' { return Invoke-TideBotCheckoutProcess git @('-C', $Arguments[0], 'fetch', '--quiet', 'origin', $Arguments[1]) }
		'git-verify-commit' { return Invoke-TideBotCheckoutProcess git @('-C', $Arguments[0], 'rev-parse', "$($Arguments[1])^{commit}") }
		'git-switch-detach' { return Invoke-TideBotCheckoutProcess git @('-C', $Arguments[0], 'switch', '--detach', $Arguments[1]) }
		'git-head' { return Invoke-TideBotCheckoutProcess git @('-C', $Arguments[0], 'rev-parse', 'HEAD') }
		default { throw "Unknown controlled checkout Git operation '$Operation'." }
	}
}

function Invoke-TideBotCheckoutFileSystem {
	param([string] $Operation, [string[]] $Arguments)
	switch ($Operation) {
		'test-directory' { return @{ exit_code = 0; stdout = [string](Test-Path -LiteralPath $Arguments[0] -PathType Container); stderr = '' } }
		'create-parent-directory' { New-Item -ItemType Directory -Path $Arguments[0] -Force | Out-Null; return @{ exit_code = 0; stdout = ''; stderr = '' } }
		default { throw "Unknown controlled checkout filesystem operation '$Operation'." }
	}
}

function Invoke-TideBotCheckoutCheckedCommand {
	param([scriptblock] $Runner, [string] $Operation, [string[]] $Arguments)
	$result = & $Runner $Operation $Arguments
	if ($null -eq $result -or $result.exit_code -ne 0) { throw "Controlled checkout operation '$Operation' failed." }
	return $result
}

function Invoke-TideBotProductionCheckoutBootstrap {
	param(
		[string] $RepositoryPath = 'C:\ProgramData\Tide-Bot\repo',
		[string] $ProductionRoot = 'C:\ProgramData\Tide-Bot',
		[string] $Commit,
		[scriptblock] $GitRunner = ${function:Invoke-TideBotCheckoutGitCommand},
		[scriptblock] $FileSystemRunner = ${function:Invoke-TideBotCheckoutFileSystem},
		[switch] $Synthetic,
		[switch] $WhatIf
	)

	$repositoryPath = [IO.Path]::GetFullPath($RepositoryPath)
	$productionRoot = [IO.Path]::GetFullPath($ProductionRoot)
	if (-not (Test-TideBotPathWithin $repositoryPath $productionRoot)) { throw 'The controlled checkout must be a child of C:\ProgramData\Tide-Bot.' }
	if (-not $Synthetic -and -not $productionRoot.TrimEnd('\').Equals('C:\ProgramData\Tide-Bot', [StringComparison]::OrdinalIgnoreCase)) { throw 'ProductionRoot must be C:\ProgramData\Tide-Bot outside synthetic tests.' }
	if ($WhatIf) { return @{ status = 'planned'; repository_path = $repositoryPath; operations = @('clone controlled origin if absent', 'verify remotes', 'fetch tags and deployable commit', 'detach to immutable commit') } }
	if ($Commit -notmatch '^[0-9a-f]{40}$') { throw 'An immutable full commit hash is required for the first controlled checkout.' }

	$existsResult = Invoke-TideBotCheckoutCheckedCommand $FileSystemRunner 'test-directory' @($repositoryPath)
	$exists = [bool]::Parse($existsResult.stdout.Trim())
	if ($exists) {
		Invoke-TideBotCheckoutCheckedCommand $GitRunner 'git-status-clean' @($repositoryPath) | Out-Null
	} else {
		Invoke-TideBotCheckoutCheckedCommand $FileSystemRunner 'create-parent-directory' @((Split-Path -Parent $repositoryPath)) | Out-Null
		Invoke-TideBotCheckoutCheckedCommand $GitRunner 'git-clone' @('--origin', 'origin', $script:TideBotControlledOrigin, $repositoryPath) | Out-Null
	}

	$origin = (Invoke-TideBotCheckoutCheckedCommand $GitRunner 'git-get-origin' @($repositoryPath)).stdout.Trim()
	if (-not $origin.Equals($script:TideBotControlledOrigin, [StringComparison]::Ordinal)) { throw 'The controlled checkout origin must exactly match https://github.com/kolbick/Tide-Bot.git.' }
	Invoke-TideBotCheckoutCheckedCommand $GitRunner 'git-fetch-tags' @($repositoryPath) | Out-Null
	Invoke-TideBotCheckoutCheckedCommand $GitRunner 'git-configure-upstream' @($repositoryPath, $script:TideBotUpstreamOrigin) | Out-Null
	$upstream = (Invoke-TideBotCheckoutCheckedCommand $GitRunner 'git-get-upstream' @($repositoryPath)).stdout.Trim()
	if (-not $upstream.Equals($script:TideBotUpstreamOrigin, [StringComparison]::Ordinal)) { throw 'The controlled checkout upstream must exactly match https://github.com/open-webui/open-webui.git.' }
	Invoke-TideBotCheckoutCheckedCommand $GitRunner 'git-fetch-commit' @($repositoryPath, $Commit) | Out-Null
	$resolvedCommit = (Invoke-TideBotCheckoutCheckedCommand $GitRunner 'git-verify-commit' @($repositoryPath, $Commit)).stdout.Trim()
	if (-not $resolvedCommit.Equals($Commit, [StringComparison]::Ordinal)) { throw 'The requested deployable commit did not resolve exactly.' }
	Invoke-TideBotCheckoutCheckedCommand $GitRunner 'git-switch-detach' @($repositoryPath, $Commit) | Out-Null
	$head = (Invoke-TideBotCheckoutCheckedCommand $GitRunner 'git-head' @($repositoryPath)).stdout.Trim()
	if (-not $head.Equals($Commit, [StringComparison]::Ordinal)) { throw 'Controlled checkout HEAD did not match the immutable deployable commit.' }
	return @{ status = 'bootstrapped'; repository_path = $repositoryPath; commit = $Commit }
}

if ($MyInvocation.InvocationName -ne '.') {
	Invoke-TideBotProductionCheckoutBootstrap @PSBoundParameters
}
