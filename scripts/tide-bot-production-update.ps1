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
	$start = [Diagnostics.ProcessStartInfo]::new(); $start.FileName = $FilePath; $start.UseShellExecute = $false; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
	foreach ($argument in $Arguments) { $null = $start.ArgumentList.Add($argument) }
	$process = [Diagnostics.Process]::new(); $process.StartInfo = $start; $null = $process.Start()
	$stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd(); $process.WaitForExit()
	return @{ exit_code = $process.ExitCode; stdout = $stdout; stderr = $stderr }
}

function Invoke-TideBotCommand {
	param([string] $Operation, [string[]] $Arguments)
	switch ($Operation) {
		'git-fetch-tag' { return Invoke-TideBotProcess git @('-C', $Arguments[0], 'fetch', '--quiet', 'origin', 'tide-bot-deployable') }
		'git-resolve-deployable' { return Invoke-TideBotProcess git @('-C', $Arguments[0], 'rev-parse', 'origin/tide-bot-deployable^{commit}') }
		'git-test-ancestor-main' { return Invoke-TideBotProcess git @('-C', $Arguments[0], 'merge-base', '--is-ancestor', $Arguments[1], 'origin/main') }
		'git-status-clean' { $status = Invoke-TideBotProcess git @('-C', $Arguments[0], 'status', '--porcelain=v1', '--untracked-files=all'); if ($status.exit_code -eq 0 -and $status.stdout.Trim().Length -ne 0) { $status.exit_code = 1 }; return $status }
		'git-switch-detach' { return Invoke-TideBotProcess git @('-C', $Arguments[0], 'switch', '--detach', $Arguments[1]) }
		'git-head' { return Invoke-TideBotProcess git @('-C', $Arguments[0], 'rev-parse', 'HEAD') }
		'docker-inspect-current-image' { return Invoke-TideBotProcess docker @('inspect', '--format', '{{.Image}}', 'tidebot-open-webui') }
		'docker-inspect-current-labels' { return Invoke-TideBotProcess docker @('inspect', '--format', '{{json .Config.Labels}}', 'tidebot-open-webui') }
		'docker-archive-volume' { return Invoke-TideBotProcess docker @('run', '--rm', '--mount', 'type=volume,src=tidebot-webui_tidebot-open-webui,dst=/data,readonly', '--mount', "type=bind,src=$($Arguments[1]),dst=/backup", 'alpine:3.20', 'sh', '-ceu', "apk add --no-cache zstd >/dev/null; tar --zstd -C /data -cf /backup/$([IO.Path]::GetFileName($Arguments[0])) .") }
		'docker-list-archive' { return Invoke-TideBotProcess docker @('run', '--rm', '--mount', "type=bind,src=$($Arguments[1]),dst=/backup,readonly", 'alpine:3.20', 'sh', '-ceu', "apk add --no-cache zstd >/dev/null; tar --zstd -tf /backup/$([IO.Path]::GetFileName($Arguments[0]))") }
		'docker-build-candidate' { return Invoke-TideBotProcess docker @('compose', '--project-directory', $Arguments[0], '--env-file', $Arguments[1], '--env-file', $Arguments[2], '-f', $Arguments[3], 'build', '--quiet') }
		'docker-inspect-candidate-image' { return Invoke-TideBotProcess docker @('image', 'inspect', '--format', '{{.Id}}', "tidebot-open-webui:$($Arguments[0])") }
		'docker-compose-up-candidate' { return Invoke-TideBotProcess docker @('compose', '--project-directory', $Arguments[0], '--env-file', $Arguments[1], '--env-file', $Arguments[2], '-f', $Arguments[3], 'up', '--detach', '--force-recreate', '--no-build') }
		'docker-compose-down' { return Invoke-TideBotProcess docker @('compose', '--project-directory', $Arguments[0], '--env-file', $Arguments[1], '--env-file', $Arguments[2], '-f', $Arguments[3], 'down') }
		'docker-restore-volume' { return Invoke-TideBotProcess docker @('run', '--rm', '--mount', 'type=volume,src=tidebot-webui_tidebot-open-webui,dst=/data', '--mount', "type=bind,src=$($Arguments[1]),dst=/backup,readonly", 'alpine:3.20', 'sh', '-ceu', "apk add --no-cache zstd >/dev/null; rm -rf /data/* /data/.[!.]* /data/..?*; tar --zstd -C /data -xf /backup/$([IO.Path]::GetFileName($Arguments[0]))") }
		'docker-compose-up-prior' { return Invoke-TideBotProcess docker @('compose', '--project-directory', $Arguments[0], '--env-file', $Arguments[1], '--env-file', $Arguments[2], '-f', $Arguments[3], '-f', $Arguments[4], 'up', '--detach', '--force-recreate', '--no-build') }
		default { throw "Unknown Tide-Bot command '$Operation'." }
	}
}

