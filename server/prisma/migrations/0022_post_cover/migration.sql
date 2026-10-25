-- 0022_post_cover：新闻/日常封面（外链 + 站内 S3 文件）
ALTER TABLE posts
  ADD COLUMN cover_url text NULL,
  ADD COLUMN cover_file_id uuid NULL;

CREATE INDEX posts_cover_file_id_idx ON posts (cover_file_id);
