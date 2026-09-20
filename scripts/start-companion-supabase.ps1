# Dot-source in a dedicated test terminal to keep the local test environment:
# . ./scripts/start-companion-supabase.ps1
$ErrorActionPreference = 'Stop'
$companionRoot = Split-Path -Parent $PSScriptRoot
$companionWorkdir = Join-Path $companionRoot 'test-results/android-companion-supabase'
$companionConfigDir = Join-Path $companionWorkdir 'supabase'
$companionConfigPath = Join-Path $companionConfigDir 'config.toml'
if ((Test-Path -LiteralPath $companionConfigPath) -and
    (Get-Content -LiteralPath $companionConfigPath -Raw) -notmatch '(?m)^project_id\s*=\s*"android-companion-validation"\s*$') {
  throw 'The fixture directory belongs to another Supabase project.'
}
New-Item -ItemType Directory -Path $companionConfigDir -Force | Out-Null
@'
project_id = "android-companion-validation"
[api]
enabled = true
port = 47321
schemas = ["public", "storage", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[db]
port = 47322
shadow_port = 47320
major_version = 17
[studio]
enabled = false
[inbucket]
enabled = true
port = 47324
[analytics]
enabled = false
[auth]
enabled = true
site_url = "http://localhost:8082"
enable_signup = false
[storage]
enabled = true
file_size_limit = "8MiB"
[edge_runtime]
policy = "per_worker"
inspector_port = 8085
'@ | Set-Content -LiteralPath $companionConfigPath -Encoding utf8
foreach ($companionFolder in @('migrations', 'functions')) {
  $companionSource = Join-Path $companionRoot "supabase/$companionFolder"
  $companionTarget = Join-Path $companionConfigDir $companionFolder
  $companionExtension = if ($companionFolder -eq 'migrations') { '*.sql' } else { '*.ts' }
  Get-ChildItem -LiteralPath $companionSource -Filter $companionExtension -File -Recurse | ForEach-Object {
    $companionRelative = [IO.Path]::GetRelativePath($companionSource, $_.FullName)
    $companionDestination = Join-Path $companionTarget $companionRelative
    New-Item -ItemType Directory -Path (Split-Path -Parent $companionDestination) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $companionDestination -Force
  }
}
# Only source code is copied above. Never copy server model credentials.
'MODEL_MOCK_MODE=true' | Set-Content -LiteralPath (Join-Path $companionWorkdir 'functions.env') -Encoding utf8
& npx supabase start --workdir $companionWorkdir --output json > $null
if ($LASTEXITCODE -ne 0) { throw 'Could not start the isolated companion Supabase stack.' }
$companionEnvLines = & npx supabase status --workdir $companionWorkdir -o env 2> (Join-Path $companionWorkdir 'status.stderr.log')
if ($LASTEXITCODE -ne 0) { throw 'Could not read the isolated Supabase environment.' }
foreach ($companionLine in $companionEnvLines) {
  if ($companionLine -match '^(API_URL|ANON_KEY|PUBLISHABLE_KEY|SERVICE_ROLE_KEY)="(.*)"$') {
    $companionVarName = switch ($Matches[1]) {
      'API_URL' { 'SUPABASE_URL' }
      'ANON_KEY' { 'SUPABASE_ANON_KEY' }
      'PUBLISHABLE_KEY' { 'SUPABASE_PUBLISHABLE_KEY' }
      'SERVICE_ROLE_KEY' { 'SUPABASE_SERVICE_ROLE_KEY' }
    }
    [Environment]::SetEnvironmentVariable($companionVarName, $Matches[2], 'Process')
  }
}
$env:EXPO_PUBLIC_SUPABASE_URL = $env:SUPABASE_URL
$env:EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = if ($env:SUPABASE_PUBLISHABLE_KEY) { $env:SUPABASE_PUBLISHABLE_KEY } else { $env:SUPABASE_ANON_KEY }
$env:EXPO_PUBLIC_DEMO_MODE = 'false'
$env:EXPO_NO_DOTENV = '1'
Write-Output 'Isolated android-companion-validation stack is ready on port 47321; test variables loaded into this terminal.'
