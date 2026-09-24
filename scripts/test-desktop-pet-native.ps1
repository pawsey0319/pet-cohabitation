param([Parameter(Mandatory=$true)][string]$JdkDirectory, [string]$ProxyUrl = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root ('test-results/desktop-pet-native-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $target | Out-Null
Copy-Item -Path (Join-Path $root 'modules/desktop-pet/android/host-tests/*') -Destination $target -Recurse
$production = Join-Path $root 'modules/desktop-pet/android/src/main/java/expo/modules/petdesktop'
foreach ($file in @('PetDesktopStore.kt', 'PetDesktopService.kt')) {
  Copy-Item -LiteralPath (Join-Path $production $file) -Destination (Join-Path $target 'src/main/kotlin')
}
# Reuse React Native's shipped wrapper with a JVM-test-compatible Gradle version.
$wrapperRoot = Join-Path $root 'node_modules/@react-native/gradle-plugin'
Copy-Item -LiteralPath (Join-Path $wrapperRoot 'gradlew.bat') -Destination $target
Copy-Item -LiteralPath (Join-Path $wrapperRoot 'gradle') -Destination $target -Recurse
$properties = Join-Path $target 'gradle/wrapper/gradle-wrapper.properties'
(Get-Content -LiteralPath $properties -Raw) -replace 'gradle-[0-9.]+-bin.zip', 'gradle-8.13-bin.zip' | Set-Content -LiteralPath $properties
$env:JAVA_HOME = (Resolve-Path -LiteralPath $JdkDirectory).Path
$env:GRADLE_USER_HOME = Join-Path $root 'test-results/native-journal-tools/gradle-cache'
if ($ProxyUrl) {
  $proxyEndpoint = [Uri]$ProxyUrl
  if ($proxyEndpoint.Scheme -ne 'http' -or $proxyEndpoint.UserInfo) { throw 'Expected an HTTP proxy without credentials' }
  @("systemProp.http.proxyHost=$($proxyEndpoint.Host)", "systemProp.http.proxyPort=$($proxyEndpoint.Port)", "systemProp.https.proxyHost=$($proxyEndpoint.Host)", "systemProp.https.proxyPort=$($proxyEndpoint.Port)") | Set-Content -LiteralPath (Join-Path $target 'gradle.properties')
}
Push-Location -LiteralPath $target
try {
  & .\gradlew.bat test --no-daemon --console=plain *> (Join-Path $target 'gradle.log')
  $result = $LASTEXITCODE
  @{target=$target; exitCode=$result; scope='Current Kotlin store and service compiled; Robolectric native SQLite; headless RN boundary stubbed; no APK or device acceptance'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'report.json')
  Get-Content -LiteralPath (Join-Path $target 'gradle.log') -Tail 55
  Write-Output ('Evidence: ' + $target)
  exit $result
} finally { Pop-Location }
