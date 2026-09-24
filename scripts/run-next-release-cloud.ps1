param(
  [Parameter(Mandatory=$true)][ValidateSet('smoke','measure-group','measure-companion','measure-recall','inventory')][string]$Action,
  [ValidatePattern('^[a-z0-9-]{1,40}$')][string]$Label = 'next-release-20260921',
  [ValidateRange(1,40)][int]$Samples = 20,
  [switch]$OrdinaryOnly,
  [switch]$VerifyReplay
)
$ErrorActionPreference = 'Stop'
if ($Action -in @('measure-companion','measure-recall') -and $Samples -gt 20) { throw 'Companion measurements support at most 20 samples per run' }
if ($VerifyReplay -and ($Action -notin @('measure-companion','measure-recall') -or $Samples -ne 1)) { throw 'Replay verification requires a companion/recall run with exactly one sample' }
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$project = 'lthcucgggoevgcboouqw'
if ($Action -eq 'inventory') {
  $target = Join-Path $root ('test-results/' + $Label + '-functions.json')
  if (Test-Path -LiteralPath $target) { throw 'Choose a new label; previous evidence is preserved' }
  $raw = & npx.cmd supabase functions list --project-ref $project --output json
  if ($LASTEXITCODE -ne 0) { throw 'Cloud function inventory unavailable' }
  $functions = ($raw -join "`n") | ConvertFrom-Json
  @{at=[DateTime]::UtcNow.ToString('o');project=$project;functions=$functions} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $target
  Write-Output ('Saved cloud function inventory: ' + $target)
  return
}
$prior = @{}
foreach ($key in @('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY')) { $prior[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
  $raw = & npx.cmd supabase projects api-keys --project-ref $project --output json
  if ($LASTEXITCODE -ne 0) { throw 'Existing validation credentials unavailable' }
  $keys = ($raw -join "`n") | ConvertFrom-Json
  $env:SUPABASE_URL = "https://$project.supabase.co"
  $env:SUPABASE_ANON_KEY = ($keys | Where-Object id -eq 'anon' | Select-Object -First 1).api_key
  $env:SUPABASE_SERVICE_ROLE_KEY = ($keys | Where-Object id -eq 'service_role' | Select-Object -First 1).api_key
  $raw = $null; $keys = $null
  if (-not $env:SUPABASE_ANON_KEY -or -not $env:SUPABASE_SERVICE_ROLE_KEY) { throw 'Required credentials unavailable' }
  if ($Action -eq 'smoke') { & node scripts/test-next-version-cloud.mjs --cloud --project-ref $project }
  elseif ($Action -eq 'measure-group') {
    $measurementArgs = @('scripts/measure-group-reply-cloud.mjs','--cloud','--label',$Label,'--samples',"$Samples")
    if ($OrdinaryOnly) { $measurementArgs += '--ordinary-only' }
    & node @measurementArgs
  } else {
    $measurementArgs = @('scripts/test-companion-group-recall-cloud.mjs','--cloud','--label',$Label,'--samples',"$Samples")
    if ($Action -eq 'measure-companion') { $measurementArgs += '--plain' }
    if ($VerifyReplay) { $measurementArgs += '--final' }
    & node @measurementArgs
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  foreach ($key in $prior.Keys) { [Environment]::SetEnvironmentVariable($key, $prior[$key], 'Process') }
}
