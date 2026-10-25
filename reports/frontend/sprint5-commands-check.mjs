/**
 * 最小指令解析断言（8 条正向 + 误匹配负例）。
 * 运行：node --experimental-strip-types reports/frontend/sprint5-commands-check.mjs
 */
import assert from 'node:assert/strict';
import { parseStartCommand } from '../../web/src/lib/commands.ts';

const positive = [
  ['/task', 'task'],
  ['/task   ', 'task'],
  ['/poll', 'poll'],
  ['/tasks', 'tasks'],
  ['/goto 素材工坊', 'goto'],
  ['/report', 'report'],
  ['/ping', 'ping'],
  ['sudo rm -rf /', 'sudo'],
];

for (const [input, type] of positive) {
  const result = parseStartCommand(input);
  assert.equal(result.type, type, `${input} 应解析为 ${type}，实际 ${result.type}`);
  if (type === 'goto') assert.equal(result.channelName, '素材工坊');
}

const negative = ['/botany', '/tasks2', '/task foo', '/polling', '/goto', '/report x', '/pingx', 'sudo rm -rf /tmp', '/unknown'];
for (const input of negative) {
  assert.equal(parseStartCommand(input).type, 'none', `${input} 不应被拦截`);
}

console.log(JSON.stringify({ ok: true, positive: positive.length, negative: negative.length, negativeCases: negative }, null, 2));
