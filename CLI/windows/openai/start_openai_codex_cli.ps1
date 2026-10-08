$ErrorActionPreference = 'Stop'

try {
    Set-Location (Join-Path $PSScriptRoot '..\..\..')
    $codex = (Get-Command codex -ErrorAction SilentlyContinue).Source
    if (-not $codex) {
        $roots = @(
            (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'),
            (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin')
        )
        $codex = Get-ChildItem -Path $roots -Filter codex.exe -File -Recurse -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $codex) {
        throw 'Codex CLI was not found. Run 1-install_openai_codex_cli.bat first.'
    }

    $codexArguments = @($args)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and
        $codexArguments -notcontains '--no-daemon') {
        # Codex refuses to start its shared Windows daemon from an elevated terminal.
        $codexArguments = @('--no-daemon') + $codexArguments
        Write-Host 'Administrator terminal detected. Starting Codex with --no-daemon.'
    }

    & $codex @codexArguments
    exit $LASTEXITCODE
} catch {
    Write-Host ('Unable to start Codex CLI: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