function Invoke-TideBotCheckedCommand { param([scriptblock] $CommandRunner, [string] $Operation, [string[]] $Arguments); $result = & $CommandRunner $Operation $Arguments; if ($result.exit_code -ne 0) { throw "Tide-Bot operation '$Operation' failed." }; return $result }
function Enter-TideBotDeploymentLock { param([string] $Name = 'Global\TideBot-Upstream-Deploy'); $mutex = [Threading.Mutex]::new($false, $Name); if (-not $mutex.WaitOne(0)) { $mutex.Dispose(); return $null }; return $mutex }

function Get-TideBotDeployableCommit {
	param([string] $RepositoryPath)
	Invoke-TideBotCheckedCommand ${function:Invoke-TideBotCommand} 'git-fetch-tag' @($RepositoryPath) | Out-Null
	$commit = (Invoke-TideBotCheckedCommand ${function:Invoke-TideBotCommand} 'git-resolve-deployable' @($RepositoryPath)).stdout.Trim()
	if ($commit -notmatch '^[0-9a-f]{40}$') { throw 'The deployable tag did not resolve to a full commit hash.' }; return $commit
}
function Test-TideBotCandidateIsOnMain { param([string] $RepositoryPath, [string] $Commit); return ((& ${function:Invoke-TideBotCommand} 'git-test-ancestor-main' @($RepositoryPath, $Commit)).exit_code -eq 0) }

