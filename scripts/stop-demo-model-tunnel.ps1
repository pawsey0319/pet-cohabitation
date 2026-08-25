$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $repoRoot "supabase/.temp/model-tunnel.json"
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Output "没有找到正在运行的 Demo 模型隧道。"; exit 0 }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$process = Get-Process -Id $state.process_id -ErrorAction SilentlyContinue
if ($process) { Stop-Process -Id $process.Id -Force; Write-Output "已停止 Demo 模型隧道。" }
Remove-Item -LiteralPath $stateFile -Force
