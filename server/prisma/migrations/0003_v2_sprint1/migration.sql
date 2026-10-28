-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0003_v2_sprint1（契约 v1.2 Sprint 1 手写增量迁移）
-- 依据：Sprint1 需求（状态前缀 + 群公告）
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0001_init、0002_conversations 已执行
-- 说明：不写显式 BEGIN/COMMIT —— prisma migrate deploy 对 PostgreSQL 会把每个
--       迁移文件包在一个事务里；0001_init 的显式事务属历史写法，两者并存会产生
--       "there is already a transaction in progress" 警告（0002 已采用从简写法）。
-- 幂等性：仅可执行一次（prisma migrate deploy 会记录到 _prisma_migrations）。
-- ============================================================================

-- ── 1. users.status_prefix（≤24 字符，前端展示在昵称前）────────────────────
ALTER TABLE users ADD COLUMN status_prefix varchar(24) NULL;

-- ── 2. channels.announcement（群公告，≤4000 字符）──────────────────────────
ALTER TABLE channels ADD COLUMN announcement text NULL;

-- ── 3. 一致性 CHECK（实现侧加固，不改变契约语义）──────────────────────────
-- 公告只允许出现在群聊（kind=group）；DM/频道不应有公告
ALTER TABLE channels ADD CONSTRAINT channels_announcement_kind_check CHECK (
  announcement IS NULL OR kind = 'group'
);
-- 公告长度上限 4000（与 DTO 校验一致）
ALTER TABLE channels ADD CONSTRAINT channels_announcement_length_check CHECK (
  announcement IS NULL OR char_length(announcement) <= 4000
);
-- 状态前缀长度上限 24（与 DTO 校验一致；trim 后允许空串表示清除→应用层写 NULL）
ALTER TABLE users ADD CONSTRAINT users_status_prefix_length_check CHECK (
  status_prefix IS NULL OR char_length(status_prefix) <= 24
);

-- ── 4. 回滚（手工；prisma migrate deploy 不生成 down）──────────────────────
-- BEGIN;
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_prefix_length_check;
-- ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_announcement_length_check;
-- ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_announcement_kind_check;
-- ALTER TABLE channels DROP COLUMN IF EXISTS announcement;
-- ALTER TABLE users DROP COLUMN IF EXISTS status_prefix;
-- COMMIT;
