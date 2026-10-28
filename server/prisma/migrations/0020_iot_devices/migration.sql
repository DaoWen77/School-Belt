-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0020_iot_devices（Sprint 7.3）
-- ESP32 绑定码 + 长期设备 token（与用户 JWT 隔离，token 只存 SHA-256）。
-- ============================================================================

CREATE TABLE device_bind_codes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(6)  NOT NULL,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_bind_codes_code_idx
  ON device_bind_codes (code, used_at, expires_at);
CREATE INDEX device_bind_codes_user_created_idx
  ON device_bind_codes (user_id, created_at);

CREATE TABLE device_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mac          varchar(64) NOT NULL,
  token_hash   varchar(128) NOT NULL UNIQUE,
  name         varchar(60) NULL,
  last_seen_at timestamptz NULL,
  revoked_at   timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX device_tokens_user_mac_key
  ON device_tokens (user_id, mac);
CREATE INDEX device_tokens_user_revoked_idx
  ON device_tokens (user_id, revoked_at);
