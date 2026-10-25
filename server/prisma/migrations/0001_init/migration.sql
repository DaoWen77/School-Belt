-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0001_init（手写完整迁移）
-- 依据：docs/_contract.md §2（18 张表）、§2 索引、§3 单调序、§5 邀请原子扣减
-- 目标库：PostgreSQL 16
-- 幂等性：仅可执行一次（prisma migrate deploy 会记录到 _prisma_migrations）
-- ============================================================================

BEGIN;

-- ── 0. 扩展 ─────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. 枚举类型（§1） ───────────────────────────────────────────────────────
CREATE TYPE "GlobalRole"       AS ENUM ('owner', 'admin', 'member');
CREATE TYPE "UserStatus"       AS ENUM ('active', 'suspended');
CREATE TYPE "ChannelRole"      AS ENUM ('member', 'moderator');
CREATE TYPE "Visibility"       AS ENUM ('public', 'private');
CREATE TYPE "NotifyLevel"      AS ENUM ('all', 'mentions', 'none');
CREATE TYPE "MessageKind"      AS ENUM ('text', 'image', 'file', 'card', 'system');
CREATE TYPE "CardKind"         AS ENUM ('material', 'idea', 'vote', 'task', 'artwork');
CREATE TYPE "CardStatus"       AS ENUM ('open', 'done', 'closed', 'archived');
CREATE TYPE "TaskStatus"       AS ENUM ('todo', 'doing', 'done');
CREATE TYPE "FileKind"         AS ENUM ('image', 'video', 'audio', 'document', 'archive', 'other');
CREATE TYPE "FileStatus"       AS ENUM ('pending', 'ready', 'rejected', 'deleted');
CREATE TYPE "PreviewStatus"    AS ENUM ('none', 'pending', 'ready', 'failed');
CREATE TYPE "NotificationType" AS ENUM ('mention', 'thread_reply', 'card_assigned', 'card_due', 'vote_closed', 'invite_accepted', 'system');
CREATE TYPE "PushStatus"       AS ENUM ('pending', 'sent', 'failed', 'skipped');
CREATE TYPE "Platform"         AS ENUM ('web', 'android');

-- ── 2. users（§2.1）─────────────────────────────────────────────────────────
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle         citext                NOT NULL,
  display_name   varchar(40)           NOT NULL,
  password_hash  text                  NOT NULL,
  avatar_file_id uuid                  NULL,
  global_role    "GlobalRole"          NOT NULL DEFAULT 'member',
  status         "UserStatus"          NOT NULL DEFAULT 'active',
  muted_until    timestamptz           NULL,
  created_at     timestamptz           NOT NULL DEFAULT now(),
  updated_at     timestamptz           NOT NULL DEFAULT now(),
  last_seen_at   timestamptz           NULL,
  CONSTRAINT users_handle_check CHECK (handle::text ~ '^[a-z0-9_]{3,24}$')
);
CREATE UNIQUE INDEX users_handle_key ON users (handle);
CREATE INDEX users_status_idx ON users (status);

-- ── 3. user_settings（§2.2）─────────────────────────────────────────────────
CREATE TABLE user_settings (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  locale        varchar(8)      NOT NULL DEFAULT 'zh-CN',
  theme         text            NOT NULL DEFAULT 'system',
  notify_level  "NotifyLevel"   NOT NULL DEFAULT 'all',
  dnd_enabled   boolean         NOT NULL DEFAULT false,
  dnd_start     time            NULL,
  dnd_end       time            NULL,
  timezone      text            NOT NULL DEFAULT 'Asia/Shanghai',
  push_web      boolean         NOT NULL DEFAULT true,
  push_android  boolean         NOT NULL DEFAULT true,
  digest_window integer         NOT NULL DEFAULT 300,
  updated_at    timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT user_settings_theme_check CHECK (theme IN ('light', 'dark', 'system'))
);

-- ── 4. devices（§2.3）───────────────────────────────────────────────────────
CREATE TABLE devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform       "Platform"    NOT NULL,
  name           varchar(60)   NOT NULL,
  push_provider  text          NULL,
  push_token     text          NULL,
  push_keys      jsonb         NULL,
  last_active_at timestamptz   NULL,
  created_at     timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_id_idx ON devices (user_id);
