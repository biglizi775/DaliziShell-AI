param([Parameter(Mandatory)][string]$Component,[string]$Toolchain='stable-x86_64-pc-windows-msvc')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$zip=(Resolve-Path -LiteralPath $Component).Path
$target=Join-Path $repo 'src-tauri/target/harness-release'
$id=[guid]::NewGuid().ToString()
$profile="com.dalizi.harness-release-test-$id"
$nonAsciiName=([string][char]0x5de5)+' '+([string][char]0x53f0)
$run=Join-Path (Join-Path $repo "src-tauri/target/m5-acceptance/$id") $nonAsciiName
$null=New-Item -ItemType Directory -Path $run
$cargo=Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
$node=Join-Path $env:LOCALAPPDATA 'DaliziDev/node-v24.22.1-win-x64/node.exe'
if(!(Test-Path -LiteralPath $node)){$node=(Get-Command node.exe -ErrorAction Stop).Source}
$previous=$env:TAURI_CONFIG
$previousProfile=$env:DALIZI_TEST_PROFILE
Push-Location -LiteralPath $repo
try{
    $env:TAURI_CONFIG=@{identifier=$profile} | ConvertTo-Json -Compress
    $env:DALIZI_TEST_PROFILE=$profile
    & $cargo "+$Toolchain" build --locked --release --manifest-path src-tauri/Cargo.toml --target-dir $target --bin dalizi-files
    if($LASTEXITCODE -ne 0){throw 'Release fixture build failed'}
    $exe=Join-Path $run 'harness-release-fixture.exe'
    Copy-Item -LiteralPath (Join-Path $target 'release/dalizi-files.exe') -Destination $exe
    Write-Output ('Release test host: '+$exe)
    & $node tools/harness_m1_smoke.cjs $exe --m5 $zip
    if($LASTEXITCODE -ne 0){throw 'Release acceptance failed'}
}finally{
    $env:TAURI_CONFIG=$previous
    $env:DALIZI_TEST_PROFILE=$previousProfile
    Pop-Location
}
