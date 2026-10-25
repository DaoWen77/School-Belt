-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0002_conversations（契约 v1.2 §A 手写增量迁移）
-- 依据：docs/_contract-v1.2.md §A1（channels 三列）、§A2（索引）
-- 目标库：PostgreSQL 16
-- 前置：0001_init 已执行（channels 表存在）
-- 事务：不写显式 BEGIN/COMMIT —— `prisma migrate deploy` 对 PostgreSQL 会把每个
--       迁移文件包在一个事务里执行（0001_init 的显式 BEGIN/COMMIT 属历史写法，
--       两者并存会产生 "there is already a transaction in progress" 告警，故本文件从简）。
-- 幂等性：仅可执行一次（prisma migrate deploy 会记录到 _prisma_migrations）。
-- ============================================================================

-- ── 1. 会话类型枚举（契约 v1.2 §A1）──────────────────────────────────────────
-- channel = 社区频道（默认值，既有行为不变）；dm = 一对一私聊；group = 群聊
CREATE TYPE "ChannelKind" AS ENUM ('channel', 'dm', 'group');

-- ── 2. channels 增加 3 列（契约 v1.2 §A1）────────────────────────────────────
-- kind：存量行全部落 'channel'，社区频道语义零变化
ALTER TABLE channels ADD COLUMN kind "ChannelKind" NOT NULL DEFAULT 'channel';
-- dm_key：仅 kind=dm 有值 = sha256(排序后的两个 userId 以 ':' 连接)，64 位十六进制
ALTER TABLE channels ADD COLUMN dm_key varchar(80) NULL;
-- last_message_at：会话列表排序用，发消息时由 messages.service 同事务更新
ALTER TABLE channels ADD COLUMN last_message_at timestamptz NULL;

-- ── 3. 索引（契约 v1.2 §A2）─────────────────────────────────────────────────
-- DM 幂等的最终保证：同一对人永远只有一行（部分唯一索引，普通频道/群聊 dm_key 为 NULL 不参与）
CREATE UNIQUE INDEX channels_dm_key_key ON channels (dm_key) WHERE dm_key IS NOT NULL;
-- 侧栏按 kind 分组 + position 排序
CREATE INDEX channels_kind_position_idx ON channels (kind, position);

-- ── 4. 一致性 CHECK（实现侧加固，不改变契约语义）─────────────────────────────
-- dm_key 只能出现在 kind=dm 上（防止把群聊/频道误标成私聊幂等行）；
-- 允许 kind=dm 且 dm_key IS NULL —— 一方退出时清空 dm_key（会话行保留、幂等槽位释放），
-- 这样「重新发起需要新建」可落地，且旧会话历史仍对留下的一方可见（契约 v1.2 §D4）。
ALTER TABLE channels ADD CONSTRAINT channels_dm_key_kind_check CHECK (
  dm_key IS NULL OR kind = 'dm'
);
-- 群聊名称必填（1–60），DM 名称允许空串（前端用对方显示名渲染）
ALTER TABLE channels ADD CONSTRAINT channels_group_name_check CHECK (
  kind <> 'group' OR char_length(btrim(name)) BETWEEN 1 AND 60
);

-- ── 5. 回滚（手工；prisma migrate deploy 不生成 down）───────────────────────
-- BEGIN;
-- ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_group_name_check;
-- ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_dm_key_kind_check;
-- DROP INDEX IF EXISTS channels_kind_position_idx;
-- DROP INDEX IF EXISTS channels_dm_key_key;
-- ALTER TABLE channels DROP COLUMN IF EXISTS last_message_at;
-- ALTER TABLE channels DROP COLUMN IF EXISTS dm_key;
-- ALTER TABLE channels DROP COLUMN IF EXISTS kind;
-- DROP TYPE IF EXISTS "ChannelKind";
-- COMMIT;
