# task-18 · 真实 Redis/S3 链路验收 + k6 50 VU ack P95

- 验收时间：2026-10-23 23:06 – 23:16（Asia/Shanghai）
- 执行人：e2e（只写 `ops/loadtest/**`、`ops/e2e/**`、`reports/loadtest/**`、`reports/infra/**`，未改 server/web）
- 结论：**5 项验收全部 PASS**；k6 50 VU / 2 min：**ack P95 = 19.75ms、P99 = 51.10ms、ack_ok = 1.0、ack_failures = 0、rate_limited = 0**（阈值 P95<150 / P99<300 / 失败率<1% 全部通过，k6 exit 0）。

---

## 1. 验收结论

| # | 验收项 | 结果 | 关键数据 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 真实 `/readyz`（PG + S3 + Redis 全 ok、无 degraded） | **PASS** | `postgres=true, s3=true, redis=true, degraded=null` | `reports/infra/env-check.json` |
| 2 | 上传 presign → PUT → complete → 下载逐字节相等 | **PASS** | 1217B，`byteEqual=true`、sha256 一致；25MB→413、伪造 MIME→415 | `reports/infra/upload-check.json` |
| 3 | S3 CORS（OPTIONS + Origin + PUT/GET） | **PASS** | OPTIONS 200、ACAO=`*`；带 Origin 的预签名 PUT/GET 200 | `reports/infra/s3-cors.json` |
| 4 | k6 50 VU / 2 min ack P95 | **PASS** | **P95=19.75ms**、P99=51.10ms、766 acks、ack_ok=1.0、失败 0 | `reports/loadtest/k6-summary.json` |
| 5 | 断网 60s 重连补拉：无重复、无空洞 | **PASS** | 离线 60001ms，断线期 5 条全部补到，duplicates=0、holes=0 | `reports/infra/offline-gap.json` |
| + | Redis 不可用时 API 启动失败（fail fast） | **PASS** | 临时实例 1951ms 后 **exit 1**，从未监听成功 | `reports/infra/redis-down.json` |

---

## 2. 环境与版本（实测）

| 项 | 版本/配置 | 证据 |
| --- | --- | --- |
| API | `http://127.0.0.1:3000`，pid 13320；env：`REDIS_URL=redis://127.0.0.1:6379`、`S3_ENDPOINT=http://127.0.0.1:9000`、`DATABASE_URL=…?connection_limit=20&pool_timeout=10&connect_timeout=5`、`DATABASE_POOL_MAX=20` | `reports/e2e/run.json`、`env-check.json` |
| Redis | **Memurai 4.1.8 / redis_version 7.2.12**，`PING=PONG`，`DBSIZE=16`（真实限流 key：`dijiang:ratelimit:msg:<userId>:60000` ZSET 44–51 members、TTL≈46s；`dijiang:ratelimit:login:account:*` 计数 string，TTL≈1h） | `env-check.json` |
| S3 | **rclone serve s3 @ http://127.0.0.1:9000**，bucket **`dijiang`**，`HeadBucket=200`，`ListObjectsV2` 3 个对象（`cors.txt`、`probe.txt`、一张已上传 png） | `env-check.json` |
| PostgreSQL | PostgreSQL **17.5**（embedded，端口 55432），`max_connections=100`；验收时 `pg_stat_activity`：active 1 / idle **20**（= `connection_limit=20` 生效痕迹）；task-17 的 200 并发查询测试显示实际只占 20 个 backend（`reports/infra/pg-pool-check.json`） | `env-check.json`、`pg-pool-check.json` |
| k6 | `C:\Program Files\k6\k6.exe` **v2.3.0**（go1.26.8，windows/amd64） | `k6-run.log` |
| Node | v24.19.0 | 脚本运行环境 |

`/readyz` 原始响应（无 degraded 字段即无降级）：

```json
{"status":"ok","checks":[{"name":"postgres","ok":true},{"name":"s3","ok":true},{"name":"redis","ok":true}],"timestamp":"2026-10-23T15:06:40.048Z"}
```

---

## 3. k6 50 VU / 2 min（核心）

### 3.1 命令（原始）

```powershell
& 'C:\Program Files\k6\k6.exe' run -e VUS=50 -e DURATION=2m `
  -e SUMMARY_OUT=reports/loadtest/k6-summary.json `
  --summary-export reports/loadtest/k6-raw-summary.json `
  ops/loadtest/k6-ack.js
