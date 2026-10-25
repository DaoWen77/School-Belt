-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0021_direct_clears
-- 私聊“仅自己不可见”的清空记录点。
-- ============================================================================

CREATE TABLE direct_clears (
  channel_id uuid        NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  cleared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX direct_clears_user_idx ON direct_clears (user_id);
