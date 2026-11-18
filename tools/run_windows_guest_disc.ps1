#Requires -Version 5.1
# Run on a disposable Windows guest. The host receives only this newly created QA report.
param([switch]$ConfirmDisposableGuest)
$ErrorActionPreference='Stop'
if(!$ConfirmDisposableGuest){throw 'Use -ConfirmDisposableGuest only inside a disposable QA guest.'}
$out=Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('Dalizi-__QA_RELEASE__-'+[guid]::NewGuid().ToString('N')+'.json')
try {
    & (Join-Path $PSScriptRoot 'verify_windows_guest.ps1') -Mode Guest -ConfirmDisposableGuest -Report $out
} finally {
    if(Test-Path -LiteralPath $out){
        Write-Output ('Local report: '+$out)
        try {
            $data=[IO.File]::ReadAllBytes($out)
            if($data.Length -gt 32768){throw 'Report exceeded the serial transfer limit'}
            $hash=(Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash
            $serial=[IO.Ports.SerialPort]::new('COM1',115200)
            try {
                $serial.WriteTimeout=10000;$serial.Open()
                $serial.WriteLine('DALIZI-__QA_RELEASE__ '+$hash+' '+[Convert]::ToBase64String($data))
                $clock=[Diagnostics.Stopwatch]::StartNew()
                while($serial.BytesToWrite -gt 0 -and $clock.Elapsed.TotalSeconds -lt 12){Start-Sleep -Milliseconds 50}
                if($serial.BytesToWrite -gt 0){throw 'Serial port did not finish sending'}
                Write-Output 'Report sent to the configured VM serial log.'
            }finally{$serial.Dispose()}
        } catch {Write-Warning 'Serial return unavailable. Keep the local report before restoring the snapshot.'}
    }
}
