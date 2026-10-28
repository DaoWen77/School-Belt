#!/usr/bin/env node
/** 二次清扫：复合词/标识符里残留的 IP 词 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(process.argv[1]), '..');
const SKIP = new Set(['node_modules', '.next', 'dist', '.git', 'reports', 'backups', 'ref', 'design', 'firmware']);
const EXT = new Set(['.ts', '.tsx', '.md', '.mjs', '.js', '.sql', '.ps1', '.sh', '.cmd']);

/* 顺序：长复合词 → 单独词 */
const RULES = [
  ['O.M.V 工作台', 'O.M.V 工作台'], // 兜底
  ['O.M.V 工作台', 'O.M.V 工作台'],
  ['工作台', '工作台'],
  ['工作台', '工作台'],
  ['环塔', '环塔'],
  ['环塔', '环塔'],
  ['信号塔', '信号塔'],
  ['用户', '用户'],
  ['O.M.V', 'O.M.V'],
];

const changed = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(full);
      continue;
    }
    if (!EXT.has(path.extname(e.name))) continue;
    const before = fs.readFileSync(full, 'utf8');
    let after = before;
    for (const [from, to] of RULES) after = after.split(from).join(to);
    if (after !== before) {
      fs.writeFileSync(full, after, 'utf8');
      changed.push(path.relative(ROOT, full));
    }
  }
}
walk(ROOT);
console.log(`二次清扫 ${changed.length} 个文件`);
for (const f of changed) console.log(' -', f);
