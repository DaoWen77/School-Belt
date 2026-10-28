# O.M.V 工作台 · 全域广播 —— 一键验收脚本（Windows / PowerShell 5.1+ 与 7+）
#
# 用法（在任意目录执行均可）：
#   pwsh -File ops/acceptance/start.ps1                 # 自动：有 Docker 跑全栈，没有则跑静态验收
#   pwsh -File ops/acceptance/start.ps1 -Mode ui        # 只跑静态验收（构建 + 单测 + 两套 UI）
#   pwsh -File ops/acceptance/start.ps1 -Mode test      # 只跑构建与单测
#   pwsh -File ops/acceptance/start.ps1 -Mode full      # 强制全栈（需要 Docker）
#   pwsh -File ops/acceptance/start.ps1 -Mode stop      # 停止静态服务/容器
#
# 参数：-Port 8099（静态服务端口）、-NoBrowser（不开浏览器）、-NoWait（检查完即退出，服务保留）、
#       -SkipTest（静态模式跳过构建与单测）
[CmdletBinding()]
param(
  [ValidateSet('auto', 'ui', 'test', 'full', 'stop')]
  [string]$Mode = 'auto',
  [int]$Port = 8099,
  [switch]$NoBrowser,
  [switch]$NoWait,
  [switch]$SkipTest
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
$ServerDir = Join-Path $Root 'server'
$OpsDir = Join-Path $Root 'ops'
$LogDir = Join-Path $Root 'reports\acceptance'
$SummaryPath = Join-Path $LogDir 'summary.json'
$PidFile = Join-Path $ScriptDir '.preview.pid'
$ServeScript = Join-Path $ScriptDir 'serve-ui.mjs'
$CheckScript = Join-Path $ScriptDir 'check-ui.mjs'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Section([string]$Text) {
  Write-Host ''
  Write-Host "── $Text" -ForegroundColor Cyan
}
function Write-Ok([string]$Text) { Write-Host "  PASS  $Text" -ForegroundColor Green }
function Write-Bad([string]$Text) { Write-Host "  FAIL  $Text" -ForegroundColor Red }
function Write-Info([string]$Text) { Write-Host "  ....  $Text" -ForegroundColor DarkGray }

# Windows PowerShell 5.1 会把原生命令的 stderr 当成终止错误；
# 这里局部关掉 Stop，只以退出码判断成败，避免 pnpm/tsc 的正常提示中断脚本。
function Invoke-Logged {
  param([string]$File, [string[]]$Arguments, [string]$LogPath)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $File @Arguments *> $LogPath
    return $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev }
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-DockerReady {
  if (-not (Test-Command 'docker')) { return $false }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & docker version --format '{{.Server.Version}}' *> $null
    return ($LASTEXITCODE -eq 0)
  } catch { return $false } finally { $ErrorActionPreference = $prev }
}

function Test-PortFree([int]$Candidate) {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Candidate)
    $listener.Start()
    return $true
  } catch { return $false } finally { if ($listener) { try { $listener.Stop() } catch {} } }
}

function Get-FreePort([int]$Start) {
  for ($p = $Start; $p -lt ($Start + 20); $p++) {
    if (Test-PortFree $p) { return $p }
  }
  throw "端口 $Start 起的 20 个端口都被占用，请用 -Port 指定其它端口"
}

