param([string]$Toolchain, [string]$Node = 'node')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cargo = (Get-Command cargo.exe -ErrorAction SilentlyContinue).Source
if (!$cargo) { $cargo = Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe' }
$selector = @()
if ($Toolchain) { $selector = @("+$Toolchain") }
$priorConfig = $env:TAURI_CONFIG
$target = Join-Path $repo 'src-tauri/target/workspace-fixture'
Push-Location -LiteralPath $repo
try {
    $env:TAURI_CONFIG = '{"identifier":"com.dalizi.files.workspace-test"}'
    & $cargo @selector build --locked --manifest-path src-tauri/Cargo.toml --bin dalizi-files --target-dir $target
    if ($LASTEXITCODE -ne 0) { throw 'Desktop fixture build failed' }
    $fixture = Join-Path $target 'debug/workspace-fixture.exe'
    Copy-Item -LiteralPath (Join-Path $target 'debug/dalizi-files.exe') -Destination $fixture -Force
    & $Node tools/workspace_native_smoke.cjs $fixture --file-tab-scope
    if ($LASTEXITCODE -ne 0) { throw 'File tab directory and operation scope check failed' }
    & $Node tools/workspace_native_smoke.cjs $fixture --terminal-restore
    if ($LASTEXITCODE -ne 0) { throw 'Mixed workspace and terminal restore check failed' }
} finally {
    $env:TAURI_CONFIG = $priorConfig
    Pop-Location
}
