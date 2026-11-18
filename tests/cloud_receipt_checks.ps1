# Only synthetic files under a new temporary directory. Never opens an application profile.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../tools/cloud_check_core.ps1')
$root=Join-Path ([IO.Path]::GetTempPath()) ('dalizi-cloud-unit-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $root
$ledger=Join-Path $root 'ledger.json'
try {
    $case=New-CloudChallenge $root
    $route='https://api.deepseek.com/anthropic/v1/messages'
    $row=@{id=[guid]::NewGuid().ToString();workspace=@{path=$case.a;identity='01234567:0123456789abcdef'};
        created=100;kind='question';files=@('notes.md');question=$case.question;status='succeeded';model='deepseek-flash';
        endpoint=$route;result=$case.words[0];resultRevision=1;unread=$true}
    function StoreRows($rows) {[IO.File]::WriteAllText($ledger,(@{version=4;tasks=@($rows)}|ConvertTo-Json -Depth 6))}
    function Reject($reason) {
        $message=''
        try {$null=Read-CloudReceipt $ledger $case $route $true} catch {$message=$_.Exception.Message}
        if($message -cne $reason){throw "Expected $reason; saw $message"}
    }
    StoreRows $row;$first=Read-CloudReceipt $ledger $case $route $true
    foreach($spec in @(@('result',$case.words[1],'answer-markers-mismatch'),
        @('result',($case.words[0]+' '+$case.words[2]),'answer-markers-mismatch'),@('unread',$false,'unexpected-read-state'),
        @('endpoint','http://127.0.0.1:12345/v1/messages','wrong-model-endpoint'),@('status','failed','no-successful-answer'),
        @('model','credential-like-value','unsupported-test-model'),@('resultRevision',2,'invalid-result-identity'),
        @('question','different prompt','wrong-selection-or-question'))) {
        $bad=$row.Clone();$bad[$spec[0]]=$spec[1];StoreRows $bad;Reject $spec[2]
    }
    $other=$row.Clone();$other.workspace=@{path=$case.b;identity='76543210:0123456789abcdef'}
    StoreRows @($row,$other);Reject 'wrong-task-count-or-workspace'
    StoreRows @($row,$row);Reject 'wrong-task-count-or-workspace'
    $row.unread=$false;StoreRows $row
    $second=Read-CloudReceipt $ledger $case $route $false
    if($first.fingerprint -cne $second.fingerprint){throw 'Same result was not restored'}
    $row.result=$row.result+' extra';StoreRows $row
    if((Read-CloudReceipt $ledger $case $route $false).fingerprint -ceq $first.fingerprint){throw 'Changed result appeared identical'}
} finally {
    $folder=Get-Item -LiteralPath $root
    if($folder.Parent.FullName -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or
        $folder.Name -notmatch '^dalizi-cloud-unit-[a-f0-9]{32}$'){throw 'Unexpected unit test directory'}
    Remove-Item -LiteralPath $folder.FullName -Recurse -Force
}
