#!/usr/bin/env bash
# O.M.V 帝江号 · 全域广播 —— 一键验收入口（Linux / macOS / WSL）
# 等价于：bash ops/acceptance/start.sh "$@"
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$ROOT/ops/acceptance/start.sh" "$@"