function Stop-Preview {
  if (Test-Path $PidFile) {
    $pidValue = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($pidValue) {
      $proc = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
      if ($proc) {
        Write-Info "停止静态服务 PID $pidValue"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  }
}

function Start-Preview {
  # 已有本脚本启动的服务则复用
  if (Test-Path $PidFile) {
    $existingPid = (Get-Content $PidFile | Select-Object -First 1)
    if ($existingPid -and (Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue)) {
      try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/__health" -TimeoutSec 2
        if ($health.ok -and $health.service -eq 'dijiang-acceptance-preview') {
          Write-Info "复用已运行的静态服务：http://127.0.0.1:$Port"
          return $Port
        }
      } catch {}
      Stop-Preview
    }
  }

  $actualPort = Get-FreePort $Port
  if ($actualPort -ne $Port) { Write-Info "端口 $Port 被占用，改用 $actualPort" }

  if (-not (Test-Command 'node')) { throw '未找到 node，请安装 Node.js 18+ 并加入 PATH' }
  $node = (Get-Command node).Source
  $stdout = Join-Path $LogDir 'preview.out.log'
  $stderr = Join-Path $LogDir 'preview.err.log'
  $argList = @(
    "`"$ServeScript`"", '--port', "$actualPort", '--root', "`"$Root`""
  )
  $proc = Start-Process -FilePath $node -ArgumentList $argList -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  Set-Content -Path $PidFile -Value $proc.Id -Encoding ascii

  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 200
    if ($proc.HasExited) {
      $err = Get-Content $stderr -ErrorAction SilentlyContinue | Select-Object -Last 8
      throw "静态服务启动失败（exit $($proc.ExitCode)）：`n$($err -join "`n")"
    }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$actualPort/__health" -TimeoutSec 1
      if ($health.ok) {
        Write-Ok "静态服务已就绪：http://127.0.0.1:$actualPort（PID $($proc.Id)）"
        return $actualPort
      }
    } catch {}
  }
  throw '静态服务 16 秒内未就绪，请查看 reports/acceptance/preview.err.log'
}

function Invoke-SelfTest {
  $result = [ordered]@{ ok = $false; build = $false; buildMs = 0; test = $false; passed = 0; total = 0; testMs = 0 }

  Write-Section '链路自检 1/2：构建（tsc strict）'
  if (-not (Test-Command 'pnpm')) {
    Write-Bad '未找到 pnpm，请先安装 pnpm 9+（或 npm i -g pnpm）'
    return $result
  }

  $buildLog = Join-Path $LogDir 'build.log'
  $testLog = Join-Path $LogDir 'test.log'
  Push-Location $ServerDir
  try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $buildExit = Invoke-Logged 'pnpm' @('build') $buildLog
    $sw.Stop()
    $result.build = ($buildExit -eq 0)
    $result.buildMs = $sw.ElapsedMilliseconds
    if ($result.build) { Write-Ok "构建通过（$([math]::Round($sw.ElapsedMilliseconds / 1000, 1))s）" }
    else {
      Write-Bad "构建失败（exit $buildExit）"
      Get-Content $buildLog -Tail 12 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "        $_" }
      return $result
    }

    Write-Section '链路自检 2/2：单元测试（vitest）'
    $sw.Restart()
    $testExit = Invoke-Logged 'pnpm' @('test') $testLog
    $sw.Stop()
    $result.testMs = $sw.ElapsedMilliseconds
    $text = Get-Content $testLog -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    $fileMatch = [regex]::Match($text, 'Test Files\s+(\d+) passed')
    $testMatch = [regex]::Match($text, 'Tests\s+(\d+) passed')
    $result.passed = if ($testMatch.Success) { [int]$testMatch.Groups[1].Value } else { 0 }
    $result.total = $result.passed
    $result.test = ($testExit -eq 0) -and $result.passed -gt 0
    if ($result.test) {
      $files = if ($fileMatch.Success) { $fileMatch.Groups[1].Value } else { '?' }
      Write-Ok "单测通过（$files 个文件 / $($result.passed) 例，$([math]::Round($sw.ElapsedMilliseconds / 1000, 1))s）"
    } else {
      Write-Bad "单测失败（exit $testExit）"
      Get-Content $testLog -Tail 16 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "        $_" }
    }
  } finally { Pop-Location }

  $result.ok = $result.build -and $result.test
  return $result
}

function Invoke-UiChecks([int]$PreviewPort) {
  Write-Section '界面验收：18 个页面 + 本地资源'
  $jsonPath = Join-Path $LogDir 'ui-checks.json'
  $base = "http://127.0.0.1:$PreviewPort"
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & node $CheckScript --base $base --json $jsonPath } finally { $ErrorActionPreference = $prev }
  $exit = $LASTEXITCODE
  $result = [ordered]@{ ok = ($exit -eq 0); passed = 0; total = 0 }
  if (Test-Path $jsonPath) {
    try {
      $json = Get-Content $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $result.passed = [int]$json.passed
      $result.total = [int]$json.total
    } catch {}
  }
  if ($result.ok) { Write-Ok "界面检查通过（$($result.passed)/$($result.total)）" }
  else { Write-Bad "界面检查失败（$($result.passed)/$($result.total)），详见 $jsonPath" }
  return $result
}

function Write-Summary([int]$PreviewPort, $testResult, $uiResult, [string]$RunMode) {
  $overall = [bool]$testResult.ok -and [bool]$uiResult.ok
  $summary = [ordered]@{
    mode      = $RunMode
    timestamp = (Get-Date).ToString('o')
    build     = [ordered]@{ ok = [bool]$testResult.build; ms = [int]$testResult.buildMs }
    test      = [ordered]@{ ok = [bool]$testResult.test; passed = [int]$testResult.passed; total = [int]$testResult.total; ms = [int]$testResult.testMs }
    ui        = [ordered]@{ ok = [bool]$uiResult.ok; passed = [int]$uiResult.passed; total = [int]$uiResult.total }
    overall   = $overall
  }
  [System.IO.File]::WriteAllText($SummaryPath, ($summary | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))

  Write-Section '验收摘要'
  Write-Host ("  构建      {0}" -f $(if ($testResult.build) { 'PASS' } else { 'FAIL' }))
  Write-Host ("  单元测试  {0}" -f $(if ($testResult.test) { "PASS  $($testResult.passed)/$($testResult.total)" } else { 'FAIL' }))
  Write-Host ("  界面检查  {0}" -f $(if ($uiResult.ok) { "PASS  $($uiResult.passed)/$($uiResult.total)" } else { 'FAIL' }))
  Write-Host ("  运行模式  {0}" -f $(if ($RunMode -eq 'full') { '全栈（Docker）' } else { '静态验收（无 Docker）' }))
  Write-Host ''
  Write-Host "  验收台    http://127.0.0.1:$PreviewPort/ops/acceptance/hub.html" -ForegroundColor Yellow
  Write-Host "  甲套 UI   http://127.0.0.1:$PreviewPort/design/ui-endfield/index.html"
  Write-Host "  乙套 UI   http://127.0.0.1:$PreviewPort/design/ui-independent/index.html"
  Write-Host "  记录      $SummaryPath"
  Write-Host ''
  if (-not $overall) {
    Write-Host '  未全部通过：请查看上方 FAIL 与 reports/acceptance/ 下的日志。' -ForegroundColor Red
  }
  return $overall
}

# ─────────────────────────────────────────────────────────────────────
# 开屏
# ─────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '┌──────────────────────────────────────────────────────────────┐' -ForegroundColor DarkGray
Write-Host '│  O.M.V 工作台 · 全域广播  —— 验收协议 / ACCEPTANCE PROTOCOL   │' -ForegroundColor DarkGray
Write-Host '└──────────────────────────────────────────────────────────────┘' -ForegroundColor DarkGray

if ($Mode -eq 'stop') {
  Write-Section '停止'
  Stop-Preview
  if (Test-DockerReady) {
    Write-Info '停止 Docker 全栈（保留数据卷）'
    & (Join-Path $OpsDir 'start.ps1') -Down
  }
  Write-Ok '已停止'
  exit 0
}

if ($Mode -eq 'test') {
  $tr = Invoke-SelfTest
  if (-not $tr.ok) { exit 1 }
  Write-Host ''
  Write-Ok '构建与单测全部通过'
  exit 0
}

$runMode = $Mode
if ($Mode -eq 'auto') {
  if (Test-DockerReady) {
    Write-Info '检测到 Docker，进入全栈验收'
    $runMode = 'full'
  } else {
    Write-Info '未检测到 Docker（或 daemon 未启动），进入静态验收'
    $runMode = 'ui'
  }
}

if ($runMode -eq 'full') {
  if (-not (Test-DockerReady)) {
    Write-Bad '未检测到可用的 Docker。请启动 Docker Desktop，或改用：-Mode ui'
    exit 1
  }
  Write-Section '启动全栈（PostgreSQL / Redis / MinIO / API / Caddy）'
  try {
    & (Join-Path $OpsDir 'start.ps1')
  } catch {
    Write-Bad "全栈启动失败：$($_.Exception.Message)"
    Write-Info '可查看 docker compose 日志，或先用 -Mode ui 做静态验收'
    exit 1
  }
  Write-Ok '全栈已启动（API http://localhost:3000/healthz）'
}

$testResult = [ordered]@{ ok = $true; build = $true; buildMs = 0; test = $true; passed = 0; total = 0; testMs = 0 }
if (-not $SkipTest) {
  $testResult = Invoke-SelfTest
} else {
  Write-Info '已按 -SkipTest 跳过构建与单测'
}

$previewPort = Start-Preview
$uiResult = Invoke-UiChecks $previewPort

if (-not $NoBrowser) {
  Start-Process "http://127.0.0.1:$previewPort/ops/acceptance/hub.html"
  Write-Info '已打开验收台'
}

$overall = Write-Summary $previewPort $testResult $uiResult $runMode

if ($NoWait) {
  Write-Host "  停止服务：pwsh -File `"$($MyInvocation.MyCommand.Path)`" -Mode stop" -ForegroundColor DarkGray
  if (-not $overall) { exit 1 }
  exit 0
}

Write-Host ''
Write-Host '  按 Enter 停止静态服务并退出（全栈容器不会被停止）…' -ForegroundColor DarkGray
[void](Read-Host)
Stop-Preview
Write-Ok '静态服务已停止'
if (-not $overall) { exit 1 }
exit 0
