#!/usr/bin/env bash
# O.M.V 工作台 · 全域广播 —— 一键验收脚本（Linux / macOS / WSL / Git Bash）
#
# 用法：
#   bash ops/acceptance/start.sh                 # 自动：有 Docker 跑全栈，没有则静态验收
#   bash ops/acceptance/start.sh --mode ui       # 只跑静态验收（构建 + 单测 + 两套 UI）
#   bash ops/acceptance/start.sh --mode test     # 只跑构建与单测
#   bash ops/acceptance/start.sh --mode full     # 强制全栈（需要 Docker）
#   bash ops/acceptance/start.sh --mode stop     # 停止静态服务/容器
#
# 参数：--port 8099、--no-browser、--no-wait、--skip-test
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVER_DIR="$ROOT/server"
OPS_DIR="$ROOT/ops"
LOG_DIR="$ROOT/reports/acceptance"
SUMMARY="$LOG_DIR/summary.json"
PID_FILE="$SCRIPT_DIR/.preview.pid"
SERVE="$SCRIPT_DIR/serve-ui.mjs"
CHECK="$SCRIPT_DIR/check-ui.mjs"

MODE="auto"
PORT="8099"
OPEN_BROWSER=1
WAIT=1
SKIP_TEST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:-auto}"; shift 2 ;;
    --port) PORT="${2:-8099}"; shift 2 ;;
    --no-browser) OPEN_BROWSER=0; shift ;;
    --no-wait) WAIT=0; shift ;;
    --skip-test) SKIP_TEST=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "未知参数：$1（--help 查看用法）"; exit 2 ;;
  esac
done

mkdir -p "$LOG_DIR"

c_cyan='\033[36m'; c_green='\033[32m'; c_red='\033[31m'; c_gray='\033[90m'; c_yellow='\033[33m'; c_off='\033[0m'
section() { printf '\n%s── %s%s\n' "$c_cyan" "$1" "$c_off"; }
ok()      { printf '  %sPASS%s  %s\n' "$c_green" "$c_off" "$1"; }
bad()     { printf '  %sFAIL%s  %s\n' "$c_red" "$c_off" "$1"; }
info()    { printf '  %s....  %s%s\n' "$c_gray" "$1" "$c_off"; }

docker_ready() {
  command -v docker >/dev/null 2>&1 || return 1
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1
}

compose() {
  docker compose --project-directory "$OPS_DIR" --env-file "$OPS_DIR/.env" -f "$OPS_DIR/docker-compose.yml" "$@"
}

full_up() {
  [ -f "$OPS_DIR/.env" ] || cp "$OPS_DIR/.env.example" "$OPS_DIR/.env"
  compose up -d --build || return 1
  local i
  for i in $(seq 1 40); do
    [ "$(docker inspect --format '{{.State.Health.Status}}' dijiang-postgres 2>/dev/null)" = healthy ] && break
    sleep 2
  done
  compose run --rm --no-deps api node node_modules/prisma/build/index.js migrate deploy || return 1
  compose run --rm --no-deps api node dist/scripts/init-owner.js || return 1
  compose run --rm --no-deps api node dist/scripts/seed.js || true
}

http_ok() {
  node -e "fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "$1"
}

stop_preview() {
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      info "停止静态服务 PID $pid"
      kill "$pid" 2>/dev/null || true
      sleep 0.3
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
}

port_free() {
  node -e "
    const net=require('net');const s=net.createServer();
    s.once('error',()=>process.exit(1));
    s.once('listening',()=>{s.close(()=>process.exit(0))});
    s.listen(Number(process.argv[1]),'127.0.0.1');
  " "$1" >/dev/null 2>&1
}

start_preview() {
  if [ -f "$PID_FILE" ]; then
    old="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
      if http_ok "http://127.0.0.1:$PORT/__health"; then
        info "复用已运行的静态服务：http://127.0.0.1:$PORT"
        PREVIEW_PORT="$PORT"
        return 0
      fi
      stop_preview
    fi
  fi

  command -v node >/dev/null 2>&1 || { bad '未找到 node，请安装 Node.js 18+'; exit 1; }
  local try_port="$PORT" i
  for i in 0 1 2 3 4 5 6 7 8 9 10; do
    try_port=$((PORT + i))
    port_free "$try_port" && break
    try_port=""
  done
  [ -n "$try_port" ] || { bad "端口 $PORT 起的 11 个端口都被占用"; exit 1; }
  [ "$try_port" != "$PORT" ] && info "端口 $PORT 被占用，改用 $try_port"

  nohup node "$SERVE" --port "$try_port" --root "$ROOT" \
    >"$LOG_DIR/preview.out.log" 2>"$LOG_DIR/preview.err.log" &
  echo $! >"$PID_FILE"

  for i in $(seq 1 80); do
    sleep 0.2
    if http_ok "http://127.0.0.1:$try_port/__health"; then
      ok "静态服务已就绪：http://127.0.0.1:$try_port（PID $(cat "$PID_FILE")）"
      PREVIEW_PORT="$try_port"
      return 0
    fi
  done
  bad "静态服务未就绪，查看 $LOG_DIR/preview.err.log"
  tail -n 10 "$LOG_DIR/preview.err.log" 2>/dev/null || true
  exit 1
}

