'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { beltApi, beltFileUrl, uploadBeltAvatar, type BeltUser } from '@/lib/beltApi';
import { IdentityBadges } from '@/components/im/IdentityBadges';

interface OrgSummary {
  id: string;
  name: string;
  myRole: string | null;
  status: string;
}

export function BeltProfileView({ user }: { user: BeltUser }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [statusPrefix, setStatusPrefix] = useState(user.statusPrefix ?? '');
  const [avatarFileId, setAvatarFileId] = useState(user.avatarFileId ?? null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<OrgSummary[]>([]);
  const [stats, setStats] = useState<{ posts: number; likesReceived: number; commentsReceived: number; recent: Array<{ id: string; title: string; board: string; publishedAt: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!avatarFileId) {
      setAvatarUrl(null);
      return;
    }
    let cancelled = false;
    beltFileUrl(avatarFileId)
      .then((url) => {
        if (!cancelled) setAvatarUrl(url);
      })
      .catch(() => {
        if (!cancelled) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [avatarFileId]);

  useEffect(() => {
    beltApi<{ organizations: OrgSummary[] }>('/belt/organizations/mine')
      .then((data) => setOrganizations(data.organizations ?? []))
      .catch(() => setOrganizations([]));
    beltApi<typeof stats>('/belt/stats').then(setStats).catch(() => setStats(null));
  }, []);

  const upload = async (file: File) => {
    if (uploading) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const fileId = await uploadBeltAvatar(file);
      setAvatarFileId(fileId);
      const url = await beltFileUrl(fileId);
      setAvatarUrl(url);
      setNotice('头像已上传。点击“保存资料”写入个人资料。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '头像上传失败');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (busy || !displayName.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await beltApi('/belt/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: displayName.trim(),
          statusPrefix: statusPrefix.trim() || null,
          avatarFileId,
        }),
      });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
      setBusy(false);
    }
  };

  return (
    <div className="belt-profile mt-4">
      {error ? (
        <p className="belt-error" role="alert">
          <code>PROFILE_ERROR</code> {error}
        </p>
      ) : null}
      {notice ? <p className="belt-panel belt-hint">{notice}</p> : null}

      <section className="belt-profile-card">
        <div className="belt-profile-left">
          <div className="belt-profile-portrait">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName || user.handle} />
            ) : (
              <span className="belt-profile-placeholder">{displayName.slice(0, 1) || '?'}</span>
            )}
          </div>
          <button type="button" className="belt-button" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? '上传中…' : '更换头像'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
        </div>

        <div className="belt-profile-right">
          <p className="belt-page-kicker">OPERATOR DOSSIER / 干员档案</p>
          <h1 className="belt-profile-name">{displayName || user.handle}</h1>
          <div className="belt-profile-badges">
            <IdentityBadges values={user.prefixes ?? []} scan />
            <span className="belt-stamp">{user.accountOrigin === 'belt' ? 'EXTERNAL' : 'INTERNAL'}</span>
            <span className="belt-handle">@{user.handle}</span>
          </div>

          <label className="belt-field belt-profile-status">
            <span>状态前缀 / STATUS</span>
            <input className="belt-input" value={statusPrefix} maxLength={24} onChange={(event) => setStatusPrefix(event.target.value)} placeholder="例如：战术规划中" />
          </label>

          <div className="belt-profile-save">
            <label className="belt-field">
              <span>昵称 / DISPLAY NAME</span>
              <input className="belt-input" value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <button type="button" className="belt-button is-signal signal-publish" disabled={busy || !displayName.trim()} onClick={() => void save()}>
              {busy ? '写入中…' : '保存资料'}
            </button>
          </div>

          {stats ? (
            <div className="belt-profile-hud">
              <div><b>{stats.posts}</b><span>POSTS / 发帖</span></div>
              <div><b>{stats.likesReceived}</b><span>LIKES / 认同</span></div>
              <div><b>{stats.commentsReceived}</b><span>ECHOES / 回波</span></div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="belt-profile-org">
        <div className="belt-panel-head">
          <h2>组织状态 / ORGANIZATION</h2>
          <Link href="/belt/organizations" className="belt-hint">组织中心 →</Link>
        </div>
        {organizations.length === 0 ? (
          <Link href="/belt/organizations" className="belt-profile-org-cta">
            <span>+</span>
            <b>申请建立组织</b>
            <small>创建你的干员小队 · 私有频道 · 成员审批</small>
          </Link>
        ) : (
          <div className="belt-profile-org-list">
            {organizations.map((org) => (
              <div key={org.id} className="belt-profile-org-chip">
                <span className="belt-profile-org-sigil">{org.name.slice(0, 1)}</span>
                <div>
                  <b>{org.name}</b>
                  <small>{org.myRole === 'owner' ? '组织 Owner' : org.myRole === 'admin' ? '管理员' : '成员'} · {org.status}</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="belt-panel mt-3">
        <div className="belt-panel-head">
          <h2>最近活跃 / ACTIVITY</h2>
          <span className="belt-hint">{stats ? `${stats.posts} POSTS` : '—'}</span>
        </div>
        {stats ? (
          <>
            <ul className="belt-ledger">
              {stats.recent.map((row) => (
                <li key={row.id} className="belt-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                  <div>
                    <div className="belt-row-title">{row.title}</div>
                    <div className="belt-row-meta">{row.board} · {new Date(row.publishedAt).toLocaleDateString()}</div>
                  </div>
                  <span className="belt-stamp">ACTIVE</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="belt-hint">还没有活跃记录。</p>
        )}
      </section>
    </div>
  );
}
