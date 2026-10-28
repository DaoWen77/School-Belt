'use client';

import { useEffect, useState } from 'react';
import { api, errorOf } from '@/lib/api';
import { askConfirm } from '@/lib/confirm';
import type { ApiUser } from '@/lib/types';
import { IdentityBadges } from '@/components/im/IdentityBadges';

type OrgRole = 'owner' | 'admin' | 'member';
type OrgStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'dissolved';
type MemberStatus = 'pending' | 'invited' | 'active' | 'left' | 'rejected' | 'banned';

interface OrgMemberView {
  userId: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  role: OrgRole;
  status: MemberStatus;
  prefixes: string[];
  requestNote: string | null;
  requestedAt: string;
  joinedAt: string | null;
}

interface OrgChannelView {
  id: string;
  name: string;
  topic: string | null;
  memberCount: number;
  createdAt: string;
}

interface OrganizationView {
  id: string;
  name: string;
  summary: string;
  status: OrgStatus;
  ownerId: string;
  ownerHandle: string | null;
  ownerDisplayName: string | null;
  ownerPrefixes: string[];
  myRole: OrgRole | null;
  myStatus: MemberStatus | null;
  memberCount: number;
  channels?: OrgChannelView[];
  members?: OrgMemberView[];
  pendingRequests?: OrgMemberView[];
  createdAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
}

interface OrgSummary {
  id: string;
  name: string;
  summary: string;
  status: OrgStatus;
  memberCount: number;
  myRole: OrgRole | null;
  myStatus: MemberStatus | null;
  createdAt: string;
}

interface MineResult {
  organization: OrganizationView | null;
  pendingApplication: OrganizationView | null;
  pendingJoin: OrganizationView | null;
}

type PageError = { code: string; message: string };

/**
 * Phase B：组织申请、Owner 审批、成员审批、组织私有频道。
 * 全站 Owner 不加入组织，因此这里也没有「Owner 自己的组织」分支。
 */
