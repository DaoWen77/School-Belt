#!/usr/bin/env node
/**
 * UI 冒烟落库核验：直接查真实 Postgres，确认 UI 点出来的消息/私聊/群聊确实写入数据库
 * （不经过 API，避免登录限流；证据写入 reports/e2e/ui-db-check.json）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 'ui-db-check.json');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/dijiang';

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

const messages = await client.query(
  `SELECT m.id::text AS id, m.body, m.channel_id, c.kind, c.name AS channel_name, u.handle
     FROM messages m
     JOIN channels c ON c.id = m.channel_id
     JOIN users u ON u.id = m.sender_id
    WHERE m.body LIKE '[e2e-ui]%'
    ORDER BY m.id DESC
    LIMIT 20`,
);

const groups = await client.query(
  `SELECT c.id, c.kind, c.name, count(cm.user_id)::int AS members
     FROM channels c
     LEFT JOIN channel_members cm ON cm.channel_id = c.id
    WHERE c.kind IN ('dm','group')
    GROUP BY c.id
    ORDER BY c.created_at DESC
    LIMIT 20`,
);

const summary = await client.query(
  `SELECT (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM channels WHERE kind='channel') AS channels,
          (SELECT count(*)::int FROM channels WHERE kind='dm') AS dms,
          (SELECT count(*)::int FROM channels WHERE kind='group') AS groups,
          (SELECT count(*)::int FROM messages) AS messages`,
);

await client.end();

const result = {
  checkedAt: new Date().toISOString(),
  databaseUrl: DATABASE_URL,
  uiMessages: messages.rows,
  conversations: groups.rows,
  totals: summary.rows[0],
  verdict:
    messages.rows.length >= 3 && groups.rows.some((row) => row.kind === 'dm' && row.name === '') && groups.rows.some((row) => row.kind === 'group' && row.name.startsWith('e2e 群'))
      ? 'PASS'
      : 'FAIL',
};
fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result, null, 2));
