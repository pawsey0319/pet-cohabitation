param([Parameter(Mandatory=$true)][string]$ExpectedBundle)
$ErrorActionPreference='Stop'
if($ExpectedBundle -notmatch '^index-[a-f0-9]{32}\.js$'){throw 'Explicit deployed bundle required'}
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$projectRef='lthcucgggoevgcboouqw'
$keyOutput=& npx.cmd supabase projects api-keys --project-ref $projectRef --output json
if($LASTEXITCODE -ne 0){throw 'Validation credentials unavailable'}
$projectKeys=($keyOutput -join "`n") | ConvertFrom-Json
$env:SUPABASE_URL="https://$projectRef.supabase.co"
$env:SUPABASE_ANON_KEY=($projectKeys | Where-Object id -eq 'anon' | Select-Object -First 1).api_key
$env:SUPABASE_SERVICE_ROLE_KEY=($projectKeys | Where-Object id -eq 'service_role' | Select-Object -First 1).api_key
$env:PUBLIC_UI_EXPECTED_BUNDLE=$ExpectedBundle
$keyOutput=$null
$projectKeys=$null
try { & node scripts/test-public-next-version-browser.mjs --cloud --deployment-ready; $validationExit=$LASTEXITCODE }
finally { Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY,Env:SUPABASE_ANON_KEY -ErrorAction SilentlyContinue }
exit $validationExit
