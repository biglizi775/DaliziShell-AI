# Test adapter only: the profile and endpoint must both be isolated.
param([Parameter(Mandatory)][string]$Core,[Parameter(Mandatory)][string]$Root,
      [Parameter(Mandatory)][string]$Profile,[Parameter(Mandatory)][string]$Endpoint,
      [ValidateSet('Prepare','First','Restored')][string]$Phase)
$ErrorActionPreference='Stop'
. $Core
Require-CloudCheck ($Profile -cmatch '^com\.dalizi\.harness-release-test-[0-9a-f-]{36}$' -and
    $Endpoint -cmatch '^http://127\.0\.0\.1:[0-9]+/v1/messages$') 'fixture-only'
$caseFile=Join-Path $Root 'fixture-case.json'
if($Phase -eq 'Prepare'){
    $c=New-CloudChallenge $Root
    [IO.File]::WriteAllText($caseFile,($c | ConvertTo-Json -Compress))
    return
}
$c=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($caseFile))
$ledger=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "$Profile\HarnessTasks\tasks-v4.json"
$unread=$Phase -eq 'First'
$r=Read-CloudReceipt $ledger $c $Endpoint $unread
$rejected=$false
try {$null=Read-CloudReceipt $ledger $c 'https://api.deepseek.com/anthropic/v1/messages' $unread}
catch {if($_.Exception.Message -ne 'wrong-model-endpoint'){throw};$rejected=$true}
Require-CloudCheck $rejected 'loopback-counted-as-cloud'
$f=Join-Path $Root 'fixture-fingerprint.txt'
if($unread){[IO.File]::WriteAllText($f,$r.fingerprint)}
else {Require-CloudCheck ($r.fingerprint -ceq [IO.File]::ReadAllText($f)) 'changed-result-after-restart'}
Write-Output "$Phase verified; official endpoint check rejected the loopback receipt."
