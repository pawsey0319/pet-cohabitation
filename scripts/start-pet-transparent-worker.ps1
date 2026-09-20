param(
  [string]$PythonPath = (Join-Path $env:TEMP 'pet-transparent-validation/venv/Scripts/python.exe'),
  [string]$ModelDirectory = (Join-Path $env:TEMP 'pet-transparent-validation')
)
$ErrorActionPreference = 'Stop'
$projectRef = 'lthcucgggoevgcboouqw'
$repoRoot = Split-Path -Parent $PSScriptRoot
$stateDirectory = Join-Path $env:LOCALAPPDATA "PetCompanion/$projectRef"
$credentialPath = Join-Path $stateDirectory 'transparent-worker.credential'
$statePath = Join-Path $stateDirectory 'transparent-worker.json'
if (-not (Test-Path -LiteralPath $credentialPath)) { throw '透明形象服务尚未配置本机凭据。' }
if (Test-Path -LiteralPath $statePath) {
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  $existing = Get-Process -Id $state.process_id -ErrorAction SilentlyContinue
  $started = if ($state.started_at -is [datetime]) { $state.started_at.ToUniversalTime() } else { [datetime]::Parse($state.started_at).ToUniversalTime() }
  if ($existing -and $existing.ProcessName -eq 'python' -and $existing.StartTime.ToUniversalTime().Ticks -eq $started.Ticks -and $existing.Path -eq $state.python_path) {
    Write-Output '透明形象处理进程已在运行；实际结果以云端任务状态为准。'
    return
  }
}
if (-not (Test-Path -LiteralPath $PythonPath)) { throw '找不到已经验证的透明形象 Python 环境。' }
$workerPath = Join-Path $repoRoot 'src/avatars/transparent-worker/worker.py'
& $PythonPath $workerPath --model-dir $ModelDirectory --verify-model
if ($LASTEXITCODE -ne 0) { throw '透明形象模型校验未通过，未启动。' }
$encrypted = (Get-Content -LiteralPath $credentialPath -Raw).Trim()
$secure = ConvertTo-SecureString $encrypted
$pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$previousToken = $env:PET_TRANSPARENT_WORKER_TOKEN
$previousUrl = $env:PET_TRANSPARENT_WORKER_URL
$previousNoProxy = $env:NO_PROXY
try {
  $env:PET_TRANSPARENT_WORKER_TOKEN = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:PET_TRANSPARENT_WORKER_URL = "https://$projectRef.supabase.co/functions/v1/pet-transparent-worker"
  $env:NO_PROXY = (@($previousNoProxy, '127.0.0.1', 'localhost', '::1') | Where-Object { $_ }) -join ','
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $stdout = Join-Path $stateDirectory "transparent-$stamp.stdout.log"
  $stderr = Join-Path $stateDirectory "transparent-$stamp.stderr.log"
  # Only fixed local file paths enter arguments. The credential is inherited
  # through process memory, never a command argument or printable configuration.
  if ($workerPath.Contains('"') -or $ModelDirectory.Contains('"')) { throw '无效的本机工作目录。' }
  $arguments = @('-u', ('"'+$workerPath+'"'), '--model-dir', ('"'+$ModelDirectory+'"'))
  $workerProcess = Start-Process -FilePath $PythonPath -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  @{ process_id=$workerProcess.Id; started_at=$workerProcess.StartTime.ToUniversalTime().ToString('o'); python_path=$workerProcess.Path; stdout=$stdout; stderr=$stderr; project=$projectRef } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
  Write-Output ('透明形象处理进程已启动，进程 ID：'+$workerProcess.Id+'。仅处理云端已授权任务，结果需本人预览确认。')
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $secure.Dispose()
  $env:PET_TRANSPARENT_WORKER_TOKEN = $previousToken
  $env:PET_TRANSPARENT_WORKER_URL = $previousUrl
  $env:NO_PROXY = $previousNoProxy
}
