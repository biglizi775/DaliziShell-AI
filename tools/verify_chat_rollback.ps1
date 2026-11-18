# Build both desktop hosts with test-only app identifiers; never open the normal app profile.
param([string]$Toolchain='stable-x86_64-pc-windows-msvc')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tag='969524f867399a6c6b1b8d3026db0d150a5d1f1b'
$scratch=Join-Path $repo ('src-tauri/target/rollback-baseline/'+[guid]::NewGuid())
$null=New-Item -ItemType Directory -Path $scratch
$cargo=Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
$node=Join-Path $env:LOCALAPPDATA 'DaliziDev/node-v24.22.1-win-x64/node.exe'
if(!(Test-Path -LiteralPath $node)){$node=(Get-Command node.exe).Source}
$prior=$env:TAURI_CONFIG
Push-Location -LiteralPath $repo
try {
    $archive=Join-Path $scratch 'source.zip'
    git archive --format=zip -o $archive $tag
    if($LASTEXITCODE){throw 'Cannot export the pinned v0.5.1 source'}
    python -m zipfile -e $archive (Join-Path $scratch 'old')
    if($LASTEXITCODE){throw 'Could not unpack baseline'}
    $baseline='src-tauri/target/rollback-old'
    $current='src-tauri/target/rollback-current'
    $env:TAURI_CONFIG='{"identifier":"com.dalizi.rollback-baseline-test"}'
    & $cargo "+$Toolchain" build --release --locked --manifest-path (Join-Path $scratch 'old/src-tauri/Cargo.toml') --target-dir $baseline --bin dalizi-files
    if($LASTEXITCODE){throw 'Baseline build failed'}
    $env:TAURI_CONFIG='{"identifier":"com.dalizi.rollback-candidate-test"}'
    & $cargo "+$Toolchain" build --release --locked --manifest-path src-tauri/Cargo.toml --target-dir $current --bin dalizi-files
    if($LASTEXITCODE){throw 'Candidate test build failed'}
    & $node tools/chat_rollback_smoke.cjs "$baseline/release/dalizi-files.exe" "$current/release/dalizi-files.exe" isolated
    if($LASTEXITCODE){throw 'Desktop rollback regression failed'}
} finally {
    $env:TAURI_CONFIG=$prior
    Pop-Location
}
