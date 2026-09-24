$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$project='lthcucgggoevgcboouqw'
$prior=@{}
foreach($key in @('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY')){$prior[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
try {
 $raw=& npx.cmd supabase projects api-keys --project-ref $project --output json
 if($LASTEXITCODE -ne 0){throw 'Existing project credentials unavailable'}
 $keys=($raw -join "`n")|ConvertFrom-Json
 $env:SUPABASE_URL="https://$project.supabase.co"
 $env:SUPABASE_ANON_KEY=($keys|Where-Object id -eq 'anon'|Select-Object -First 1).api_key
 $env:SUPABASE_SERVICE_ROLE_KEY=($keys|Where-Object id -eq 'service_role'|Select-Object -First 1).api_key
 $keys=$null;$raw=$null
 if(-not $env:SUPABASE_ANON_KEY -or -not $env:SUPABASE_SERVICE_ROLE_KEY){throw 'Missing validation credentials'}
 & node scripts/test-pet-capabilities-cloud.mjs --cloud
 $result=$LASTEXITCODE
 if($result -ne 0){
  & npx.cmd supabase secrets set PET_CAPABILITIES_ENABLED=false --project-ref $project
  throw 'Cloud capability verification failed; execution flag disabled pending repair. Candidate client not published.'
 }
} finally {foreach($key in $prior.Keys){[Environment]::SetEnvironmentVariable($key,$prior[$key],'Process')}}
