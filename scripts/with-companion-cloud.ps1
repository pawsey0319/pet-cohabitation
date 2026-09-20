param(
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [ValidateSet('scripts/test-companion-supabase.mjs', 'scripts/test-mobile-cloud.mjs', 'scripts/report-companion-runtime.mjs', 'scripts/benchmark-companion-cloud.mjs', 'scripts/test-chat-background-cloud.mjs')]
  [string]$Script = 'scripts/test-companion-supabase.mjs'
)
$ErrorActionPreference = 'Stop'
if ($ProjectRef -notmatch '^[a-z]{20}$') { throw 'Invalid project reference' }
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$keyOutput = & npx.cmd supabase projects api-keys --project-ref $ProjectRef --output json
if ($LASTEXITCODE -ne 0) { throw 'Cannot obtain validation credentials' }
$projectKeys = ($keyOutput -join "`n") | ConvertFrom-Json
$env:SUPABASE_URL = "https://$ProjectRef.supabase.co"
$env:SUPABASE_ANON_KEY = ($projectKeys | Where-Object id -eq 'anon' | Select-Object -First 1).api_key
$env:SUPABASE_SERVICE_ROLE_KEY = ($projectKeys | Where-Object id -eq 'service_role' | Select-Object -First 1).api_key
$keyOutput = $null
$projectKeys = $null
if (-not $env:SUPABASE_ANON_KEY -or -not $env:SUPABASE_SERVICE_ROLE_KEY) { throw 'Required credentials unavailable' }
$env:COMPANION_TEST_HOST = "$ProjectRef.supabase.co"
$env:MOBILE_TEST_HOST = $env:COMPANION_TEST_HOST
$env:COMPANION_EXPECT_MODEL_PROVIDER = 'openai-compatible'
try {
  & node $Script
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
}
