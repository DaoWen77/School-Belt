-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0013_friend_backfill_repair（Phase D 数据修复）
-- 背景：历史测试 DM 里混入了 bot 成员，导致 0012 回填出错误好友对。
-- 本迁移：
--   1. 删除指向“非严格 2 人 DM”的 friendships（这些只能是错误回填）；
--   2. 从多人 DM 中移除 bot 成员，恢复真实二人会话；
--   3. 重新回填严格 2 人 DM 的好友关系。
-- ============================================================================

DELETE FROM friendships f
USING channels c
WHERE f.dm_channel_id = c.id
  AND c.kind = 'dm'
  AND (SELECT count(*) FROM channel_members m WHERE m.channel_id = c.id) <> 2;

-- Bot 不应出现在 DM 参与者里。只处理有额外成员的旧 DM，避免误删正常 bot 频道。
DELETE FROM channel_members cm
USING channels c, users u
WHERE cm.channel_id = c.id
  AND cm.user_id = u.id
  AND c.kind = 'dm'
  AND u.is_bot = true
  AND (SELECT count(*) FROM channel_members x WHERE x.channel_id = c.id) > 2;

INSERT INTO friendships (
  requester_id,
  addressee_id,
  status,
  surface,
  dm_channel_id,
  requested_at,
  responded_at,
  created_at,
  updated_at
)
SELECT
  LEAST(m1.user_id, m2.user_id),
  GREATEST(m1.user_id, m2.user_id),
  'accepted',
  c.surface,
  c.id,
  c.created_at,
  c.created_at,
  c.created_at,
  now()
FROM channels c
JOIN LATERAL (
  SELECT user_id FROM channel_members
  WHERE channel_id = c.id
  ORDER BY user_id ASC
  LIMIT 1
) m1 ON true
JOIN LATERAL (
  SELECT user_id FROM channel_members
  WHERE channel_id = c.id
  ORDER BY user_id DESC
  LIMIT 1
) m2 ON true
WHERE c.kind = 'dm'
  AND m1.user_id <> m2.user_id
  AND (SELECT count(*) FROM channel_members x WHERE x.channel_id = c.id) = 2
ON CONFLICT DO NOTHING;