run_selftest() {
  BUILD_OK=0; TEST_OK=0; BUILD_MS=0; TEST_MS=0; PASSED=0; TOTAL=0
  section "链路自检 1/2：构建（tsc strict）"
  if ! command -v pnpm >/dev/null 2>&1; then
    bad '未找到 pnpm，请安装 pnpm 9+'
    return 1
  fi
  local t0 t1
  t0=$(date +%s)
  ( cd "$SERVER_DIR" && pnpm build >"$LOG_DIR/build.log" 2>&1 )
  local exit_code=$?
  t1=$(date +%s)
  BUILD_MS=$(( (t1 - t0) * 1000 ))
  if [ $exit_code -eq 0 ]; then
    BUILD_OK=1
    ok "构建通过（$((BUILD_MS / 1000)).$(((BUILD_MS % 1000) / 100))s）"
  else
    bad "构建失败（exit $exit_code）"
    tail -n 12 "$LOG_DIR/build.log" 2>/dev/null | sed 's/^/        /'
    return 1
  fi

  section "链路自检 2/2：单元测试（vitest）"
  t0=$(date +%s)
  ( cd "$SERVER_DIR" && pnpm test >"$LOG_DIR/test.log" 2>&1 )
  exit_code=$?
  t1=$(date +%s)
  TEST_MS=$(( (t1 - t0) * 1000 ))
  PASSED=$(awk '/Tests[ ]+[0-9]+ passed/ { for (i=1;i<=NF;i++) if ($i=="Tests") { print $(i+1); exit } }' "$LOG_DIR/test.log")
  PASSED=${PASSED:-0}
  TOTAL=$PASSED
  if [ $exit_code -eq 0 ] && [ "$PASSED" -gt 0 ]; then
    TEST_OK=1
    ok "单测通过（${PASSED} 例，$((TEST_MS / 1000)).$(((TEST_MS % 1000) / 100))s）"
  else
    bad "单测失败（exit $exit_code）"
    tail -n 16 "$LOG_DIR/test.log" 2>/dev/null | sed 's/^/        /'
  fi
  [ $BUILD_OK -eq 1 ] && [ $TEST_OK -eq 1 ]
}

run_ui_checks() {
  section "界面验收：18 个页面 + 本地资源"
  node "$CHECK" --base "http://127.0.0.1:$PREVIEW_PORT" --json "$LOG_DIR/ui-checks.json"
  local exit_code=$?
  UI_PASSED=0; UI_TOTAL=0
  if [ -f "$LOG_DIR/ui-checks.json" ]; then
    UI_PASSED=$(node -e "try{const j=require('$LOG_DIR/ui-checks.json');console.log(j.passed)}catch(e){console.log(0)}")
    UI_TOTAL=$(node -e "try{const j=require('$LOG_DIR/ui-checks.json');console.log(j.total)}catch(e){console.log(0)}")
  fi
  if [ $exit_code -eq 0 ]; then ok "界面检查通过（$UI_PASSED/$UI_TOTAL）"; else bad "界面检查失败（$UI_PASSED/$UI_TOTAL）"; fi
  return $exit_code
}