# 退出码：K6_EXIT=0
```

脚本：`ops/loadtest/k6-ack.js`（实现 `ops/loadtest/lib/im-scenario.js`，历史入口 `k6-chat.js` 同源）。
流程：setup 真实登录 8 个 seed 账号 → `GET /channels` 取 `general` → 每 VU 连真实 Socket.IO `/ws` → 周期 `message:send` → 解析 ack 计算端到端延迟。

### 3.2 结果（原始 JSON 值）

| 指标 | 值 |
| --- | --- |
| ack 样本数 | **766** |
| **ack P95** | **19.75 ms**（阈值 <150 ms ✅） |
| **ack P99** | **51.10 ms**（阈值 <300 ms ✅） |
| ack avg / med / min / max | 9.74 / 7 / 3 / **216** ms |
| ack_ok | **1.0**（766/766） |
| ack_failures | **0**（rate=0，阈值 <1% ✅） |
| rate_limited_acks | **0**（null，无样本） |
| ws_ready | **50**（50/50 连接成功） |
| messages_sent | **766** |
| 发送 RPS（2min 场景内） | **6.38 条/秒**（766/120s）；ws 帧发送 1066（含心跳） |
| HTTP RPS | 0.039（仅 setup 的 10 次 HTTP，压测路径走 WS） |
| k6 退出码 | **0**（全部阈值通过；日志 `chat_ack ✓ [100%] 50 VUs 2m0s`） |

原始日志行：

```
[k6] ack P95=19.75ms P99=51.10000000000059ms ok=1 failures=0 rateLimited=null sent=766 wsReady=50
running (4m18.4s), 00/50 VUs, 0 complete and 50 interrupted iterations
chat_ack ✓ [ 100% ] 50 VUs  2m0s
```

> 说明：`50 interrupted iterations` 是设计使然 —— 每个 VU 保持一条长连接跨整个 2 分钟场景（`HOLD_MS=135s`），不是“脚本没跑完”；连接数见 `ws_ready=50`。

### 3.3 为什么“RPS 只有 6.38/s”不是吞吐上限

契约 §9 对消息发送有**用户级**限流：**5 条/秒突发 + 60 条/分钟/用户**（`server/src/common/redis/rate-limiter.service.ts → assertMessageSend`，WS/REST 共用）。本脚本**遵守业务限流**（未改限流）：

- 50 VU 轮转到 8 个账号，发送间隔自动推导为 **8300ms**（单账号 ≈50 条/分钟，留 15% 余量）；
- 同账号内多个 VU 按槽位错峰启动，避免触发 5 条/秒突发；
- 因此 **50 VU = 50 条并发 WS 连接**，可持续消息速率约 6.4 条/秒；这是限流允许的上限内压测，不是服务端吞吐极限。

### 3.4 setup 中的限流重试（脚本健壮性证据）

登录是 5 次/分钟/IP，setup 分两批（5 + 3）并等待 61s；本次日志显示 `shen 登录被限流（429），等待 62s 后重试（2/3）` 后成功，8 账号最终全部就绪：

```
[setup] 登录 8 个账号（每批 5，登录限流 5 次/分钟/IP）
[setup] shen 登录被限流（429），等待 62s 后重试（2/3）
[setup] 等待 61s 让登录限流窗口过期…
[setup] 就绪：users=8 channel=general(298e06ba-…) …
```

---

## 4. 上传链路（真实 S3 9000）

命令：`node ops/e2e/verify-upload.mjs`（账号 qiu；走真实 API → 预签名 → rclone S3）

| 步骤 | 实测 |
| --- | --- |
| U1 presign | fileId=`155e8153…`，uploadHost=`127.0.0.1:9000`，带 `X-Amz-Signature` |
| U2 预签名 PUT | HTTP 200，1217B（真实 24×18 PNG） |
| U3 complete | `status=ready`，sizeBytes=1217，mime=image/png（HEAD 大小 + 魔数均过） |
| U4 下载比对 | 下载 **1217B**，**byteEqual=true**、**sha256Equal=true** |
| U5 带附件消息 | messageId=**1393**，读回 attachments.fileId=`155e8153…` 一致 |
| 限额 | 25MB PNG → **413 FILE_TOO_LARGE**；伪造 MIME → **415** 且文件置 rejected（再取 url 409）；`text/html` → 415 |

`upload-check.json` 中 S3 标记：`implementation=rclone-s3, endpoint=http://127.0.0.1:9000, bucket=dijiang`。

---

## 5. S3 CORS（浏览器直传前提）

命令：`node ops/e2e/check-s3-cors.mjs`（带 `Origin: http://localhost:3100`）

| 用例 | 结果 |
| --- | --- |
| C1 OPTIONS 预检（`Access-Control-Request-Method: PUT`） | **200**，`Access-Control-Allow-Origin: *`，Allow-Methods 含 PUT，Allow-Headers 含 Content-Type/Authorization |
| C2 预签名 PUT + Origin | **200**，回 `Allow-Origin: *`，ETag 正常 |
| C3 预签名 GET + Origin | **200**，回 `Allow-Origin: *`，下载 35B 与原字节一致 |

> rclone 用 `--allow-origin *` 提供 CORS；生产 MinIO/云 S3 需为 bucket 配置等价 CORS 规则（GET/PUT/HEAD、允许 web origin、`content-type,x-amz-*`、暴露 ETag）。

---

## 6. 断网 60 秒 → 重连补拉

命令：`node ops/e2e/smoke-offline.mjs`（A=qiu、B=chen；B 断开 60s，期间 A 发 5 条）

```
lastSeq=1393, offline=60001ms
gapIds      = [1394,1395,1396,1397,1398]
fetchedIds  = [1394,1395,1396,1397,1398]   （direction=newer&cursor=base64url("seq:1393")）
duplicates=0, holes=0, missing=[], extras=[], strictlyIncreasing=true
重连后 A→B 实时消息恢复：PASS
```

