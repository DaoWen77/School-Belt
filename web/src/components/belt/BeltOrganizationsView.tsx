'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { beltApi, type BeltUser } from '@/lib/beltApi';
import { BeltAvatar } from './BeltAvatar';
import { IdentityBadges } from '@/components/im/IdentityBadges';

interface OrgChannel {
  id: string;
  name: string;
  topic: string | null;
  visibility?: 'public' | 'private';
  memberCount: number;
  archived: boolean;
}

interface OrgMember {
  userId: string;
  handle: string;
  displayName: string;
  role: string;
  status: string;
  avatarFileId?: string | null;
  prefixes?: string[];
  requestNote: string | null;
  requestedAt: string;
}

interface OrgView {
  id: string;
  name: string;
  summary: string;
  status: string;
  isPublic?: boolean;
  joinType?: 'open' | 'apply' | 'invite';
  ownerId: string;
  myRole: 'owner' | 'admin' | 'member' | null;
  myStatus: string | null;
  memberCount: number;
  channels?: OrgChannel[];
  members?: OrgMember[];
  pendingRequests?: OrgMember[];
}

interface MineResponse {
  organizations: OrgView[];
  pendingApplication: OrgView | null;
  pendingJoin: OrgView | null;
}

export function BeltOrganizationsView({ user }: { user: BeltUser }) {
  const [data, setData] = useState<MineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);

  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [orgPublic, setOrgPublic] = useState(true);
  const [orgJoinType, setOrgJoinType] = useState<'open' | 'apply' | 'invite'>('apply');
  const [channelName, setChannelName] = useState<Record<string, string>>({});
  const [channelTopic, setChannelTopic] = useState<Record<string, string>>({});
  const [inviteHandle, setInviteHandle] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const mine = await beltApi<MineResponse>('/belt/organizations/mine');
      setData(mine);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '组织状态读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = async () => {
    if (!name.trim() || !summary.trim() || busy) return;
    setBusy('apply');
    setError(null);
    setNotice(null);
    try {
      await beltApi('/belt/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), summary: summary.trim(), isPublic: orgPublic, joinType: orgJoinType }),
      });
      setName('');
      setSummary('');
      setNotice('组织申请已提交，等待全站 Owner 审批。');
      window.dispatchEvent(new CustomEvent('belt:refresh'));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '组织申请失败');
    } finally {
      setBusy(null);
    }
  };

  const review = async (orgId: string, userId: string, action: 'approve' | 'reject') => {
    if (busy) return;
    setBusy(`${userId}:${action}`);
    setError(null);
    try {
      await beltApi(`/belt/organizations/${orgId}/requests/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ...(action === 'reject' ? { reason: '暂不接收' } : {}) }),
      });
      setNotice(action === 'approve' ? '已通过加入申请。' : '已拒绝加入申请。');
      window.dispatchEvent(new CustomEvent('belt:refresh'));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '审批失败');
    } finally {
      setBusy(null);
    }
  };

  const createChannel = async (orgId: string) => {
    const nameValue = channelName[orgId]?.trim();
    if (!nameValue || busy) return;
    setBusy(`channel:${orgId}`);
    setError(null);
    setNotice(null);
    try {
      await beltApi(`/belt/organizations/${orgId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: nameValue, ...(channelTopic[orgId]?.trim() ? { topic: channelTopic[orgId].trim() } : {}) }),
      });
      setChannelName((previous) => ({ ...previous, [orgId]: '' }));
      setChannelTopic((previous) => ({ ...previous, [orgId]: '' }));
      setNotice('私有频道已创建。');
      window.dispatchEvent(new CustomEvent('belt:refresh'));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建频道失败');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="belt-panel belt-empty mt-4">正在同步组织台账…</div>;

  const inviteMember = async (orgId: string) => {
    const handle = inviteHandle[orgId]?.replace(/^@/, '').trim();
    if (!handle || busy) return;
    setBusy(`invite:${orgId}`);
    setError(null);
    setNotice(null);
    try {
      await beltApi(`/belt/organizations/${orgId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ handle }),
      });
      setInviteHandle((previous) => ({ ...previous, [orgId]: '' }));
      setNotice(`已向 @${handle} 发出组织邀请。`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '邀请失败');
    } finally {
      setBusy(null);
    }
  };

  const acceptInvite = async (orgId: string) => {
    if (busy) return;
    setBusy(`join:${orgId}`);
    setError(null);
    try {
      await beltApi(`/belt/organizations/${orgId}/join`, { method: 'POST', body: JSON.stringify({}) });
      setNotice('已接受组织邀请。');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '接受邀请失败');
    } finally {
      setBusy(null);
    }
  };

  const deleteChannel = async (orgId: string, channelId: string, channelName: string) => {
    if (busy) return;
    if (!window.confirm(`确认删除频道「${channelName}」？此操作会归档频道，成员将不再看到它。`)) return;
    setBusy(`delete:${channelId}`);
    setError(null);
    try {
      await beltApi(`/belt/organizations/${orgId}/channels/${channelId}`, { method: 'DELETE' });
      setNotice(`频道「${channelName}」已删除。`);
      window.dispatchEvent(new CustomEvent('belt:refresh'));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除频道失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="belt-organizations mt-4">
      {error ? (
        <p className="belt-error" role="alert">
          <code>ORG_ERROR</code> {error}
        </p>
      ) : null}
      {notice ? <p className="belt-panel belt-hint">{notice}</p> : null}

      {data?.pendingApplication ? (
        <section className="belt-panel mb-3">
          <div className="belt-panel-head">
            <h2>申请审批中</h2>
            <span className="belt-stamp is-signal">PENDING</span>
          </div>
          <p className="belt-row-title">{data.pendingApplication.name}</p>
          <p className="belt-row-deck">{data.pendingApplication.summary}</p>
          <p className="belt-hint mt-2">已进入全站 Owner 的审批流。通过后组织频道会出现在这里。</p>
        </section>
      ) : null}

      {data?.pendingJoin ? (
        <section className="belt-panel mb-3">
          <div className="belt-panel-head">
            <h2>加入申请待处理</h2>
            <span className="belt-stamp">JOIN PENDING</span>
          </div>
          <p className="belt-row-title">{data.pendingJoin.name}</p>
          <p className="belt-hint mt-1">
            {data.pendingJoin.myStatus === 'invited' ? '你收到了组织邀请，接受后即可加入频道。' : '组织管理员审批后会加入频道。'}
          </p>
          {data.pendingJoin.myStatus === 'invited' ? (
            <button type="button" className="belt-button is-signal mt-2" disabled={Boolean(busy)} onClick={() => void acceptInvite(data.pendingJoin!.id)}>
              {busy === `join:${data.pendingJoin.id}` ? '加入中…' : '接受邀请'}
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="belt-org-head">
        <div>
          <p className="belt-page-kicker">ORGANIZATION CENTER</p>
          <h2>组织中心</h2>
        </div>
        {!data?.pendingApplication ? (
          <button type="button" className="belt-button is-signal" onClick={() => setApplyOpen(true)}>
            + 发起申请
          </button>
        ) : null}
      </div>

      <section className="belt-org-section">
        <div className="belt-panel-head">
          <h2>我的组织</h2>
          <span className="belt-hint">{data?.organizations.length ?? 0}</span>
        </div>
      </section>

      {data?.organizations.map((org) => {
        const isAdmin = org.myRole === 'owner' || org.myRole === 'admin';
        return (
          <section key={org.id} className="belt-panel mb-3">
            <div className="belt-panel-head">
              <h2>{org.name}</h2>
              <span className="belt-stamp is-signal">{org.myRole === 'owner' ? 'OWNER' : org.myRole === 'admin' ? 'ADMIN' : 'MEMBER'}</span>
            </div>
            <p className="belt-row-deck">{org.summary}</p>
            <div className="belt-row-meta mt-2">
              <span>{org.memberCount} members</span>
              <span>{org.status}</span>
              <span>{org.isPublic === false ? 'HIDDEN / 不公开' : 'LISTED / 发现可见'}</span>
              <span>{org.joinType === 'open' ? 'OPEN / 直接加入' : org.joinType === 'invite' ? 'INVITE / 仅邀请' : 'APPLY / 审批加入'}</span>
              <span>{org.channels?.length ?? 0} channels</span>
            </div>

            {org.members?.length ? (
              <div className="belt-org-members">
                <p className="belt-page-kicker">MEMBERS / 成员</p>
                <ul className="belt-ledger">
                  {org.members.map((member) => (
                    <li key={member.userId} className="belt-row" style={{ gridTemplateColumns: 'auto minmax(0, 1fr) auto' }}>
                      <BeltAvatar fileId={member.avatarFileId} name={member.displayName} size="sm" />
                      <div>
                        <div className="belt-row-title">{member.displayName}</div>
                        <div className="belt-row-meta">@{member.handle}</div>
                      </div>
                      <div className="belt-row-side">
                        <span className="belt-stamp">{member.role}</span>
                        <IdentityBadges values={member.prefixes ?? []} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {org.channels?.length ? (
              <ul className="belt-ledger mt-2">
                {org.channels.map((channel) => (
                  <li key={channel.id} className="belt-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                    <div>
                      <div className="belt-row-title">
                        {channel.visibility === 'private' ? '🔒' : '#'} {channel.name}
                      </div>
                      <div className="belt-row-meta">{channel.topic ?? 'PRIVATE CHANNEL'} · {channel.memberCount} members</div>
                    </div>
                    <div className="belt-row-side">
                      <Link className="belt-header-link" href={`/belt/channel?channelId=${channel.id}`}>
                        进入 →
                      </Link>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="belt-danger-link"
                          disabled={Boolean(busy)}
                          onClick={() => void deleteChannel(org.id, channel.id, channel.name)}
                        >
                          {busy === `delete:${channel.id}` ? '删除中…' : '删除'}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="belt-hint mt-2">还没有私有频道。</p>
            )}

            {isAdmin ? (
              <div className="belt-org-manage">
                <div className="belt-org-manage-block">
                  <p className="belt-page-kicker">INVITE MEMBER / 邀请成员</p>
                  <div className="belt-form-row">
                    <input
                      className="belt-input"
                      value={inviteHandle[org.id] ?? ''}
                      onChange={(event) => setInviteHandle((previous) => ({ ...previous, [org.id]: event.target.value }))}
                      placeholder="@handle"
                      aria-label="邀请成员 handle"
                    />
                    <button
                      type="button"
                      className="belt-button is-signal"
                      disabled={Boolean(busy) || !(inviteHandle[org.id] ?? '').trim()}
                      onClick={() => void inviteMember(org.id)}
                    >
                      {busy === `invite:${org.id}` ? '邀请中…' : '发出邀请'}
                    </button>
                  </div>
                </div>
                <div className="belt-org-manage-block">
                  <p className="belt-page-kicker">JOIN REQUESTS / 加入审批</p>
                  {org.pendingRequests?.length ? (
                    <ul className="belt-ledger">
                      {org.pendingRequests.map((member) => (
                        <li key={member.userId} className="belt-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                          <div>
                            <div className="belt-row-title">{member.displayName} <span className="belt-row-meta">@{member.handle}</span></div>
                            <p className="belt-row-deck">{member.requestNote ?? '申请加入组织'}</p>
                          </div>
                          <div className="belt-row-side">
                            <button type="button" className="belt-button is-signal" disabled={Boolean(busy)} onClick={() => void review(org.id, member.userId, 'approve')}>
                              通过
                            </button>
                            <button type="button" className="belt-button" disabled={Boolean(busy)} onClick={() => void review(org.id, member.userId, 'reject')}>
                              拒绝
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="belt-hint mt-1">暂无待审申请。</p>
                  )}
                </div>

                <div className="belt-org-manage-block">
                  <p className="belt-page-kicker">NEW PRIVATE CHANNEL / 私有频道</p>
                  <div className="belt-form-row">
                    <input className="belt-input" value={channelName[org.id] ?? ''} onChange={(event) => setChannelName((previous) => ({ ...previous, [org.id]: event.target.value }))} placeholder="频道名" aria-label="私有频道名" />
                    <input className="belt-input" value={channelTopic[org.id] ?? ''} onChange={(event) => setChannelTopic((previous) => ({ ...previous, [org.id]: event.target.value }))} placeholder="主题（可选）" aria-label="私有频道主题" />
                    <button type="button" className="belt-button is-signal" disabled={Boolean(busy) || !channelName[org.id]?.trim()} onClick={() => void createChannel(org.id)}>
                      创建
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        );
      })}

      <section className="belt-org-section mt-3">
        <div className="belt-panel-head">
          <h2>发现组织</h2>
          <span className="belt-hint">申请后可加入</span>
        </div>
        <p className="belt-hint">当前没有公开招新的组织。你也可以发起申请，建立自己的组织。</p>
      </section>

      {applyOpen ? (
        <div className="belt-modal-backdrop" role="presentation" onClick={() => setApplyOpen(false)}>
          <section className="belt-modal" role="dialog" aria-modal="true" aria-label="发起组织申请" onClick={(event) => event.stopPropagation()}>
            <p className="belt-page-kicker">NEW ORGANIZATION / 发起申请</p>
            <h2>建立你的组织</h2>
            <p className="belt-hint">组织申请会进入全站 Owner 审批流。每个 Owner 只能拥有一个在册组织，但可以加入多个组织。</p>
            <div className="belt-form-row">
              <label className="belt-field">
                <span>组织名</span>
                <input className="belt-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={24} placeholder="2–24 字" aria-label="组织名" />
              </label>
              <label className="belt-field">
                <span>简介</span>
                <input className="belt-input" value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={400} placeholder="组织简介" aria-label="组织简介" />
              </label>
            </div>
            <div className="belt-form-row">
              <label className="belt-field">
                <span>公开性</span>
                <select className="belt-input" value={orgPublic ? 'public' : 'private'} onChange={(event) => setOrgPublic(event.target.value === 'public')}>
                  <option value="public">公开 · 出现在发现列表</option>
                  <option value="private">不公开 · 仅管理员拉人</option>
                </select>
              </label>
              <label className="belt-field">
                <span>加入方式</span>
                <select className="belt-input" value={orgJoinType} onChange={(event) => setOrgJoinType(event.target.value as 'open' | 'apply' | 'invite')}>
                  <option value="open">开放 · 直接加入</option>
                  <option value="apply">审批 · 申请加入</option>
                  <option value="invite">邀请 · 仅限邀请</option>
                </select>
              </label>
            </div>
            <p className="belt-hint">当前身份 @{user.handle} · 申请通过后自动创建「[组织名] 议事厅」私有频道。</p>
            <div className="belt-form-row">
              <button type="button" className="belt-button is-signal signal-publish" disabled={Boolean(busy) || !name.trim() || !summary.trim()} onClick={() => void apply()}>
                {busy === 'apply' ? '提交中…' : '提交申请'}
              </button>
              <button type="button" className="belt-button" onClick={() => setApplyOpen(false)}>取消</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
