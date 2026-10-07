param([Parameter(Mandatory = $true)][string]$PlanPath)

$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
$base = [System.IO.Path]::GetFullPath([string]$plan.base)
$source = [System.IO.Path]::GetFullPath([string]$plan.source)
$backup = [System.IO.Path]::GetFullPath([string]$plan.backup)
$statusPath = [string]$plan.status
$serverId = [int]$plan.pid
$affected = @($plan.files) + @($plan.remove) | Sort-Object -Unique
$existing = @{}

function Set-UpdateStatus([string]$phase, [string]$message) {
    $state = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $state.phase = $phase
    if ($message) { $state | Add-Member -NotePropertyName error -NotePropertyValue $message -Force }
    $temp = "$statusPath.tmp"
    [System.IO.File]::WriteAllText($temp, ($state | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $statusPath -Force
}

function Get-ManagedPath([string]$root, [string]$relative) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $root ($relative.Replace('/', '\'))))
    if (-not $target.StartsWith(($root.TrimEnd('\') + '\'), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe update path: $relative"
    }
    return $target
}

function Start-Nadou {
    $launcher = Join-Path $base 'run.bat'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'run.bat is missing' }
    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', "call `"$launcher`" --no-browser") -WorkingDirectory $base
}

try {
    Write-Host '[Update] Waiting for the old server to stop...'
    Start-Sleep -Seconds 2
    if ($serverId -gt 0 -and (Get-Process -Id $serverId -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $serverId -Force -ErrorAction Stop
        Wait-Process -Id $serverId -Timeout 30 -ErrorAction SilentlyContinue
    }
    Set-UpdateStatus 'installing' ''
    Write-Host ("[Update] Backing up {0} program files..." -f $affected.Count)

    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($relative in $affected) {
        $target = Get-ManagedPath $base ([string]$relative)
        $saved = Get-ManagedPath $backup ([string]$relative)
        $exists = Test-Path -LiteralPath $target -PathType Leaf
        $existing[[string]$relative] = $exists
        if ($exists) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $saved) -Force | Out-Null
            Copy-Item -LiteralPath $target -Destination $saved -Force -ErrorAction Stop
        }
    }
    foreach ($relative in @($plan.files)) {
        $target = Get-ManagedPath $base ([string]$relative)
        $staged = Get-ManagedPath $source ([string]$relative)
        if (-not (Test-Path -LiteralPath $staged -PathType Leaf)) { throw "Missing staged file: $relative" }
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $staged -Destination $target -Force -ErrorAction Stop
    }
    foreach ($relative in @($plan.remove)) {
        $target = Get-ManagedPath $base ([string]$relative)
        if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force -ErrorAction Stop }
    }
    $record = @{ version = [string]$plan.version; from_version = [string]$plan.from_version; files = $affected; existing = $existing }
    $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $backup 'full-update-backup.json') -Encoding UTF8
    Set-UpdateStatus 'restarting' ''
    Write-Host '[Update] Installation complete. Starting nadou ai...'
    if ($plan.restart -ne $false) { Start-Nadou }
    Set-UpdateStatus 'complete' ''
    $stagingRoot = [System.IO.Path]::GetFullPath((Join-Path $base 'data\update_staging'))
    if ($source.StartsWith(($stagingRoot.TrimEnd('\') + '\'), [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $source -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath (Join-Path (Split-Path -Parent $source) 'release.zip') -Force -ErrorAction SilentlyContinue
    }
} catch {
    $message = $_.Exception.Message
    Write-Host "[Update] Installation failed: $message"
    try {
        foreach ($relative in $affected) {
            $target = Get-ManagedPath $base ([string]$relative)
            $saved = Get-ManagedPath $backup ([string]$relative)
            if ($existing[[string]$relative] -and (Test-Path -LiteralPath $saved -PathType Leaf)) {
                New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
                Copy-Item -LiteralPath $saved -Destination $target -Force -ErrorAction Stop
            } elseif ($existing.ContainsKey([string]$relative) -and -not $existing[[string]$relative] -and
                      (Test-Path -LiteralPath $target -PathType Leaf)) {
                Remove-Item -LiteralPath $target -Force -ErrorAction Stop
            }
        }
        if ($plan.restart -ne $false) { Start-Nadou }
        Set-UpdateStatus 'failed' "Installation failed; original files restored: $message"
        Write-Host '[Update] Original version restored.'
    } catch {
        Set-UpdateStatus 'failed' "Installation and automatic restore failed; inspect the backup in data/update_backups: $message"
    }
    exit 1
}
