# O.M.V 帝江号 · 本机一键启动（前端 + 后端，不用 Docker）
# 用法：
#   .\一键启动.cmd               # 缺产物则构建，然后起 API(3000) + Web(3100)，开浏览器
#   .\一键启动.cmd -Rebuild      # 强制重构建
#   .\一键启动.cmd -Stop         # 停掉本脚本启动的进程
#   .\一键启动.cmd -NoBrowser    # 不开浏览器
# 依赖：Node >= 22（含 --env-file）、pnpm；后端还需 Postgres + Redis（连接串见 server/.env）
[CmdletBinding()]
param(
  [switch]$Rebuild,
  [switch]$Stop,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ServerDir = Join-Path $Root 'server'
$WebDir = Join-Path $Root 'web'
$RunDir = Join-Path $Root 'ops\.run'
$PidFile = Join-Path $RunDir 'pids.json'
$ApiUrl = 'http://localhost:3000'
$WebUrl = 'http://localhost:3100'
# 探针走 127.0.0.1：0.0.0.0 只绑 IPv4，.NET 先试 ::1 会超时
$ProbeWeb = 'http://127.0.0.1:3100'
$ProbeApi = 'http://127.0.0.1:3000'
$Pnpm = (Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue).Source
if (-not $Pnpm) { $Pnpm = 'pnpm' }

if ($Stop) {
  if (Test-Path $PidFile) {
    $pids = Get-Content $PidFile -Raw | ConvertFrom-Json
    foreach ($id in @($pids.api, $pids.web)) {
      if ($id) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
        Write-Host "已停止 PID $id" -ForegroundColor Yellow
      }
    }
    Remove-Item $PidFile -Force
  } else {
    Write-Host '没有本脚本记录的进程。' -ForegroundColor Yellow
  }
  return
}

function Invoke-Step([string]$Title, [string]$WorkDir, [scriptblock]$ScriptBlock) {
  Write-Host "==> $Title" -ForegroundColor Cyan
  Push-Location $WorkDir
  try {
    & $ScriptBlock
    if ($LASTEXITCODE -ne 0) { throw "$Title 失败（exit $LASTEXITCODE）" }
  } finally { Pop-Location }
}

# 0) 后端 .env：缺 DATABASE_URL / REDIS_URL 时，从 .env.example 补齐缺失键（不改已有值）
$EnvPath = Join-Path $ServerDir '.env'
$ExamplePath = Join-Path $ServerDir '.env.example'
$current = if (Test-Path $EnvPath) { Get-Content $EnvPath -Raw } else { '' }
$missing = @()
foreach ($line in (Get-Content $ExamplePath)) {
  if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Z0-9_]+)\s*=') { continue }
  $key = $Matches[1]
  if ($current -notmatch "(?m)^\s*$key\s*=") { $missing += $line.TrimEnd() }
}
if ($missing.Count -gt 0) {
  $block = "`r`n# --- 一键启动自动补齐（取自 server/.env.example）---`r`n" + ($missing -join "`r`n") + "`r`n"
  Add-Content -Path $EnvPath -Value $block -Encoding utf8
  Write-Host "已向 server/.env 补齐 $($missing.Count) 个缺失键（DATABASE_URL / REDIS_URL 等按需改）" -ForegroundColor Yellow
}

# 1) 依赖
foreach ($dir in 'server', 'web') {
  if (-not (Test-Path (Join-Path $Root "$dir\node_modules"))) {
    Invoke-Step "安装 $dir 依赖" (Join-Path $Root $dir) { & $Pnpm install --frozen-lockfile }
  }
}

# 2) 构建（产物缺失或 -Rebuild）
if ($Rebuild -or -not (Test-Path (Join-Path $Root 'server\dist\main.js'))) {
  Invoke-Step '构建后端' $ServerDir { & $Pnpm build }
}
if ($Rebuild -or -not (Test-Path (Join-Path $Root 'web\.next\BUILD_ID'))) {
  Invoke-Step '构建前端' $WebDir { & $Pnpm build }
}

# 3) 停掉上一轮实例，避免端口占用
if (Test-Path $PidFile) {
  $previous = Get-Content $PidFile -Raw | ConvertFrom-Json
  foreach ($id in @($previous.api, $previous.web)) {
    if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item $PidFile -Force
}

# 4) 起进程：日志落 ops/.run/，窗口最小化，关窗口即停
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
$dbUp = Test-NetConnection -ComputerName '127.0.0.1' -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $dbUp) {
  Write-Host '警告：本机 127.0.0.1:5432 没有 Postgres。前端照常启动，后端会因连不上库退出。' -ForegroundColor Yellow
  Write-Host '      起库方式见 ops/docker-compose.yml，或改 server/.env 的 DATABASE_URL 指向已有实例。' -ForegroundColor DarkGray
}
$apiLog = Join-Path $RunDir 'api.log'
$webLog = Join-Path $RunDir 'web.log'
$envFile = '--env-file=' + $EnvPath
$api = Start-Process -FilePath 'node' -ArgumentList @($envFile, 'dist/main.js') `
  -WorkingDirectory $ServerDir -PassThru -WindowStyle Minimized `
  -RedirectStandardOutput $apiLog -RedirectStandardError (Join-Path $RunDir 'api.err.log')
# 直接调 next 的 bin，避开 pnpm 在 Start-Process 下的 .cmd shim
$nextBin = Join-Path $WebDir 'node_modules\next\dist\bin\next'
$web = Start-Process -FilePath 'node' -ArgumentList @($nextBin, 'start', '-H', '0.0.0.0', '-p', '3100') `
  -WorkingDirectory $WebDir -PassThru -WindowStyle Minimized `
  -RedirectStandardOutput $webLog -RedirectStandardError (Join-Path $RunDir 'web.err.log')
@{ api = $api.Id; web = $web.Id } | ConvertTo-Json | Set-Content -Path $PidFile -Encoding utf8

# 5) 等 Web 就绪；顺便探一下后端
Write-Host '等待服务就绪…' -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  try {
    if ((Invoke-WebRequest -Uri $ProbeWeb -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { break }
  } catch { Start-Sleep -Milliseconds 800 }
}

$apiState = try {
  $probe = Invoke-WebRequest -Uri $ProbeApi -UseBasicParsing -TimeoutSec 3
  "OK ($($probe.StatusCode))"
} catch {
  '未就绪（Postgres/Redis 没起？见 ops\.run\api.log）'
}

Write-Host ''
Write-Host "帝江号内网  : $WebUrl" -ForegroundColor Green
Write-Host "文明环带    : $WebUrl/belt" -ForegroundColor Green
Write-Host "后端 API    : $ApiUrl/api/v1    探针 $ApiUrl/readyz -> $apiState" -ForegroundColor Green
Write-Host "日志        : ops\.run\api.log / web.log" -ForegroundColor DarkGray
Write-Host "停止        : .\一键启动.cmd -Stop   （或关掉两个最小化窗口）" -ForegroundColor DarkGray

if (-not $NoBrowser) { Start-Process $WebUrl }
