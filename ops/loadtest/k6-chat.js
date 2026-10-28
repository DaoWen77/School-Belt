// O.M.V 工作台 · 全域广播 —— k6 聊天压测（历史入口，保留文件名）
//
// 2026-10-23 起，完整实现抽到 lib/im-scenario.js，本文件与 k6-ack.js 行为一致：
//   login（多账号，setup）→ 取频道 → WS /ws → message:send → ack 延迟统计 → summary JSON。
//
// 相比旧版（要求手工传 ACCESS_TOKEN / CHANNEL_ID、每 VU 固定 1 条/秒）的变化：
//   - 不再需要 ACCESS_TOKEN/CHANNEL_ID：脚本自己登录并解析 general 频道；
//   - 发送间隔按账号数自动推导，避开契约 §9 的「60 条/分钟/用户」限流；
//   - 新增 ack 超时清理、RATE_LIMITED 单独计数、ack_ok 比例与 ws_ready 指标。
//
// 推荐用法见 k6-ack.js 头部；两者等价：
//   & 'C:\Program Files\k6\k6.exe' run -e VUS=50 -e DURATION=2m ops/loadtest/k6-chat.js
export { default, options, setup, handleSummary } from './lib/im-scenario.js';
