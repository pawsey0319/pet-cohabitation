$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $repoRoot "supabase/.temp/model-tunnel.json"
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Output "没有找到正在运行的 Demo 模型隧道。"; exit 0 }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$process = Get-Process -Id $state.process_id -ErrorAction SilentlyContinue
if ($process) {
  if ($process.ProcessName -ne "cloudflared" -or -not $state.process_started_at -or
      $process.StartTime.ToUniversalTime().Ticks -ne ([datetime]$state.process_started_at).ToUniversalTime().Ticks) {
    throw "记录中的进程身份已变化，未停止任何进程。请检查 model-tunnel.json，避免误关其他程序。"
  }
  Stop-Process -Id $process.Id -Force
  Write-Output "已停止 Demo 模型隧道。"
}
Remove-Item -LiteralPath $stateFile -Force
