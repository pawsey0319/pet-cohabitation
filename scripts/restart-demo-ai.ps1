param(
  [string]$ProjectRef = "lthcucgggoevgcboouqw",
  [string]$CpaConfigPath = "D:\CLIProxyAPI\config.yaml",
  [switch]$NoWait
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $repoRoot "supabase/.temp/model-tunnel.json"
Set-Location -LiteralPath $repoRoot

if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
  throw "没有找到 Node.js/npx，请先安装 Node.js，再重新打开此窗口。"
}

# Keep API keys only in memory. Do this before stopping a working tunnel.
Write-Host "[1/4] 检查 Supabase 登录与项目权限（不显示密钥）..."
$keyOutput = & npx.cmd --yes supabase projects api-keys --project-ref $ProjectRef --output json
if ($LASTEXITCODE -ne 0) { throw "Supabase 登录不可用。请在终端运行 npx supabase login 后重试。" }
$keys = ($keyOutput -join "`n") | ConvertFrom-Json
$serviceKey = ($keys | Where-Object id -eq "service_role" | Select-Object -First 1).api_key
$anonKey = ($keys | Where-Object id -eq "anon" | Select-Object -First 1).api_key
$keyOutput = $null
$keys = $null
if (-not $serviceKey -or -not $anonKey) { throw "当前账号无法取得项目探测权限，未更改隧道。" }

Write-Host "[2/4] 重启本项目的 CPA 隧道并同步云端地址..."
& (Join-Path $PSScriptRoot "stop-demo-model-tunnel.ps1")
# Some local networks cannot loop back through trycloudflare.com. The next step
# verifies the actual Supabase -> CPA route instead; TLS checks remain enabled.
& (Join-Path $PSScriptRoot "start-demo-model-tunnel.ps1") -ProjectRef $ProjectRef -CpaConfigPath $CpaConfigPath -SkipLocalPublicProbe

Write-Host "[3/4] 从 Supabase 云端检查文本与图片接口..."
$baseUrl = "https://$ProjectRef.supabase.co"
$adminHeaders = @{ apikey = $serviceKey; Authorization = "Bearer $serviceKey" }
$probeUserId = $null
try {
  # Disposable diagnostic identity: no real user's session, chats, or pet is touched.
  $email = "tunnel-probe-$([guid]::NewGuid().ToString('N'))@example.test"
  $password = "Tmp-$([guid]::NewGuid().ToString('N'))!"
  $created = Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/v1/admin/users" -Headers $adminHeaders -ContentType "application/json" -TimeoutSec 20 -Body (@{ email = $email; password = $password; email_confirm = $true } | ConvertTo-Json)
  $probeUserId = $created.id
  if (-not $probeUserId) { throw "无法建立临时云端探测会话。" }
  $session = Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/v1/token?grant_type=password" -Headers @{ apikey = $anonKey } -ContentType "application/json" -TimeoutSec 20 -Body (@{ email = $email; password = $password } | ConvertTo-Json)
  $healthHeaders = @{ apikey = $anonKey; Authorization = "Bearer $($session.access_token)" }
  $health = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $health = Invoke-RestMethod -Method Post -Uri "$baseUrl/functions/v1/model-health" -Headers $healthHeaders -ContentType "application/json" -Body "{}" -TimeoutSec 25
    if ($health.status_code -eq "online" -and $health.text_online -and $health.image_online) { break }
    if ($attempt -lt 3) { Start-Sleep -Seconds 3 }
  }
  if ($health.status_code -ne "online" -or -not $health.text_online -or -not $health.image_online) {
    throw "云端仍未连通 AI。请检查 CPA 和网络，稍后重试；不要只凭隧道进程判断成功。"
  }
  $verifiedState = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  $verifiedState | Add-Member -NotePropertyName "cloud_probe_passed" -NotePropertyValue $true -Force
  $verifiedState | Add-Member -NotePropertyName "cloud_checked_at" -NotePropertyValue $health.checked_at -Force
  $verifiedState | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
  Write-Host "[4/4] AI 已恢复：云端文本接口在线，图片接口在线。" -ForegroundColor Green
  Write-Host "云端检查时间：$($health.checked_at)"
} finally {
  if ($probeUserId) {
    try {
      $null = Invoke-RestMethod -Method Delete -Uri "$baseUrl/auth/v1/admin/users/$probeUserId" -Headers $adminHeaders -TimeoutSec 20
    } catch {
      Write-Warning "临时探测账号清理失败，ID：$probeUserId。请稍后通过后台清理；它没有聊天或异宠数据。"
    }
  }
  $serviceKey = $null
  $anonKey = $null
  $password = $null
  $session = $null
  $adminHeaders = $null
  $healthHeaders = $null
}

Write-Host "请在手机重新进入异宠页。无需重新安装 APK 或发布 OTA。"
if (-not $NoWait) {
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  Write-Host "请保持此窗口和 CPA 运行（可最小化）。下次离线时重新运行启动入口即可。"
  Wait-Process -Id $state.process_id
  Write-Warning "隧道进程已结束；需要使用 AI 时请重新运行启动入口。"
}