CREATE UNIQUE INDEX devices_platform_push_token_key ON devices (platform, push_token);

-- ── 5. sessions（§2.4）──────────────────────────────────────────────────────
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text         NOT NULL,
  device_id    uuid         NULL REFERENCES devices(id) ON DELETE SET NULL,
  ip           inet         NULL,
  user_agent   text         NULL,
  expires_at   timestamptz  NOT NULL,
  revoked_at   timestamptz  NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  rotated_from uuid         NULL
);
CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_user_id_revoked_at_idx ON sessions (user_id, revoked_at);

-- ── 6. invites（§2.5）───────────────────────────────────────────────────────
CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash   text        NOT NULL,
  code_prefix varchar(8)  NOT NULL,
  created_by  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        "GlobalRole" NOT NULL DEFAULT 'member',
  max_uses    integer     NOT NULL DEFAULT 1,
  uses        integer     NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  revoked_at  timestamptz NULL,
  note        varchar(80) NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invites_role_check CHECK (role IN ('member', 'admin')),
  CONSTRAINT invites_uses_nonneg CHECK (uses >= 0 AND uses <= max_uses)
);
CREATE UNIQUE INDEX invites_code_hash_key ON invites (code_hash);
CREATE INDEX invites_created_by_idx ON invites (created_by);
CREATE INDEX invites_expires_at_idx ON invites (expires_at);

-- ── 7. channels（§2.6）──────────────────────────────────────────────────────
CREATE TABLE channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(60)  NOT NULL,
  slug        citext       NOT NULL,
  topic       varchar(200) NULL,
  visibility  "Visibility" NOT NULL DEFAULT 'public',
  position    integer      NOT NULL DEFAULT 0,
  created_by  uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  archived_at timestamptz  NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX channels_slug_key ON channels (slug);
CREATE INDEX channels_position_idx ON channels (position);

-- ── 8. channel_members（§2.7）───────────────────────────────────────────────
CREATE TABLE channel_members (
  channel_id    uuid          NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id       uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          "ChannelRole" NOT NULL DEFAULT 'member',
  notify_level  "NotifyLevel" NOT NULL DEFAULT 'all',
  muted_until   timestamptz   NULL,
  last_read_seq bigint        NOT NULL DEFAULT 0,
  last_read_at  timestamptz   NULL,
  joined_at     timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX channel_members_user_id_idx ON channel_members (user_id);

-- ── 9. files（§2.10）───────────────────────────────────────────────────────
CREATE TABLE files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id      uuid          NULL REFERENCES channels(id) ON DELETE SET NULL,
  bucket          text          NOT NULL,
  storage_key     text          NOT NULL,
  original_name   varchar(255)  NOT NULL,
  mime            varchar(120)  NOT NULL,
  kind            "FileKind"    NOT NULL DEFAULT 'other',
  size_bytes      bigint        NOT NULL,
  checksum_sha256 char(64)      NULL,
  width           integer       NULL,
  height          integer       NULL,
  duration_ms     integer       NULL,
  preview_key     text          NULL,
  preview_status  "PreviewStatus" NOT NULL DEFAULT 'none',
  status          "FileStatus"  NOT NULL DEFAULT 'pending',
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT files_size_bytes_nonneg CHECK (size_bytes >= 0)
);
CREATE UNIQUE INDEX files_storage_key_key ON files (storage_key);
CREATE INDEX files_channel_kind_created_idx ON files (channel_id, kind, created_at DESC);
CREATE INDEX files_owner_id_idx ON files (owner_id);
CREATE INDEX files_status_idx ON files (status);

-- 用户头像 ↔ files 的循环外键
ALTER TABLE users
  ADD CONSTRAINT users_avatar_file_id_fkey
  FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL;

