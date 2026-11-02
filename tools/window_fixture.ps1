param(
  [Parameter(Mandatory=$true)][int]$FixturePid,
  [Parameter(Mandatory=$true)][string]$FixtureExe,
  [ValidateSet('resize','restore')][string]$Action = 'resize',
  [int]$Width = 1280,
  [int]$Height = 800
)
$ErrorActionPreference = 'Stop'
$fixtureProcess = Get-Process -Id $FixturePid
$expected = (Resolve-Path -LiteralPath $FixtureExe).Path
if (-not [string]::Equals($fixtureProcess.Path, $expected, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Fixture process does not match the isolated test executable.'
}
$handle = $fixtureProcess.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { throw 'Fixture window not found.' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DaliziWindowFixture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect rect);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@
if ($Action -eq 'resize') {
  if ($Width -lt 960 -or $Height -lt 560 -or $Width -gt 2000 -or $Height -gt 1600) { throw 'Fixture dimensions outside test bounds.' }
  $rect = New-Object DaliziWindowFixture+Rect
  if (-not [DaliziWindowFixture]::GetWindowRect($handle, [ref]$rect)) { throw 'Cannot read fixture bounds.' }
  if (-not [DaliziWindowFixture]::MoveWindow($handle, $rect.Left, $rect.Top, $Width, $Height, $true)) { throw 'Cannot resize fixture.' }
} else {
  1..3 | ForEach-Object {
    [void][DaliziWindowFixture]::ShowWindow($handle, 6)
    Start-Sleep -Milliseconds 200
    [void][DaliziWindowFixture]::ShowWindow($handle, 9)
    [void][DaliziWindowFixture]::ShowWindow($handle, 5)
    Start-Sleep -Milliseconds 200
  }
  if ([DaliziWindowFixture]::IsIconic($handle) -or -not [DaliziWindowFixture]::IsWindowVisible($handle)) {
    throw 'Fixture did not restore to a visible window.'
  }
}
