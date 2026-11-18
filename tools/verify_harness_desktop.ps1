param([string]$Toolchain)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dev = Join-Path $env:LOCALAPPDATA 'DaliziDev'
$node = Join-Path $dev 'node-v24.22.1-win-x64/node.exe'
$dsh = Join-Path $dev 'runtime-0.2.2-rc.3/node_modules/@deepseek-ai/dsh/lib/bin.js'
if (!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath $dsh)) {
    throw 'Missing the pinned development runtime. See docs/HARNESS_M1.md.'
}
$cargo = (Get-Command cargo.exe -ErrorAction SilentlyContinue).Source
if (!$cargo) { $cargo = Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe' }
$selector = @()
if ($Toolchain) { $selector = @("+$Toolchain") }
$priorPath = $env:Path
$priorFlags = $env:RUSTFLAGS
$priorConfig = $env:TAURI_CONFIG
$target = Join-Path $repo 'src-tauri/target/harness-m1'
Push-Location -LiteralPath $repo
try {
    $gnu = Join-Path $dev 'w64devkit/bin'
    if ($Toolchain -like '*windows-gnu' -and (Test-Path -LiteralPath (Join-Path $gnu 'gcc.exe'))) {
        $env:Path = "$gnu;$priorPath"
        $env:RUSTFLAGS = ("$priorFlags -C link-self-contained=yes").Trim()
    }
    $env:TAURI_CONFIG = '{"identifier":"com.dalizi.files.harness-m1-test"}'
    & $cargo @selector build --locked --manifest-path src-tauri/Cargo.toml --bin dalizi-files --target-dir $target
    if ($LASTEXITCODE -ne 0) { throw 'Desktop fixture build failed' }
    $fixture = Join-Path $target 'debug/harness-m1-fixture.exe'
    Copy-Item -LiteralPath (Join-Path $target 'debug/dalizi-files.exe') -Destination $fixture -Force
    & $node tools/harness_m1_smoke.cjs $fixture --file-history
    if ($LASTEXITCODE -ne 0) { throw 'Directory file history and restart recovery check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture --skill-copies
    if ($LASTEXITCODE -ne 0) { throw 'Editable skill and multi-instance check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture --agent-roles
    if ($LASTEXITCODE -ne 0) { throw 'Agent role selection and turn isolation check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture --file-tab-scope
    if ($LASTEXITCODE -ne 0) { throw 'File tab directory and operation scope check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture --terminal-restore
    if ($LASTEXITCODE -ne 0) { throw 'Mixed workspace and terminal restore check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture --pinned-auto
    if ($LASTEXITCODE -ne 0) { throw 'Pinned local project foreground check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture --pinned-selection
    if ($LASTEXITCODE -ne 0) { throw 'Pinned project subfolder attachment check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture --model-switch
    if ($LASTEXITCODE -ne 0) { throw 'Desktop model switch and background request check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture --session-cache
    if ($LASTEXITCODE -ne 0) { throw 'Workspace draft and plan retention check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture --archive-recovery
    if ($LASTEXITCODE -ne 0) { throw 'Chat archive recovery check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture --desktop-exit
    if ($LASTEXITCODE -ne 0) { throw 'Normal Windows close and chat recovery check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture --history-scope
    if ($LASTEXITCODE -ne 0) { throw 'Task history directory switch and retry check failed' }
    & $node tools/harness_m1_smoke.cjs $fixture
    if ($LASTEXITCODE -ne 0) { throw 'Native desktop Harness smoke failed' }
    $webToolchain = if ($Toolchain) { $Toolchain } else { 'default' }
    & $node tools/harness_m3.cjs $webToolchain $target
    if ($LASTEXITCODE -ne 0) { throw 'Native web quote and project routing check failed' }
} finally {
    $env:TAURI_CONFIG = $priorConfig
    $env:RUSTFLAGS = $priorFlags
    $env:Path = $priorPath
    Pop-Location
}
