[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$candidate = Join-Path $workspace 'desktop\release\pet-desktop-1.1.1-x64.exe'
$expectedHash = '99b37ab9d914e525e82fc0638b605d0ebe84f85b86d12ea6fca1c640195acd90'
$runRoot = Join-Path $workspace ('test-results\windows-install-' + [guid]::NewGuid().ToString())
$installRoot = Join-Path $runRoot 'installed'
$report = [ordered]@{ startedAt = [DateTime]::UtcNow.ToString('o'); candidate = $candidate; checks = @(); boundaries = @('Real current-user silent NSIS installation; no interactive wizard acceptance', 'No login or existing private profile is used', 'Lock-screen and physical multi-monitor behavior are not covered'); cleanup = @{} }
$installerStarted = $false
$uninstaller = $null
$exitCode = 0
function Assert-Check([bool]$condition, [string]$name) {
  if (-not $condition) { throw $name }
  $script:report.checks += $name
}
function Assert-WithinRun([string]$target) {
  $absolute = [IO.Path]::GetFullPath($target)
  if (-not $absolute.StartsWith($runRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'unsafe_path_outside_isolated_run' }
  return $absolute
}
function Get-ProductRegistrations {
  $roots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
  foreach ($registryRoot in $roots) {
    foreach ($entry in (Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue)) {
      $p = Get-ItemProperty -LiteralPath $entry.PSPath
      if ($p.DisplayName -like '异宠桌面伙伴*' -or $p.InstallLocation -match 'pet-companion-desktop') {
        $guidPath = if ($registryRoot.StartsWith('HKCU:')) { 'HKCU:\Software\' + $entry.PSChildName } else { 'HKLM:\Software\' + $entry.PSChildName }
        $registration = Get-ItemProperty -LiteralPath $guidPath -ErrorAction SilentlyContinue
        $location = if ($p.InstallLocation) { $p.InstallLocation } else { $registration.InstallLocation }
        [pscustomobject]@{ key = $entry.Name; path = $entry.PSPath; settingsPath = $guidPath; name = $p.DisplayName; version = $p.DisplayVersion; location = $location; uninstall = $p.UninstallString }
      }
    }
  }
}
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
try {
  $report.sha256 = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
  $report.bytes = (Get-Item -LiteralPath $candidate).Length
  $report.signature = (Get-AuthenticodeSignature -LiteralPath $candidate).Status.ToString()
  Assert-Check ($report.sha256 -eq $expectedHash) 'candidate_hash_matches_reviewed_1_1_1'
  $links = @((Join-Path ([Environment]::GetFolderPath('Desktop')) '异宠桌面伙伴.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) '异宠桌面伙伴.lnk'))
  $profiles = @((Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'pet-companion-desktop'), (Join-Path ([Environment]::GetFolderPath('ApplicationData')) '异宠桌面伙伴'))
  $existing = @(Get-ProductRegistrations)
  Assert-Check ($existing.Count -eq 0) 'no_existing_product_installation_will_be_overwritten'
  foreach ($item in @($links) + @($profiles)) { Assert-Check (-not (Test-Path -LiteralPath $item)) ('baseline_path_absent:' + $item) }
  $running = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq '异宠桌面伙伴.exe' })
  Assert-Check ($running.Count -eq 0) 'no_existing_packaged_app_running'
  $runKey = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue
  $existingRunNames = @($runKey.PSObject.Properties | Where-Object { $_.Name -match 'pet-companion|petcohabitation|异宠' } | ForEach-Object { $_.Name })
  Assert-Check ($existingRunNames.Count -eq 0) 'no_existing_product_startup_setting_will_be_modified'
  $report.baseline = @{ shortcuts = $links; profilePaths = $profiles; registryMatches = $existing.Count }
  [void](Assert-WithinRun $installRoot)
  $installerStarted = $true
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $candidate -ArgumentList @('/S', '/currentuser', ('/D=' + $installRoot)) -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(120000)) { throw 'installer_exceeded_120_seconds' }
  $report.install = @{ exitCode = $process.ExitCode; milliseconds = $watch.ElapsedMilliseconds; directory = $installRoot }
  Assert-Check ($process.ExitCode -eq 0) 'real_nsis_installer_exit_zero'
  $installed = @(Get-ProductRegistrations)
  Assert-Check ($installed.Count -eq 1) 'exactly_one_new_uninstall_registration'
  $actualRoot = [IO.Path]::GetFullPath($installed[0].location.TrimEnd('\'))
  [void](Assert-WithinRun $actualRoot)
  $report.registration = $installed[0]
  Assert-Check ($installed[0].version -eq '1.1.1' -and $installed[0].key.StartsWith('HKEY_CURRENT_USER\')) 'current_user_registry_version_is_1_1_1'
  $exe = Join-Path $actualRoot '异宠桌面伙伴.exe'
  $uninstaller = Join-Path $actualRoot 'Uninstall 异宠桌面伙伴.exe'
  Assert-Check ((Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $uninstaller)) 'installed_executable_and_real_uninstaller_exist'
  $reference = Join-Path $workspace 'desktop\release\win-unpacked\resources\app.asar'
  $actualAsar = Join-Path $actualRoot 'resources\app.asar'
  $report.asarSha256 = (Get-FileHash -LiteralPath $actualAsar -Algorithm SHA256).Hash.ToLowerInvariant()
  Assert-Check ($report.asarSha256 -eq (Get-FileHash -LiteralPath $reference -Algorithm SHA256).Hash.ToLowerInvariant()) 'installed_asar_matches_packaged_release_payload'
  $shell = New-Object -ComObject WScript.Shell
  $report.shortcuts = @()
  foreach ($link in $links) {
    Assert-Check (Test-Path -LiteralPath $link) ('installer_created_shortcut:' + $link)
    $shortcut = $shell.CreateShortcut($link)
    $report.shortcuts += @{ path = $link; target = $shortcut.TargetPath }
    Assert-Check ([IO.Path]::GetFullPath($shortcut.TargetPath) -eq [IO.Path]::GetFullPath($exe)) ('shortcut_points_to_installed_binary:' + $link)
  }
  & node (Join-Path $PSScriptRoot 'install-packaged-probe.cjs') $exe $runRoot
  Assert-Check ($LASTEXITCODE -eq 0) 'actual_installed_executable_startup_checks_pass'
  $report.packaged = Get-Content -LiteralPath (Join-Path $runRoot 'packaged-startup.json') -Raw | ConvertFrom-Json
} catch {
  $report.failure = $_.Exception.Message
  $exitCode = 1
} finally {
  try {
    if ($installerStarted) {
      $entries = @(Get-ProductRegistrations)
      if (-not $uninstaller -and $entries.Count -eq 1) {
        $safeInstallRoot = Assert-WithinRun $entries[0].location
        $uninstaller = Join-Path $safeInstallRoot 'Uninstall 异宠桌面伙伴.exe'
      }
      if ($uninstaller -and (Test-Path -LiteralPath $uninstaller)) {
        [void](Assert-WithinRun $uninstaller)
        $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList @('/S', '/currentuser') -WindowStyle Hidden -PassThru
        if (-not $uninstallProcess.WaitForExit(120000)) { throw 'uninstaller_exceeded_120_seconds' }
        $report.cleanup.uninstallerExitCode = $uninstallProcess.ExitCode
        Assert-Check ($uninstallProcess.ExitCode -eq 0) 'real_nsis_uninstaller_exit_zero'
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
          $remainingRegistrations = @(Get-ProductRegistrations)
          $remainingLinks = @($links | Where-Object { Test-Path -LiteralPath $_ })
          $remainingBinary = Test-Path -LiteralPath $uninstaller
          if ($remainingRegistrations.Count -eq 0 -and $remainingLinks.Count -eq 0 -and -not $remainingBinary) { break }
          Start-Sleep -Milliseconds 300
        } while ([DateTime]::UtcNow -lt $deadline)
        Assert-Check ($remainingRegistrations.Count -eq 0) 'uninstaller_removed_product_registration'
        if ($report.registration.settingsPath) { Assert-Check (-not (Test-Path -LiteralPath $report.registration.settingsPath)) 'uninstaller_removed_install_location_registry_key' }
        Assert-Check ($remainingLinks.Count -eq 0) 'uninstaller_removed_desktop_and_start_menu_shortcuts'
        Assert-Check (-not $remainingBinary -and -not (Test-Path -LiteralPath $exe)) 'uninstaller_removed_application_binaries'
      }
      foreach ($profile in $profiles) { Assert-Check (-not (Test-Path -LiteralPath $profile)) ('existing_profile_location_untouched:' + $profile) }
      $isolatedProfile = Join-Path $runRoot 'profile'
      if (Test-Path -LiteralPath $isolatedProfile) { $safeProfile = Assert-WithinRun $isolatedProfile; Remove-Item -LiteralPath $safeProfile -Recurse -Force }
      $report.cleanup.isolatedProfileRemoved = -not (Test-Path -LiteralPath $isolatedProfile)
      $cacheFile = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'pet-companion-desktop-updater\installer.exe'
      $report.cleanup.installerCache = @{ path = $cacheFile; exists = (Test-Path -LiteralPath $cacheFile); handling = 'Electron-builder installer cache may remain outside the isolated test directory; not private app data and not manually deleted by this test.' }
      $report.cleanup.completed = $true
    }
  } catch { $report.cleanup.failure = $_.Exception.Message; $exitCode = 1 }
  $report.passed = $exitCode -eq 0
  $report.finishedAt = [DateTime]::UtcNow.ToString('o')
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $runRoot 'report.json') -Encoding utf8
  [pscustomobject]@{ passed = $report.passed; checks = $report.checks.Count; report = (Join-Path $runRoot 'report.json'); failure = $report.failure; cleanupFailure = $report.cleanup.failure } | ConvertTo-Json -Compress
}
exit $exitCode
