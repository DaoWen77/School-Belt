// O.M.V 帝江号 · 全域广播 —— k6 ack 压测入口（task-18 正式脚本）
//
// 流程：登录（setup，多账号）→ GET /channels 取频道 → 每 VU 连 /ws（Socket.IO namespace）
//       → 周期 message:send → 用 ack 计算端到端延迟 → summary JSON 可直接读 P95/P99。
//
// 用法（k6 必须用全路径，PATH 未加）：
//   & 'C:\Program Files\k6\k6.exe' run `
//     -e VUS=50 -e DURATION=2m `
//     -e CHAT_USERS=qiu,chen,lin,yue,shen,an_obs,protocol_officer,founder `
//     --summary-export ops/loadtest/out/k6-raw-summary.json `
//     ops/loadtest/k6-ack.js
//
// 结果：
//   - 自定义 summary：ops/loadtest/out/k6-summary.json（ack_latency_ms.p95 / p99 直接可读）
//   - k6 原生 summary：--summary-export 指定的 JSON（metrics.ack_latency_ms.values["p(95)"]）
//
// 参数（env，全部可选）：
//   API_BASE         默认 http://127.0.0.1:3000
//   WS_PATH          默认 /socket.io
//   CHAT_USERS       逗号分隔的 seed 账号（默认 8 个；共享 SEED_PASSWORD）
//   SEED_PASSWORD    默认 Dijiang#2026
//   CHANNEL_SLUG     默认 general
//   VUS / DURATION   默认 50 / 2m
//   SEND_INTERVAL_MS 默认按账号数自动推导（保证单账号 ≤~51 条/分钟，避开契约 §9 用户级限流）
//   HOLD_MS          单连接保持时长，默认 135000（≈场景 + 余量）
//   SUMMARY_OUT      自定义 summary 输出路径
//
// 契约口径：docs/09 §1 S2 —— ack P95 < 150ms、P99 < 300ms、失败率 < 1%。
export { default, options, setup, handleSummary } from './lib/im-scenario.js';