-- ── 10. messages（§2.8）────────────────────────────────────────────────────
CREATE TABLE messages (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id         uuid          NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id          uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind               "MessageKind" NOT NULL,
  body               text          NULL,
  client_msg_id      uuid          NOT NULL,
  parent_id          bigint        NULL,
  thread_root_id     bigint        NULL,
  reply_to_id        bigint        NULL,
  card_id            uuid          NULL,          -- FK 在 cards 建表后补充
  mentions           uuid[]        NOT NULL DEFAULT '{}',
  thread_reply_count integer       NOT NULL DEFAULT 0,
  last_reply_at      timestamptz   NULL,
  edited_at          timestamptz   NULL,
  deleted_at         timestamptz   NULL,
  deleted_by         uuid          NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  -- 生成列：§2.8 要求 to_tsvector('simple', coalesce(body,''))
  search_vector      tsvector GENERATED ALWAYS AS (
                       to_tsvector('simple'::regconfig, coalesce(body, ''::text))
                     ) STORED,
  CONSTRAINT messages_body_len_check  CHECK (body IS NULL OR char_length(body) <= 8000),
  CONSTRAINT messages_thread_shape     CHECK (
    (parent_id IS NULL AND thread_root_id IS NULL)
    OR (parent_id IS NOT NULL AND thread_root_id IS NOT NULL)
  )
);
-- 幂等唯一键：同频道同发送者同 client_msg_id 只落一条（§2.8 / §6 ack 语义）
CREATE UNIQUE INDEX messages_channel_sender_client_key
  ON messages (channel_id, sender_id, client_msg_id);
CREATE INDEX messages_channel_id_id_idx ON messages (channel_id, id DESC);
CREATE INDEX messages_thread_root_id_id_idx ON messages (thread_root_id, id) WHERE thread_root_id IS NOT NULL;
CREATE INDEX messages_sender_id_id_idx ON messages (sender_id, id DESC);
CREATE INDEX messages_search_vector_idx ON messages USING GIN (search_vector);
CREATE INDEX messages_body_trgm_idx ON messages USING GIN (body gin_trgm_ops);
CREATE INDEX messages_mentions_idx ON messages USING GIN (mentions);
CREATE INDEX messages_card_id_idx ON messages (card_id);
-- 未读计数走 (channel_id, id) 覆盖索引（§3）

-- ── 11. reactions（§2.9）───────────────────────────────────────────────────
CREATE TABLE reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id bigint        NULL REFERENCES messages(id) ON DELETE CASCADE,
  card_id    uuid          NULL,
  user_id    uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      varchar(32)   NOT NULL,
  created_at timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT reactions_one_target CHECK (num_nonnulls(message_id, card_id) = 1)
);
CREATE INDEX reactions_message_id_idx ON reactions (message_id);
CREATE INDEX reactions_card_id_idx ON reactions (card_id);
CREATE UNIQUE INDEX reactions_user_emoji_message_key
  ON reactions (user_id, emoji, message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX reactions_user_emoji_card_key
  ON reactions (user_id, emoji, card_id) WHERE card_id IS NOT NULL;

-- ── 12. cards（§2.13）──────────────────────────────────────────────────────
CREATE TABLE cards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id     uuid           NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kind           "CardKind"     NOT NULL,
  title          varchar(120)   NOT NULL,
  body           text           NULL,
  color          varchar(16)    NULL,
  tags           text[]         NOT NULL DEFAULT '{}',
  position       double precision NOT NULL DEFAULT 1000,
  status         "CardStatus"   NOT NULL DEFAULT 'open',
  task_status    "TaskStatus"   NULL,
  due_at         timestamptz    NULL,
  closed_at      timestamptz    NULL,
  message_id     bigint         NULL,      -- FK 在 messages 之后补充
  source_card_id uuid           NULL,      -- 自引用，稍后补充
  created_by     uuid           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data           jsonb          NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  deleted_at     timestamptz    NULL,
  CONSTRAINT cards_body_len_check CHECK (body IS NULL OR char_length(body) <= 4000),
  CONSTRAINT cards_color_check CHECK (
    color IS NULL OR color IN ('amber', 'teal', 'rose', 'violet', 'slate')
  ),
  CONSTRAINT cards_task_status_check CHECK (
    (kind = 'task' AND task_status IS NOT NULL) OR (kind <> 'task' AND task_status IS NULL)
  )
);
CREATE INDEX cards_channel_kind_position_idx ON cards (channel_id, kind, position);
CREATE INDEX cards_channel_created_idx ON cards (channel_id, created_at DESC);
CREATE INDEX cards_tags_idx ON cards USING GIN (tags);
CREATE INDEX cards_message_id_idx ON cards (message_id);
CREATE INDEX cards_source_card_id_idx ON cards (source_card_id);
ALTER TABLE cards ADD CONSTRAINT cards_source_card_id_fkey
  FOREIGN KEY (source_card_id) REFERENCES cards(id) ON DELETE SET NULL;