9 个断言（O1–O9）全部 PASS；`reports/infra/offline-gap.json`。

> 断网以“关闭 WS 连接并保持 60s”模拟（客户端掉线场景），不是 OS 防火墙断网；对补拉/去重语义等价。

---

## 7. Redis 不可用时 API fail fast

命令：`node ops/e2e/check-redis-down.mjs`（在 **3101** 起临时实例，`REDIS_URL=redis://127.0.0.1:6399` 无服务）

```
exited=true, exitCode=1, durationMs=1951, healthyWhileBroken=false
日志：[bootstrap] 启动失败: Redis 连接失败（REDIS_URL=redis://127.0.0.1:6399）：Connection is closed。
      请先启动 Redis（本机 Memurai 服务）并检查 REDIS_URL
      at RedisService.onModuleInit (server/dist/common/redis/redis.service.js:49)
```

证据：`reports/infra/redis-down.json`、`reports/infra/redis-down.log`。运行中的 3000 实例未受影响。

---

## 8. 失败项 / 脚本修正（非环境失败）

| 项 | 现象 | 归因 | 处置 |
| --- | --- | --- | --- |
| k6 第一次正式跑 | `ack P95=0, wsReady=0`，`setup() execution timed out after 60 seconds` | **脚本 options 缺 `setupTimeout`**（setup 为登录限流等 61s > k6 默认 60s） | 已加 `setupTimeout: '600s'`；重跑 **exit 0**，证据见 §3。首次失败产物归档为 `reports/loadtest/k6-summary.attempt1-setup-timeout.json` / `k6-run.attempt1-setup-timeout.log` |
| env-check 首版 verdict=FAIL | 脚本检查了两个 bucket，其中 `dijjiang`（三个 j）是笔误 → 404 | **脚本里的 bucket 拼写错误** | 已改为只查 `dijiang`；重跑 **verdict=PASS**（`env-check.json`） |

其余无失败项。压测期间未修改任何业务限流参数。

---

## 9. 未验证项 / 边界（如实说明）

- **浏览器真实页面直传**：验收时 web 3100 未启动；CORS 用脚本带 `Origin: http://localhost:3100` 验证（与浏览器预检同语义）。前端页面内上传由 Lead 早前用 Playwright 实测过，不在本次证据内。
- **多实例广播**：Redis adapter 的多实例 fan-out 未验证（仅单 API 实例）。
- **数据库连接池**：`DATABASE_POOL_MAX=20` 已注入（PG idle=20 印证）；task-17 另做过 200 并发查询（全部成功、只占 20 backend，见 `reports/infra/pg-pool-check.json`）。本次未做**长事务/写放大**压力测试。
- **k6 口径**：50 VU 为并发 WS 连接；消息速率受契约 §9 用户级限流约束（≈6.38 条/秒）。若要看“吞吐上限”，需要临时提高限流或用更多账号，本轮**按要求未改业务限流**。
- **断网模拟**：以 WS 断开 60s 模拟客户端掉线；未做网卡级断网/丢包测试。
- **告警/长稳**：未做长时间（>2min）稳定性与内存/句柄泄漏观察。

---

## 10. 证据文件索引

| 文件 | 内容 |
| --- | --- |
| `reports/loadtest/k6-summary.json` | 自定义 summary（`ack_latency_ms.p95=19.75`、p99、ack_ok、failures、rateLimited、messages_sent、ws_ready） |
| `reports/loadtest/k6-raw-summary.json` | k6 原生 summary-export（`metrics.ack_latency_ms["p(95)"]=19.75`、`metrics.messages_sent.count=766` 等） |
| `reports/loadtest/k6-run.log` | k6 原始输出（setup、阈值、`chat_ack ✓ [100%] 50 VUs 2m0s`、exit 0） |
| `reports/loadtest/k6-summary.attempt1-setup-timeout.json` / `k6-run.attempt1-setup-timeout.log` | 首轮 setup 超时失败归档（脚本修正证据） |
| `reports/infra/env-check.json` | API/Redis/S3/PG 版本与探针（含真实限流 key、S3 ListObjects、PG idle 20） |
| `reports/infra/upload-check.json` | 上传链路 8 步证据（字节、sha256、限额错误码） |
| `reports/infra/s3-cors.json` | OPTIONS 预检 + 带 Origin 的 PUT/GET 的 CORS 头 |
| `reports/infra/offline-gap.json` | 断网 60s 补拉：lastSeq/gap/fetched/duplicates/holes/liveResumed |
| `reports/infra/redis-down.json` / `redis-down.log` | Redis 不可用 → exit 1（1951ms）与日志 |
| `ops/loadtest/k6-ack.js` / `lib/im-scenario.js` / `k6-chat.js` / `README.md` | 压测脚本与复跑说明 |
| `ops/e2e/infra-check.mjs`、`check-s3-cors.mjs`、`smoke-offline.mjs`、`check-redis-down.mjs`、`verify-upload.mjs` | 本次验收脚本（可复跑） |
