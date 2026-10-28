'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { beltApi } from '@/lib/beltApi';

interface PendingOrg {
  id: string;
  name: string;
  summary: string;
  ownerHandle: string | null;
  ownerDisplayName: string | null;
  createdAt: string;
}

interface JoinRequest {
  orgId: string;
  orgName: string;
  userId: string;
  handle: string;
  displayName: string;
  requestNote: string | null;
}

/**
 * 环带处理中心：待审组织 / 组织加入申请。
 * 全部在当前页面处置，不要求切回内网或 F5。
 */
export function BeltInbox({ isOwner, onChanged }: { isOwner: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<PendingOrg[]>([]);
  const [joins, setJoins] = useState<JoinRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    const [orgData, mine] = await Promise.all([
      isOwner ? beltApi<{ organizations: PendingOrg[] }>('/belt/organizations/pending').catch(() => ({ organizations: [] })) : Promise.resolve({ organizations: [] }),
      beltApi<{ organizations: Array<{ id: string; name: string; myRole: string; pendingRequests?: Array<{ userId: string; handle: string; displayName: string; requestNote: string | null }> }> }>('/belt/organizations/mine').catch(() => ({ organizations: [] })),
    ]);
    setOrgs(orgData.organizations ?? []);
    const rows: JoinRequest[] = [];
    for (const org of mine.organizations ?? []) {
      if (org.myRole !== 'owner' && org.myRole !== 'admin') continue;
      for (const request of org.pendingRequests ?? []) {
        rows.push({
          orgId: org.id,
          orgName: org.name,
          userId: request.userId,
          handle: request.handle,
          displayName: request.displayName,
          requestNote: request.requestNote,
        });
      }
    }
    setJoins(rows);
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const count = orgs.length + joins.length;

  const reviewOrg = async (id: string, action: 'approve' | 'reject') => {
    setBusy(`org:${id}`);
    try {
      await beltApi(`/belt/organizations/${id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ...(action === 'reject' ? { reason: '本轮暂缓' } : {}) }),
      });
      setNotice(action === 'approve' ? '组织已通过。' : '组织已驳回。');
      await load();
      onChanged();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '处理失败');
    } finally {
      setBusy(null);
    }
  };

  const reviewJoin = async (row: JoinRequest, action: 'approve' | 'reject') => {
    setBusy(`join:${row.userId}`);
    try {
      await beltApi(`/belt/organizations/${row.orgId}/requests/${row.userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ...(action === 'reject' ? { reason: '暂不接收' } : {}) }),
      });
      setNotice('加入申请已处理。');
      await load();
      onChanged();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '处理失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="belt-inbox" ref={root}>
      <button
        type="button"
        className="belt-inbox-trigger"
        aria-label="处理中心"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        🔔 <span>处理中心</span>
        {count > 0 ? <b className="belt-inbox-dot">{count}</b> : null}
      </button>

      {open ? (
        <div className="belt-inbox-panel">
          <div className="belt-inbox-head">
            <strong>处理中心 / INBOX</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭处理中心">
              ×
            </button>
          </div>
          {notice ? <p className="belt-inbox-notice">{notice}</p> : null}
          {count === 0 ? <p className="belt-inbox-empty">没有待处理事项。</p> : null}

          {isOwner && orgs.length > 0 ? (
            <div className="belt-inbox-group">
              <p>待审组织 · {orgs.length}</p>
              {orgs.map((org) => (
                <div key={org.id} className="belt-inbox-row">
                  <div>
                    <b>{org.name}</b>
                    <small>@{org.ownerHandle ?? '—'} · {org.summary.slice(0, 40)}</small>
                  </div>
                  <div className="belt-inbox-actions">
                    <button type="button" disabled={Boolean(busy)} onClick={() => void reviewOrg(org.id, 'approve')}>
                      通过
                    </button>
                    <button type="button" disabled={Boolean(busy)} onClick={() => void reviewOrg(org.id, 'reject')}>
                      驳回
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {joins.length > 0 ? (
            <div className="belt-inbox-group">
              <p>组织加入申请 · {joins.length}</p>
              {joins.map((row) => (
                <div key={`${row.orgId}:${row.userId}`} className="belt-inbox-row">
                  <div>
                    <b>{row.displayName}</b>
                    <small>@{row.handle} → {row.orgName}</small>
                  </div>
                  <div className="belt-inbox-actions">
                    <button type="button" disabled={Boolean(busy)} onClick={() => void reviewJoin(row, 'approve')}>
                      通过
                    </button>
                    <button type="button" disabled={Boolean(busy)} onClick={() => void reviewJoin(row, 'reject')}>
                      拒绝
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <Link className="belt-inbox-more" href="/belt/organizations" onClick={() => setOpen(false)}>
            打开组织中心 →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