-- 循环外键：messages.card_id ↔ cards.message_id
ALTER TABLE messages ADD CONSTRAINT messages_card_id_fkey
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL;
ALTER TABLE cards ADD CONSTRAINT cards_message_id_fkey
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE reactions ADD CONSTRAINT reactions_card_id_fkey
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE;

-- 线程内自引用外键
ALTER TABLE messages ADD CONSTRAINT messages_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT messages_thread_root_id_fkey
  FOREIGN KEY (thread_root_id) REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT messages_reply_to_id_fkey
  FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD CONSTRAINT messages_deleted_by_fkey
  FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL;

-- ── 13. attachments（§2.11）────────────────────────────────────────────────
CREATE TABLE attachments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id    uuid          NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  message_id bigint        NULL REFERENCES messages(id) ON DELETE CASCADE,
  card_id    uuid          NULL REFERENCES cards(id) ON DELETE CASCADE,
  position   integer       NOT NULL DEFAULT 0,
  created_at timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT attachments_one_target CHECK (num_nonnulls(message_id, card_id) = 1)
);
CREATE INDEX attachments_message_id_idx ON attachments (message_id);
CREATE INDEX attachments_card_id_idx ON attachments (card_id);
CREATE UNIQUE INDEX attachments_file_message_key
  ON attachments (file_id, message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX attachments_file_card_key
  ON attachments (file_id, card_id) WHERE card_id IS NOT NULL;

-- ── 14. pins（§2.12）───────────────────────────────────────────────────────
CREATE TABLE pins (
  channel_id uuid        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id bigint      NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, message_id)
);
CREATE INDEX pins_channel_created_idx ON pins (channel_id, created_at DESC);

-- ── 15. card_assignees（§2.14）─────────────────────────────────────────────
CREATE TABLE card_assignees (
  card_id     uuid        NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, user_id)
);
CREATE INDEX card_assignees_user_id_idx ON card_assignees (user_id);

-- ── 16. vote_options（§2.15）───────────────────────────────────────────────
CREATE TABLE vote_options (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id  uuid        NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  label    varchar(80) NOT NULL,
  position integer     NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX vote_options_card_position_key ON vote_options (card_id, position);
CREATE INDEX vote_options_card_id_idx ON vote_options (card_id);

-- ── 17. vote_ballots（§2.16）───────────────────────────────────────────────
CREATE TABLE vote_ballots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id    uuid        NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  option_id  uuid        NOT NULL REFERENCES vote_options(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vote_ballots_card_option_user_key ON vote_ballots (card_id, option_id, user_id);
CREATE INDEX vote_ballots_card_id_idx ON vote_ballots (card_id);
CREATE INDEX vote_ballots_user_id_idx ON vote_ballots (user_id);

-- ── 18. notifications（§2.17）──────────────────────────────────────────────
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        "NotificationType" NOT NULL,
  channel_id  uuid             NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id  bigint           NULL,
  card_id     uuid             NULL REFERENCES cards(id) ON DELETE CASCADE,
  title       varchar(120)     NOT NULL,
  body        varchar(300)     NULL,
  payload     jsonb            NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz      NULL,
  pushed_at   timestamptz      NULL,
  push_status "PushStatus"     NOT NULL DEFAULT 'pending',
  created_at  timestamptz      NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_read_created_idx ON notifications (user_id, read_at, created_at DESC);
CREATE INDEX notifications_created_at_idx ON notifications (created_at);

-- ── 19. audit_logs（§2.18）────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    uuid         NULL,
  action      varchar(64)  NOT NULL,
  target_kind varchar(32)  NULL,
  target_id   text         NULL,
  meta        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  ip          inet         NULL,
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_created_idx ON audit_logs (actor_id, created_at DESC);

COMMIT;
