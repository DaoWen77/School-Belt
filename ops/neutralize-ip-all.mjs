#!/usr/bin/env node
/**
 * IP 全量清理（第二轮，覆盖上一轮脚本漏掉的范围）：
 *   全仓扫描（含 .css/.html/.json/.env.example/Dockerfile/Caddyfile/Makefile 等），
 *   把 IP 专有词替换为中性词；跳过构建产物与运行时目录。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(process.argv[1]), '..');
const SKIP_DIRS = new Set([
  'node_modules', '.next', 'dist', '.git', 'reports', 'backups', 'ref',
  'pgdata', 'rclone-s3', '.pnpm-store', 'coverage', '.vitest',
]);
const SKIP_FILES = new Set(['neutralize-ip.mjs', 'neutralize-ip2.mjs', 'neutralize-ip-all.mjs']);

/** 顺序：长的复合词先替换 */
const RULES = [
  ['O.M.V 帝江号', 'O.M.V 工作台'],
  ['O.M.V帝江号', 'O.M.V 工作台'],
  ['O.M.V. DIJIANG', 'O.M.V. WORKBENCH'],
  ['DIJIANG / BROADCAST', 'OMV / BROADCAST'],
  ['[DIJIANG/OS]', '[OMV/OS]'],
  ['帝江号', '工作台'],
  ['帝江', '工作台'],
  ['文明环带', '环塔'],
  ['环带', '环塔'],
  ['绳网', '信号塔'],
  ['INTER-KNOT', 'SIGNAL-NET'],
  ['终末地工业高级协议官', '站长助理'],
  ['终末地工业', 'O.M.V'],
  ['终末地', 'O.M.V'],
  ['干员', '用户'],
  ['极光通讯', '语音链路'],
  ['AURORA CALL', 'VOICE LINK'],
  ['极光科技', '站长'],
  ['极光', '核心'],
];

const changed = new Map();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (SKIP_FILES.has(entry.name)) continue;
    const ext = path.extname(entry.name);
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.bundle', '.exe', '.dll', '.pdf', '.pptx'].includes(ext)) continue;
    if (fs.statSync(full).size > 4 * 1024 * 1024) continue;

    const before = fs.readFileSync(full, 'utf8');
    if (before.includes('\u0000')) continue;
    let after = before;
    for (const [from, to] of RULES) if (after.includes(from)) after = after.split(from).join(to);
    if (after !== before) {
      fs.writeFileSync(full, after, 'utf8');
      const hits = RULES.filter(([from]) => before.includes(from)).map(([from]) => from);
      changed.set(path.relative(ROOT, full), hits);
    }
  }
}
walk(ROOT);
console.log(`清理 ${changed.size} 个文件`);
for (const [file, hits] of changed) console.log(` - ${file}  [${[...new Set(hits)].join(',')}]`);
