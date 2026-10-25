-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0012_friendships（文明环带 Phase D）
-- 依据：双面单库方案 D｜好友申请与 DM 限制
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0011_belt_content 已执行
-- 说明：
--   1. 好友关系一对用户只有一行；同意后才创建 DM；
--   2. 现有 DM 全部回填为 accepted，保证历史会话不失效；
--   3. channels.dm_key 的唯一性从全局改为 (dm_key, surface)，
--      让内网 DM / 环带 DM / bridge DM 可以共存；
--   4. 本迁移不物理删除任何消息或频道。
-- ============================================================================

CREATE TYPE "FriendshipStatus" AS ENUM ('pending', 'accepted', 'rejected', 'blocked', 'removed');

CREATE TABLE friendships (
  id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id    uuid             NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  addressee_id    uuid             NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status          "FriendshipStatus" NOT NULL DEFAULT 'pending',
  surface         "ChannelSurface" NOT NULL DEFAULT 'internal',
  context_post_id uuid             NULL REFERENCES posts (id) ON DELETE SET NULL,
  request_note    varchar(200)     NULL,
  dm_channel_id   uuid             NULL UNIQUE REFERENCES channels (id) ON DELETE SET NULL,
  blocked_by      uuid             NULL REFERENCES users (id) ON DELETE SET NULL,
  requested_at    timestamptz      NOT NULL DEFAULT now(),
  responded_at    timestamptz      NULL,
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT friendships_not_self_check CHECK (requester_id <> addressee_id),
  CONSTRAINT friendships_request_note_length_check
    CHECK (request_note IS NULL OR char_length(request_note) <= 200)
);

-- 一对用户只允许一条关系；顺序无关。
CREATE UNIQUE INDEX friendships_pair_key
  ON friendships (
    LEAST(requester_id, addressee_id),
    GREATEST(requester_id, addressee_id)
  );

CREATE INDEX friendships_addressee_status_idx
  ON friendships (addressee_id, status, requested_at);
CREATE INDEX friendships_requester_status_idx
  ON friendships (requester_id, status);

-- DM 的唯一键从全局改为按面；历史 dm_key 不变。
DROP INDEX IF EXISTS channels_dm_key_key;
CREATE UNIQUE INDEX channels_dm_key_surface_key
  ON channels (dm_key, surface)
  WHERE dm_key IS NOT NULL;

-- 历史 DM 回填为已接受好友链路，避免升级后不能发消息。
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
  -- 只回填严格 2 人的 DM；历史坏数据可能有 bot 等额外成员。
  AND (SELECT count(*) FROM channel_members x WHERE x.channel_id = c.id) = 2
ON CONFLICT DO NOTHING;