export function OrgSettings({ me }: { me: ApiUser | null }) {
  const [mine, setMine] = useState<MineResult | null>(null);
  const [organizations, setOrganizations] = useState<OrgSummary[]>([]);
  const [pendingOrgs, setPendingOrgs] = useState<OrganizationView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PageError | null>(null);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [channelName, setChannelName] = useState('');
  const [channelTopic, setChannelTopic] = useState('');
  const [joinNote, setJoinNote] = useState('');

  const isGlobalOwner = me?.globalRole === 'owner';
  const panel = 'cut-corner-sm border border-line bg-panel p-4';
  const heading = 'mb-2 font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2';
  const label = 'block font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-2';
  const field = 'w-full border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink';
  const button = 'cut-corner-sm bg-ink px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40';
  const secondary = 'border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-ink hover:text-ink';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mineData, listData, pendingData] = await Promise.all([
        api<MineResult>('/organizations/mine'),
        api<{ organizations: OrgSummary[] }>('/organizations'),
        isGlobalOwner
          ? api<{ organizations: OrganizationView[] }>('/organizations/pending')
          : Promise.resolve({ organizations: [] as OrganizationView[] }),
      ]);
      setMine(mineData);
      setOrganizations(Array.isArray(listData.organizations) ? listData.organizations : []);
      setPendingOrgs(Array.isArray(pendingData.organizations) ? pendingData.organizations : []);
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGlobalOwner]);

  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      after?.();
      await load();
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!name.trim() || !summary.trim()) return;
    void run(
      () =>
        api('/organizations', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), summary: summary.trim() }),
        }),
      () => {
        setName('');
        setSummary('');
      },
    );
  };

  const reviewOrg = (org: OrganizationView, action: 'approve' | 'reject') => {
    let reason: string | undefined;
    if (action === 'reject') {
      const value = window.prompt(`拒绝「${org.name}」的理由`, '资料不完整');
      if (value === null) return;
      reason = value.trim();
      if (!reason) return;
    }
    void run(() =>
      api(`/organizations/${org.id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
      }),
    );
  };

  const join = (org: OrgSummary) => {
    void run(() =>
      api(`/organizations/${org.id}/join`, {
        method: 'POST',
        body: JSON.stringify({ ...(joinNote.trim() ? { note: joinNote.trim() } : {}) }),
      }),
    );
  };

  const reviewMember = (org: OrganizationView, member: OrgMemberView, action: 'approve' | 'reject') => {
    let reason: string | undefined;
    if (action === 'reject') {
      const value = window.prompt(`拒绝 @${member.handle} 的理由`, '暂不接收');
      if (value === null) return;
      reason = value.trim();
      if (!reason) return;
    }
    void run(() =>
      api(`/organizations/${org.id}/requests/${member.userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
      }),
    );
  };

  const createChannel = () => {
    if (!mine?.organization || !channelName.trim()) return;
    void run(
      () =>
        api(`/organizations/${mine.organization!.id}/channels`, {
          method: 'POST',
          body: JSON.stringify({
            name: channelName.trim(),
            ...(channelTopic.trim() ? { topic: channelTopic.trim() } : {}),
          }),
        }),
      () => {
        setChannelName('');
        setChannelTopic('');
      },
    );
  };

  const leave = async (org: OrganizationView) => {
    if (
      !(await askConfirm(`退出组织「${org.name}」？组织频道会立即从侧边栏消失。`, {
        title: '退出组织',
        confirmText: '退出组织',
        danger: true,
      }))
    )
      return;
    void run(() => api(`/organizations/${org.id}/leave`, { method: 'POST', body: JSON.stringify({}) }));
  };

  const dissolve = async (org: OrganizationView) => {
    if (
      !(await askConfirm(`解散组织「${org.name}」？所有成员会失去前缀，组织频道会归档。`, {
        title: '解散组织',
        confirmText: '解散组织',
        danger: true,
      }))
    )
      return;
    void run(() => api(`/organizations/${org.id}/dissolve`, { method: 'POST', body: JSON.stringify({}) }));
  };

  const transfer = (org: OrganizationView) => {
    const userId = window.prompt('输入接收组织 Owner 的成员 userId（可在成员列表复制）');
    if (!userId?.trim()) return;
    void run(() =>
      api(`/organizations/${org.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ userId: userId.trim() }),
      }),
    );
  };

  const archiveChannel = async (org: OrganizationView, channel: OrgChannelView) => {
    if (
      !(await askConfirm(`归档组织频道「${channel.name}」？`, {
        title: '归档频道',
        confirmText: '归档频道',
      }))
    )
      return;
    void run(() =>
      api(`/organizations/${org.id}/channels/${channel.id}`, { method: 'DELETE' }),
    );
  };

  const active = mine?.organization ?? null;
  const isOrgAdmin = active?.myRole === 'owner' || active?.myRole === 'admin';
  const pending = mine?.pendingApplication ?? mine?.pendingJoin ?? null;

  if (loading && !mine) {
    return (
      <section id="tab-org" className={panel}>
        <p className={heading}>Organization / 组织与证章</p>
        <p className="text-[11px] text-ink-2">读取组织状态…</p>
      </section>
    );
  }

  return (
    <section id="tab-org" className={panel}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className={heading}>Organization / 组织与证章</p>
        <span className="border border-line px-1 font-sans text-[9px] uppercase tracking-[0.1em] text-ink-2">
          Phase B · internal only
        </span>
      </div>

      {error ? (
        <p className="mb-2 flex items-center gap-2 border border-line px-2 py-1.5 text-[11px] text-ink" role="alert">
          <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase text-on-accent">{error.code}</span>
          {error.message}
          <button type="button" className="ml-auto text-[10px] underline" onClick={() => setError(null)}>
            关闭
          </button>
        </p>
      ) : null}

      {isGlobalOwner ? (
        <p className="mb-3 border-l-2 border-ink pl-2 text-[10px] leading-relaxed text-ink-2">
          全站 Owner 不加入组织、不读组织私密消息；这里只做组织申请审批与元数据查看。
        </p>
      ) : null}

      {active ? (
        <div className="flex flex-col gap-3">
          <div className="border border-ink bg-paper p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-sans text-[16px] font-extrabold text-ink">{active.name}</span>
              <span className="border border-ink px-1 font-sans text-[9px] font-bold uppercase">
                {active.myRole}
              </span>
              <span className="font-mono text-[10px] text-ink-2">members {active.memberCount}</span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{active.summary}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-ink-2">
              <span>你的证章：</span>
              <IdentityBadges values={active.myRole ? [`[${active.name}]${active.myRole === 'owner' ? 'Official' : ''}`] : []} scan />
              <span>· 服务端全局渲染</span>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className={label}>私有频道</span>
              <span className="font-mono text-[9px] text-ink-2">{active.channels?.length ?? 0}</span>
            </div>
            <ul className="flex flex-col">
              {(active.channels ?? []).map((channel) => (
                <li key={channel.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-[11px] last:border-b-0">
                  <span className="font-semibold text-ink">#{channel.name}</span>
                  <span className="font-mono text-[9px] text-ink-2">{channel.memberCount} 人</span>
                  {channel.topic ? <span className="truncate text-ink-2">{channel.topic}</span> : null}
                  {isOrgAdmin ? (
                    <button type="button" className="ml-auto text-[10px] text-danger" onClick={() => archiveChannel(active, channel)}>
                      归档
                    </button>
                  ) : null}
                </li>
              ))}
              {(active.channels?.length ?? 0) === 0 ? <li className="text-[11px] text-ink-2">还没有组织频道</li> : null}
            </ul>
            {isOrgAdmin ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input className={field} placeholder="频道名" value={channelName} onChange={(event) => setChannelName(event.target.value)} aria-label="组织频道名" />
                <input className={field} placeholder="主题（可选）" value={channelTopic} onChange={(event) => setChannelTopic(event.target.value)} aria-label="组织频道主题" />
                <button type="button" disabled={busy || !channelName.trim()} className={button} onClick={createChannel}>
                  新建私有频道
                </button>
              </div>
            ) : null}
          </div>

          {isOrgAdmin && (active.pendingRequests?.length ?? 0) > 0 ? (
            <div>
              <span className={label}>待审加入申请</span>
              <ul className="mt-1 flex flex-col">
                {active.pendingRequests!.map((member) => (
                  <li key={member.userId} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-[11px] last:border-b-0">
                    <IdentityBadges values={member.prefixes} />
                    <span className="font-semibold text-ink">{member.displayName}</span>
                    <span className="font-mono text-[9px] text-ink-2">@{member.handle}</span>
                    {member.requestNote ? <span className="truncate text-ink-2">「{member.requestNote}」</span> : null}
                    <span className="ml-auto flex gap-2">
                      <button type="button" className="text-[10px] text-ink underline" onClick={() => reviewMember(active, member, 'approve')}>
                        同意
                      </button>
                      <button type="button" className="text-[10px] text-danger underline" onClick={() => reviewMember(active, member, 'reject')}>
                        拒绝
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <span className={label}>成员</span>
            <ul className="mt-1 flex flex-col">
              {(active.members ?? []).map((member) => (
                <li key={member.userId} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-[11px] last:border-b-0">
                  <IdentityBadges values={member.prefixes} />
                  <span className="font-semibold text-ink">{member.displayName}</span>
                  <span className="font-mono text-[9px] text-ink-2">@{member.handle}</span>
                  <span className="border border-line px-1 text-[9px] text-ink-2">{member.role}</span>
                  <span className="ml-auto font-mono text-[8px] text-ink-2/60">{member.userId}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-line pt-2">
            {active.myRole === 'owner' ? (
              <>
                <button type="button" disabled={busy} className={secondary} onClick={() => transfer(active)}>
                  转让 Owner
                </button>
                <button type="button" disabled={busy} className="border border-danger px-2.5 py-1.5 text-[11px] text-danger" onClick={() => dissolve(active)}>
                  解散组织
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} className={secondary} onClick={() => leave(active)}>
                退出组织
              </button>
            )}
          </div>
        </div>
      ) : pending ? (
        <div className="border border-line bg-paper p-3">
          <p className="font-sans text-[12px] font-bold text-ink">
            {pending.status === 'pending' ? '申请待审' : pending.status}
          </p>
          <p className="mt-1 text-[11px] text-ink-2">
            组织「{pending.name}」· {pending.summary}
          </p>
          {pending.rejectReason ? <p className="mt-1 text-[10px] text-danger">理由：{pending.rejectReason}</p> : null}
        </div>
      ) : isGlobalOwner ? (
        <div className="border border-line bg-paper p-3">
          <p className="font-sans text-[11px] font-bold text-ink">全站 Owner 不加入组织</p>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-2">
            这是 Phase B 的硬边界：Owner 负责审批组织，但不进入组织、不读组织私密频道。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="border border-line bg-paper p-3">
            <p className="font-sans text-[11px] font-bold text-ink">申请建立组织</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-2">
              提交后进入全站 Owner 审批。通过后你获得 `[组织名]Official`，成员获得 `[组织名]`。
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <label className="flex flex-col gap-1">
                <span className={label}>组织名（2–24）</span>
                <input className={field} value={name} maxLength={24} onChange={(event) => setName(event.target.value)} aria-label="组织名" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>简介（≤400）</span>
                <textarea className={`${field} min-h-[4rem]`} value={summary} maxLength={400} onChange={(event) => setSummary(event.target.value)} aria-label="组织简介" />
              </label>
              <button type="button" disabled={busy || name.trim().length < 2 || !summary.trim()} className={button} onClick={apply}>
                {busy ? '提交中…' : '提交组织申请'}
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className={label}>在册组织</span>
              <span className="font-mono text-[9px] text-ink-2">{organizations.length}</span>
            </div>
            <ul className="flex flex-col">
              {organizations.map((org) => (
                <li key={org.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-[11px] last:border-b-0">
                  <span className="font-semibold text-ink">{org.name}</span>
                  <span className="font-mono text-[9px] text-ink-2">{org.memberCount} 人</span>
                  <span className="truncate text-ink-2">{org.summary}</span>
                  {org.myRole ? (
                    <span className="border border-line px-1 text-[9px] text-ink-2">{org.myRole}</span>
                  ) : (
                    <button type="button" disabled={busy} className="ml-auto text-[10px] text-ink underline" onClick={() => join(org)}>
                      申请加入
                    </button>
                  )}
                </li>
              ))}
              {organizations.length === 0 ? <li className="text-[11px] text-ink-2">还没有在册组织</li> : null}
            </ul>
            <label className="mt-2 flex flex-col gap-1">
              <span className={label}>加入附言（可选，作用于下一次申请）</span>
              <input className={field} value={joinNote} maxLength={200} onChange={(event) => setJoinNote(event.target.value)} aria-label="加入附言" />
            </label>
          </div>
        </div>
      )}

      {isGlobalOwner ? (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className={label}>组织审批 · 全站 Owner</span>
            <span className="font-mono text-[9px] text-ink-2">{pendingOrgs.length}</span>
          </div>
          {pendingOrgs.length === 0 ? <p className="text-[11px] text-ink-2">没有待审组织</p> : null}
          <ul className="flex flex-col">
            {pendingOrgs.map((org) => (
              <li key={org.id} className="border-b border-line py-2 text-[11px] last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{org.name}</span>
                  <span className="font-mono text-[9px] text-ink-2">owner @{org.ownerHandle ?? '—'}</span>
                  <span className="ml-auto flex gap-2">
                    <button type="button" disabled={busy} className="text-[10px] text-ink underline" onClick={() => reviewOrg(org, 'approve')}>
                      通过
                    </button>
                    <button type="button" disabled={busy} className="text-[10px] text-danger underline" onClick={() => reviewOrg(org, 'reject')}>
                      拒绝
                    </button>
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-ink-2">{org.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
