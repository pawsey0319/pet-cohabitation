param([string]$PythonCommand = 'python')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'PetCompanion/transparent-runtime'
$venvDirectory = Join-Path $runtimeRoot 'venv'
$runtimePython = Join-Path $venvDirectory 'Scripts/python.exe'
$modelDirectory = Join-Path $runtimeRoot 'models'
$workerDirectory = Join-Path $repoRoot 'src/avatars/transparent-worker'
$lock = Get-Content -LiteralPath (Join-Path $workerDirectory 'model.lock.json') -Raw | ConvertFrom-Json
if ($lock.name -ne 'isnet-general-use' -or $lock.filename -ne 'isnet-general-use.onnx' -or $lock.url -ne 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx') { throw 'Unexpected locked model' }
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw '需要已安装的 uv 来核对并安装锁定依赖。' }
$version = & $PythonCommand -c 'import sys; print(str(sys.version_info.major)+"."+str(sys.version_info.minor))'
if ($LASTEXITCODE -ne 0 -or $version -ne '3.13') { throw '锁定环境需要 Python 3.13。' }
New-Item -ItemType Directory -Path $runtimeRoot,$modelDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $runtimePython)) {
  & $PythonCommand -m venv $venvDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed' }
}
# Resolve Windows redirected AppData before uv creates executable entry points;
# crossing the apparent C: path and its actual D: target can fail atomic writes.
$runtimePython = & $PythonCommand -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' $runtimePython
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $runtimePython)) { throw 'Cannot resolve runtime interpreter' }
& uv pip sync --python $runtimePython --link-mode copy --require-hashes (Join-Path $workerDirectory 'requirements.lock')
if ($LASTEXITCODE -ne 0) { throw 'Locked runtime dependency verification failed' }
$modelPath = Join-Path $modelDirectory $lock.filename
if (-not (Test-Path -LiteralPath $modelPath)) {
  $partial = Join-Path $modelDirectory ($lock.filename + '.download')
  & curl.exe --fail --location --retry 2 --connect-timeout 15 --max-time 300 --silent --show-error --output $partial $lock.url
  if ($LASTEXITCODE -ne 0) { throw 'Locked model download failed; runtime was not started' }
  if ((Get-Item -LiteralPath $partial).Length -ne $lock.bytes -or (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.sha256) { throw 'Downloaded model checksum mismatch; runtime was not started' }
  Move-Item -LiteralPath $partial -Destination $modelPath
}
& $runtimePython (Join-Path $workerDirectory 'worker.py') --model-dir $modelDirectory --verify-model
if ($LASTEXITCODE -ne 0) { throw 'Locked model verification failed; runtime was not started' }
$previousNumbaCache = $env:NUMBA_CACHE_DIR
try {
  $env:NUMBA_CACHE_DIR = & $runtimePython -c 'from pathlib import Path; p=(Path.home()/".pet-companion-cache"/"numba").resolve(); p.mkdir(parents=True,exist_ok=True); print(p)'
  if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare segmentation cache' }
  & $runtimePython -c 'import rembg, onnxruntime; print("Locked segmentation runtime imports successfully.")'
  if ($LASTEXITCODE -ne 0) { throw 'Segmentation runtime import failed; runtime was not started' }
} finally { $env:NUMBA_CACHE_DIR = $previousNumbaCache }
Write-Output ('透明形象运行环境已验证：' + $runtimeRoot)
Write-Output '运行 scripts/start-pet-transparent-worker.ps1 启动；凭据沿用本机现有加密配置。'
