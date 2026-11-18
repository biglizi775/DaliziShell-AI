# Windows PowerShell 5.1. No network, application automation or credential APIs.
function Require-CloudCheck($Condition,[string]$Code) {
    if (!$Condition) { throw [InvalidOperationException]::new($Code) }
}
function New-CloudChallenge([string]$Root) {
    $a=Join-Path $Root 'A';$b=Join-Path $Root 'B'
    $null=New-Item -ItemType Directory -Path $a -ErrorAction Stop
    $null=New-Item -ItemType Directory -Path $b -ErrorAction Stop
    $words=@(1..3 | ForEach-Object {'DALI-'+[guid]::NewGuid().ToString('N')})
    $encoding=[Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText((Join-Path $a 'notes.md'),$words[0],$encoding)
    [IO.File]::WriteAllText((Join-Path $b 'notes.md'),$words[1],$encoding)
    [IO.File]::WriteAllText((Join-Path $a 'other.md'),$words[2],$encoding)
    return @{a=$a;b=$b;words=$words;question='Reply with only the exact text of the selected file.'}
}
function Read-CloudReceipt([string]$Ledger,$Case,[string]$Route,[bool]$Unread) {
    Require-CloudCheck ([IO.File]::Exists($Ledger)) 'no-task-record'
    $item=Get-Item -LiteralPath $Ledger
    Require-CloudCheck ($item.Length -gt 0 -and $item.Length -le 32MB) 'invalid-task-record'
    try {$data=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($item.FullName)) -ErrorAction Stop}
    catch {throw 'invalid-task-record'}
    Require-CloudCheck ($data.version -eq 4 -and $data.tasks -is [array]) 'invalid-task-record'
    $a=@($data.tasks | Where-Object {$_.workspace.path -eq $Case.a})
    $b=@($data.tasks | Where-Object {$_.workspace.path -eq $Case.b})
    Require-CloudCheck ($a.Count -eq 1 -and $b.Count -eq 0) 'wrong-task-count-or-workspace'
    $t=$a[0]
    Require-CloudCheck ($t.endpoint -ceq $Route) 'wrong-model-endpoint'
    Require-CloudCheck ($t.model -cin @('deepseek-flash','deepseek-v4-pro','deepseek-v4-flash')) 'unsupported-test-model'
    Require-CloudCheck ($t.kind -ceq 'question' -and !$t.webSource -and !$t.remoteSource -and
        $t.files -is [array] -and $t.files.Count -eq 1 -and $t.files[0] -ceq 'notes.md' -and $t.question -ceq $Case.question) 'wrong-selection-or-question'
    Require-CloudCheck ($t.status -ceq 'succeeded') 'no-successful-answer'
    Require-CloudCheck ($t.result -is [string] -and $t.result.Contains($Case.words[0]) -and
        !$t.result.Contains($Case.words[1]) -and !$t.result.Contains($Case.words[2])) 'answer-markers-mismatch'
    Require-CloudCheck ($t.unread -is [bool] -and $t.unread -eq $Unread) 'unexpected-read-state'
    Require-CloudCheck ($t.id -cmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -and
        $t.workspace.identity -cmatch '^[0-9a-f]{8}:[0-9a-f]{16}$' -and $t.resultRevision -eq 1) 'invalid-result-identity'
    foreach($entry in @(@($Case.a,'notes.md',0),@($Case.b,'notes.md',1),@($Case.a,'other.md',2))) {
        Require-CloudCheck ([IO.File]::ReadAllText((Join-Path $entry[0] $entry[1])) -ceq $Case.words[$entry[2]]) 'challenge-files-changed'
    }
    $hash=[Security.Cryptography.SHA256]::Create()
    try {$digest=[BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($t.result)))} finally {$hash.Dispose()}
    # The fingerprint is compared in memory and is never written into the report.
    return @{fingerprint=($t.id+'/'+$t.workspace.identity+'/'+$t.resultRevision+'/'+$t.created+'/'+$t.model+'/'+$digest);model=$t.model}
}
