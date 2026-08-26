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
	Set-Content -LiteralPath $composePath -Value 'name: tide-bot' -Encoding utf8NoBOM
	New-Item -ItemType Directory -Path (Join-Path $root 'docs') -Force | Out-Null
	Set-Content -LiteralPath (Join-Path $root 'docs\UPSTREAM_MAIN_SHA') -Value ('3' * 40) -Encoding ascii
	return @{ root = $root; state_path = $statePath; compose_path = $composePath; commit = ('2' * 40); calls = [Collections.Generic.List[object]]::new() }
}

function New-FakeUpdateRunner {
	param([hashtable] $Fixture, [hashtable] $Failures, [Collections.Generic.List[string]] $Trace)
	$runner = {
		param([string] $Operation, [string[]] $Arguments)
		$Trace.Add($Operation); $entry = @{ operation = $Operation; arguments = @($Arguments) }
		if ($Operation -in @('docker-compose-up-candidate', 'docker-compose-up-prior', 'docker-compose-down', 'docker-compose-stop-current', 'docker-compose-start-current')) { $entry.environment_text = Get-Content -LiteralPath $Arguments[2] -Raw }
		$Fixture.calls.Add($entry)
		if ($Failures.ContainsKey($Operation)) { return @{ exit_code = 1; stdout = ''; stderr = 'secret stderr' } }
			switch ($Operation) {
			'git-fetch-tag' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-fetch-main' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-resolve-deployable' { return @{ exit_code = 0; stdout = "$($Fixture.commit)`n"; stderr = '' } }
			'git-test-ancestor-main' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-test-upstream-provenance' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-status-clean' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-switch-detach' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-head' { return @{ exit_code = 0; stdout = "$($Fixture.commit)`n"; stderr = '' } }
			'docker-inspect-current-image' { return @{ exit_code = 0; stdout = 'sha256:prior'; stderr = '' } }
			'docker-inspect-current-labels' { if ($Failures.ContainsKey('bad-predecessor-label')) { return @{ exit_code = 0; stdout = '{"com.docker.compose.project":"tide-bot"}'; stderr = '' } }; return @{ exit_code = 0; stdout = '{"com.docker.compose.project":"tide-bot","org.opencontainers.image.revision":"1111111111111111111111111111111111111111"}'; stderr = '' } }
			'docker-compose-stop-current' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'docker-compose-start-current' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
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
	param([hashtable] $Failures = @{}, [switch] $NoState, [scriptblock] $StateWriter, [scriptblock] $UpstreamProvenanceReader, [scriptblock] $DirectoryProtector)
	$fixture = New-UpdateFixture -NoState:$NoState; $trace = [Collections.Generic.List[string]]::new()
	try {
		$arguments = @{ RepositoryPath = $fixture.root; StateRoot = $fixture.root; StatePath = $fixture.state_path; ComposeFile = $fixture.compose_path; CommandRunner = (New-FakeUpdateRunner $fixture $Failures $trace); HealthRunner = (New-FakeHealthRunner $Failures $trace $fixture); Synthetic = $true; SkipLock = $true }
		if ($null -ne $StateWriter) { $arguments.StateWriter = $StateWriter }
		if ($null -ne $UpstreamProvenanceReader) { $arguments.UpstreamProvenanceReader = $UpstreamProvenanceReader }
		if ($null -ne $DirectoryProtector) { $arguments.DirectoryProtector = $DirectoryProtector }
		$result = Invoke-TideBotProductionUpdate @arguments
		return @{ result = $result; trace = @($trace); fixture = $fixture }
	} catch { return @{ error = $_; trace = @($trace); fixture = $fixture } }
}

try {
	$checkoutTrace = @('git-fetch-tag', 'git-fetch-main', 'git-resolve-deployable', 'git-test-ancestor-main', 'git-status-clean', 'git-switch-detach', 'git-head', 'git-test-upstream-provenance')
	$preparedTrace = @($checkoutTrace + @('docker-inspect-current-image', 'docker-inspect-current-labels', 'docker-build-candidate', 'docker-inspect-candidate-image'))
	$backupTrace = @($preparedTrace + @('docker-compose-stop-current', 'docker-archive-volume', 'docker-list-archive'))
	$success = Invoke-UpdateFixture
	Assert-True ($null -eq $success.error) "Successful deployment unexpectedly failed: $($success.error.Exception.Message)"
	Assert-Trace $success.trace @($backupTrace + @('docker-compose-up-candidate', 'health')) 'controlled successful deployment'
	Assert-True ((Read-TideBotDeploymentState $success.fixture.state_path).image_id -eq 'sha256:candidate') 'Successful state did not persist the candidate image.'
	Assert-True ((Read-TideBotDeploymentState $success.fixture.state_path).upstream_sha -eq ('3' * 40)) 'Successful state did not persist exact upstream provenance.'
	$gitSwitch = @($success.fixture.calls | Where-Object operation -eq 'git-switch-detach')[0]
	Assert-True ($gitSwitch.arguments[-1] -eq $success.fixture.commit) 'Candidate checkout was not detached to the validated commit.'
	$candidateUp = @($success.fixture.calls | Where-Object operation -eq 'docker-compose-up-candidate')[0]
	Assert-True ($candidateUp.environment_text.Trim() -eq "TIDE_BOT_COMMIT=$($success.fixture.commit)") 'Candidate Compose interpolation was not supplied.'
	Assert-True ($success.result.oauth_warning -eq 'reconnect_required') 'Safe OAuth reconnect warning was not retained on a healthy deployment.'
	$protectedDirectories = [Collections.Generic.List[string]]::new()
	$aclFixture = Invoke-UpdateFixture -DirectoryProtector { param([string] $Path) $protectedDirectories.Add([IO.Path]::GetFullPath($Path)) }
	Assert-True ($null -eq $aclFixture.error) 'Synthetic ACL-order fixture failed.'
	Assert-True ($protectedDirectories.Count -eq 2) 'Production root and backup root were not both protected.'
	Assert-True ($protectedDirectories[0] -eq [IO.Path]::GetFullPath($aclFixture.fixture.root)) 'Production root ACL was not established first.'
	Assert-True ($protectedDirectories[1] -eq [IO.Path]::GetFullPath((Join-Path $aclFixture.fixture.root 'backups'))) 'Backup ACL was not established before archive writing.'

	$alreadyFixture = New-UpdateFixture
	$alreadyFixture.commit = ('1' * 40)
	$alreadyTrace = [Collections.Generic.List[string]]::new()
	$alreadyResult = Invoke-TideBotProductionUpdate -RepositoryPath $alreadyFixture.root -StateRoot $alreadyFixture.root -StatePath $alreadyFixture.state_path -ComposeFile $alreadyFixture.compose_path -CommandRunner (New-FakeUpdateRunner $alreadyFixture @{} $alreadyTrace) -HealthRunner (New-FakeHealthRunner @{} $alreadyTrace $alreadyFixture) -Synthetic -SkipLock
	Assert-True ($alreadyResult.status -eq 'already_deployed') 'Recorded deployable tag was not a no-op.'
	Assert-Trace @($alreadyTrace) $checkoutTrace 'already deployed no-op'

	$notOnMain = Invoke-UpdateFixture -Failures @{ 'git-test-ancestor-main' = $true }
	Assert-True ($null -ne $notOnMain.error) 'Candidate outside origin/main was accepted.'
	Assert-Trace $notOnMain.trace @('git-fetch-tag', 'git-fetch-main', 'git-resolve-deployable', 'git-test-ancestor-main') 'non-ancestor rejection'

	$buildFailure = Invoke-UpdateFixture -Failures @{ 'docker-build-candidate' = $true }
	Assert-True ($null -ne $buildFailure.error) 'Candidate build failure was accepted.'
	Assert-Trace $buildFailure.trace @($checkoutTrace + @('docker-inspect-current-image', 'docker-inspect-current-labels', 'docker-build-candidate')) 'build failure without rollback'

	$dirty = Invoke-UpdateFixture -Failures @{ 'git-status-clean' = $true }
	Assert-True ($null -ne $dirty.error) 'Dirty controlled checkout was accepted.'
	Assert-Trace $dirty.trace @('git-fetch-tag', 'git-fetch-main', 'git-resolve-deployable', 'git-test-ancestor-main', 'git-status-clean') 'dirty checkout rejection'

	$setupFailureCases = [ordered]@{
		marker = 'git-fetch-tag'
		ref = 'git-resolve-deployable'
		ancestry = 'git-test-ancestor-main'
		checkout = 'git-status-clean'
		provenance = 'git-test-upstream-provenance'
		build = 'docker-build-candidate'
		backup = 'docker-archive-volume'
	}
	foreach ($case in $setupFailureCases.GetEnumerator()) {
		$failedSetup = Invoke-UpdateFixture -Failures @{ $case.Value = $true }
		Assert-True ($null -ne $failedSetup.error) "$($case.Key) setup failure was accepted."
		$recordPath = Get-ChildItem -LiteralPath $failedSetup.fixture.root -Filter 'failed-deployment-*.json' | Select-Object -First 1
		Assert-True ($null -ne $recordPath) "$($case.Key) setup failure did not write sanitized state."
		$record = Get-Content -LiteralPath $recordPath.FullName -Raw | ConvertFrom-Json
		Assert-True ($record.stage -eq $case.Key -and $record.status -in @('failed', 'rollback_failed')) "$($case.Key) setup failure state was not classified safely."
		Assert-True ((Get-Content -LiteralPath $recordPath.FullName -Raw) -notmatch 'secret stderr') "$($case.Key) setup failure leaked command stderr."
	}
	$missingProvenance = Invoke-UpdateFixture -UpstreamProvenanceReader { param($path) throw 'synthetic malformed provenance detail' }
	Assert-True ($null -ne $missingProvenance.error) 'Unavailable upstream provenance was accepted.'
	$missingProvenanceRecord = Get-ChildItem -LiteralPath $missingProvenance.fixture.root -Filter 'failed-deployment-*.json' | Select-Object -First 1
	Assert-True ((Get-Content -LiteralPath $missingProvenanceRecord.FullName -Raw | ConvertFrom-Json).stage -eq 'provenance') 'Unavailable provenance did not write sanitized failure state.'

	$partial = Invoke-UpdateFixture -Failures @{ 'docker-compose-up-candidate' = $true }
	Assert-True ($null -ne $partial.error) 'Partial candidate replacement failure was accepted.'
	Assert-Trace $partial.trace @($backupTrace + @('docker-compose-up-candidate', 'docker-compose-down', 'docker-list-archive', 'docker-restore-volume', 'docker-compose-up-prior', 'health')) 'partial replacement recovery'
	$recoveryDown = @($partial.fixture.calls | Where-Object operation -eq 'docker-compose-down')[0]
	Assert-True ($recoveryDown.environment_text.Trim() -eq ('TIDE_BOT_COMMIT=' + ('1' * 40))) 'Recovery Compose down did not receive the validated predecessor interpolation.'
	$priorUp = @($partial.fixture.calls | Where-Object operation -eq 'docker-compose-up-prior')[0]
	Assert-True ($priorUp.environment_text.Trim() -eq ('TIDE_BOT_COMMIT=' + ('1' * 40))) 'Recovery Compose interpolation was not supplied from the validated predecessor.'

	$postReplacementRecoveryTrace = @($backupTrace + @('docker-compose-up-candidate', 'health', 'docker-compose-down', 'docker-list-archive', 'docker-restore-volume', 'docker-compose-up-prior', 'health'))
	foreach ($healthFailure in @('local-health', 'public-health', 'socketio-health')) {
		$postHealthFailure = Invoke-UpdateFixture -Failures @{ $healthFailure = $true }
		Assert-True ($null -ne $postHealthFailure.error) "$healthFailure post-replacement failure was accepted."
		Assert-Trace $postHealthFailure.trace $postReplacementRecoveryTrace "$healthFailure post-replacement recovery"
	}

	$stateWriteFailure = Invoke-UpdateFixture -StateWriter { param($path, $state) throw 'synthetic state write failure' }
	Assert-True ($null -ne $stateWriteFailure.error) 'State write failure was accepted.'
	Assert-Trace $stateWriteFailure.trace $postReplacementRecoveryTrace 'state write failure full recovery'

	$rollbackFailure = Invoke-UpdateFixture -Failures @{ health = $true; 'docker-restore-volume' = $true }
	Assert-True ($null -ne $rollbackFailure.error) 'Rollback failure was accepted.'
	Assert-Trace $rollbackFailure.trace @($backupTrace + @('docker-compose-up-candidate', 'health', 'docker-compose-down', 'docker-list-archive', 'docker-restore-volume')) 'rollback failure stops before prior up'

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
	Assert-Trace $invalidPredecessor.trace @($backupTrace + @('docker-compose-start-current')) 'invalid predecessor rejection'

	$rootRefused = $false
	try { Invoke-TideBotProductionUpdate -RepositoryPath $success.fixture.root -StateRoot $success.fixture.root -StatePath $success.fixture.state_path -ComposeFile $success.fixture.compose_path -CommandRunner (New-FakeUpdateRunner $success.fixture @{} ([Collections.Generic.List[string]]::new())) -HealthRunner (New-FakeHealthRunner @{} ([Collections.Generic.List[string]]::new()) $success.fixture) -SkipLock | Out-Null } catch { $rootRefused = $true }
	Assert-True $rootRefused 'Non-canonical production StateRoot was accepted without synthetic mode.'

	$unsafeState = Read-TideBotDeploymentState $success.fixture.state_path
	$unsafeState.oauth = @{ unexpected = 'value' }
	$unsafeRejected = $false
	try { Write-TideBotDeploymentState (Join-Path $success.fixture.root 'unsafe-state.json') $unsafeState } catch { $unsafeRejected = $true }
	Assert-True $unsafeRejected 'State writer accepted OAuth fields outside the safe schema.'

	$gitContractRoot = Join-Path $success.fixture.root 'git-ref-contract'
	$remotePath = Join-Path $gitContractRoot 'origin.git'; $seedPath = Join-Path $gitContractRoot 'seed'; $controlledPath = Join-Path $gitContractRoot 'controlled'
	New-Item -ItemType Directory -Path $gitContractRoot -Force | Out-Null
	& git init --bare $remotePath | Out-Null
	& git init -b main $seedPath | Out-Null
	& git -C $seedPath config user.name fixture
	& git -C $seedPath config user.email fixture@example.invalid
	Set-Content -LiteralPath (Join-Path $seedPath 'fixture.txt') -Value first -Encoding ascii
	& git -C $seedPath add fixture.txt; & git -C $seedPath commit -m first | Out-Null
	$firstCommit = (& git -C $seedPath rev-parse HEAD).Trim()
	& git -C $seedPath remote add origin $remotePath; & git -C $seedPath push -u origin main | Out-Null
	& git clone --branch main $remotePath $controlledPath | Out-Null
	Set-Content -LiteralPath (Join-Path $seedPath 'fixture.txt') -Value second -Encoding ascii
	& git -C $seedPath commit -am second | Out-Null
	$secondCommit = (& git -C $seedPath rev-parse HEAD).Trim()
	& git -C $seedPath push origin main | Out-Null
	& git -C $seedPath tag -f tide-bot-deployable $secondCommit
	& git -C $seedPath push --force origin refs/tags/tide-bot-deployable | Out-Null
	& git -C $seedPath push origin "$firstCommit`:refs/heads/tide-bot-deployable" | Out-Null
	Assert-True ((& git -C $controlledPath rev-parse origin/main).Trim() -eq $firstCommit) 'Synthetic controlled checkout did not start with stale origin/main.'
	Assert-True ((Invoke-TideBotCommand 'git-fetch-tag' @($controlledPath)).exit_code -eq 0) 'Exact synthetic deployable tag fetch failed.'
	Assert-True ((Invoke-TideBotCommand 'git-fetch-main' @($controlledPath)).exit_code -eq 0) 'Synthetic origin/main refresh failed.'
	$resolvedTag = (Invoke-TideBotCommand 'git-resolve-deployable' @($controlledPath)).stdout.Trim()
	Assert-True ($resolvedTag -eq $secondCommit) 'Exact tag ref did not resolve the tagged commit.'
	Assert-True ((& git -C $controlledPath rev-parse origin/main).Trim() -eq $secondCommit) 'origin/main remained stale after the required refresh.'
	Assert-True ((Invoke-TideBotCommand 'git-test-ancestor-main' @($controlledPath, $resolvedTag)).exit_code -eq 0) 'Refreshed origin/main ancestry rejected the exact tag.'
	& git -C $controlledPath fetch origin refs/heads/tide-bot-deployable:refs/remotes/origin/tide-bot-deployable | Out-Null
	$rejectedRemoteBranchCommit = (& git -C $controlledPath rev-parse 'origin/tide-bot-deployable^{commit}').Trim()
	Assert-True ($rejectedRemoteBranchCommit -eq $firstCommit -and $rejectedRemoteBranchCommit -ne $resolvedTag) 'Synthetic remote-branch trap did not prove exact-tag resolution rejects the branch formulation.'

	$updaterSource = Get-Content -LiteralPath $updaterPath -Raw
	Assert-True ($updaterSource -match 'refs/tags/tide-bot-deployable:refs/tags/tide-bot-deployable') 'Production dispatcher does not fetch the exact deployable tag ref.'
	Assert-True ($updaterSource -match "rev-parse', 'refs/tags/tide-bot-deployable\^\{commit\}") 'Production dispatcher does not resolve the exact deployable tag ref.'
	Assert-True ($updaterSource -notmatch 'origin/tide-bot-deployable') 'Production dispatcher still accepts the rejected remote-branch formulation.'
	Assert-True ($updaterSource -match 'refs/heads/main:refs/remotes/origin/main') 'Production dispatcher does not refresh origin/main before ancestry validation.'
	Assert-True ($updaterSource -notmatch 'alpine:|apk add|--zstd') 'Production backup still relies on a mutable image, online package installation, or zstd helper tooling.'
	Assert-True ($updaterSource.IndexOf("'docker-compose-stop-current'") -lt $updaterSource.IndexOf("'docker-archive-volume'")) 'Production backup does not stop the SQLite writer before snapshotting.'
	Assert-True ($updaterSource -match 'upstream_sha = \$upstreamSha') 'Successful state does not use independently validated upstream provenance.'
	Assert-True ($updaterSource -match "@\('S-1-5-18', 'S-1-5-32-544'\)") 'Production directory ACL does not restrict access to SYSTEM and Administrators.'
	Assert-True ($updaterSource -match 'SetAccessRuleProtection\(\$true, \$false\)') 'Production directory ACL still inherits broader parent permissions.'
	Assert-True ($updaterSource -match "'tide-bot-data'") 'Production backup does not name the active Tide-Bot data volume.'
	Assert-True ($updaterSource -match '"tide-bot:\$\(\$Arguments\[0\]\)"') 'Candidate inspection does not target the immutable Tide-Bot image tag.'
	Assert-True ($updaterSource -notmatch 'tidebot-open-webui|tidebot-webui|tidebot-net|3001') 'Production updater still references the legacy unrouted stack.'

	$entryOutput = & $updaterPath -WhatIf 2>&1 | Out-String
	Assert-True ($entryOutput -match 'state\\\\last-successful-deployment.json') 'Normal script entry point did not preserve its StatePath default.'
	Assert-True ($entryOutput -match 'docker-compose.live.yml') 'Normal script entry point did not preserve its ComposeFile default.'

	Write-Output 'PASS: Tide-Bot production updater safeguards'
} finally {
	Get-ChildItem -Path ([IO.Path]::GetTempPath()) -Filter "tide-bot-production-update-$PID-*" -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
}
