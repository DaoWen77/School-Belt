# Stop the rclone S3 process started by ops/infra/start-real.ps1.
# Memurai is a Windows service and is intentionally left running.
$ErrorActionPreference = 'Stop'
$procs = Get-Process rclone -ErrorAction SilentlyContinue
if (-not $procs) {
  Write-Output 'rclone is not running'
} else {
  $procs | Stop-Process -Force
  Write-Output "Stopped rclone ($($procs.Count) process(es))"
}