function Read-TideBotDeploymentState { param([string] $StatePath); if (-not (Test-Path -LiteralPath $StatePath)) { return $null }; return Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop }
function Test-TideBotSuccessfulState {
	param([hashtable] $State)
	$required = @('schema_version', 'commit', 'upstream_sha', 'image_id', 'deployed_at_utc', 'local_health', 'public_health', 'socketio_health', 'oauth')
	$oauthRequired = @('connection_present', 'credential_decryptable', 'credential_state', 'model_catalog_available', 'model_count')
	return $State -and $State.Keys.Count -eq $required.Count -and @($State.Keys | Where-Object { $_ -notin $required }).Count -eq 0 -and $State.schema_version -eq 1 -and $State.commit -match '^[0-9a-f]{40}$' -and $State.upstream_sha -match '^[0-9a-f]{40}$' -and $State.image_id -match '^sha256:' -and $State.oauth -and $State.oauth.Keys.Count -eq $oauthRequired.Count -and @($State.oauth.Keys | Where-Object { $_ -notin $oauthRequired }).Count -eq 0
}
function Write-TideBotDeploymentState {
	param([string] $StatePath, [hashtable] $State)
	if (-not (Test-TideBotSuccessfulState $State)) { throw 'Refusing to persist an invalid successful deployment state.' }
	$directory = Split-Path -Parent $StatePath; New-Item -ItemType Directory -Path $directory -Force | Out-Null
	$temporary = "$StatePath.$PID.tmp"; $State | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporary -Encoding utf8NoBOM; Move-Item -LiteralPath $temporary -Destination $StatePath -Force
}
function Write-TideBotFailureRecord {
	param([string] $StateRoot, [hashtable] $Record)
	if ($Record.schema_version -ne 1 -or $Record.status -notin @('failed', 'rollback_failed') -or -not $Record.failed_at_utc) { throw 'Refusing to persist an invalid failed deployment record.' }
	$timestamp = ([datetime]::Parse($Record.failed_at_utc)).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
	$path = Join-Path $StateRoot ("failed-deployment-$timestamp-$($Record.commit.Substring(0, 12)).json")
	$Record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding utf8NoBOM; return $path
}
function New-TideBotBackupManifest {
	param([string] $ArchivePath, [string] $CandidateCommit, [string] $ImageId)
	return [ordered]@{ schema_version = 1; volume_name = 'tidebot-webui_tidebot-open-webui'; archive_file = [IO.Path]::GetFileName($ArchivePath); archive_sha256 = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash; candidate_commit = $CandidateCommit; image_id = $ImageId; created_at_utc = [datetime]::UtcNow.ToString('o') }
}
function Test-TideBotBackupManifest { param([hashtable] $Manifest, [string] $ArchivePath, [string] $ExpectedImageId); return $Manifest -and $Manifest.volume_name -eq 'tidebot-webui_tidebot-open-webui' -and $Manifest.image_id -eq $ExpectedImageId -and $Manifest.archive_file -eq [IO.Path]::GetFileName($ArchivePath) -and (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash -eq $Manifest.archive_sha256 }
function New-TideBotCommitEnvironment { param([string] $StateRoot, [string] $Commit, [string] $Prefix); if ($Commit -notmatch '^[0-9a-f]{40}$') { throw 'A Compose interpolation commit must be a validated full commit hash.' }; $path = Join-Path $StateRoot (".$Prefix-" + [guid]::NewGuid().ToString('N') + '.env'); "TIDE_BOT_COMMIT=$Commit" | Set-Content -LiteralPath $path -Encoding ascii; return $path }
function New-TideBotRecoveryOverride { param([string] $StateRoot, [string] $ImageId); $path = Join-Path $StateRoot ('.tide-bot-recovery-' + [guid]::NewGuid().ToString('N') + '.yml'); @('services:', '  tidebot-open-webui:', "    image: $ImageId") | Set-Content -LiteralPath $path -Encoding utf8NoBOM; return $path }
function Read-TideBotPredecessorRecovery {
	param([string] $Path, [string] $ComposeFile, [string] $ExpectedImageId, [string] $ExpectedManifestPath, [string] $ArchivePath)
	if (-not (Test-Path -LiteralPath $Path)) { throw 'The predecessor recovery record is missing.' }
	$record = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
	$required = @('schema_version', 'image_id', 'prior_commit', 'compose_sha256', 'backup_manifest', 'created_at_utc')
	if ($record.Keys.Count -ne $required.Count -or @($record.Keys | Where-Object { $_ -notin $required }).Count -ne 0 -or $record.schema_version -ne 1 -or $record.image_id -ne $ExpectedImageId -or $record.prior_commit -notmatch '^[0-9a-f]{40}$' -or $record.compose_sha256 -ne (Get-FileHash -LiteralPath $ComposeFile -Algorithm SHA256).Hash -or [IO.Path]::GetFullPath($record.backup_manifest) -ne [IO.Path]::GetFullPath($ExpectedManifestPath)) { throw 'The predecessor recovery record is invalid.' }
	$manifest = Get-Content -LiteralPath $record.backup_manifest -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
	if (-not (Test-TideBotBackupManifest $manifest $ArchivePath $record.image_id)) { throw 'The predecessor recovery backup manifest is invalid.' }
	return $record
}

function Invoke-TideBotProductionUpdate {
	param([string] $RepositoryPath = 'C:\ProgramData\Tide-Bot\repo', [string] $StateRoot = 'C:\ProgramData\Tide-Bot', [string] $StatePath, [string] $EnvironmentFile = 'C:\ProgramData\Tide-Bot\production.env', [string] $ComposeFile, [scriptblock] $CommandRunner = ${function:Invoke-TideBotCommand}, [scriptblock] $HealthRunner, [scriptblock] $StateWriter = ${function:Write-TideBotDeploymentState}, [switch] $SkipLock, [switch] $Synthetic, [switch] $WhatIf)
	if ([string]::IsNullOrWhiteSpace($StatePath)) { $StatePath = Join-Path $StateRoot 'state\last-successful-deployment.json' }
	if ([string]::IsNullOrWhiteSpace($ComposeFile)) { $ComposeFile = Join-Path $RepositoryPath 'deploy\tide-stack\docker-compose.live.yml' }
	if ($WhatIf) { return @{ status = 'planned'; repository_path = $RepositoryPath; state_root = $StateRoot; state_path = $StatePath; compose_file = $ComposeFile; operations = @('fetch tag', 'validate tag ancestry', 'detach controlled checkout', 'backup named volume', 'build candidate', 'recreate service', 'health checks') } }
	$canonicalRoot = [IO.Path]::GetFullPath('C:\ProgramData\Tide-Bot').TrimEnd('\'); $resolvedRoot = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
	if (-not $Synthetic -and -not $resolvedRoot.Equals($canonicalRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Production state and backup root must be C:\ProgramData\Tide-Bot.' }
	$resolvedStatePath = [IO.Path]::GetFullPath($StatePath); if (-not $Synthetic -and -not $resolvedStatePath.StartsWith("$resolvedRoot\", [StringComparison]::OrdinalIgnoreCase)) { throw 'Production deployment state must remain under C:\ProgramData\Tide-Bot.' }
	$lock = $null; if (-not $SkipLock) { $lock = Enter-TideBotDeploymentLock; if ($null -eq $lock) { return @{ status = 'already_running' } } }
	$replacementAttempted = $false; $recoveryOverride = $null; $recoveryEnvironment = $null; $predecessorPath = $null
	try {
		Invoke-TideBotCheckedCommand $CommandRunner 'git-fetch-tag' @($RepositoryPath) | Out-Null
		$candidate = (Invoke-TideBotCheckedCommand $CommandRunner 'git-resolve-deployable' @($RepositoryPath)).stdout.Trim(); if ($candidate -notmatch '^[0-9a-f]{40}$') { throw 'The deployable tag did not resolve to a full commit hash.' }
		Invoke-TideBotCheckedCommand $CommandRunner 'git-test-ancestor-main' @($RepositoryPath, $candidate) | Out-Null
		Invoke-TideBotCheckedCommand $CommandRunner 'git-status-clean' @($RepositoryPath) | Out-Null
		Invoke-TideBotCheckedCommand $CommandRunner 'git-switch-detach' @($RepositoryPath, $candidate) | Out-Null
		if ((Invoke-TideBotCheckedCommand $CommandRunner 'git-head' @($RepositoryPath)).stdout.Trim() -ne $candidate) { throw 'Controlled checkout HEAD did not match the validated candidate.' }
		$priorState = Read-TideBotDeploymentState $StatePath
		if ($priorState -and -not (Test-TideBotSuccessfulState $priorState)) { throw 'The last successful deployment state is invalid.' }
		if ($priorState -and $priorState.commit -eq $candidate) { return @{ status = 'already_deployed'; commit = $candidate } }
		$priorImage = (Invoke-TideBotCheckedCommand $CommandRunner 'docker-inspect-current-image' @()).stdout.Trim(); if ($priorImage -notmatch '^sha256:') { throw 'Running container did not provide an immutable image ID.' }
		$labels = (Invoke-TideBotCheckedCommand $CommandRunner 'docker-inspect-current-labels' @()).stdout | ConvertFrom-Json -AsHashtable -ErrorAction Stop
		if ($labels.'com.docker.compose.project' -ne 'tidebot-webui') { throw 'Running container is not the Tide-Bot production service.' }
		if ($priorState -and $priorState.image_id -ne $priorImage) { throw 'The recorded prior image does not match the running container.' }
		$backupDirectory = Join-Path $StateRoot 'backups'; New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
		$archivePath = Join-Path $backupDirectory ("$([datetime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))-$($candidate.Substring(0, 12))-tidebot-data.tar.zst")
		Invoke-TideBotCheckedCommand $CommandRunner 'docker-archive-volume' @($archivePath, $backupDirectory) | Out-Null; Invoke-TideBotCheckedCommand $CommandRunner 'docker-list-archive' @($archivePath, $backupDirectory) | Out-Null
		$manifest = New-TideBotBackupManifest $archivePath $candidate $priorImage; $manifestPath = "$archivePath.manifest.json"; $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
		if ($priorState) { $predecessor = @{ image_id = $priorState.image_id; prior_commit = $priorState.commit; backup_manifest = $manifestPath } } else {
			$priorCommit = $labels.'org.opencontainers.image.revision'; if ($priorCommit -notmatch '^[0-9a-f]{40}$') { throw 'First migration requires a validated predecessor revision label.' }
			$predecessor = @{ schema_version = 1; image_id = $priorImage; prior_commit = $priorCommit; compose_sha256 = (Get-FileHash -LiteralPath $ComposeFile -Algorithm SHA256).Hash; backup_manifest = $manifestPath; created_at_utc = [datetime]::UtcNow.ToString('o') }; $predecessorPath = Join-Path $StateRoot 'predecessor-recovery.json'; $predecessor | ConvertTo-Json | Set-Content -LiteralPath $predecessorPath -Encoding utf8NoBOM
		}
		if ($predecessor.image_id -ne $priorImage -or $predecessor.prior_commit -notmatch '^[0-9a-f]{40}$') { throw 'No validated predecessor recovery record is available.' }
		$candidateEnvironment = New-TideBotCommitEnvironment $StateRoot $candidate 'tide-bot-candidate'
		try {
			Invoke-TideBotCheckedCommand $CommandRunner 'docker-build-candidate' @($RepositoryPath, $EnvironmentFile, $candidateEnvironment, $ComposeFile) | Out-Null
			$candidateImage = (Invoke-TideBotCheckedCommand $CommandRunner 'docker-inspect-candidate-image' @($candidate)).stdout.Trim(); if ($candidateImage -notmatch '^sha256:') { throw 'The candidate image inspection did not return an immutable image ID.' }
			$replacementAttempted = $true; Invoke-TideBotCheckedCommand $CommandRunner 'docker-compose-up-candidate' @($RepositoryPath, $EnvironmentFile, $candidateEnvironment, $ComposeFile) | Out-Null
		} finally { Remove-Item -LiteralPath $candidateEnvironment -Force -ErrorAction SilentlyContinue }
		if (-not $HealthRunner) { . (Join-Path $PSScriptRoot 'tide-bot-production-health.ps1'); $HealthRunner = { Invoke-TideBotProductionHealth } }
		$health = & $HealthRunner; if (-not $health.healthy) { throw 'Candidate health checks failed.' }
		& $StateWriter $StatePath ([ordered]@{ schema_version = 1; commit = $candidate; upstream_sha = $candidate; image_id = $candidateImage; deployed_at_utc = [datetime]::UtcNow.ToString('o'); local_health = [bool]$health.local_health; public_health = [bool]$health.public_health; socketio_health = [bool]$health.socketio_health; oauth = $health.oauth })
		return @{ status = 'deployed'; commit = $candidate; oauth_warning = $health.oauth_warning }
	} catch {
		$failure = $_; if (-not $replacementAttempted) { throw $failure }
		$recoveryFailure = $null
		try {
			if ($predecessorPath) { $predecessor = Read-TideBotPredecessorRecovery $predecessorPath $ComposeFile $priorImage $manifestPath $archivePath }
			if (-not (Test-TideBotBackupManifest $manifest $archivePath $predecessor.image_id) -or $predecessor.image_id -ne $priorImage) { throw 'The validated predecessor backup is unavailable for recovery.' }
			$recoveryEnvironment = New-TideBotCommitEnvironment $StateRoot $predecessor.prior_commit 'tide-bot-recovery'
			Invoke-TideBotCheckedCommand $CommandRunner 'docker-compose-down' @($RepositoryPath, $EnvironmentFile, $recoveryEnvironment, $ComposeFile) | Out-Null
			if ((Invoke-TideBotCheckedCommand $CommandRunner 'docker-list-archive' @($archivePath, $backupDirectory)).stdout.Trim().Length -eq 0) { throw 'The backup archive listing was empty.' }
			Invoke-TideBotCheckedCommand $CommandRunner 'docker-restore-volume' @($archivePath, $backupDirectory) | Out-Null
			$recoveryOverride = New-TideBotRecoveryOverride $StateRoot $predecessor.image_id
			Invoke-TideBotCheckedCommand $CommandRunner 'docker-compose-up-prior' @($RepositoryPath, $EnvironmentFile, $recoveryEnvironment, $ComposeFile, $recoveryOverride) | Out-Null
			$rollbackHealth = & $HealthRunner
			if (-not $rollbackHealth.local_health) { throw 'Rollback local health check failed.' }
			Write-TideBotFailureRecord $StateRoot @{ schema_version = 1; status = 'failed'; commit = $candidate; prior_image_id = $predecessor.image_id; data_written_after_backup_discarded = $true; failed_at_utc = [datetime]::UtcNow.ToString('o') } | Out-Null
		} catch {
			$recoveryFailure = $_
			Write-TideBotFailureRecord $StateRoot @{ schema_version = 1; status = 'rollback_failed'; commit = $candidate; data_written_after_backup_discarded = $true; failed_at_utc = [datetime]::UtcNow.ToString('o') } | Out-Null
		} finally { if ($recoveryEnvironment) { Remove-Item -LiteralPath $recoveryEnvironment -Force -ErrorAction SilentlyContinue }; if ($recoveryOverride) { Remove-Item -LiteralPath $recoveryOverride -Force -ErrorAction SilentlyContinue } }
		if ($recoveryFailure) { throw $recoveryFailure }
		throw $failure
	} finally { if ($lock) { $lock.ReleaseMutex(); $lock.Dispose() } }
}

if ($MyInvocation.InvocationName -ne '.') {
	$invoke = @{ RepositoryPath = $RepositoryPath; StateRoot = $StateRoot; EnvironmentFile = $EnvironmentFile; WhatIf = $WhatIf }
	if ($PSBoundParameters.ContainsKey('StatePath')) { $invoke.StatePath = $StatePath }; if ($PSBoundParameters.ContainsKey('ComposeFile')) { $invoke.ComposeFile = $ComposeFile }
	Invoke-TideBotProductionUpdate @invoke | ConvertTo-Json -Compress
}
