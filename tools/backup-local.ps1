param([string]$BackupParent = 'D:\daxiong-backups')
$ErrorActionPreference = 'Stop'
$source = Split-Path $PSScriptRoot -Parent
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$destination = Join-Path $BackupParent "baseline-$stamp"
$snapshot = Join-Path $destination 'snapshot'
$restore = Join-Path $destination 'restore-check'
if (Test-Path $destination) { throw 'Backup destination already exists' }
if (Test-Path (Join-Path $source 'data/storage_settings.json')) { throw 'Review custom storage paths before backup' }
$queue = Invoke-RestMethod 'http://127.0.0.1:3000/api/queue_status?client_id=backup-verification'
if ($queue.total -ne 0) { throw 'Generation queue is not empty' }
$listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen)
$processIds = @($listeners.OwningProcess | Select-Object -Unique)
if ($processIds.Count -ne 1) { throw 'Ambiguous server process' }
$server = Get-CimInstance Win32_Process -Filter "ProcessId=$($processIds[0])"
if ($server.ExecutablePath -ne (Join-Path $source 'python/python.exe')) { throw 'Unexpected server executable' }
New-Item -ItemType Directory -Path $snapshot -Force | Out-Null
try {
    Stop-Process -Id $server.ProcessId
    & robocopy $source $snapshot /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XD .git __pycache__ /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Backup copy failed: $LASTEXITCODE" }
    $manifest = @(Get-ChildItem $snapshot -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($snapshot.Length + 1)
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        $original = Join-Path $source $relative
        if ((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ne $hash) { throw "Source mismatch: $relative" }
        [pscustomobject]@{Path=$relative; Bytes=$_.Length; SHA256=$hash}
    })
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination 'manifest.json') -Encoding UTF8
    git -C $source bundle create (Join-Path $destination 'code-history.bundle') --all
    if ($LASTEXITCODE -ne 0) { throw 'Git bundle failed' }
} finally {
    Start-Process -FilePath (Join-Path $source 'python/python.exe') -ArgumentList 'main.py' -WorkingDirectory $source -WindowStyle Hidden | Out-Null
}
& robocopy $snapshot $restore /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Restore copy failed' }
foreach ($entry in $manifest) {
    if ((Get-FileHash -LiteralPath (Join-Path $restore $entry.Path) -Algorithm SHA256).Hash -ne $entry.SHA256) { throw "Restore mismatch: $($entry.Path)" }
}
[pscustomobject]@{Backup=$destination; Files=$manifest.Count; Bytes=($manifest | Measure-Object Bytes -Sum).Sum; HashVerified=$true} | ConvertTo-Json
