param([Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$Port)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$entryPath = Join-Path $projectRoot 'main.py'
$bundledPython = Join-Path $projectRoot 'python\python.exe'

try {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    $targets = @()
    foreach ($ownerId in $owners) {
        $info = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId"
        # An API response alone cannot prove that this is the same project checkout.
        # Legacy launchers passed relative main.py; accept that only for our bundled Python.
        $absoluteEntry = '(?i)(?:^|\s)"?' + [regex]::Escape($entryPath) + '"?\s*$'
        $relativeEntry = '(?i)(?:^|\s)"?main\.py"?\s*$'
        $isPython = $info.ExecutablePath -and ([IO.Path]::GetFileName($info.ExecutablePath) -in @('python.exe', 'pythonw.exe'))
        $isOurEntry = $info.CommandLine -match $absoluteEntry
        $isLegacyEntry = ($info.ExecutablePath -ieq $bundledPython) -and ($info.CommandLine -match $relativeEntry)
        if (-not $isPython -or -not ($isOurEntry -or $isLegacyEntry)) {
            throw "Port $Port belongs to an unverified process. Close that server manually; no process was stopped."
        }
        $targets += Get-Process -Id $ownerId
    }
    foreach ($target in $targets) {
        Write-Host "Stopping previous Nadou backend (PID $($target.Id)) to load current local source..."
        Stop-Process -InputObject $target -Force
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        if ([DateTime]::UtcNow -ge $deadline) { throw "Port $Port was not released. Please retry." }
        Start-Sleep -Milliseconds 200
    }
    exit 0
} catch {
    Write-Host "Cannot restart Nadou: $($_.Exception.Message)"
    exit 1
}
