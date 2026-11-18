#Requires -Version 5.1
# Standalone, offline Windows 10/11 acceptance. The kit builder freezes the release hashes here.
[CmdletBinding()]
param([ValidateSet('Inspect','Guest','Rehearse')][string]$Mode='Inspect',
      [string]$Previous=(Join-Path $PSScriptRoot 'public-v0.5.1.zip'),
      [string]$Candidate,
      [switch]$ConfirmDisposableGuest, [string]$RehearsalOld, [string]$RehearsalNew,
      [string]$Report=(Join-Path (Get-Location) 'windows-acceptance.json'))
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$frozen='__DALIZI_QA_PINS__'
if(!$frozen.StartsWith('{')){throw 'Run verify_windows_guest.ps1 from the packaged offline acceptance kit.'}
$pins=$frozen|ConvertFrom-Json
if(!$Candidate){$Candidate=Join-Path $PSScriptRoot ('candidate-'+$pins.tag+'.zip')}
$oldPin=$pins.oldZip;$newPin=$pins.newZip;$id=$pins.componentId;$componentPin=$pins.componentZip
$hostPins=@($pins.oldExe,$pins.newExe)
$utf8=[Text.UTF8Encoding]::new($false)
function Check($ok, [string]$why){if(!$ok){throw $why}}
function Digest([string]$file){(Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()}
function NewQaDirectory([string]$path){[IO.Directory]::CreateDirectory($path).FullName}
function ExpandPinned($path,$pin,$dir){
    $stream=[IO.File]::Open($path,'Open','Read','Read');$digest=[Security.Cryptography.SHA256]::Create()
    try{
        $actual=[BitConverter]::ToString($digest.ComputeHash($stream)).Replace('-','')
        Check ($actual -eq $pin) 'Archive changed before extraction'
        $stream.Position=0
        $zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Read,$true)
        try{[IO.Compression.ZipFileExtensions]::ExtractToDirectory($zip,$dir)}finally{$zip.Dispose()}
    }finally{$digest.Dispose();$stream.Dispose()}
}
function ExportHosts($oldDir,$newDir,$scratch){
    ExpandPinned $Previous $oldPin $oldDir;ExpandPinned $Candidate $newPin $newDir
    [IO.File]::Copy((Join-Path $newDir 'qa/windows_acceptance_model.ps1'),(Join-Path $scratch 'model.ps1'))
    Check ((Digest (Join-Path $oldDir 'DaliziFiles.exe')) -eq $hostPins[0]) 'Unexpected old host'
    Check ((Digest (Join-Path $newDir 'DaliziFiles.exe')) -eq $hostPins[1]) 'Unexpected new host'
    Check ((Digest (Join-Path $newDir "components/$id.zip")) -eq $componentPin) 'Unexpected component'
}
function TestGuestEnvironment {
    $os=Get-CimInstance Win32_OperatingSystem
    $ver=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    # WindowsIdentity.Groups omits deny-only SIDs in a filtered UAC token:
    # a non-elevated admin is still not an ordinary user. Read the native token
    # group listing, inspect only two well-known SIDs and never log the list.
    $groups=& (Join-Path $env:SystemRoot 'System32/whoami.exe') /groups /fo csv /nh
    Check ($LASTEXITCODE -eq 0 -and [bool]($groups -match '"S-1-1-0"')) 'Cannot establish Windows token group membership'
    $tools=@('node.exe','pnpm.exe','pnpm.cmd','cargo.exe','rustc.exe','cl.exe' | Where-Object {Get-Command $_ -CommandType Application -ErrorAction SilentlyContinue})
    $adapters=@(Get-NetAdapter -ErrorAction Stop | Where-Object Status -eq 'Up')
    $profiles=@(@([Environment]::GetFolderPath('LocalApplicationData'),[Environment]::GetFolderPath('ApplicationData')) | Where-Object {Test-Path -LiteralPath (Join-Path $_ 'com.dalizi.files')})
    $build=[int]$os.BuildNumber
    [ordered]@{osBuild="$build.$($ver.UBR)";windowsFamily=$(if($os.ProductType -eq 1 -and $build -ge 22000){'11'}elseif($os.ProductType -eq 1 -and $build -ge 17763){'10'}else{'unsupported'});
        x64=([Environment]::Is64BitProcess -and $env:PROCESSOR_ARCHITECTURE -eq 'AMD64');
        standardUser=(![bool]($groups -match '"S-1-5-32-544"'));
        developmentCommandsOnPath=$tools;activeAdapterCount=$adapters.Count;freshProductProfile=($profiles.Count -eq 0)}
}
function NativeProcess($exe,$cwd){
    $pi=[Diagnostics.ProcessStartInfo]::new();$pi.FileName=$exe;$pi.WorkingDirectory=$cwd;$pi.UseShellExecute=$false
    return $pi
}
function Evaluate($socket,$expr,$timeout){
    $token=[Threading.CancellationTokenSource]::new([int]$timeout)
    $memory=[IO.MemoryStream]::new()
    try{
        $json=@{id=1;method='Runtime.evaluate';params=@{expression=$expr;awaitPromise=$true;returnByValue=$true}} | ConvertTo-Json -Depth 5 -Compress
        $data=[ArraySegment[byte]]::new([Text.Encoding]::UTF8.GetBytes($json))
        $null=$socket.SendAsync($data,[Net.WebSockets.WebSocketMessageType]::Text,$true,$token.Token).GetAwaiter().GetResult()
        $buffer=[ArraySegment[byte]]::new([byte[]]::new(8192))
        do{
            $memory.SetLength(0)
            do{
                $frame=$socket.ReceiveAsync($buffer,$token.Token).GetAwaiter().GetResult()
                Check ($frame.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Text) 'Desktop closed the verification channel'
                Check ($memory.Length+$frame.Count -lt 262144) 'Unexpected verification response size'
                $memory.Write($buffer.Array,0,$frame.Count)
            }while(!$frame.EndOfMessage)
            $msg=ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString($memory.ToArray()))
        }while($msg.id -ne 1)
        if($msg.error){throw ('WebView2 evaluation failed: '+$msg.error.message)}
        if($msg.result.exceptionDetails){throw ('Desktop scenario failed: '+$msg.result.exceptionDetails.exception.description)}
        return $msg.result.result.value
    }finally{$memory.Dispose();$token.Dispose()}
}
function Stage($name,$dir,$project,$second,$endpoint){
    $script:current=$name
    $web=NewQaDirectory (Join-Path $scratch ('web-'+$name))
    $pi=NativeProcess (Join-Path $dir 'DaliziFiles.exe') $scratch
    $pi.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER']=$web
    $pi.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--remote-debugging-address=127.0.0.1 --remote-debugging-port=0'
    $pi.EnvironmentVariables['PATH']=(Join-Path $env:SystemRoot 'System32')
    $pi.EnvironmentVariables.Remove('NODE_OPTIONS');$pi.EnvironmentVariables.Remove('NODE_PATH')
    $watch=[Diagnostics.Stopwatch]::StartNew()
    $app=[Diagnostics.Process]::Start($pi)
    $wc=[Net.WebClient]::new();$wc.Proxy=$null
    $socket=[Net.WebSockets.ClientWebSocket]::new()
    try{
        $target=$null
        while(!$target -and $watch.Elapsed.TotalSeconds -lt 45){
            Check (!$app.HasExited) ('Desktop closed before WebView2 was ready: '+$name)
            # Chromium creates and removes caches concurrently. Never traverse those
            # directories while it starts; inspect only the port file in our new UDF.
            $file=@((Join-Path $web 'EBWebView\DevToolsActivePort'),(Join-Path $web 'DevToolsActivePort')) | Where-Object {[IO.File]::Exists($_)} | Select-Object -First 1
            if($file){
                try{
                    $lines=[IO.File]::ReadAllLines($file);$port=0
                    if($lines.Count -and [int]::TryParse($lines[0],[ref]$port) -and $port -ge 1 -and $port -le 65535){
                        $address="http://127.0.0.1:$port"
                        $targets=ConvertFrom-Json -InputObject ($wc.DownloadString("$address/json/list"))
                        $target=$targets | Where-Object {$_.type -eq 'page' -and $_.url -match '^https?://tauri\.localhost(/|$)'} | Select-Object -First 1
                    }
                }catch [Net.WebException]{}catch [IO.IOException]{}
            }
            if(!$target){Start-Sleep -Milliseconds 130}
        }
        Check ($null -ne $target) 'No application WebView2 target in the isolated user data folder'
        $ws=[uri]$target.webSocketDebuggerUrl
        Check ($ws.Scheme -eq 'ws' -and $ws.Host -in @('127.0.0.1','localhost') -and $ws.Port -eq $port) 'Unexpected verification channel'
        $token=[Threading.CancellationTokenSource]::new(10000)
        try{$null=$socket.ConnectAsync($ws,$token.Token).GetAwaiter().GetResult()}finally{$token.Dispose()}
        $version=ConvertFrom-Json -InputObject ($wc.DownloadString("$address/json/version"))
        $result.webView2=$version.Browser
        # WebView2 may publish the target before it replaces its startup document.
        # Only the read-only probe is repeatable; never replay the scenario itself.
        $origin=$null;$stable=$false
        while(!$stable -and $watch.Elapsed.TotalSeconds -lt 65){
            try{
                $now=Evaluate $socket "document.readyState==='complete' && typeof workspaceSessionReady!=='undefined' && workspaceSessionReady && !state.loading ? String(performance.timeOrigin) : ''" 5000
                $stable=$now -and $now -eq $origin;$origin=$now
            }catch{
                if($_.Exception.Message -notmatch 'Execution context was destroyed|Cannot find context'){throw}
                $origin=$null
            }
            if(!$stable){Start-Sleep -Milliseconds 180}
        }
        Check $stable 'Desktop did not finish loading a stable workspace'
        $arg=ConvertTo-Json -InputObject @{project=$project;second=$second;endpoint=$endpoint} -Compress
        $stageJson=ConvertTo-Json -InputObject $name -Compress
        $expr="(async()=>{"+$scenario+";return runGuestStage("+$stageJson+","+$arg+");})()"
        $ready=$watch.ElapsedMilliseconds
        $timeout=if($name -eq 'unavailable'){245000}else{115000}
        $evidence=Evaluate $socket $expr $timeout
        Check ($evidence.checks.Count -ge 2) 'Stage did not return its checks'
        $child=$null
        if($name -eq 'interrupt'){
            $got=$false
            foreach($i in 1..2){
                $line=$model.StandardOutput.ReadLineAsync()
                Check ($line.Wait(40000) -and $null -ne $line.Result) 'Model never received the pending request'
                if($line.Result.Contains('no other marker, no tools')){$got=$true;break}
            }
            Check ($got -and !$model.HasExited) 'Pending reply was not held'
            $nodes=@(Get-CimInstance Win32_Process -Filter ("ParentProcessId="+$app.Id+" AND Name='node.exe'"))
            Check ($nodes.Count -eq 1) 'Expected one active bundled Node child'
            $child=Get-Process -Id $nodes[0].ProcessId
            $null=$child.Handle
            $result.hostPeakWorkingSetBytes=$app.PeakWorkingSet64
            $result.nodePeakWorkingSetBytes=$child.PeakWorkingSet64
        }
        $socket.Abort()
        Check ($app.CloseMainWindow()) 'Desktop refused the normal close request'
        Check ($app.WaitForExit(12000) -and $app.ExitCode -eq 0) 'Desktop did not exit normally'
        if($child){
            try{Check ($child.WaitForExit(10000)) 'Bundled Node outlived the desktop';$result.nodeAliveAfterExit=0}finally{$child.Dispose()}
        }
        $result.stages+=@([ordered]@{stage=$name;passed=$evidence.checks;metrics=$evidence.metrics;webViewTargetReadyMs=$ready;elapsedMs=$watch.ElapsedMilliseconds})
        Write-Output ("Passed "+$name)
    }finally{
        $socket.Dispose();$wc.Dispose()
        if(!$app.HasExited){$app.Kill();$null=$app.WaitForExit(8000)}
        $app.Dispose()
    }
}
function StartModel([int]$hold=0){
    $pi=NativeProcess (Join-Path $PSHOME 'powershell.exe') $scratch
    $pi.Arguments='-NoProfile -NonInteractive -File "'+(Join-Path $scratch 'model.ps1')+'" -HoldSeconds '+$hold
    $pi.RedirectStandardOutput=$true;$pi.RedirectStandardError=$true;$pi.CreateNoWindow=$true
    return [Diagnostics.Process]::Start($pi)
}
function ModelEndpoint($proc){
    $line=$proc.StandardOutput.ReadLineAsync()
    Check ($line.Wait(15000) -and $line.Result -match '^Endpoint: (http://127\.0\.0\.1:[0-9]+/v1)$') 'Local model did not start'
    return $Matches[1]
}
function WithReadOnlyInstall($dir,[scriptblock]$test){
    Check ((Split-Path -Parent (Resolve-Path -LiteralPath $dir).Path) -eq $scratch) 'Not an owned temporary install'
    $section=[Security.AccessControl.AccessControlSections]::Access
    $acl=Get-Acl -LiteralPath $dir;$prior=$acl.GetSecurityDescriptorSddlForm($section)
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'Write,Delete,DeleteSubdirectoriesAndFiles','ContainerInherit,ObjectInherit','None','Deny')
    $probe=Join-Path $dir 'write-test.tmp';$denied=$false
    try{
        $acl.AddAccessRule($rule);Set-Acl -LiteralPath $dir -AclObject $acl
        try{[IO.File]::WriteAllText($probe,'test')}catch [UnauthorizedAccessException]{$denied=$true}
        Check $denied 'Installation was still writable'
        & $test
    }finally{
        $restore=Get-Acl -LiteralPath $dir;$restore.SetSecurityDescriptorSddlForm($prior,$section);Set-Acl -LiteralPath $dir -AclObject $restore
        [IO.File]::WriteAllText($probe,'restored');[IO.File]::Delete($probe)
    }
    $result.readOnlyInstallVerified=$true
}
function WriteReport($value,$path){
    $bytes=$utf8.GetBytes(($value | ConvertTo-Json -Depth 8)+[Environment]::NewLine)
    $f=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
    try{$f.Write($bytes,0,$bytes.Length)}finally{$f.Dispose()}
}
$Previous=(Resolve-Path -LiteralPath $Previous).Path;$Candidate=(Resolve-Path -LiteralPath $Candidate).Path
Check ((Digest $Previous) -eq $oldPin) 'Expected the original public v0.5.1 archive'
Check ((Digest $Candidate) -eq $newPin) 'Expected the unchanged candidate archive for this kit'
$envReport=TestGuestEnvironment
if($Mode -eq 'Inspect'){[PSCustomObject]@{archiveHashesMatched=$true;environment=$envReport} | ConvertTo-Json -Depth 5;return}
if($Mode -eq 'Guest'){
    Check ($ConfirmDisposableGuest.IsPresent) 'Guest mode requires an explicit disposable snapshot'
    Check ($envReport.windowsFamily -in @('10','11') -and $envReport.x64 -and $envReport.standardUser) 'An ordinary non-administrator account on a Windows x64 client is required'
    Check ($envReport.freshProductProfile -and !(Get-Process -Name DaliziFiles -ErrorAction SilentlyContinue)) 'Use an unused application profile on a fresh snapshot'
    Check (!$envReport.developmentCommandsOnPath.Count) 'Development tools are present on PATH'
    Check ($envReport.activeAdapterCount -eq 0) 'Disconnect the guest network adapters before this offline test'
}else{
    Check ($RehearsalOld -and $RehearsalNew) 'Rehearsal requires two separately identified test builds'
    $testPins=@($pins.testOld,$pins.testNew)
    Check ((Digest $RehearsalOld) -eq $testPins[0] -and (Digest $RehearsalNew) -eq $testPins[1]) 'Rehearsal only accepts the verified isolated builds, never the public executables'
}
$Report=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Report)
Check (!(Test-Path -LiteralPath $Report)) 'Use a new report path'
$scenario=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows_guest_scenarios.js'),$utf8)
$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$scratch=NewQaDirectory (Join-Path $temp ('dalizi-guest-'+[guid]::NewGuid().ToString('N')))
$result=[ordered]@{schema=1;utc=[DateTime]::UtcNow.ToString('o');suite='offline-start-and-rollback';mode=$Mode;publicExecutables=($Mode -eq 'Guest');environment=$envReport;oldZipSha256=$oldPin;candidateZipSha256=$newPin;componentZipSha256=$componentPin;stages=@();passed=$false}
$model=$null;$current='prepare'
try{
    $oldDir=NewQaDirectory (Join-Path $scratch 'old');$newDir=NewQaDirectory (Join-Path $scratch (([char]0x5446).ToString()+' '+$pins.tag))
    $src=NewQaDirectory (Join-Path $scratch 'A');$second=NewQaDirectory (Join-Path $scratch 'B');$moved=Join-Path $scratch (([char]0x9879).ToString()+' A')
    ExportHosts $oldDir $newDir $scratch
    if($Mode -eq 'Rehearse'){
        [IO.File]::Copy((Resolve-Path -LiteralPath $RehearsalOld).Path,(Join-Path $oldDir 'DaliziFiles.exe'),$true)
        [IO.File]::Copy((Resolve-Path -LiteralPath $RehearsalNew).Path,(Join-Path $newDir 'DaliziFiles.exe'),$true)
    }
    $result.executedExeSha256=@((Digest (Join-Path $oldDir 'DaliziFiles.exe')),(Digest (Join-Path $newDir 'DaliziFiles.exe')))
    [IO.File]::WriteAllText((Join-Path $src 'notes.md'),'DALIZI_M5_SELECTED',$utf8)
    [IO.File]::WriteAllText((Join-Path $src 'other.md'),'DALIZI_M5_OTHER',$utf8)
    [IO.File]::WriteAllText((Join-Path $second 'notes.md'),'DALIZI_M5_OTHER',$utf8)
    Stage 'firstStart' $newDir $src $second ''
    Stage 'oldCreate' $oldDir $src $second ''
    $chatRel='.dalizi\chat-history.json';$original=Digest (Join-Path $src $chatRel)
    Copy-Item -LiteralPath $src -Destination $moved -Recurse
    Copy-Item -LiteralPath (Join-Path $oldDir 'DaliziData') -Destination $newDir -Recurse
    $sidecar=Join-Path $newDir "components/$id.zip";$saved=Join-Path $scratch "$id.zip"
    [IO.File]::Move($sidecar,$saved)
    Stage 'newMissing' $newDir $moved $second ''
    Check ((Digest (Join-Path $moved $chatRel)) -eq $original) 'Read-only upgrade rewrote history'
    [IO.File]::WriteAllText($sidecar,'truncated test component')
    Stage 'newDamaged' $newDir $moved $second ''
    [IO.File]::Delete($sidecar);[IO.File]::Move($saved,$sidecar)
    $current='model-start';$model=StartModel
    $endpoint=ModelEndpoint $model
    WithReadOnlyInstall $newDir {Stage 'newFull' $newDir $moved $second $endpoint}
    Check ($model.WaitForExit(10000) -and $model.ExitCode -eq 0 -and $model.StandardOutput.ReadToEnd().Contains('no other marker, no tools')) 'Local model did not verify the selected bytes and empty tools'
    $model.Dispose();$model=$null
    Stage 'unavailable' $newDir $moved $second $endpoint
    Stage 'oldRollback' $oldDir $moved $second ''
    $model=StartModel 90
    Stage 'interrupt' $newDir $moved $second (ModelEndpoint $model)
    Stage 'newRestore' $newDir $moved $second ''
    Check ((Digest (Join-Path $src $chatRel)) -eq $original) 'Original project changed'
    $result.passed=$true
}finally{
    $result.finalStage=$current
    try{
        try{
            if($model){
                try{if(!$model.HasExited){$model.Kill();Check ($model.WaitForExit(8000)) 'Local model did not stop'}}finally{$model.Dispose()}
            }
        }finally{
            $owned=(Resolve-Path -LiteralPath $scratch).Path
            Check ((Split-Path -Parent $owned) -eq $temp -and (Split-Path -Leaf $owned) -match '^dalizi-guest-[0-9a-f]{32}$') 'Unexpected cleanup target'
            Remove-Item -LiteralPath $owned -Recurse -Force -ErrorAction Stop
        }
        $result.temporaryFilesRemoved=$true
    }catch{$result.passed=$false;$result.finalStage='cleanup';throw}
    finally{WriteReport $result $Report}
}
