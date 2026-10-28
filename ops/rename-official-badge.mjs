#!/usr/bin/env node
/**
 * 身份章改名：`[站长]` → `[站长]`
 * - 源码 / schema / 文档 / e2e 脚本：全量替换（字符串常量与注释文案）
 * - 迁移 SQL：不动历史迁移，新增一次性迁移 0030 更新存量数据（由 Lead 单独写）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(process.argv[1]), '..');
const FROM = '站长';
const TO = '站长';
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', 'reports', 'backups', 'ref']);
const EXT = new Set(['.ts', '.tsx', '.prisma', '.md', '.mjs', '.js', '.json', '.ps1', '.sh', '.cmd', '.yml', '.yaml', '.conf', '.html']);

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
    const text = fs.readFileSync(full, 'utf8');
    if (!text.includes(FROM)) continue;
    fs.writeFileSync(full, text.split(FROM).join(TO), 'utf8');
    changed.push(path.relative(ROOT, full));
  }
}
walk(ROOT);
console.log(`改名字段 ${changed.length} 个文件：`);
for (const file of changed) console.log(' -', file);
