$ErrorActionPreference = 'Stop'

$bootstrapPath = Join-Path $PSScriptRoot 'bootstrap-tide-bot-production-checkout.ps1'
. $bootstrapPath

function Assert-True {
	param([bool] $Condition, [string] $Message)
	if (-not $Condition) { throw $Message }
}

function Assert-Trace {
	param([Collections.Generic.List[string]] $Actual, [string[]] $Expected, [string] $Message)
	Assert-True (($Actual -join '|') -eq ($Expected -join '|')) "$Message Actual: $($Actual -join '|')"
}

function New-CheckoutFixture {
	$root = Join-Path ([IO.Path]::GetTempPath()) ("tide-bot-checkout-$PID-" + [guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Path $root -Force | Out-Null
	return @{ root = $root; repository = Join-Path $root 'repo'; commit = ('a' * 40); exists = $false; trace = [Collections.Generic.List[string]]::new(); calls = [Collections.Generic.List[object]]::new() }
}

function New-FakeGitRunner {
	param([hashtable] $Fixture, [hashtable] $Failures = @{}, [string] $Origin = 'https://github.com/kolbick/Tide-Bot.git')
	$runner = {
		param([string] $Operation, [string[]] $Arguments)
		$Fixture.trace.Add($Operation)
		$Fixture.calls.Add(@{ operation = $Operation; arguments = @($Arguments) })
		if ($Failures.ContainsKey($Operation)) { return @{ exit_code = 1; stdout = ''; stderr = 'synthetic failure' } }
		switch ($Operation) {
			'git-clone' { $Fixture.exists = $true; return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-status-clean' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-get-origin' { return @{ exit_code = 0; stdout = "$Origin`n"; stderr = '' } }
			'git-fetch-tags' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-configure-upstream' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-get-upstream' { return @{ exit_code = 0; stdout = "https://github.com/open-webui/open-webui.git`n"; stderr = '' } }
			'git-fetch-commit' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-verify-commit' { return @{ exit_code = 0; stdout = "$($Fixture.commit)`n"; stderr = '' } }
			'git-switch-detach' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			'git-head' { return @{ exit_code = 0; stdout = "$($Fixture.commit)`n"; stderr = '' } }
			default { throw "Unexpected git operation: $Operation" }
		}
	}
	return $runner.GetNewClosure()
}

function New-FakeFileSystemRunner {
	param([hashtable] $Fixture)
	$runner = {
		param([string] $Operation, [string[]] $Arguments)
		$Fixture.calls.Add(@{ operation = "fs-$Operation"; arguments = @($Arguments) })
		switch ($Operation) {
			'test-directory' { return @{ exit_code = 0; stdout = [string]$Fixture.exists; stderr = '' } }
			'create-parent-directory' { return @{ exit_code = 0; stdout = ''; stderr = '' } }
			default { throw "Unexpected filesystem operation: $Operation" }
		}
	}
	return $runner.GetNewClosure()
}

try {
	$fixture = New-CheckoutFixture
	$result = Invoke-TideBotProductionCheckoutBootstrap -RepositoryPath $fixture.repository -ProductionRoot $fixture.root -Commit $fixture.commit -Synthetic -GitRunner (New-FakeGitRunner $fixture) -FileSystemRunner (New-FakeFileSystemRunner $fixture)
	Assert-True ($result.commit -eq $fixture.commit) 'Bootstrap did not return the immutable requested commit.'
	Assert-Trace $fixture.trace @('git-clone', 'git-get-origin', 'git-fetch-tags', 'git-configure-upstream', 'git-get-upstream', 'git-fetch-commit', 'git-verify-commit', 'git-switch-detach', 'git-head') 'Bootstrap Git ordering was incorrect.'
	$clone = @($fixture.calls | Where-Object operation -eq 'git-clone')[0]
	Assert-True (($clone.arguments -join '|') -eq "--origin|origin|https://github.com/kolbick/Tide-Bot.git|$($fixture.repository)") 'Bootstrap clone did not use the exact controlled origin and origin name.'
	$upstream = @($fixture.calls | Where-Object operation -eq 'git-configure-upstream')[0]
	Assert-True ($upstream.arguments[-1] -eq 'https://github.com/open-webui/open-webui.git') 'Bootstrap did not configure the exact upstream remote.'
	Assert-True ((@(Get-ChildItem -LiteralPath $fixture.root -Recurse -File -ErrorAction Stop).Count) -eq 0) 'Bootstrap wrote a secret-bearing filesystem artifact.'

	$dirty = New-CheckoutFixture
	$dirty.exists = $true
	$dirtyResult = $null
	try { $dirtyResult = Invoke-TideBotProductionCheckoutBootstrap -RepositoryPath $dirty.repository -ProductionRoot $dirty.root -Commit $dirty.commit -Synthetic -GitRunner (New-FakeGitRunner $dirty @{ 'git-status-clean' = $true }) -FileSystemRunner (New-FakeFileSystemRunner $dirty) } catch { $dirtyResult = $_ }
	Assert-True ($dirtyResult -is [System.Management.Automation.ErrorRecord]) 'Bootstrap accepted a dirty controlled checkout.'
	Assert-Trace $dirty.trace @('git-status-clean') 'Dirty checkout performed a later Git operation.'

	$wrongOrigin = New-CheckoutFixture
	$wrongOrigin.exists = $true
	$wrongOriginResult = $null
	try { $wrongOriginResult = Invoke-TideBotProductionCheckoutBootstrap -RepositoryPath $wrongOrigin.repository -ProductionRoot $wrongOrigin.root -Commit $wrongOrigin.commit -Synthetic -GitRunner (New-FakeGitRunner $wrongOrigin @{} 'https://github.com/attacker/Tide-Bot.git') -FileSystemRunner (New-FakeFileSystemRunner $wrongOrigin) } catch { $wrongOriginResult = $_ }
	Assert-True ($wrongOriginResult -is [System.Management.Automation.ErrorRecord]) 'Bootstrap accepted a checkout with the wrong origin.'
	Assert-Trace $wrongOrigin.trace @('git-status-clean', 'git-get-origin') 'Wrong origin performed a later Git operation.'

	$userPathRejected = $false
	try { Invoke-TideBotProductionCheckoutBootstrap -RepositoryPath 'C:\Users\developer\worktree\repo' -ProductionRoot $fixture.root -Commit $fixture.commit -Synthetic -GitRunner (New-FakeGitRunner $fixture) -FileSystemRunner (New-FakeFileSystemRunner $fixture) | Out-Null } catch { $userPathRejected = $true }
	Assert-True $userPathRejected 'Bootstrap accepted a checkout outside its protected production root.'

	$whatIfFixture = New-CheckoutFixture
	$whatIfResult = Invoke-TideBotProductionCheckoutBootstrap -RepositoryPath $whatIfFixture.repository -ProductionRoot $whatIfFixture.root -Commit $whatIfFixture.commit -Synthetic -GitRunner { throw 'WhatIf called Git.' } -FileSystemRunner { throw 'WhatIf called the filesystem.' } -WhatIf
	Assert-True ($whatIfResult.status -eq 'planned') 'Bootstrap WhatIf did not return a plan.'
	Write-Output 'PASS: Tide-Bot controlled checkout bootstrap safeguards'
} finally {
	Get-ChildItem -Path ([IO.Path]::GetTempPath()) -Filter "tide-bot-checkout-$PID-*" -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
}
