-- ============================================================================
-- O.M.V 工作台 · 功能大搬家 —— 任务一：物理清空内网历史社交数据
--
-- 语义：
--   - surface='internal' 的 posts（朋友圈/动态）整表删除；
--   - surface='internal' 的 conversations（内部 DM/群聊频道）及其消息整链删除；
--   - 以及引用这些消息/频道/卡片/帖子的 reactions、attachments、pins、
--     notifications、cards、vote 等派生数据一并物理清除。
--
-- 采用显式依赖顺序（子表 → 父表），不依赖外键级联，便于审计与幂等重跑。
-- 执行前请确认已在目标环境备份（见 backups/）。
-- ============================================================================

BEGIN;

-- 1) 内部频道集合（含 DM / 群聊 / 普通频道）
CREATE TEMP TABLE internal_channels AS
  SELECT id FROM channels WHERE surface = 'internal';

-- 2) 内部帖子集合
CREATE TEMP TABLE internal_posts AS
  SELECT id FROM posts WHERE surface = 'internal';

-- 3) 内部消息集合（其频道为 internal）
CREATE TEMP TABLE internal_messages AS
  SELECT m.id
  FROM messages m
  JOIN internal_channels c ON c.id = m.channel_id;

-- 4) 内部卡片集合（其频道为 internal）
CREATE TEMP TABLE internal_cards AS
  SELECT c.id
  FROM cards c
  JOIN internal_channels ch ON ch.id = c.channel_id;

-- 5) 内部文件集合（其频道为 internal）
CREATE TEMP TABLE internal_files AS
  SELECT f.id
  FROM files f
  JOIN internal_channels ch ON ch.id = f.channel_id;

-- ── 派生数据：reactions / attachments / pins / notifications ─────────────
DELETE FROM reactions WHERE message_id IN (SELECT id FROM internal_messages)
                      OR card_id IN (SELECT id FROM internal_cards);

DELETE FROM attachments WHERE message_id IN (SELECT id FROM internal_messages)
                          OR card_id IN (SELECT id FROM internal_cards);

DELETE FROM pins WHERE message_id IN (SELECT id FROM internal_messages);

DELETE FROM notifications
 WHERE channel_id IN (SELECT id FROM internal_channels)
    OR message_id IN (SELECT id FROM internal_messages)
    OR card_id IN (SELECT id FROM internal_cards);

-- ── 投票：选项 / 选票 ────────────────────────────────────────────────────
DELETE FROM vote_options WHERE card_id IN (SELECT id FROM internal_cards);
DELETE FROM vote_ballots WHERE card_id IN (SELECT id FROM internal_cards);

-- ── 卡片分配 ─────────────────────────────────────────────────────────────
DELETE FROM card_assignees WHERE card_id IN (SELECT id FROM internal_cards);

-- ── 贴纸（内部文件）──────────────────────────────────────────────────────
DELETE FROM stickers WHERE file_id IN (SELECT id FROM internal_files);

-- ── 消息（含父/子线程引用）───────────────────────────────────────────────
DELETE FROM messages WHERE id IN (SELECT id FROM internal_messages);

-- ── 卡片 ──────────────────────────────────────────────────────────────────
DELETE FROM cards WHERE id IN (SELECT id FROM internal_cards);

-- ── 频道成员 / 频道 ──────────────────────────────────────────────────────
DELETE FROM channel_members WHERE channel_id IN (SELECT id FROM internal_channels);
DELETE FROM channels WHERE id IN (SELECT id FROM internal_channels);

-- ── 内部帖子派生：赞 / 评论 / 贴纸（RSS 为 belt，不受影响）──────────────
DELETE FROM post_likes WHERE post_id IN (SELECT id FROM internal_posts);
DELETE FROM post_comments WHERE post_id IN (SELECT id FROM internal_posts);
DELETE FROM posts WHERE id IN (SELECT id FROM internal_posts);

-- ── 内部文件本身 ─────────────────────────────────────────────────────────
DELETE FROM files WHERE id IN (SELECT id FROM internal_files);

DROP TABLE IF EXISTS internal_files;
DROP TABLE IF EXISTS internal_cards;
DROP TABLE IF EXISTS internal_messages;
DROP TABLE IF EXISTS internal_posts;
DROP TABLE IF EXISTS internal_channels;

COMMIT;
