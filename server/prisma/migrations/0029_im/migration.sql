-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0029_im（模块六：@提及 / DING / 置顶 / 隐藏 / 拉黑）
-- 依据：IM 消息增强
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0028_escrow 已执行
-- 说明：
--   1. 置顶复用既有 pins 表，本迁移不动 pins；
--   2. mentions 列已存在（0001 建表），本次只补解析写库逻辑；
--   3. message_hides 为「单用户隐藏」；user_blocks 为拉黑（频道消息不过滤）；
--   4. 全部 IF NOT EXISTS / DO 块，可重复执行。
-- ============================================================================

-- 1) DING 标记（每日 3 次按 sender_id + ding + created_at 计数）
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ding boolean NOT NULL DEFAULT false;

-- 2) 单用户隐藏消息
CREATE TABLE IF NOT EXISTS message_hides (
  message_id bigint       NOT NULL REFERENCES messages (id) ON DELETE CASCADE ON UPDATE CASCADE,
  user_id    uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS message_hides_user_id_idx
  ON message_hides (user_id);

-- 3) 拉黑（单向：blocker 拒绝 blocked 建链）
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  blocked_id uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self_check CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocked_id_idx
  ON user_blocks (blocked_id);

-- 4) DING 计数索引（今日 Count + 频道内 DING 列表）
CREATE INDEX IF NOT EXISTS messages_channel_id_ding_created_at_idx
  ON messages (channel_id, ding, created_at);
