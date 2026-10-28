-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0015_multi_organization（扩展结构 1）
-- 1. 移除“一个用户只能有一个 active 组织”的部分唯一索引；
-- 2. 增加 users.display_organization_id：用户当前展示的组织身份；
-- 3. 保留 organization_members (organization_id, user_id) 唯一，防止同组织重复行；
-- 4. 保留 organizations_owner_pending_active_key：同一 owner 仍只能有一个在册组织。
-- ============================================================================

DROP INDEX IF EXISTS organization_members_user_active_key;

ALTER TABLE users
  ADD COLUMN display_organization_id uuid NULL
  REFERENCES organizations (id) ON DELETE SET NULL;

CREATE INDEX users_display_organization_id_idx
  ON users (display_organization_id);

-- 历史数据默认不指定展示组织；IdentityService 会按角色权重自动选择。
