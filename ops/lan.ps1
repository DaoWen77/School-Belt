# O.M.V 工作台 · 全域广播 —— 局域网一键配置（Windows PowerShell）
#
# 作用：探测本机 LAN IP（或用 -Ip 指定）→ 生成 ops/.env.lan（CORS_ORIGINS / S3_PUBLIC_ENDPOINT /
#       NEXT_PUBLIC_API_BASE 提示）→ 打印可直接复制的启动命令。
#
# 用法：
#   pwsh -File ops/lan.ps1                 # 自动探测私网 IPv4
#   pwsh -File ops/lan.ps1 -Ip 192.168.1.9 # 手动指定（多网卡/无线+有线并存时推荐）
#   pwsh -File ops/lan.ps1 -ApiPort 3000 -WebPort 3100 -S3Port 9100
#   pwsh -File ops/lan.ps1 -NoWrite        # 只打印，不写文件
#   pwsh -File ops/lan.ps1 -ShowCommands   # 只重印上次生成的命令
#
# 生成文件：ops/.env.lan（仅供参考/复制，不会被自动加载；避免误改 .env）
[CmdletBinding()]
param(
  [string]$Ip,
  [int]$ApiPort = 3000,
  [int]$WebPort = 3100,
  [int]$S3Port = 9100,
  [switch]$NoWrite,
  [switch]$ShowCommands
)

$ErrorActionPreference = 'Stop'
$OpsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $OpsDir
$EnvFile = Join-Path $OpsDir '.env.lan'

function Test-PrivateIpv4 {
  param([string]$Address)
  return $Address -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)'
}

function Get-LanIp {
  $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      (Test-PrivateIpv4 $_.IPAddress)
    } |
    Sort-Object -Property @{ Expression = { if ($_.InterfaceAlias -match 'WLAN|Wi-Fi|无线') { 0 } else { 1 } } }, InterfaceAlias

  if (-not $candidates -or $candidates.Count -eq 0) {
    throw '未探测到私网 IPv4（10./192.168./172.16-31.）。请用 -Ip <地址> 手动指定，例如 -Ip 192.168.1.9'
  }
  return $candidates[0].IPAddress
}

if ($ShowCommands -and (Test-Path $EnvFile)) {
  $Ip = (Select-String -Path $EnvFile -Pattern '^LAN_IP=(.+)$').Matches.Groups[1].Value
  if (-not $Ip) { $Ip = Get-LanIp }
} elseif (-not $Ip) {
  $Ip = Get-LanIp
}

if ($Ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
  throw "非法 IPv4 地址：$Ip"
}
if (-not (Test-PrivateIpv4 $Ip)) {
  Write-Warning "$Ip 不是私网地址；局域网访问只建议使用 10./192.168./172.16-31. 网段。"
}

$CorsOrigins = @(
  "http://localhost:$WebPort",
  "http://localhost:$ApiPort",
  "http://127.0.0.1:$WebPort",
  "http://127.0.0.1:$ApiPort",
  "http://${Ip}:$WebPort",
  "http://${Ip}:$ApiPort"
) -join ','
$ApiBase = "http://${Ip}:$ApiPort"
$WebUrl = "http://${Ip}:$WebPort"
$S3Public = "http://${Ip}:$S3Port"

$envLines = @(
  '# 由 ops/lan.ps1 生成 —— 复制到当前终端，或写入系统环境变量后重启进程',
  "# 生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
  "LAN_IP=$Ip",
  'API_HOST=0.0.0.0',
  "CORS_ORIGINS=$CorsOrigins",
  "S3_ENDPOINT=http://127.0.0.1:$S3Port",
  "S3_PUBLIC_ENDPOINT=$S3Public",
  "# 前端可选：不设置时自动按浏览器 hostname 推导为 $ApiBase",
  "NEXT_PUBLIC_API_BASE=$ApiBase"
)

if (-not $NoWrite) {
  Set-Content -LiteralPath $EnvFile -Value $envLines -Encoding UTF8
}

Write-Host ''
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host "  工作台 · 局域网访问配置（LAN_IP=$Ip）" -ForegroundColor Cyan
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host "  手机/其他设备打开: $WebUrl"
Write-Host "  API 探针:          $ApiBase/healthz"
Write-Host "  S3 直传地址:       $S3Public"
Write-Host "  CORS 白名单:       $CorsOrigins"
if (-not $NoWrite) { Write-Host "  已写入:            $EnvFile" -ForegroundColor DarkGray }
Write-Host ''
Write-Host '── 1) 启动后端（新开一个 PowerShell 窗口）──────────────────' -ForegroundColor Yellow
Write-Host @"
cd "$RootDir"

`$env:API_HOST = '0.0.0.0'
`$env:CORS_ORIGINS = '$CorsOrigins'
`$env:S3_ENDPOINT = 'http://127.0.0.1:$S3Port'
`$env:S3_PUBLIC_ENDPOINT = '$S3Public'
node ops/e2e/run-backend.mjs --with-s3
"@
Write-Host ''
Write-Host '── 2) 启动前端（再开一个窗口）──────────────────────────────' -ForegroundColor Yellow
Write-Host @"
cd "$RootDir/web"

# 推荐不设 NEXT_PUBLIC_API_BASE：页面按 hostname 自动推导，换 IP 不用重新 build
pnpm dev          # next dev -H 0.0.0.0 -p $WebPort
# 生产模式：pnpm build && pnpm start
"@
Write-Host ''
Write-Host '── 3) 永久环境变量（可选，改完需重启进程/终端）──────────────' -ForegroundColor Yellow
Write-Host @"
[Environment]::SetEnvironmentVariable('CORS_ORIGINS', '$CorsOrigins', 'User')
[Environment]::SetEnvironmentVariable('S3_PUBLIC_ENDPOINT', '$S3Public', 'User')
[Environment]::SetEnvironmentVariable('NEXT_PUBLIC_API_BASE', '$ApiBase', 'User')
# 删除：传入 `$null；查看： [Environment]::GetEnvironmentVariable('CORS_ORIGINS','User')
"@
Write-Host ''
Write-Host '── 4) 防火墙（管理员 PowerShell，一次即可）──────────────────' -ForegroundColor Yellow
Write-Host @"
New-NetFirewallRule -DisplayName 'Dijiang API $ApiPort'  -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ApiPort
New-NetFirewallRule -DisplayName 'Dijiang Web $WebPort'  -Direction Inbound -Action Allow -Protocol TCP -LocalPort $WebPort
New-NetFirewallRule -DisplayName 'Dijiang S3  $S3Port'   -Direction Inbound -Action Allow -Protocol TCP -LocalPort $S3Port
"@
Write-Host ''
Write-Host '提示：手机需与电脑同一网段；公司/公共 WiFi 若开启 AP 隔离则无法互访。' -ForegroundColor DarkGray
Write-Host '排障与验收步骤见 docs/19-局域网访问.md' -ForegroundColor DarkGray