write_summary() {
  local run_mode="$1"
  local overall=false
  [ "$BUILD_OK" = 1 ] && [ "$TEST_OK" = 1 ] && [ "$UI_OK" = 1 ] && overall=true
  node -e '
    const fs=require("fs");
    const [mode,path,buildOk,buildMs,testOk,passed,total,testMs,uiOk,uiPassed,uiTotal,overall]=process.argv.slice(1);
    const s={mode,timestamp:new Date().toISOString(),
      build:{ok:buildOk==="1",ms:Number(buildMs)},
      test:{ok:testOk==="1",passed:Number(passed),total:Number(total),ms:Number(testMs)},
      ui:{ok:uiOk==="1",passed:Number(uiPassed),total:Number(uiTotal)},
      overall:overall==="true"};
    fs.writeFileSync(path,JSON.stringify(s,null,2),"utf8");
  ' "$run_mode" "$SUMMARY" "$BUILD_OK" "$BUILD_MS" "$TEST_OK" "$PASSED" "$TOTAL" "$TEST_MS" "$UI_OK" "$UI_PASSED" "$UI_TOTAL" "$overall"

  section "验收摘要"
  printf '  构建      %s\n' "$([ "$BUILD_OK" = 1 ] && echo PASS || echo FAIL)"
  printf '  单元测试  %s\n' "$([ "$TEST_OK" = 1 ] && echo "PASS  $PASSED/$TOTAL" || echo FAIL)"
  printf '  界面检查  %s\n' "$([ "$UI_OK" = 1 ] && echo "PASS  $UI_PASSED/$UI_TOTAL" || echo FAIL)"
  printf '  运行模式  %s\n' "$([ "$run_mode" = full ] && echo '全栈（Docker）' || echo '静态验收（无 Docker）')"
  printf '\n  验收台    %shttp://127.0.0.1:%s/ops/acceptance/hub.html%s\n' "$c_yellow" "$PREVIEW_PORT" "$c_off"
  printf '  甲套 UI   http://127.0.0.1:%s/design/ui-endfield/index.html\n' "$PREVIEW_PORT"
  printf '  乙套 UI   http://127.0.0.1:%s/design/ui-independent/index.html\n' "$PREVIEW_PORT"
  printf '  记录      %s\n\n' "$SUMMARY"
  [ "$overall" = true ]
}

open_hub() {
  [ "$OPEN_BROWSER" = 1 ] || return 0
  local url="http://127.0.0.1:$PREVIEW_PORT/ops/acceptance/hub.html"
  if command -v open >/dev/null 2>&1; then open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"
  else info "请手动打开：$url"; return 0
  fi
  info '已打开验收台'
}

printf '\n%s┌──────────────────────────────────────────────────────────────┐%s\n' "$c_gray" "$c_off"
printf '%s│  O.M.V 工作台 · 全域广播  —— 验收协议 / ACCEPTANCE PROTOCOL   │%s\n' "$c_gray" "$c_off"
printf '%s└──────────────────────────────────────────────────────────────┘%s\n' "$c_gray" "$c_off"

case "$MODE" in
  stop)
    section "停止"
    stop_preview
    if docker_ready; then
      info '停止 Docker 全栈（保留数据卷）'
      compose down
    fi
    ok '已停止'; exit 0 ;;
  test)
    if run_selftest; then ok '构建与单测全部通过'; exit 0; else exit 1; fi ;;
  auto)
    if docker_ready; then RUN_MODE=full; info '检测到 Docker，进入全栈验收'; else RUN_MODE=ui; info '未检测到 Docker（或 daemon 未启动），进入静态验收'; fi ;;
  ui|full) RUN_MODE="$MODE" ;;
  *) bad "未知模式：$MODE"; exit 2 ;;
esac

if [ "$RUN_MODE" = full ]; then
  if ! docker_ready; then bad '未检测到可用的 Docker。请启动 Docker，或改用 --mode ui'; exit 1; fi
  section "启动全栈（PostgreSQL / Redis / MinIO / API / Caddy）"
  if ! full_up; then bad '全栈启动失败，请查看 compose 日志'; exit 1; fi
  ok '全栈已启动（API http://localhost:3000/healthz）'
fi

if [ "$SKIP_TEST" = 1 ]; then
  BUILD_OK=1; TEST_OK=1; BUILD_MS=0; TEST_MS=0; PASSED=0; TOTAL=0
  info '已按 --skip-test 跳过构建与单测'
else
  run_selftest || true
fi

start_preview
run_ui_checks; UI_OK=$?
open_hub
if write_summary "$RUN_MODE"; then OVERALL=0; else OVERALL=1; fi

if [ "$WAIT" = 0 ]; then
  printf '  停止服务：bash %s --mode stop\n' "$0"
  exit $OVERALL
fi

printf '  按 Ctrl+C 停止静态服务并退出（全栈容器不会被停止）…\n'
trap 'stop_preview; printf "\n%s静态服务已停止%s\n" "$c_green" "$c_off"; exit 0' INT TERM
while :; do sleep 1; done
