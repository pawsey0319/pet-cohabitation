param(
  [string]$ProjectRef = "",
  [string]$AllowedOrigin = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot "supabase/functions/.env.local"
if (-not (Test-Path -LiteralPath $envFile)) { throw "缺少 supabase/functions/.env.local，无法读取 CPA 模型配置。" }

function Read-DotEnv([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $parts = $trimmed.Split("=", 2)
    $values[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
  }
  return $values
}

$settings = Read-DotEnv $envFile
foreach ($required in @("TEXT_API_KEY", "TEXT_MODEL", "IMAGE_API_KEY", "IMAGE_MODEL", "DEMO_PURGE_SECRET")) {
  if (-not $settings[$required]) { throw "模型环境缺少 $required。" }
}

$headers = @{ Authorization = "Bearer $($settings.TEXT_API_KEY)" }
try { $null = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8317/v1/models" -Headers $headers -TimeoutSec 8 }
catch { throw "CPA 当前不可用或密钥无效。请先启动 CPA，并确认 127.0.0.1:8317 可访问。" }

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
  $installed = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (Test-Path -LiteralPath $installed) { $cloudflared = $installed }
}
if (-not $cloudflared) { throw "未找到 cloudflared。请先执行 winget install Cloudflare.cloudflared。" }

$stateDir = Join-Path $repoRoot "supabase/.temp"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$stdout = Join-Path $stateDir "model-tunnel.stdout.log"
$stderr = Join-Path $stateDir "model-tunnel.stderr.log"
Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
$process = Start-Process -FilePath $cloudflared -ArgumentList @("tunnel", "--url", "http://127.0.0.1:8317", "--protocol", "http2", "--no-autoupdate") -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

$tunnelUrl = ""
for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  if ($process.HasExited) { throw "Cloudflare Tunnel 启动失败，请查看 $stderr。" }
  $output = ((Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue))
  if ($output -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $tunnelUrl = $matches[0]; break }
  Start-Sleep -Milliseconds 500
}
if (-not $tunnelUrl) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; throw "30 秒内没有取得公网隧道地址。" }

$modelBase = "$tunnelUrl/v1"
$publicReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  try { $null = Invoke-WebRequest -UseBasicParsing -Uri "$modelBase/models" -Headers $headers -TimeoutSec 8; $publicReady = $true; break }
  catch { Start-Sleep -Seconds 1 }
}
if (-not $publicReady -and $ProjectRef) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; throw "隧道已经建立，但 60 秒内公网模型探测仍失败，因此没有更新 Supabase Secrets。请检查当前网络是否能访问 trycloudflare.com。" }
if (-not $publicReady) { Write-Warning "隧道连接已建立，但随机域名尚未传播完成；进程会继续运行，可稍后再次探测。" }

@{ process_id = $process.Id; tunnel_url = $tunnelUrl; public_probe_passed = $publicReady; started_at = (Get-Date).ToString("o"); stdout = $stdout; stderr = $stderr } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDir "model-tunnel.json") -Encoding UTF8

if ($ProjectRef) {
  $secrets = @(
    "TEXT_API_BASE_URL=$modelBase",
    "TEXT_API_KEY=$($settings.TEXT_API_KEY)",
    "TEXT_MODEL=$($settings.TEXT_MODEL)",
    "IMAGE_API_BASE_URL=$modelBase",
    "IMAGE_API_KEY=$($settings.IMAGE_API_KEY)",
    "IMAGE_MODEL=$($settings.IMAGE_MODEL)",
    "MODEL_MOCK_MODE=false",
    "DEMO_PURGE_SECRET=$($settings.DEMO_PURGE_SECRET)"
  )
  if ($AllowedOrigin) { $secrets += "ALLOWED_ORIGINS=$AllowedOrigin,http://localhost:8081,http://localhost:3000" }
  & npx --yes supabase secrets set --project-ref $ProjectRef @secrets
  if ($LASTEXITCODE -ne 0) { throw "隧道已启动，但 Supabase Secrets 更新失败。" }
}

Write-Output "CPA 公网隧道已就绪：$tunnelUrl"
Write-Output "进程 ID：$($process.Id)。电脑、CPA 和该进程运行期间，云端异宠模型可用。"
