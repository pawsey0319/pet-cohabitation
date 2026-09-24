param(
  [ValidateSet('drag', 'click')][string]$Action,
  [int]$X, [int]$Y, [int]$ToX, [int]$ToY,
  [Parameter(Mandatory=$true)][string]$AllowedWindowHandles
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OverlayPointer {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public static void Move(int x, int y) {
    uint dx = (uint)Math.Round((x-GetSystemMetrics(76))*65535.0/(GetSystemMetrics(78)-1));
    uint dy = (uint)Math.Round((y-GetSystemMetrics(77))*65535.0/(GetSystemMetrics(79)-1));
    mouse_event(0xC001, dx, dy, 0, UIntPtr.Zero);
  }
}
'@
[void][OverlayPointer]::SetProcessDPIAware()
$original = New-Object OverlayPointer+Point
[void][OverlayPointer]::GetCursorPos([ref]$original)
$pressed = $false
try {
  # Inject a real mouse-move input: SetCursorPos alone skips low-level hooks
  # used by Electron to forward movement while click-through is enabled.
  [OverlayPointer]::Move($X, $Y)
  Start-Sleep -Milliseconds 150
  $target = New-Object OverlayPointer+Point
  $target.X = $X; $target.Y = $Y
  $handle = [OverlayPointer]::GetAncestor([OverlayPointer]::WindowFromPoint($target), 2).ToInt64().ToString()
  if ($handle -notin $AllowedWindowHandles.Split(',')) { throw 'Pointer target is outside the isolated test windows; input was not sent.' }
  Write-Output (ConvertTo-Json -Compress @{ target_handle=$handle; x=$X; y=$Y; action=$Action })
  [OverlayPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  $pressed = $true
  if ($Action -eq 'drag') {
    for ($step = 1; $step -le 12; $step++) {
      [OverlayPointer]::Move([int]($X + ($ToX-$X)*$step/12), [int]($Y + ($ToY-$Y)*$step/12))
      Start-Sleep -Milliseconds 30
    }
  } else { Start-Sleep -Milliseconds 50 }
} finally {
  if ($pressed) { [OverlayPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }
  [OverlayPointer]::Move($original.X, $original.Y)
}
