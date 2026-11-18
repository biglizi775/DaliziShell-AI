# Real Linux/OpenSSH guests; only ephemeral VMX files under the Cargo target directory.
param([Parameter(Mandatory)][string]$Component,
      [string]$Toolchain='stable-x86_64-pc-windows-msvc',
      [string]$Vmrun=(Join-Path $env:ProgramFiles 'VMware/VMware Workstation/vmrun.exe'))
$ErrorActionPreference='Stop'
$repo=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$image=(Resolve-Path -LiteralPath $Component).Path
$vm=(Resolve-Path -LiteralPath $Vmrun).Path
$cargo=Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
$py=Join-Path $repo 'src-tauri/target/openssh-qa-env/Scripts/python.exe'
$target=Join-Path $repo 'src-tauri/target/harness-openssh'
$prior=$env:TAURI_CONFIG
Push-Location -LiteralPath $repo
try {
    if (!(Test-Path -LiteralPath $py)) {
        python -m venv src-tauri/target/openssh-qa-env
        if($LASTEXITCODE -ne 0){throw 'Could not create the test environment'}
    }
    & $py -m pip install --disable-pip-version-check -r tools/requirements-openssh-guest.txt
    if($LASTEXITCODE -ne 0){throw 'Could not prepare guest tooling'}
    $env:TAURI_CONFIG='{"identifier":"com.dalizi.openssh-qa"}'
    & $cargo "+$Toolchain" build --release --locked --manifest-path src-tauri/Cargo.toml --target-dir $target --bin dalizi-files
    if($LASTEXITCODE -ne 0){throw 'Isolated release host build failed'}
    & $py -u tools/openssh_guest.py --vmrun $vm --desktop (Join-Path $target 'release/dalizi-files.exe') --component $image
    if($LASTEXITCODE -ne 0){throw 'OpenSSH guest acceptance failed'}
} finally {
    $env:TAURI_CONFIG=$prior
    Pop-Location
}
