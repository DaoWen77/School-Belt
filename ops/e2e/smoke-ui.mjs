#!/usr/bin/env node
/**
 * 兼容入口：旧命令 `node smoke-ui.mjs` 现在转发到新 IM 布局回归脚本 `im-ui-smoke.mjs`。
 *
 * 历史：task-11 的 smoke-ui.mjs 针对旧布局（ef-dialog / textarea.dj-input / 右侧常驻栏）。
 * task-15 IM 重构后布局与选择器全变（aria-label、AppShell、抽屉、卡片入流），
 * 因此新回归统一由 `im-ui-smoke.mjs` 承担；这里保留旧文件名做转发，避免旧文档/脚本失效。
 *
 * 用法：node smoke-ui.mjs [--wait-min 20] [--handle qiu] [--headed]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(HERE, 'im-ui-smoke.mjs');
console.log('[smoke-ui] 已迁移到 IM 布局回归：im-ui-smoke.mjs（本次转发，参数原样传递）');

const child = spawn(process.execPath, [script, ...process.argv.slice(2)], {
  cwd: HERE,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
child.on('error', (error) => {
  console.error(`[smoke-ui] 启动 im-ui-smoke.mjs 失败：${error.message}`);
  process.exitCode = 1;
});
