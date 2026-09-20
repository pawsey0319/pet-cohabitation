param([string]$Script = "scripts/test-companion-supabase.mjs", [switch]$Live, [ValidateSet("android-companion-supabase","final-supabase-chain")][string]$Fixture="android-companion-supabase")
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$fixturePath = Join-Path (Get-Location) "test-results/$Fixture"
$config = Get-Content -LiteralPath (Join-Path $fixturePath 'supabase/config.toml') -Raw
$expectedProject = if ($Fixture -eq "final-supabase-chain") { "android-final-validation" } else { "android-companion-validation" }
if ($config -notmatch ('(?m)^project_id\s*=\s*"' + [regex]::Escape($expectedProject) + '"')) { throw 'Unexpected fixture' }
try {
  $ErrorActionPreference = 'Continue' # Windows PowerShell turns native stderr warnings into terminating errors under Stop.
  $lines = & npx.cmd supabase status --workdir $fixturePath -o env 2>$null
  $statusExit = $LASTEXITCODE
} finally { $ErrorActionPreference = 'Stop' }
if ($statusExit -ne 0) { throw 'Fixture status unavailable' }
foreach ($line in $lines) {
  if ($line -match '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)="(.*)"$') {
    $name = switch ($Matches[1]) { 'API_URL' {'SUPABASE_URL'} 'ANON_KEY' {'SUPABASE_ANON_KEY'} 'SERVICE_ROLE_KEY' {'SUPABASE_SERVICE_ROLE_KEY'} }
    [Environment]::SetEnvironmentVariable($name, $Matches[2], 'Process')
  }
}
$env:COMPANION_SUPABASE_WORKDIR = $fixturePath
$env:SUPABASE_TEST_DB_CONTAINER = if($Fixture -eq "final-supabase-chain") {"supabase_db_android-final-validation"} else {"supabase_db_android-companion-validation"}
$env:COMPANION_EXPECT_MODEL_PROVIDER = if ($Live) { 'openai-compatible' } else { 'mock' }
try {
  $ErrorActionPreference = 'Continue'
  $cliPath = & npx.cmd --yes --package supabase -c 'where.exe supabase' 2>$null
} finally { $ErrorActionPreference = 'Stop' }
$shim = @($cliPath | Where-Object { $_ -like '*.cmd' })[0]
if ($shim) {
  $modules = Split-Path -Parent (Split-Path -Parent $shim)
  $binary = Get-ChildItem -LiteralPath $modules -Filter 'supabase.exe' -File -Recurse | Select-Object -First 1
  $env:COMPANION_SUPABASE_CLI = $binary.FullName
}
if ($Script -like '*recovery*' -and -not $env:COMPANION_SUPABASE_CLI) { throw 'Supabase CLI binary unavailable' }
& node $Script
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
