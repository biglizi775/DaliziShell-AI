# One-shot, loopback-only Messages fixture for clean Windows guests. No admin or development tools.
param([ValidateRange(0,65535)][int]$Port = 0, [ValidateRange(0,120)][int]$HoldSeconds = 0)
$ErrorActionPreference = 'Stop'
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$client = $null
try {
    $listener.Start(1)
    Write-Output ("Endpoint: http://127.0.0.1:" + $listener.LocalEndpoint.Port + "/v1")
    Write-Output 'One POST only. Use the synthetic DALIZI_M5_SELECTED file and a dummy key.'
    $pending = $listener.AcceptTcpClientAsync()
    if (!$pending.Wait(600000)) { throw 'No request within ten minutes.' }
    $client = $pending.Result
    $stream = $client.GetStream()
    $stream.ReadTimeout = 10000
    $stream.WriteTimeout = 10000
    $header = [Collections.Generic.List[byte]]::new()
    do {
        $b = $stream.ReadByte()
        if ($b -lt 0 -or $header.Count -ge 16384) { throw 'Invalid HTTP headers.' }
        $header.Add([byte]$b)
        $n = $header.Count
    } until ($n -ge 4 -and $header[$n-4] -eq 13 -and $header[$n-3] -eq 10 -and $header[$n-2] -eq 13 -and $b -eq 10)
    $headers = [Text.Encoding]::ASCII.GetString($header.ToArray())
    if ($headers -notmatch '^POST /v1/messages HTTP/1\.[01]\r\n' -or $headers -notmatch '(?im)^Content-Length:\s*([0-9]{1,6})\s*$') {
        throw 'Expected a Messages POST with a content length.'
    }
    $length = [int]$Matches[1]
    if ($length -lt 1 -or $length -gt 524288) { throw 'Invalid fixture request length.' }
    $body = [byte[]]::new($length)
    $received = 0
    while ($received -lt $length) {
        $read = $stream.Read($body, $received, $length - $received)
        if (!$read) { throw 'Incomplete request.' }
        $received += $read
    }
    $raw = [Text.Encoding]::UTF8.GetString($body)
    $msg = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
    if (!$raw.Contains('DALIZI_M5_SELECTED') -or $raw.Contains('DALIZI_M5_OTHER') -or $msg.tools.Count -gt 0) {
        throw 'Selected marker, isolation, or empty tools check failed.'
    }
    Write-Output 'Received selected marker, no other marker, no tools.'
    if ($HoldSeconds -gt 0) { Start-Sleep -Seconds $HoldSeconds }
    $frames = @(
        @{type='message_start';message=@{id='clean-guest';model='deepseek-v4-pro';usage=@{input_tokens=1;output_tokens=0}}}
        @{type='content_block_start';index=0;content_block=@{type='text';text='DALIZI_M5_ANSWER'}}
        @{type='content_block_stop';index=0}
        @{type='message_delta';delta=@{stop_reason='end_turn'};usage=@{output_tokens=1}}
        @{type='message_stop'}
    )
    $events = ($frames | ForEach-Object { "event: " + $_.type + [char]10 + "data: " + (ConvertTo-Json -InputObject $_ -Depth 6 -Compress) + [char]10 + [char]10 }) -join ''
    $data = [Text.Encoding]::UTF8.GetBytes($events)
    $crlf = [string][char]13 + [char]10
    $head = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK" + $crlf + "Content-Type: text/event-stream" + $crlf + "Content-Length: " + $data.Length + $crlf + "Connection: close" + $crlf + $crlf)
    $stream.Write($head, 0, $head.Length)
    $stream.Write($data, 0, $data.Length)
} finally {
    if ($client) { $client.Dispose() }
    $listener.Stop()
}
