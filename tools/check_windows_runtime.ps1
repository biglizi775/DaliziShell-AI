# Offline prerequisite check for the portable ZIP. Compatible with Windows
# PowerShell syntax; it can explain a mismatch even when DaliziFiles.exe cannot start.
param([switch]$Json)

function Get-DaliziRuntimeVersion {
    if ($env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER) {
        $file = Join-Path $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER 'msedgewebview2.exe'
        if (Test-Path -LiteralPath $file -PathType Leaf) {
            return (Get-Item -LiteralPath $file).VersionInfo.ProductVersion
        }
        return $null
    }
    $client = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($key in @("HKLM:\SOFTWARE\WOW6432Node\$client", "HKLM:\SOFTWARE\$client", "HKCU:\SOFTWARE\$client")) {
        $item = Get-ItemProperty -LiteralPath $key -Name pv -ErrorAction SilentlyContinue
        if ($item -and $item.pv) {
            try { if ([version]$item.pv -gt [version]'0.0.0.0') { return $item.pv } } catch {}
        }
    }
    return $null
}

function Get-DaliziPackageArchitecture($Executable) {
    $stream = $null
    $reader = $null
    try {
        $stream = [IO.File]::OpenRead($Executable)
        $reader = New-Object IO.BinaryReader($stream)
        if ($reader.ReadUInt16() -ne 0x5a4d) { return 'unknown' }
        $stream.Position = 60
        $stream.Position = $reader.ReadUInt32()
        if ($reader.ReadUInt32() -ne 0x4550) { return 'unknown' }
        switch ($reader.ReadUInt16()) { 0x014c { return 'x86' } 0x8664 { return 'x64' } }
    } catch {
        return 'unknown'
    } finally {
        if ($reader) { $reader.Close() } elseif ($stream) { $stream.Close() }
    }
    return 'unknown'
}

function Get-DaliziPlatformResult($Build, $ProductType, $Architecture, $InstallType, $WebView, $PackageArchitecture = 'x64', $WinPty = $false) {
    if (@('x64', 'x86') -notcontains $PackageArchitecture) { return 'unknown-package-architecture' }
    if (!$Build -or !$ProductType -or @('x86', 'x64', 'arm32', 'arm64') -notcontains $Architecture) { return 'unknown-platform' }
    if (($PackageArchitecture -eq 'x64' -and $Architecture -eq 'x86') -or $Architecture -eq 'arm32') { return 'requires-other-architecture' }
    if ($Build -lt 10240 -or ($Build -lt 17763 -and !$WinPty)) { return 'below-full-workbench-baseline' }
    if ($ProductType -ne 1 -and $InstallType -ne 'Server') { return 'requires-server-desktop-check' }
    if ($Architecture -eq 'arm64' -and $PackageArchitecture -eq 'x64' -and ($Build -lt 22000 -or $ProductType -ne 1)) { return 'requires-other-architecture' }
    if (!$WebView) { return 'webview2-not-detected' }
    if ($Build -lt 17763) { return 'early-windows-with-winpty-needs-test' }
    if ($Architecture -eq 'arm64') { return "$PackageArchitecture-emulation-needs-test" }
    if ($Architecture -eq 'x64' -and $PackageArchitecture -eq 'x86') { return 'wow64-needs-test' }
    return 'prerequisites-detected'
}

function Get-DaliziWindowsFacts($PackageArchitecture, $WinPty) {
    $reg = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue
    $os = $null
    $cpu = $null
    try {
        if (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) {
            $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
            $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
        } else {
            $os = Get-WmiObject Win32_OperatingSystem -ErrorAction Stop
            $cpu = Get-WmiObject Win32_Processor -ErrorAction Stop | Select-Object -First 1
        }
    } catch {}
    $arch = 'unknown'
    if ($cpu) {
        if ($cpu.AddressWidth -eq 32) {
            if ($cpu.Architecture -eq 5 -or $cpu.Architecture -eq 12) { $arch = 'arm32' } else { $arch = 'x86' }
        } elseif ($cpu.Architecture -eq 12) { $arch = 'arm64' }
        elseif ($cpu.Architecture -eq 9) { $arch = 'x64' }
    }
    $web = Get-DaliziRuntimeVersion
    $build = [int]$reg.CurrentBuildNumber
    $kind = [int]$os.ProductType
    $result = Get-DaliziPlatformResult $build $kind $arch $reg.InstallationType $web $PackageArchitecture $WinPty
    New-Object PSObject -Property @{
        packageArchitecture=$PackageArchitecture; winptyPresent=$WinPty; windows=$os.Caption; build=$build; productType=$kind
        architecture=$arch; installationType=$reg.InstallationType; webView2=$web; result=$result
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $dir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $arch = Get-DaliziPackageArchitecture (Join-Path $dir 'DaliziFiles.exe')
    $winpty = ($arch -ne 'unknown' -and (Get-DaliziPackageArchitecture (Join-Path $dir 'terminal\winpty.dll')) -eq $arch -and (Get-DaliziPackageArchitecture (Join-Path $dir 'terminal\winpty-agent.exe')) -eq $arch)
    $facts = Get-DaliziWindowsFacts $arch $winpty
    if ($Json -and (Get-Command ConvertTo-Json -ErrorAction SilentlyContinue)) { $facts | ConvertTo-Json }
    else { $facts | Format-List windows,build,architecture,installationType,packageArchitecture,webView2,winptyPresent,result }
}
