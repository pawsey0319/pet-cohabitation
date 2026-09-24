param(
  [string]$Script = 'scripts/test-personality-relationships.mjs',
  [switch]$Deno
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$fixtureRoot = Join-Path $projectRoot 'test-results/android-companion-supabase'
if ((Get-Content -LiteralPath (Join-Path $fixtureRoot 'supabase/config.toml') -Raw) -notmatch 'project_id\s*=\s*"android-companion-validation"') {
  throw 'Unexpected validation fixture'
}
if ($fixtureRoot -notmatch '^[A-Za-z]:\\') { throw 'Expected an absolute Windows fixture path' }
$linuxFixture = '/mnt/' + $fixtureRoot.Substring(0, 1).ToLowerInvariant() + '/' + $fixtureRoot.Substring(3).Replace('\', '/')
try {
  $ErrorActionPreference = 'Continue'
  $lines = & wsl.exe -d Ubuntu -u root -- env DOCKER_HOST=unix:///var/run/docker.sock /opt/pet-validation/bin/supabase status --workdir $linuxFixture -o env 2> (Join-Path $fixtureRoot 'wsl-status.stderr.log')
  $resultCode = $LASTEXITCODE
} finally { $ErrorActionPreference = 'Stop' }
if ($resultCode -ne 0) {
  # Docker Desktop/WSL can leave a successful healthcheck labelled "starting".
  # Read only the named isolated gateway's existing test credentials; never print them.
  $gatewayConfig = (& wsl.exe -d Ubuntu -u root -- env DOCKER_HOST=unix:///var/run/docker.sock docker exec supabase_kong_android-companion-validation cat /home/kong/kong.yml 2> (Join-Path $fixtureRoot 'gateway-read.stderr.log')) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'Isolated test gateway unavailable' }
  $lines = @('API_URL="http://127.0.0.1:47321"')
  foreach ($match in [regex]::Matches($gatewayConfig, 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')) {
    $part = $match.Value.Split('.')[1].Replace('-','+').Replace('_','/')
    $part = $part.PadRight($part.Length + (4 - $part.Length % 4) % 4, '=')
    $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($part)) | ConvertFrom-Json
    if ($payload.role -eq 'anon') { $lines += 'ANON_KEY="' + $match.Value + '"' }
    if ($payload.role -eq 'service_role') { $lines += 'SERVICE_ROLE_KEY="' + $match.Value + '"' }
  }
  $gatewayConfig = $null
}
foreach ($line in $lines) {
  if ($line -match '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)="(.*)"$') {
    $name = switch ($Matches[1]) { 'API_URL' {'SUPABASE_URL'} 'ANON_KEY' {'SUPABASE_ANON_KEY'} 'SERVICE_ROLE_KEY' {'SUPABASE_SERVICE_ROLE_KEY'} }
    [Environment]::SetEnvironmentVariable($name, $Matches[2], 'Process')
  }
}
if ($env:SUPABASE_URL -ne 'http://127.0.0.1:47321' -or -not $env:SUPABASE_SERVICE_ROLE_KEY) { throw 'Unexpected test service address or missing test credentials' }
$env:MODEL_MOCK_MODE = 'true'
$env:COMPANION_EXPECT_MODEL_PROVIDER = 'mock'
$env:COMPANION_SUPABASE_WORKDIR = $fixtureRoot
$env:SUPABASE_TEST_DB_CONTAINER = 'supabase_db_android-companion-validation'
$env:SUPABASE_TEST_DOCKER_RUNTIME = 'wsl'
$env:SUPABASE_TEST_DOCKER_RUNTIME = 'wsl'
if ($Deno) {
  $denoPath = if ($env:DENO_BIN) { $env:DENO_BIN } else { Join-Path $env:LOCALAPPDATA 'npm-cache/_npx/05b6ef7b13673c57/node_modules/deno/deno.exe' }
  & $denoPath run --allow-env --allow-read --allow-net=127.0.0.1:47321,127.0.0.1:47329 --allow-write=test-results $Script
} else {
  & node $Script
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
