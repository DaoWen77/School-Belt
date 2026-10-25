# k6 压测（task-18 准备）

50 VU / 2 分钟真实链路：**login → GET /channels → WS `/ws`（Socket.IO）→ `message:send` → ack 延迟**。
本目录只放压测脚本与试跑产物；正式验收结论在 `reports/infra/REPORT.md`（task-18）。

## 文件

| 文件 | 说明 |
| --- | --- |
| `k6-ack.js` | **正式入口**（task-18 用这个）。多账号自动登录 + 自动取频道 + ack 延迟统计 + summary JSON |
| `k6-chat.js` | 历史入口，行为与 `k6-ack.js` 完全一致（两者都从 `lib/im-scenario.js` 导出） |
| `lib/im-scenario.js` | 场景实现：Engine.IO v4 + Socket.IO v4 手工帧、登录分批与 429 重试、ack 超时清理、P95/P99 summary |
| `out/k6-summary.json` | 自定义 summary（`ack_latency_ms.p95` / `p99` 直接可读） |
| `out/k6-raw-summary.json` | k6 原生 `--summary-export`（`metrics.ack_latency_ms.values["p(95)"]`） |
| `out/k6-trial.log` | 最近一次试跑日志（2 VU / 10s） |

## 运行（k6 用全路径，PATH 未加；在仓库根目录执行）

```powershell
# 正式：50 VU × 2 分钟（脚本自己登录 8 个 seed 账号；登录限流 5 次/分钟/IP，setup 会自动分批等 61s）
# task-18 要求 summary 落在 reports/loadtest/，用 SUMMARY_OUT 指定
& 'C:\Program Files\k6\k6.exe' run `
  -e VUS=50 -e DURATION=2m `
  -e CHAT_USERS=qiu,chen,lin,yue,shen,an_obs,protocol_officer,founder `
  -e SUMMARY_OUT=reports/loadtest/k6-summary.json `
  --summary-export reports/loadtest/k6-raw-summary.json `
  ops/loadtest/k6-ack.js

# 试跑（不干扰后端改造；用外部 token 可跳过登录，避免消耗登录配额）
& 'C:\Program Files\k6\k6.exe' run -e ACCESS_TOKEN=<token> -e VUS=2 -e DURATION=10s -e HOLD_MS=12000 `
  ops/loadtest/k6-ack.js
```

快速读 P95：

```powershell
node -e "const s=require('./ops/loadtest/out/k6-summary.json');console.log('ack P95',s.ack_latency_ms.p95,'ms / P99',s.ack_latency_ms.p99,'ms; ok',s.ack_ok_rate,'failures',s.ack_failures_rate,'rateLimited',s.rate_limited_acks)"
# 或从 k6 原生 summary：metrics.ack_latency_ms.values["p(95)"]
```

## 试跑结果（脚本自检，非正式验收）

k6 `v2.3.0`，2 VU / 10s（`SEND_INTERVAL_MS=1500`）：

```
ws_ready=2, messages_sent=14, ack P95=7.6ms, P99=9.52ms, ack_ok=1.0, ack_failures=0, EXIT=0
```

说明脚本链路（登录/建连/发送/ack 解析/summary 落盘/阈值）都正常；50 VU 正式数据等 task-17 完成后跑。

## 设计要点（为什么不是"每 VU 每秒 1 条"）

契约 §9 有**用户级**消息限流：5 条/秒突发 + 60 条/分钟/用户
（`server/src/common/redis/rate-limiter.service.ts → assertMessageSend`，WS 与 REST 共用）。

- 脚本用 8 个 seed 账号轮转，50 VU 分到 8 个账号；
- 发送间隔按 `VUS / 账号数` 自动推导（默认 `PER_USER_RATE=0.85` 条/秒，留 15% 余量），
  当前默认参数下 interval≈**8300ms**，单账号 ≈50 条/分钟，2 分钟预计 ~700 条 ack；
- 同账号内的多个 VU 还会按槽位**错峰**启动，避免瞬时触发 5 条/秒的突发限制；
- `RATE_LIMITED` 的 ack 单独计数（不污染 `ack_failures`），若出现可从 summary 直接看到数量。

登录：`/auth/login` 限流 5 次/分钟/IP，setup 按 5 个一批、批间等 61s；若仍 429，会按服务端
`retryAfterMs` 等待重试（最多 3 次）。也支持 `-e ACCESS_TOKEN=` / `-e CHANNEL_ID=` 直接复用，反复试跑不消耗登录配额。

> ⚠️ `options` 里已设 **`setupTimeout: '600s'`**（k6 默认只有 60s，而 setup 为登录限流要等 61s，
> 不加会直接 `setup() execution timed out after 60 seconds`）。可用 `-e SETUP_TIMEOUT=300s` 覆盖。

## 正式结果（2026-10-23 23:09–23:13，真实 Redis/S3）

50 VU / 2min / 8 账号，k6 **exit 0**（阈值全过）：

```
ack samples=766, P95=19.75ms, P99=51.10ms, avg=9.74ms, max=216ms
ack_ok=1.0, ack_failures=0, rate_limited=0, ws_ready=50, messages_sent=766
发送 RPS ≈ 6.38 条/秒（受契约 §9 用户级 60 条/分钟限流约束，未改限流）
```

证据：`reports/loadtest/k6-summary.json`、`k6-raw-summary.json`、`k6-run.log`；
完整验收报告：`reports/infra/REPORT.md`。

## 前置环境（正式跑之前必须满足）

| 项 | 要求 | 当前状态（2026-10-23 23:15 复核） |
| --- | --- | --- |
| API | `http://127.0.0.1:3000`，`/healthz` 200 | ✅ 在线 |
| `/readyz` | postgres/s3/redis 均 ok、无 degraded | ✅ 三项全 true（`reports/infra/env-check.json`） |
| Redis | Memurai 6379 真实接入 | ✅ Memurai 4.1.8 / Redis 7.2.12，限流 key 真实写入 |
| S3 | rclone 9000（CORS/预签名已通） | ✅ bucket `dijiang` HeadBucket 200；CORS OPTIONS/PUT/GET 通过 |
| k6 | `C:\Program Files\k6\k6.exe` | ✅ v2.3.0 |

> k6 试跑（2 VU/10s）仅用于验证脚本语法与链路，不会计入正式验收；正式数据见上一节。
