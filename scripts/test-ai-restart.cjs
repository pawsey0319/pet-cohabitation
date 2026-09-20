// Run the actual Windows entry script with isolated files and synthetic HTTP responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'win32') process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-ai-restart-test-'));
const scripts = path.join(root, 'scripts');
const stateDir = path.join(root, 'supabase', '.temp');
fs.mkdirSync(scripts, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'restart-demo-ai.ps1'), path.join(scripts, 'restart-demo-ai.ps1'));
const writePs = (name, text) => fs.writeFileSync(path.join(scripts, name), '\ufeff' + text);
writePs('stop-demo-model-tunnel.ps1', '$global:stops += 1');
writePs('start-demo-model-tunnel.ps1', '$global:starts += 1');
const harness = `param([string]$Case)
$ErrorActionPreference = 'Stop'
$global:profile = $false; $global:deleted = $false; $global:healthCalls = 0
$global:starts = 0; $global:stops = 0; $global:missingProfile = $false
function npx.cmd { $global:LASTEXITCODE = 0; '[{"id":"service_role","api_key":"synthetic-service"},{"id":"anon","api_key":"synthetic-anon"}]' }
function Start-Sleep {}
function Invoke-RestMethod {
 param($Method, $Uri, $Headers, $ContentType, $TimeoutSec, $Body)
 if ($Method -eq 'Delete') { $global:deleted = $true; return }
 if ($Uri.EndsWith('/auth/v1/admin/users')) { return @{id='synthetic-owner'} }
 if ($Uri.EndsWith('/rest/v1/profiles')) {
   if ($Case -eq 'profile-failure') { throw 'synthetic_profile_failure' }
   $record = $Body | ConvertFrom-Json
   if ($record.id -ne 'synthetic-owner' -or -not $record.email) { throw 'invalid_profile' }
   $global:profile = $true; return
 }
 if ($Uri.Contains('/auth/v1/token?')) { return @{access_token='synthetic-token'} }
 if ($Uri.EndsWith('/functions/v1/model-health')) {
   $global:healthCalls += 1
   if (-not $global:profile) { $global:missingProfile = $true }
   $passed = $global:profile -and $Case -ne 'text-failure'
   return @{text_online=$passed; image_online=$true; status_code=$(if ($passed) {'online'} else {'partial'}); text_error=$(if ($Case -eq 'text-failure') {'text_model_http_401'} else {'text_health_check_unavailable'}); checked_at='2026-09-09T03:00:00Z'}
 }
 throw 'unexpected_endpoint'
}
$failure = $null
try {
 if ($Case -eq 'check-only') { & (Join-Path $PSScriptRoot 'restart-demo-ai.ps1') -NoWait -CheckOnly }
 else { & (Join-Path $PSScriptRoot 'restart-demo-ai.ps1') -NoWait }
} catch { $failure = $_.Exception.Message }
[ordered]@{failed=[bool]$failure; message=$failure; profile=$global:profile; deleted=$global:deleted; healthCalls=$global:healthCalls; missingProfile=$global:missingProfile; starts=$global:starts; stops=$global:stops} | ConvertTo-Json -Compress | Write-Output
`;
writePs('harness.ps1', harness);
try {
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const available = spawnSync(shell, ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true });
    if (available.error?.code === 'ENOENT') continue;
    for (const scenario of ['success', 'text-failure', 'profile-failure', 'check-only']) {
      fs.writeFileSync(path.join(stateDir, 'model-tunnel.json'), JSON.stringify({process_id: 1, tunnel_url: 'https://synthetic.invalid'}));
      const run = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, 'harness.ps1'), scenario], {encoding: 'utf8', windowsHide: true, timeout: 15000});
      assert.equal(run.status, 0, run.stderr);
      const result = JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));
      assert.equal(result.missingProfile, false, `${shell}/${scenario}: health requires a profile before reserving its model run`);
      assert.equal(result.deleted, true, `${shell}/${scenario}: temporary account must always be deleted`);
      if (scenario === 'success' || scenario === 'check-only') {
        assert.equal(result.failed, false, result.message);
        assert.equal(result.healthCalls, 1);
        assert.equal(result.starts, scenario === 'check-only' ? 0 : 1);
        assert.equal(result.stops, scenario === 'check-only' ? 0 : 1);
        assert.equal(JSON.parse(fs.readFileSync(path.join(stateDir, 'model-tunnel.json'), 'utf8').replace(/^\ufeff/, '')).cloud_probe_passed, true);
      } else {
        assert.equal(result.failed, true);
        if (scenario === 'text-failure') assert.match(result.message, /text_model_http_401/);
        if (scenario === 'profile-failure') assert.equal(result.healthCalls, 0);
      }
    }
  }
  console.log('PASS: real restart script initializes profile, separates errors, cleans up, and checks without restarting on Windows PowerShell / available PowerShell 7.');
} finally {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('pet-ai-restart-test-')) throw Error('Unsafe cleanup target');
  fs.rmSync(root, {recursive: true});
}
