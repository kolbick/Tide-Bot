[CmdletBinding()]
param(
	[string] $RepositoryPath = 'C:\ProgramData\Tide-Bot\repo',
	[string] $StateRoot = 'C:\ProgramData\Tide-Bot',
	[string] $StatePath,
	[string] $EnvironmentFile = 'C:\ProgramData\Tide-Bot\production.env',
	[string] $ComposeFile,
	[switch] $WhatIf
)

$ErrorActionPreference = 'Stop'

function Invoke-TideBotProcess {
	param([string] $FilePath, [string[]] $Arguments)
	$start = [System.Diagnostics.ProcessStartInfo]::new()
	$start.FileName = $FilePath; $start.UseShellExecute = $false; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
	foreach ($argument in $Arguments) { $null = $start.ArgumentList.Add($argument) }
	$process = [System.Diagnostics.Process]::new(); $process.StartInfo = $start; $null = $process.Start()
	$stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd(); $process.WaitForExit()
	return @{ exit_code = $process.ExitCode; stdout = $stdout; stderr = $stderr }
}

function Invoke-TideBotCommand {
	param([string] $Operation, [string[]] $Arguments)
	switch ($Operation) {
		'git-fetch-tag' { return Invoke-TideBotProcess 'git' @('-C', $Arguments[0], 'fetch', '--quiet', 'origin', 'tide-bot-deployable') }
		'git-resolve-deployable' { return Invoke-TideBotProcess 'git' @('-C', $Arguments[0], 'rev-parse', 'origin/tide-bot-deployable^{commit}') }
		'git-test-ancestor-main' { return Invoke-TideBotProcess 'git' @('-C', $Arguments[0], 'merge-base', '--is-ancestor', $Arguments[1], 'origin/main') }
		'docker-inspect-current-image' { return Invoke-TideBotProcess 'docker' @('inspect', '--format', '{{.Image}}', 'tidebot-open-webui') }
		'docker-inspect-current-labels' { return Invoke-TideBotProcess 'docker' @('inspect', '--format', '{{json .Config.Labels}}', 'tidebot-open-webui') }
		'docker-archive-volume' { return Invoke-TideBotProcess 'docker' @('run', '--rm', '--mount', 'type=volume,src=tidebot-webui_tidebot-open-webui,dst=/data,readonly', '--mount', "type=bind,src=$($Arguments[1]),dst=/backup", 'alpine:3.20', 'sh', '-ceu', "tar -C /data -cf /backup/$([System.IO.Path]::GetFileName($Arguments[0])) .") }
		'docker-list-archive' { return Invoke-TideBotProcess 'docker' @('run', '--rm', '--mount', "type=bind,src=$($Arguments[1]),dst=/backup,readonly", 'alpine:3.20', 'sh', '-ceu', "tar -tf /backup/$([System.IO.Path]::GetFileName($Arguments[0]))") }
		'docker-build-candidate' { return Invoke-TideBotProcess 'docker' @('compose', '--project-directory', $Arguments[0], '--env-file', $Arguments[1], '--env-file', $Arguments[2], '-f', $Arguments[3], 'build', '--quiet') }
		'docker-compose-up-candidate' { return Invoke-TideBotProcess 'docker' @('compose', '--project-directory', $Arguments[0], '--env-file', $Arguments[1], '--env-file', $Arguments[2], '-f', $Arguments[3], 'up', '--detach', '--force-recreate', '--no-build') }
		'docker-compose-down' { return Invoke-TideBotProcess 'docker' @('compose', '--project-directory', $Arguments[0], '--env-file', $Arguments[1], '-f', $Arguments[2], 'down') }
		'docker-restore-volume' { return Invoke-TideBotProcess 'docker' @('run', '--rm', '--mount', 'type=volume,src=tidebot-webui_tidebot-open-webui,dst=/data', '--mount', "type=bind,src=$($Arguments[1]),dst=/backup,readonly", 'alpine:3.20', 'sh', '-ceu', "rm -rf /data/* /data/.[!.]* /data/..?*; tar -C /data -xf /backup/$([System.IO.Path]::GetFileName($Arguments[0]))") }
		'docker-compose-up-prior' { return Invoke-TideBotProcess 'docker' @('compose', '--project-directory', $Arguments[0], '--env-file', $Arguments[1], '-f', $Arguments[2], '-f', $Arguments[3], 'up', '--detach', '--force-recreate', '--no-build') }
		default { throw "Unknown Tide-Bot command '$Operation'." }
	}
}

