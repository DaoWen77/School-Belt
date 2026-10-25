# Start the real local infrastructure used by the Dijiang backend.
# Services:
#   - Memurai (Redis 7 compatible) Windows service, 127.0.0.1:6379
#   - rclone serve s3 (real S3-compatible endpoint), 0.0.0.0:9000
#   - PostgreSQL is started by ops/e2e/run-backend.mjs (embedded PG 17.5, 55432)
#
# Docker is NOT used on this machine: no WSL/Hyper-V, Docker Hub blocked, C: free space too small.
# The S3 endpoint is rclone's S3 server, not MinIO; it is a real S3 protocol server, not s3rver.
#
# Usage: powershell -ExecutionPolicy Bypass -File ops/infra/start-real.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$rclone = 'C:\ProgramData\chocolatey\bin\rclone.exe'
$dataDir = Join-Path $root 'reports\e2e\rclone-s3'
$logDir = Join-Path $root 'reports\infra'
$bucket = 'dijiang'

New-Item -ItemType Directory -Force $dataDir, $logDir, (Join-Path $dataDir $bucket) | Out-Null

$memurai = Get-Service -Name Memurai -ErrorAction SilentlyContinue
if (-not $memurai) { throw 'Memurai service not installed. Run: choco install redis-64 -y' }
if ($memurai.Status -ne 'Running') {
  Start-Service Memurai
  (Get-Service Memurai).WaitForStatus('Running', '00:00:20')
}
Write-Output 'Redis (Memurai) running on 127.0.0.1:6379'

$listening = Get-NetTCPConnection -State Listen -LocalPort 9000 -ErrorAction SilentlyContinue
if (-not $listening) {
  if (-not (Test-Path $rclone)) { throw "rclone not found: $rclone (choco install rclone -y)" }
  Start-Process $rclone -ArgumentList @(
    'serve', 's3', $dataDir,
    '--addr', '0.0.0.0:9000',
    '--auth-key', 'minioadmin,minioadmin',
    '--allow-origin', '*'
  ) -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'rclone.out.log') `
    -RedirectStandardError (Join-Path $logDir 'rclone.err.log')
  Start-Sleep -Seconds 2
}
$probe = Get-NetTCPConnection -State Listen -LocalPort 9000 -ErrorAction SilentlyContinue
if (-not $probe) { throw 'rclone S3 did not start on 9000; see reports/infra/rclone.err.log' }
Write-Output 'S3 (rclone serve s3) listening on 0.0.0.0:9000 (bucket dijjiang, CORS *)'

Write-Output ''
Write-Output 'Use these env vars before starting the API:'
Write-Output '  REDIS_URL=redis://127.0.0.1:6379'
Write-Output '  S3_ENDPOINT=http://127.0.0.1:9000'
Write-Output '  S3_PUBLIC_ENDPOINT=http://127.0.0.1:9000'
Write-Output '  S3_BUCKET=dijiang'
Write-Output '  S3_ACCESS_KEY_ID=minioadmin'
Write-Output '  S3_SECRET_ACCESS_KEY=minioadmin'
Write-Output ''
Write-Output 'Start the API: node ops/e2e/run-backend.mjs --skip-build --skip-seed'
Write-Output 'Health:       http://127.0.0.1:3000/readyz   (postgres/s3/redis must all be true)'
