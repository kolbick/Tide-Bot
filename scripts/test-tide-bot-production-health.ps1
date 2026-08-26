$ErrorActionPreference = 'Stop'

$healthPath = Join-Path $PSScriptRoot 'tide-bot-production-health.ps1'
. $healthPath

function Assert-True {
	param([bool] $Condition, [string] $Message)
	if (-not $Condition) { throw $Message }
}

function New-FakeHealthRunner {
	param([hashtable] $Responses, [System.Collections.Generic.List[string]] $Trace)
	return {
		param([string] $Operation, [string[]] $Arguments)
		$Trace.Add($Operation)
		if (-not $Responses.ContainsKey($Operation)) { throw "Unexpected operation: $Operation" }
		return $Responses[$Operation]
	}.GetNewClosure()
}

function Invoke-HealthFixture {
	param([hashtable] $Responses, [string[]] $ExpectedTrace, [int] $ExpectedExitCode, [string] $Name)
	$trace = [System.Collections.Generic.List[string]]::new()
	$result = Invoke-TideBotProductionHealth -CommandRunner (New-FakeHealthRunner -Responses $Responses -Trace $trace)
	Assert-True ($result.exit_code -eq $ExpectedExitCode) "$Name returned an unexpected exit code."
	Assert-True ((@($trace) -join '|') -eq ($ExpectedTrace -join '|')) "$Name ran commands out of order."
	return $result
}

$connected = '{"connection_present":true,"credential_decryptable":true,"credential_state":"connected","model_catalog_available":true,"model_count":4}'
$reconnect = '{"connection_present":true,"credential_decryptable":true,"credential_state":"reconnect_required","model_catalog_available":false,"model_count":0}'
$healthSource = Get-Content -LiteralPath $healthPath -Raw
Assert-True ($healthSource -match "@\('exec', 'tide-bot', 'python'") 'OAuth health does not target the active Tide-Bot container.'
Assert-True ($healthSource -notmatch 'tidebot-open-webui|3001') 'Health operations still reference the legacy unrouted stack.'
Assert-True ($healthSource -match "socketio_path='ws/socket.io'.+transports=\['websocket'\]") 'Socket.IO health does not exercise the public WebSocket transport.'
Assert-True ($healthSource -notmatch 'transport=polling') 'Socket.IO health still probes the disabled polling transport.'

$healthy = @{
	'local-health' = @{ exit_code = 0; stdout = '{"status":true}'; stderr = '' }
	'public-health' = @{ exit_code = 0; stdout = 'OK'; stderr = '' }
	'socketio-health' = @{ exit_code = 0; stdout = "connected`n"; stderr = '' }
	'oauth-health' = @{ exit_code = 0; stdout = $connected + "`n"; stderr = 'private diagnostic' }
}

$result = Invoke-HealthFixture -Responses $healthy -ExpectedTrace @('local-health', 'public-health', 'socketio-health', 'oauth-health') -ExpectedExitCode 0 -Name 'healthy fixture'
Assert-True $result.oauth_healthy 'Healthy OAuth probe was not recorded as healthy.'
Assert-True (-not ($result | ConvertTo-Json -Compress).Contains('private diagnostic')) 'Health output included command stderr.'

$reconnectResponses = @{} + $healthy
$reconnectResponses['oauth-health'] = @{ exit_code = 20; stdout = $reconnect + "`n"; stderr = 'private diagnostic' }
$reconnectResult = Invoke-HealthFixture -Responses $reconnectResponses -ExpectedTrace @('local-health', 'public-health', 'socketio-health', 'oauth-health') -ExpectedExitCode 0 -Name 'OAuth reconnect fixture'
Assert-True (-not $reconnectResult.oauth_healthy) 'Reconnect-required OAuth state was not marked unhealthy.'
Assert-True ($reconnectResult.oauth_warning -eq 'reconnect_required') 'Reconnect-required OAuth state was not recorded as a warning.'

foreach ($failure in @('local-health', 'public-health', 'socketio-health')) {
	$responses = @{} + $healthy
	$responses[$failure] = @{ exit_code = 1; stdout = ''; stderr = 'private diagnostic' }
	$expected = switch ($failure) {
		'local-health' { @('local-health') }
		'public-health' { @('local-health', 'public-health') }
		default { @('local-health', 'public-health', 'socketio-health') }
	}
	$failureResult = Invoke-HealthFixture -Responses $responses -ExpectedTrace $expected -ExpectedExitCode 1 -Name "$failure failure fixture"
	Assert-True (-not $failureResult.healthy) "$failure failure was reported as healthy."
}

Write-Output 'PASS: Tide-Bot production health safeguards'