function Invoke-TideBotCheckedCommand {
	param([scriptblock] $CommandRunner, [string] $Operation, [string[]] $Arguments)
	$result = & $CommandRunner $Operation $Arguments
	if ($result.exit_code -ne 0) { throw "Tide-Bot operation '$Operation' failed." }
	return $result
}

function Get-TideBotDeployableCommit {
	param([string] $RepositoryPath)
	Invoke-TideBotCheckedCommand -CommandRunner ${function:Invoke-TideBotCommand} -Operation 'git-fetch-tag' -Arguments @($RepositoryPath) | Out-Null
	$resolved = Invoke-TideBotCheckedCommand -CommandRunner ${function:Invoke-TideBotCommand} -Operation 'git-resolve-deployable' -Arguments @($RepositoryPath)
	$commit = $resolved.stdout.Trim()
	if ($commit -notmatch '^[0-9a-f]{40}$') { throw 'The deployable tag did not resolve to a full commit hash.' }
	return $commit
}

function Test-TideBotCandidateIsOnMain {
	param([string] $RepositoryPath, [string] $Commit)
	$result = & ${function:Invoke-TideBotCommand} 'git-test-ancestor-main' @($RepositoryPath, $Commit)
	return $result.exit_code -eq 0
}

function Enter-TideBotDeploymentLock {
	param([string] $Name = 'Global\TideBot-Upstream-Deploy')
	$mutex = [System.Threading.Mutex]::new($false, $Name)
	if (-not $mutex.WaitOne(0)) { $mutex.Dispose(); return $null }
	return $mutex
}

function Read-TideBotDeploymentState {
	param([string] $StatePath)
	if (-not (Test-Path -LiteralPath $StatePath)) { return $null }
	return Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
}

function Write-TideBotDeploymentState {
	param([string] $StatePath, [hashtable] $State)
	$directory = Split-Path -Parent $StatePath
	New-Item -ItemType Directory -Path $directory -Force | Out-Null
	$temporary = "$StatePath.$PID.tmp"
	$State | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
	Move-Item -LiteralPath $temporary -Destination $StatePath -Force
}

function New-TideBotBackupManifest {
	param([string] $ArchivePath, [string] $CandidateCommit, [string] $ImageId)
	return [ordered]@{ schema_version = 1; volume_name = 'tidebot-webui_tidebot-open-webui'; archive_file = [System.IO.Path]::GetFileName($ArchivePath); archive_sha256 = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash; candidate_commit = $CandidateCommit; image_id = $ImageId; created_at_utc = [datetime]::UtcNow.ToString('o') }
}

