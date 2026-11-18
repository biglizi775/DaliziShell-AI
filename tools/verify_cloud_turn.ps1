#Requires -Version 5.1
[CmdletBinding()]
param([ValidateSet('Inspect','Live')][string]$Mode='Inspect',
      [Parameter(Mandatory)][string]$Candidate, [switch]$ConfirmFreshTestAccount, [string]$Report)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'cloud_check_core.ps1')
$frozen='__DALIZI_CLOUD_PINS__'
if (!$frozen.StartsWith('{')) {throw 'Use the verifier from the packaged cloud check kit.'}
$pin=$frozen | ConvertFrom-Json
$utf8=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Hash-CloudStream($Stream) {
    $h=[Security.Cryptography.SHA256]::Create()
    try {return [BitConverter]::ToString($h.ComputeHash($Stream)).Replace('-','').ToLowerInvariant()} finally {$h.Dispose()}
}
function Launch-CloudDesktop($Dir) {
    $exe=Join-Path $Dir 'DaliziFiles.exe'
    Require-CloudCheck ((Get-FileHash -LiteralPath $exe).Hash -eq $pin.exe) 'unexpected-desktop'
    Require-CloudCheck ((Get-FileHash -LiteralPath (Join-Path $Dir $pin.member)).Hash -eq $pin.component) 'unexpected-component'
    $pi=[Diagnostics.ProcessStartInfo]::new()
    $pi.FileName=$exe;$pi.WorkingDirectory=$Dir;$pi.UseShellExecute=$false
    $p=[Diagnostics.Process]::Start($pi)
    try {$p.WaitForExit();Require-CloudCheck ($p.ExitCode -eq 0) 'abnormal-app-exit'} finally {$p.Dispose()}
}
if ($Mode -eq 'Live') {
    Require-CloudCheck ($ConfirmFreshTestAccount -and $Report) 'Live requires -ConfirmFreshTestAccount and a new -Report path.'
    $Report=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Report)
    Require-CloudCheck (!(Test-Path -LiteralPath $Report) -and [IO.Directory]::Exists([IO.Path]::GetDirectoryName($Report))) 'report-path-unavailable'
    $local=[Environment]::GetFolderPath('LocalApplicationData')
    foreach($root in @($local,[Environment]::GetFolderPath('ApplicationData'))) {
        Require-CloudCheck (!(Test-Path -LiteralPath (Join-Path $root 'com.dalizi.files'))) 'Use a fresh test account; this profile already contains application data.'
    }
    Require-CloudCheck (!(Get-Process -Name DaliziFiles -ErrorAction SilentlyContinue)) 'Close other desktop instances first.'
    Require-CloudCheck (!$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -and !$env:WEBVIEW2_USER_DATA_FOLDER) 'Use the normal desktop configuration.'
}
$file=[IO.File]::Open((Resolve-Path -LiteralPath $Candidate).Path,'Open','Read','Read')
try {
    Require-CloudCheck ((Hash-CloudStream $file) -ceq $pin.zip) 'wrong-candidate-archive'
    $file.Position=0;$zip=[IO.Compression.ZipArchive]::new($file,[IO.Compression.ZipArchiveMode]::Read,$true)
    try {
        foreach($spec in @(@('DaliziFiles.exe',$pin.exe),@($pin.member,$pin.component))) {
            $entries=@($zip.Entries | Where-Object {$_.FullName -ceq $spec[0]})
            Require-CloudCheck ($entries.Count -eq 1) 'invalid-candidate-members'
            $s=$entries[0].Open()
            try {Require-CloudCheck ((Hash-CloudStream $s) -ceq $spec[1]) 'candidate-member-mismatch'} finally {$s.Dispose()}
        }
        if ($Mode -eq 'Inspect') {Write-Output "Verified $($pin.release) archive, desktop and component. No process started or model contacted.";return}
        $root=Join-Path ([IO.Path]::GetTempPath()) ('dalizi-cloud-'+[guid]::NewGuid().ToString('N'))
        $null=New-Item -ItemType Directory -Path $root
        $appDir=Join-Path $root 'app'
        [IO.Compression.ZipFileExtensions]::ExtractToDirectory($zip,$appDir)
    } finally {$zip.Dispose()}
} finally {$file.Dispose()}
$case=New-CloudChallenge $root
$ledger=Join-Path $local 'com.dalizi.files\HarnessTasks\tasks-v4.json'
$route='https://api.deepseek.com/anthropic/v1/messages'
$result=[ordered]@{schema=1;suite='operator-cloud-turn';mode='Live';release=$pin.release;utc=[DateTime]::UtcNow.ToString('o');
    candidateZipSha256=$pin.zip;exeSha256=$pin.exe;componentZipSha256=$pin.component;passed=$false;checks=@();stage='first-launch'}
try {
    Write-Host "First launch: use the official DeepSeek Messages endpoint in Agent settings. Enter a test key in the app, enable Harness, and select ONLY notes.md in $($case.a)."
    Write-Host "Submit this once: $($case.question)"
    Write-Host "Switch to $($case.b). Wait until A has an unread answer (do not expand it), then fully exit the desktop from its tray menu."
    Launch-CloudDesktop $appDir
    $result.stage='first-receipt'
    $first=Read-CloudReceipt $ledger $case $route $true
    $result.checks+=@('official-route-selected-answer','only-A-has-one-unread-task')
    Require-CloudCheck ((Read-Host 'Confirm you switched to B after sending and did not see the result in B. Type B') -ceq 'B') 'operator-observation-missing'
    $result.stage='restart'
    Write-Host "Second launch: return to $($case.a), open File tasks, expand the previous answer until the unread mark clears, then fully exit. Do not resend."
    Launch-CloudDesktop $appDir
    $result.stage='restored-receipt'
    $second=Read-CloudReceipt $ledger $case $route $false
    Require-CloudCheck ($first.fingerprint -ceq $second.fingerprint) 'changed-result-after-restart'
    $result.checks+=@('same-answer-after-second-launch','restored-answer-read-without-resubmission')
    $result.model=$second.model;$result.operatorObservedSwitchToB=$true
    $result.passed=$true;$result.stage='complete'
} catch {
    # Never copy a provider response, filesystem exception or user input into a report.
    $known=@('no-task-record','invalid-task-record','wrong-task-count-or-workspace','wrong-model-endpoint','unsupported-test-model',
        'wrong-selection-or-question','no-successful-answer','answer-markers-mismatch','unexpected-read-state',
        'invalid-result-identity','challenge-files-changed','operator-observation-missing','changed-result-after-restart',
        'unexpected-desktop','unexpected-component','abnormal-app-exit')
    $result.failure=if($_.Exception.Message -cin $known){$_.Exception.Message}else{'verification-error'}
    throw
} finally {
    $bytes=$utf8.GetBytes(($result | ConvertTo-Json)+[Environment]::NewLine)
    $out=[IO.File]::Open($Report,'CreateNew','Write','None')
    try {$out.Write($bytes,0,$bytes.Length)} finally {$out.Dispose()}
    Write-Host "Report: $Report. Synthetic test folder: $root."
}
