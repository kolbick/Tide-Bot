[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
	[Parameter(Mandatory)]
	[ValidateNotNullOrEmpty()]
	[string] $SourceEnvFile,

	[string] $DestinationPath = 'C:\ProgramData\Tide-Bot\production.env'
)

$ErrorActionPreference = 'Stop'

function Get-EnvironmentVariableNames {
	param([string] $Path)

	$names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
	foreach ($line in (Get-Content -LiteralPath $Path -ErrorAction Stop)) {
		$trimmed = $line.Trim()
		if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) {
			continue
		}

		if ($trimmed -notmatch '^(?<name>[A-Za-z_][A-Za-z0-9_]*)=') {
			throw 'The source environment file contains an invalid variable declaration.'
		}

		$null = $names.Add($Matches.name)
	}

	return $names
}

function Test-PathIsWithin {
	param(
		[string] $Path,
		[string] $ParentPath
	)

	$normalizedPath = [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
	$normalizedParent = [System.IO.Path]::GetFullPath($ParentPath).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
	$parentPrefix = "$normalizedParent$([System.IO.Path]::DirectorySeparatorChar)"

	return $normalizedPath.Equals($normalizedParent, [System.StringComparison]::OrdinalIgnoreCase) -or
		$normalizedPath.StartsWith($parentPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Set-ProductionEnvironmentAcl {
	param([string] $Path)

	$administrators = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
	$scheduledTaskIdentity = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
	$readRights = [System.Security.AccessControl.FileSystemRights]::Read
	$allow = [System.Security.AccessControl.AccessControlType]::Allow
	$inheritance = [System.Security.AccessControl.InheritanceFlags]::None
	$propagation = [System.Security.AccessControl.PropagationFlags]::None
	$acl = [System.Security.AccessControl.FileSecurity]::new()

	$acl.SetAccessRuleProtection($true, $false)
	$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($administrators, $readRights, $inheritance, $propagation, $allow))
	$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($scheduledTaskIdentity, $readRights, $inheritance, $propagation, $allow))
	Set-Acl -LiteralPath $Path -AclObject $acl
}

$sourcePath = (Resolve-Path -LiteralPath $SourceEnvFile -ErrorAction Stop).Path
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destinationPath = [System.IO.Path]::GetFullPath($DestinationPath)
$destinationDirectory = Split-Path -Parent $destinationPath

if (Test-PathIsWithin -Path $sourcePath -ParentPath $repositoryRoot) {
	throw 'Refusing to migrate an environment file from inside the repository.'
}

if (Test-PathIsWithin -Path $destinationPath -ParentPath $repositoryRoot) {
	throw 'Refusing to write a production environment file inside the repository.'
}

$requiredNames = @('WEBUI_SECRET_KEY')
$sourceNames = Get-EnvironmentVariableNames -Path $sourcePath
foreach ($requiredName in $requiredNames) {
	if (-not $sourceNames.Contains($requiredName)) {
		throw "The source environment file is missing required variable name '$requiredName'."
	}
}

if (Test-Path -LiteralPath $destinationPath) {
	throw 'The destination production environment file already exists; refusing to overwrite it.'
}

if (-not (Test-Path -LiteralPath $destinationDirectory)) {
	if ($PSCmdlet.ShouldProcess($destinationDirectory, 'Create protected Tide-Bot production directory')) {
		New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
	}
}

if ($PSCmdlet.ShouldProcess($destinationPath, 'Copy validated production environment file')) {
	Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
	Set-ProductionEnvironmentAcl -Path $destinationPath
	Write-Output 'Production environment file initialized with protected ACL.'
}