function Test-TideBotBackupManifest {
	param([hashtable] $Manifest, [string] $ArchivePath, [string] $ExpectedImageId)
	if ($Manifest.volume_name -ne 'tidebot-webui_tidebot-open-webui' -or $Manifest.archive_file -ne [System.IO.Path]::GetFileName($ArchivePath) -or $Manifest.image_id -ne $ExpectedImageId) { return $false }
	return (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash -eq $Manifest.archive_sha256
}

function New-TideBotRecoveryOverride {
	param([string] $StateRoot, [string] $ImageId)
	$path = Join-Path $StateRoot ('.tide-bot-recovery-' + [guid]::NewGuid().ToString('N') + '.yml')
	@("services:", "  tidebot-open-webui:", "    image: $ImageId") | Set-Content -LiteralPath $path -Encoding utf8NoBOM
	return $path
}

function Invoke-TideBotProductionUpdate {
	param(
		[string] $RepositoryPath,
		[string] $StateRoot,
		[string] $StatePath = (Join-Path $StateRoot 'deployment-state.json'),
		[string] $EnvironmentFile = 'C:\ProgramData\Tide-Bot\production.env',
		[string] $ComposeFile = (Join-Path $RepositoryPath 'deploy\tide-stack\docker-compose.live.yml'),
		[scriptblock] $CommandRunner = ${function:Invoke-TideBotCommand},
		[scriptblock] $HealthRunner,
		[switch] $SkipLock,
		[switch] $WhatIf
	)
	if ($WhatIf) { return @{ status = 'planned'; repository_path = $RepositoryPath; state_root = $StateRoot; operations = @('fetch tag', 'validate tag ancestry', 'backup named volume', 'build candidate', 'recreate service', 'health checks') } }
	$lock = $null
	if (-not $SkipLock) { $lock = Enter-TideBotDeploymentLock; if ($null -eq $lock) { return @{ status = 'already_running' } } }
	$replaced = $false; $recoveryOverride = $null
	try {
		Invoke-TideBotCheckedCommand $CommandRunner 'git-fetch-tag' @($RepositoryPath) | Out-Null
		$candidate = (Invoke-TideBotCheckedCommand $CommandRunner 'git-resolve-deployable' @($RepositoryPath)).stdout.Trim()
		if ($candidate -notmatch '^[0-9a-f]{40}$') { throw 'The deployable tag did not resolve to a full commit hash.' }
		Invoke-TideBotCheckedCommand $CommandRunner 'git-test-ancestor-main' @($RepositoryPath, $candidate) | Out-Null
		$priorState = Read-TideBotDeploymentState $StatePath
		if ($priorState -and $priorState.commit -eq $candidate) { return @{ status = 'already_deployed'; commit = $candidate } }
		$priorImage = (Invoke-TideBotCheckedCommand $CommandRunner 'docker-inspect-current-image' @()).stdout.Trim()
		Invoke-TideBotCheckedCommand $CommandRunner 'docker-inspect-current-labels' @() | Out-Null
		if ($priorState -and $priorState.image_id -ne $priorImage) { throw 'The recorded prior image does not match the running container.' }
		$backupDirectory = Join-Path $StateRoot 'backups'; New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
		$timestamp = [datetime]::UtcNow.ToString('yyyyMMddTHHmmssZ'); $archivePath = Join-Path $backupDirectory ("$timestamp-$($candidate.Substring(0, 12))-tidebot-data.tar.zst")
		Invoke-TideBotCheckedCommand $CommandRunner 'docker-archive-volume' @($archivePath, $backupDirectory) | Out-Null
		Invoke-TideBotCheckedCommand $CommandRunner 'docker-list-archive' @($archivePath, $backupDirectory) | Out-Null
		$manifest = New-TideBotBackupManifest $archivePath $candidate $priorImage; $manifestPath = "$archivePath.manifest.json"; $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
		$commitEnvironment = Join-Path $StateRoot ('.tide-bot-candidate-' + [guid]::NewGuid().ToString('N') + '.env'); "TIDE_BOT_COMMIT=$candidate" | Set-Content -LiteralPath $commitEnvironment -Encoding ascii
		try {
			$candidateImage = (Invoke-TideBotCheckedCommand $CommandRunner 'docker-build-candidate' @($RepositoryPath, $EnvironmentFile, $commitEnvironment, $ComposeFile)).stdout.Trim()
			if ($candidateImage -notmatch '^sha256:') { throw 'The candidate build did not report a Docker image ID.' }
			Invoke-TideBotCheckedCommand $CommandRunner 'docker-compose-up-candidate' @($RepositoryPath, $EnvironmentFile, $commitEnvironment, $ComposeFile) | Out-Null; $replaced = $true
		} finally { Remove-Item -LiteralPath $commitEnvironment -Force -ErrorAction SilentlyContinue }
		if (-not $HealthRunner) { $healthPath = Join-Path $PSScriptRoot 'tide-bot-production-health.ps1'; . $healthPath; $HealthRunner = { Invoke-TideBotProductionHealth } }
		$health = & $HealthRunner
		if (-not $health.healthy) { throw 'Candidate health checks failed.' }
		$state = [ordered]@{ schema_version = 1; commit = $candidate; upstream_sha = $candidate; image_id = $candidateImage; deployed_at_utc = [datetime]::UtcNow.ToString('o'); local_health = [bool]$health.local_health; public_health = [bool]$health.public_health; socketio_health = [bool]$health.socketio_health; oauth = $health.oauth }
		Invoke-TideBotCheckedCommand $CommandRunner 'write-state' @() | Out-Null; Write-TideBotDeploymentState $StatePath $state
		return @{ status = 'deployed'; commit = $candidate; oauth_warning = $health.oauth_warning }
	} catch {
		$failure = $_
		if (-not $replaced) { throw $failure }
		$failedName = "failed-deployment-$($candidate.Substring(0, 12)).json"; $failedPath = Join-Path $StateRoot $failedName
		$recoveryError = $null
		try {
			$valid = (Test-TideBotBackupManifest $manifest $archivePath $priorImage)
			if (-not $valid) { throw 'The backup manifest did not validate for recovery.' }
			Invoke-TideBotCheckedCommand $CommandRunner 'docker-compose-down' @($RepositoryPath, $EnvironmentFile, $ComposeFile) | Out-Null
			$archiveListing = (Invoke-TideBotCheckedCommand $CommandRunner 'docker-list-archive' @($archivePath, $backupDirectory)).stdout.Trim()
			if ($archiveListing.Length -eq 0) { throw 'The backup archive listing was empty.' }
			Invoke-TideBotCheckedCommand $CommandRunner 'docker-restore-volume' @($archivePath, $backupDirectory) | Out-Null
			$recoveryOverride = New-TideBotRecoveryOverride $StateRoot $priorImage
			Invoke-TideBotCheckedCommand $CommandRunner 'docker-compose-up-prior' @($RepositoryPath, $EnvironmentFile, $ComposeFile, $recoveryOverride) | Out-Null
			$rollbackHealth = & $HealthRunner
			if (-not $rollbackHealth.local_health) { throw 'Rollback local health check failed.' }
			& $CommandRunner 'write-failed-state' @(); @{ schema_version = 1; status = 'failed'; commit = $candidate; prior_image_id = $priorImage; data_written_after_backup_discarded = $true } | ConvertTo-Json | Set-Content -LiteralPath $failedPath -Encoding utf8NoBOM
		} catch {
			$recoveryError = $_
			& $CommandRunner 'write-failed-state' @(); @{ schema_version = 1; status = 'rollback_failed'; commit = $candidate; data_written_after_backup_discarded = $true } | ConvertTo-Json | Set-Content -LiteralPath $failedPath -Encoding utf8NoBOM
			throw
		} finally { if ($recoveryOverride) { Remove-Item -LiteralPath $recoveryOverride -Force -ErrorAction SilentlyContinue } }
		if ($recoveryError) { throw $recoveryError }
		throw $failure
	} finally { if ($lock) { $lock.ReleaseMutex(); $lock.Dispose() } }
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-TideBotProductionUpdate -RepositoryPath $RepositoryPath -StateRoot $StateRoot -StatePath $StatePath -EnvironmentFile $EnvironmentFile -ComposeFile $ComposeFile -WhatIf:$WhatIf | ConvertTo-Json -Compress }
