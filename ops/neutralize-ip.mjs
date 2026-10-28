#!/usr/bin/env node
/**
 * IP 中性化：把带 IP 风险的专有名词统一替换为中性词。
 *
 * 规则（只改「文案/标识」层，不改代码标识符与路由）：
 *   工作台          → 工作台
 *   环塔 / 环塔  → 环塔
 *   信号塔 / SIGNAL-NET → 信号塔 / SIGNAL-NET
 *   用户            → 用户
 *   站长助理 → 站长助理
 *   O.M.V / 极光    → （见 SAG说明，单独处理）
 *
 * 处理顺序很重要：先长词后短词，避免「环塔」被拆成「文明环塔」。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(process.argv[1]), '..');
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', 'reports', 'backups', 'ref', 'design', 'firmware']);
const EXT = new Set(['.ts', '.tsx', '.md', '.mjs', '.js', '.json', '.sql', '.ps1', '.sh', '.cmd', '.yml', '.yaml', '.conf', '.html']);

const RULES = [
  // 长的先替换
  ['环塔', '环塔'],
  ['站长助理', '站长助理'],
  ['O.M.V', 'O.M.V'],
  ['O.M.V', 'O.M.V'],
  ['工作台', '工作台'],
  ['环塔', '环塔'],
  ['信号塔', '信号塔'],
  ['SIGNAL-NET', 'SIGNAL-NET'],
  ['用户', '用户'],
];

const PROTECT = [
  /RouterPath|api\/v1|pathname/g,
];

const changed = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!EXT.has(path.extname(entry.name))) continue;
    const before = fs.readFileSync(full, 'utf8');
    let after = before;
    for (const [from, to] of RULES) {
      if (after.includes(from)) after = after.split(from).join(to);
    }
    if (after !== before) {
      fs.writeFileSync(full, after, 'utf8');
      changed.push(path.relative(ROOT, full));
    }
  }
}
walk(ROOT);
console.log(`中性化 ${changed.length} 个文件`);
for (const file of changed) console.log(' -', file);
