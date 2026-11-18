param(
    [string]$Toolchain,
    [string]$RuntimePrefix = (Join-Path $env:LOCALAPPDATA 'DaliziDev/runtime-0.2.2-rc.3'),
    [string]$NodeExe
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cargoPath = (Get-Command cargo.exe -ErrorAction SilentlyContinue).Source
if (!$cargoPath) { $cargoPath = Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe' }
if (!$NodeExe) { $NodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
if (!$NodeExe) { $NodeExe = Join-Path $env:LOCALAPPDATA 'DaliziDev/node-v24.22.1-win-x64/node.exe' }
$selector = @()
if ($Toolchain) { $selector = @("+$Toolchain") }
$manifest = Join-Path $repo 'src-tauri/harness-client/Cargo.toml'
$priorPath = $env:Path
$priorFlags = $env:RUSTFLAGS
Push-Location -LiteralPath $repo
try {
    $gnuBin = Join-Path $env:LOCALAPPDATA 'DaliziDev/w64devkit/bin'
    if ($Toolchain -like '*windows-gnu' -and (Test-Path (Join-Path $gnuBin 'gcc.exe'))) {
        $env:Path = "$gnuBin;$priorPath"
        # w64devkit supplies the assembler; use Rust's matching CRT and unwind libraries.
        $env:RUSTFLAGS = ("$priorFlags -C link-self-contained=yes").Trim()
    }
    & $cargoPath @selector test --locked --manifest-path $manifest
    if ($LASTEXITCODE -ne 0) { throw 'Rust protocol replay failed' }
    & $cargoPath @selector build --locked --manifest-path $manifest --example m0
    if ($LASTEXITCODE -ne 0) { throw 'Rust diagnostic build failed' }
    $meta = & $cargoPath @selector metadata --locked --no-deps --format-version 1 --manifest-path $manifest
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve Cargo output directory' }
    $exe = Join-Path (($meta | ConvertFrom-Json).target_directory) 'debug/examples/m0.exe'
    & $NodeExe (Join-Path $repo 'tools/harness_m0.cjs') $exe $RuntimePrefix
    if ($LASTEXITCODE -ne 0) { throw 'Real runtime smoke failed' }
} finally {
    $env:Path = $priorPath
    $env:RUSTFLAGS = $priorFlags
    Pop-Location
}
