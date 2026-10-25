# 备份与回滚

当前版本锚点：`baseline-sprint7.2` 标签 → 提交 `c4a6b48`。

## 远端

- 私有仓库：https://github.com/DaoWen77/O.M.VDijiang.git
- `origin` 已配置为**不带凭据**的地址（token 从未写入 `.git/config`）。

推送需要凭据时，用一次性 header（不要把 token 写进 remote URL）：

```bash
git -c http.extraheader="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_PAT" | base64 -w0)" push origin main --tags
```

## 本地隔离备份

| 文件 | 用途 |
| --- | --- |
| `dijiang-baseline-sprint7.2.bundle` | 完整 git 历史（`--all`），离线可恢复 |
| `snapshot-*-sprint7.2.tar.gz` | 不含 node_modules/.next/dist 的工作区快照 |

`backups/` 未纳入 git（体积约 120MB），只作为本地隔离副本；要异地保存时拷到外部磁盘或另一台机器。

## 回滚方法

**A. 回到锚点提交（保留后续历史）**

```bash
git checkout -b restore baseline-sprint7.2
```

**B. 强制把工作区恢复到锚点（丢弃之后改动）**

```bash
git reset --hard baseline-sprint7.2
```

**C. 从 bundle 完全重建仓库（本地 .git 损坏时）**

```bash
git clone backups/dijiang-baseline-sprint7.2.bundle recovered
```

**D. 从 tar 快照恢复工作文件（无 git 也能用）**

```bash
tar -xzf backups/snapshot-20261025-0918-sprint7.2.tar.gz -C /path/to/restore
```

## 排除项

`node_modules/`、`.next/`、`dist/`、`.env*.local`、`ops/e2e/pgdata`、`ops/e2e/rclone-s3`、`reports/e2e`、`reports/tmp` 不入库；
`server/.env.example`、`web/.env.example`、`ops/.env.example` 等模板文件保留。
