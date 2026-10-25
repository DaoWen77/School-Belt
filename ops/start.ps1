# O.M.V 帝江号 · 全域广播 —— Windows 一键脚本
# 用法：
#   .\start.ps1            # 构建并启动，然后跑迁移 + owner 初始化 + 种子
#   .\start.ps1 -Down      # 停止（保留数据卷）
#   .\start.ps1 -Logs      # 跟踪日志
#   .\start.ps1 -Reset     # 危险：删卷重建
#   .\start.ps1 -SkipSeed  # 不灌种子数据
[CmdletBinding()]
param(
  [switch]$Down,
  [switch]$Logs,
  [switch]$Reset,
  [switch]$SkipSeed,
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$OpsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $OpsDir '.env'
$ComposeBase = @('compose', '--project-directory', $OpsDir, '--env-file', $EnvFile, '-f', (Join-Path $OpsDir 'docker-compose.yml'))

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  & docker @ComposeBase @ComposeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') 失败（exit $LASTEXITCODE）" }
}

function Invoke-ApiCommand {
  param([string[]]$Command)
  Invoke-Compose (@('run', '--rm', '--no-deps', 'api') + $Command)
}

if (-not (Test-Path $EnvFile)) {
  Copy-Item (Join-Path $OpsDir '.env.example') $EnvFile
  Write-Host "已生成 $EnvFile（请按需修改 JWT 密钥与密码）" -ForegroundColor Yellow
}

if ($Down) {
  Invoke-Compose @('down')
  Write-Host '已停止（数据卷保留）' -ForegroundColor Green
  exit 0
}

if ($Logs) {
  Invoke-Compose @('logs', '-f', '--tail=200')
  exit 0
}

if ($Reset) {
  Write-Host '危险操作：将删除全部数据卷' -ForegroundColor Red
  $answer = Read-Host '输入 RESET 确认'
  if ($answer -ne 'RESET') { Write-Host '已取消'; exit 1 }
  Invoke-Compose @('down', '-v')
}

Write-Host '==> 构建并启动容器' -ForegroundColor Cyan
if ($NoBuild) {
  Invoke-Compose @('up', '-d')
} else {
  Invoke-Compose @('up', '-d', '--build')
}

Write-Host '==> 等待 postgres 就绪'
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  $status = & docker inspect --format '{{.State.Health.Status}}' dijiang-postgres 2>$null
  if ($status -eq 'healthy') { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw 'postgres 未在 80s 内就绪' }

Write-Host '==> prisma migrate deploy' -ForegroundColor Cyan
Invoke-ApiCommand @('node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy')

Write-Host '==> 初始化 owner 与验收频道' -ForegroundColor Cyan
Invoke-ApiCommand @('node', 'dist/scripts/init-owner.js')

if (-not $SkipSeed) {
  Write-Host '==> 灌入种子数据' -ForegroundColor Cyan
  Invoke-ApiCommand @('node', 'dist/scripts/seed.js')
}

Write-Host ''
Write-Host '启动完成：' -ForegroundColor Green
Write-Host '  API      http://localhost:3000/healthz'
Write-Host '  REST     http://localhost:3000/api/v1'
Write-Host '  MinIO    http://localhost:9001'
Write-Host '  Caddy    http://localhost/api/v1'
