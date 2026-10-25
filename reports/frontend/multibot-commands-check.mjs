/**
 * 多 Bot 指令断言（node --experimental-strip-types）。
 * 8 正向 + 误匹配负例；新增 /bot /clear /summarize /translate /roll。
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
  ['/bot', 'bot'],
  ['/clear', 'clear'],
  ['/summarize', 'summarize'],
  ['/translate', 'translate'],
  ['/roll 1d100', 'roll'],
];

for (const [input, type] of positive) {
  const result = parseStartCommand(input);
  assert.equal(result.type, type, `${input} 应解析为 ${type}，实际 ${result.type}`);
  if (type === 'goto') assert.equal(result.channelName, '素材工坊');
  if (type === 'roll') {
    assert.equal(result.count, 1);
    assert.equal(result.sides, 100);
  }
}

const negative = [
  '/botany',
  '/clearx',
  '/rollx',
  '/tasks2',
  '/task foo',
  '/polling',
  '/goto',
  '/report x',
  '/pingx',
  'sudo rm -rf /tmp',
  '/unknown',
];
for (const input of negative) {
  assert.equal(parseStartCommand(input).type, 'none', `${input} 不应被拦截`);
}
assert.equal(parseStartCommand('/roll abc').type, 'roll-invalid');
assert.equal(parseStartCommand('/roll 2d').type, 'roll-invalid');

console.log(JSON.stringify({ ok: true, positive: positive.length, negative: negative.length, rollInvalid: 2 }, null, 2));
