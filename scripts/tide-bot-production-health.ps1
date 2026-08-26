[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Invoke-TideBotHealthProcess {
	param([string] $FilePath, [string[]] $Arguments)
	$start = [System.Diagnostics.ProcessStartInfo]::new()
	$start.FileName = $FilePath
	$start.UseShellExecute = $false
	$start.RedirectStandardOutput = $true
	$start.RedirectStandardError = $true
	foreach ($argument in $Arguments) { $null = $start.ArgumentList.Add($argument) }
	$process = [System.Diagnostics.Process]::new()
	$process.StartInfo = $start
	$null = $process.Start()
	$stdout = $process.StandardOutput.ReadToEnd()
	$stderr = $process.StandardError.ReadToEnd()
	$process.WaitForExit()
	return @{ exit_code = $process.ExitCode; stdout = $stdout; stderr = $stderr }
}

function Invoke-TideBotHealthCommand {
	param([string] $Operation, [string[]] $Arguments)
	switch ($Operation) {
		'local-health' {
			try { return @{ exit_code = 0; stdout = ((Invoke-RestMethod 'http://127.0.0.1:3102/health' -TimeoutSec 20 -ErrorAction Stop) | ConvertTo-Json -Compress); stderr = '' } } catch { return @{ exit_code = 1; stdout = ''; stderr = $_.Exception.Message } }
		}
		'public-health' {
			try { $response = Invoke-WebRequest 'https://tide-bot.com/health' -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop; return @{ exit_code = 0; stdout = $response.Content; stderr = '' } } catch { return @{ exit_code = 1; stdout = ''; stderr = $_.Exception.Message } }
		}
		'socketio-health' {
			$code = "import socketio; c=socketio.Client(); c.connect('https://tide-bot.com', socketio_path='ws/socket.io', transports=['websocket'], wait_timeout=15); print('connected' if c.connected else 'disconnected'); c.disconnect()"
			return Invoke-TideBotHealthProcess -FilePath 'docker' -Arguments @('exec', 'tide-bot', 'python', '-c', $code)
		}
		'oauth-health' { return Invoke-TideBotHealthProcess -FilePath 'docker' -Arguments @('exec', 'tide-bot', 'python', '-m', 'open_webui.cli.verify_chatgpt_subscription') }
		default { throw "Unknown health operation '$Operation'." }
	}
}

function Get-TideBotOAuthResult {
	param([hashtable] $CommandResult)
	$lines = @($CommandResult.stdout -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
	if ($lines.Count -ne 1) { throw 'The OAuth health command did not produce exactly one JSON line.' }
	try { $oauth = $lines[0] | ConvertFrom-Json -AsHashtable -ErrorAction Stop } catch { throw 'The OAuth health command did not produce valid JSON.' }
	$allowed = @('connection_present', 'credential_decryptable', 'credential_state', 'model_catalog_available', 'model_count')
	if ($oauth.Keys.Count -ne $allowed.Count -or @($oauth.Keys | Where-Object { $_ -notin $allowed }).Count -ne 0) { throw 'The OAuth health command produced unexpected fields.' }
	return $oauth
}

function Invoke-TideBotProductionHealth {
	param([scriptblock] $CommandRunner = ${function:Invoke-TideBotHealthCommand})
	$local = & $CommandRunner 'local-health' @()
	if ($local.exit_code -ne 0) { return @{ healthy = $false; exit_code = 1; local_health = $false; public_health = $false; socketio_health = $false; oauth_healthy = $false; oauth_warning = $null; oauth = $null } }
	try { $localPayload = $local.stdout | ConvertFrom-Json -AsHashtable -ErrorAction Stop } catch { return @{ healthy = $false; exit_code = 1; local_health = $false; public_health = $false; socketio_health = $false; oauth_healthy = $false; oauth_warning = $null; oauth = $null } }
	if ($localPayload.status -ne $true) { return @{ healthy = $false; exit_code = 1; local_health = $false; public_health = $false; socketio_health = $false; oauth_healthy = $false; oauth_warning = $null; oauth = $null } }

	$public = & $CommandRunner 'public-health' @()
	if ($public.exit_code -ne 0) { return @{ healthy = $false; exit_code = 1; local_health = $true; public_health = $false; socketio_health = $false; oauth_healthy = $false; oauth_warning = $null; oauth = $null } }
	$socket = & $CommandRunner 'socketio-health' @()
	if ($socket.exit_code -ne 0 -or $socket.stdout.Trim() -ne 'connected') { return @{ healthy = $false; exit_code = 1; local_health = $true; public_health = $true; socketio_health = $false; oauth_healthy = $false; oauth_warning = $null; oauth = $null } }

	$oauthCommand = & $CommandRunner 'oauth-health' @()
	try { $oauth = Get-TideBotOAuthResult -CommandResult $oauthCommand } catch { return @{ healthy = $false; exit_code = 1; local_health = $true; public_health = $true; socketio_health = $true; oauth_healthy = $false; oauth_warning = $null; oauth = $null } }
	if ($oauthCommand.exit_code -eq 20 -and $oauth.credential_state -eq 'reconnect_required') {
		return @{ healthy = $true; exit_code = 0; local_health = $true; public_health = $true; socketio_health = $true; oauth_healthy = $false; oauth_warning = 'reconnect_required'; oauth = $oauth }
	}
	if ($oauthCommand.exit_code -ne 0 -or $oauth.credential_state -ne 'connected') { return @{ healthy = $false; exit_code = 1; local_health = $true; public_health = $true; socketio_health = $true; oauth_healthy = $false; oauth_warning = $null; oauth = $oauth } }
	return @{ healthy = $true; exit_code = 0; local_health = $true; public_health = $true; socketio_health = $true; oauth_healthy = $true; oauth_warning = $null; oauth = $oauth }
}

if ($MyInvocation.InvocationName -ne '.') {
	$result = Invoke-TideBotProductionHealth
	$result | ConvertTo-Json -Compress
	exit $result.exit_code
}
