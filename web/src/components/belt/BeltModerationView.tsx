'use client';

import { useEffect, useRef, useState } from 'react';
import { beltApi, BeltApiError, type BeltUser } from '@/lib/beltApi';
import type { BeltClerkApplication, BeltModerationMe, BeltModerationReport } from '@/lib/beltTypes';
import { BeltPortal } from './BeltPortal';

type Panel = 'apply' | 'approvals' | 'detail' | null;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN');
}

function errText(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

function excerpt(body: string | null | undefined, limit = 120): string {
  const text = (body ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '（无正文）';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 风纪工位：工单池 + 投票 + 风纪委员申请 / Founder 审批。 */
export function BeltModerationView({ user }: { user: BeltUser }) {
  const privileged = user.globalRole === 'owner' || user.globalRole === 'admin';

  const [me, setMe] = useState<BeltModerationMe | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [gateError, setGateError] = useState<string | null>(null);

  const [reports, setReports] = useState<BeltModerationReport[]>([]);
  const [reportsBusy, setReportsBusy] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportsKey, setReportsKey] = useState(0);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [detail, setDetail] = useState<BeltModerationReport | null>(null);

  const [applyReason, setApplyReason] = useState('');
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const [apps, setApps] = useState<BeltClerkApplication[] | null>(null);
  const [appsBusy, setAppsBusy] = useState(false);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const allowed = privileged || Boolean(me?.isClerk) || Boolean(me?.isOwner);

  useEffect(() => {
    let cancelled = false;
    setMeLoading(true);
    beltApi<BeltModerationMe>('/belt/moderation/me')
      .then((data) => {
        if (cancelled) return;
        setMe(data);
        setGateError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setGateError(errText(caught, '风纪身份读取失败'));
      })
      .finally(() => {
        if (!cancelled) setMeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setReportsBusy(true);
    setReportsError(null);
    beltApi<{ items: BeltModerationReport[] }>('/belt/moderation/reports?status=open')
      .then((data) => {
        if (!cancelled) setReports(data.items ?? []);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setReportsError(errText(caught, '工单池读取失败'));
      })
      .finally(() => {
        if (!cancelled) setReportsBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, reportsKey]);

  useEffect(() => {
    if (panel !== 'approvals') return;
    let cancelled = false;
    setAppsBusy(true);
    setAppsError(null);
    beltApi<{ items: BeltClerkApplication[] }>('/belt/moderation/clerk/applications?status=pending')
      .then((data) => {
        if (!cancelled) setApps(data.items ?? []);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setApps([]);
          setAppsError(errText(caught, '申请列表读取失败'));
        }
      })
      .finally(() => {
        if (!cancelled) setAppsBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [panel]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const openPanel = (next: Exclude<Panel, null>) => {
    setMenuOpen(false);
    setApplyError(null);
    setAppsError(null);
    setPanel(next);
  };

  const vote = async (report: BeltModerationReport, verdict: 'violation' | 'clear') => {
    if (votingId || report.status !== 'open' || report.myVerdict) return;
    setVotingId(report.id);
    setVoteError(null);
    setNotice(null);
    try {
      const data = await beltApi<{ resolved: boolean; report: BeltModerationReport | null }>(
        `/belt/moderation/reports/${encodeURIComponent(report.id)}/vote`,
        { method: 'POST', body: JSON.stringify({ verdict }) },
      );
      const updated = data.report;
      setReports((prev) => prev.map((row) => (row.id === report.id ? updated ?? row : row)));
      setDetail((prev) => (prev && prev.id === report.id ? updated ?? prev : prev));
      setNotice(data.resolved ? '多数决已达成，工单结案。' : '投票已记录。');
    } catch (caught) {
      setVoteError(errText(caught, '投票失败'));
    } finally {
      setVotingId(null);
    }
  };

  const submitApply = async () => {
    if (applyBusy || !applyReason.trim()) return;
    setApplyBusy(true);
    setApplyError(null);
    try {
      await beltApi('/belt/moderation/clerk/apply', {
        method: 'POST',
        body: JSON.stringify({ reason: applyReason.trim() }),
      });
      setMe((prev) =>
        prev
          ? { ...prev, application: { status: 'pending' }, eligibility: { ...prev.eligibility, canApply: false } }
          : prev,
      );
      setPanel(null);
      setApplyReason('');
      setNotice('风纪委员申请已提交，等待 Founder 审批。');
    } catch (caught) {
      setApplyError(
        caught instanceof BeltApiError && caught.status === 409
          ? '你已是风纪委员，无需重复申请。'
          : errText(caught, '申请提交失败'),
      );
    } finally {
      setApplyBusy(false);
    }
  };

  const decide = async (application: BeltClerkApplication, approve: boolean) => {
    if (decidingId) return;
    setDecidingId(application.id);
    setAppsError(null);
    try {
      await beltApi(`/belt/moderation/clerk/applications/${encodeURIComponent(application.id)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ approve }),
      });
      setApps((prev) => (prev ?? []).filter((row) => row.id !== application.id));
      setNotice(approve ? '已通过风纪委员申请。' : '已驳回风纪委员申请。');
    } catch (caught) {
      setAppsError(errText(caught, '审批失败'));
    } finally {
      setDecidingId(null);
    }
  };

  if (meLoading && !me) {
    return (
      <section className="belt-panel" aria-live="polite">
        <p className="belt-page-kicker">TRIBUNAL SYNC</p>
        <p className="belt-hint">正在校验风纪权限…</p>
      </section>
    );
  }

  const eligibility = me?.eligibility ?? null;
  const pendingApply = me?.application?.status === 'pending';
  const identity = [me?.isClerk ? '风纪委员' : null, me?.isOwner || privileged ? 'Founder' : null]
    .filter(Boolean)
    .join(' · ');
  const canVote = (report: BeltModerationReport) => report.status === 'open' && !report.myVerdict;

  return (
    <div className="belt-mod">
      <header className="belt-mod-head">
        <div className="belt-mod-head-main">
          <p className="belt-page-kicker">TRIBUNAL // 风纪工位</p>
          <b className="belt-mod-role">{identity || '用户'}</b>
          <span className="belt-mod-pending">
            {allowed ? (
              <>
                待审 <b>{reports.length}</b>
              </>
            ) : (
              '只读参观'
            )}
          </span>
        </div>
        <div className="belt-mod-head-actions">
          {allowed ? (
            <button type="button" className="belt-button" disabled={reportsBusy} onClick={() => setReportsKey((value) => value + 1)}>
              {reportsBusy ? '同步中…' : '刷新'}
            </button>
          ) : null}
          <div className="belt-menu" ref={menuRef}>
            <button
              type="button"
              className="belt-button belt-menu-trigger"
              aria-label="风纪操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="belt-menu-pop" role="menu">
                {me?.isClerk ? (
                  <span className="belt-menu-item is-static" role="menuitem" aria-disabled="true">
                    你已是风纪委员
                  </span>
                ) : (
                  <button type="button" role="menuitem" className="belt-menu-item" onClick={() => openPanel('apply')}>
                    申请风纪委员
                  </button>
                )}
                {privileged ? (
                  <button type="button" role="menuitem" className="belt-menu-item" onClick={() => openPanel('approvals')}>
                    风纪委员申请审批
                  </button>
                ) : null}
                <button type="button" role="menuitem" className="belt-menu-item" onClick={() => setMenuOpen(false)}>
                  关闭
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className="belt-mod-shell">
        <div className="belt-mod-shell-main">
          <p className="belt-page-kicker">MODERATION COMMITTEE / 风纪委员会</p>
          <h2>环塔风纪委员会</h2>
          <p className="belt-mod-shell-copy">
            受理举报、众包投票与工单裁决。任何用户都可以提交申请；当选后才会解锁工单池与投票。
          </p>
          <ul className="belt-mod-shell-stats">
            <li>
              <span>当前等级</span>
              <b>Lv{eligibility?.level ?? '—'}</b>
              <small>需 Lv{eligibility?.requiredLevel ?? 4}</small>
            </li>
            <li>
              <span>30 天违规</span>
              <b>{eligibility?.violations30d ?? '—'} 次</b>
              <small>{eligibility ? (eligibility.cleanOk ? '清白' : '存在违规') : '数据不可用'}</small>
            </li>
            <li>
              <span>工单池</span>
              <b>{allowed ? '已授权' : '未授权'}</b>
              <small>{identity || '用户'}</small>
            </li>
          </ul>
          {eligibility && !eligibility.canApply && eligibility.reasons.length > 0 ? (
            <ul className="belt-mod-shell-reasons">
              {eligibility.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="belt-mod-shell-actions">
          {allowed ? (
            <span className="belt-stamp is-signal">工单池已授权</span>
          ) : pendingApply ? (
            <p className="belt-hint">申请审核中，请等待 Founder 批复。</p>
          ) : eligibility?.canApply ? (
            <button type="button" className="belt-button is-signal" onClick={() => openPanel('apply')}>
              提交申请
            </button>
          ) : (
            <p className="belt-hint">暂不符合申请条件。</p>
          )}
        </div>
      </section>

      {gateError ? (
        <p className="belt-error" role="alert">
          <code>GATE_ERROR</code> {gateError}
        </p>
      ) : null}
      {notice ? (
        <p className="belt-panel belt-hint" role="status">
          {notice}
        </p>
      ) : null}

      {allowed ? (
        <>
          {voteError ? (
            <p className="belt-error" role="alert">
              <code>VOTE_ERROR</code> {voteError}
            </p>
          ) : null}

          {reportsError ? (
            <p className="belt-error" role="alert">
              <code>QUEUE_ERROR</code> {reportsError}
            </p>
          ) : null}

          {reportsBusy && reports.length === 0 ? <p className="belt-hint">正在读取工单…</p> : null}

          {!reportsBusy && reports.length === 0 ? <p className="belt-hint">工单池已清空。</p> : null}

      <div className="belt-mod-list">
        {reports.map((report) => (
          <article key={report.id} className={`belt-mod-card${report.status === 'open' ? '' : ' is-closed'}`}>
            <header className="belt-mod-card-head">
              <span className="belt-mod-kicker">
                #{report.id.slice(0, 8).toUpperCase()} · {report.targetType}
              </span>
              <span className={`belt-stamp${report.status === 'open' ? ' is-signal' : ''}`}>{report.status}</span>
            </header>
            <h2 className="belt-mod-title">{report.target?.title || '（目标已移除）'}</h2>
            <p className="belt-mod-body">{excerpt(report.target?.body)}</p>
            <div className="belt-mod-meta">
              <span>
                作者 @{report.target?.authorHandle ?? '—'} · Lv{report.target?.authorLevel ?? '—'}
              </span>
              <span>理由 {report.reason}</span>
              <span>
                票数 违规 {report.votes.violation} / 不违规 {report.votes.clear} / 共 {report.votes.total}
              </span>
              <span>{fmtDate(report.createdAt)}</span>
            </div>
            {report.subjectIsClerk ? <p className="belt-mod-warn">被举报人为风纪委员，需 Founder 复核。</p> : null}
            <div className="belt-mod-actions">
              <button
                type="button"
                className="belt-button belt-mod-vote is-violation"
                aria-pressed={report.myVerdict === 'violation'}
                disabled={!canVote(report) || votingId === report.id}
                onClick={() => void vote(report, 'violation')}
              >
                {report.myVerdict === 'violation' ? '已投违规' : '违规'}
              </button>
              <button
                type="button"
                className="belt-button belt-mod-vote is-clear"
                aria-pressed={report.myVerdict === 'clear'}
                disabled={!canVote(report) || votingId === report.id}
                onClick={() => void vote(report, 'clear')}
              >
                {report.myVerdict === 'clear' ? '已投不违规' : '不违规'}
              </button>
              <button
                type="button"
                className="belt-button"
                onClick={() => {
                  setDetail(report);
                  setPanel('detail');
                }}
              >
                详情
              </button>
            </div>
          </article>
        ))}
      </div>
        </>
      ) : (
        <p className="belt-panel belt-hint">
          工单池与投票仅对风纪委员开放。符合条件后可在此提交申请，等待 Founder 批复。
        </p>
      )}

      {panel === 'detail' && detail ? (
        <div className="belt-drawer-backdrop" role="presentation" onClick={() => setPanel(null)}>
          <aside
            className="belt-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="工单详情"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="belt-drawer-head">
              <b>工单详情</b>
              <button type="button" className="belt-button" onClick={() => setPanel(null)}>
                关闭
              </button>
            </div>
            <p className="belt-page-kicker">CASE #{detail.id.slice(0, 8).toUpperCase()}</p>
            <h2 className="belt-mod-title">{detail.target?.title || '（目标已移除）'}</h2>
            <p className="belt-mod-body">{detail.target?.body || '（无正文）'}</p>
            <ul className="belt-ledger mt-2">
              <li className="belt-row">
                <span>作者</span>
                <b>@{detail.target?.authorHandle ?? '—'}</b>
              </li>
              <li className="belt-row">
                <span>作者等级</span>
                <b>Lv{detail.target?.authorLevel ?? '—'}</b>
              </li>
              <li className="belt-row">
                <span>理由</span>
                <b>{detail.reason}</b>
              </li>
              <li className="belt-row">
                <span>补充</span>
                <b>{detail.detail || '—'}</b>
              </li>
              <li className="belt-row">
                <span>票数</span>
                <b>
                  违规 {detail.votes.violation} / 不违规 {detail.votes.clear} / 共 {detail.votes.total}
                </b>
              </li>
              <li className="belt-row">
                <span>我的裁决</span>
                <b>{detail.myVerdict === 'violation' ? '违规' : detail.myVerdict === 'clear' ? '不违规' : '未投'}</b>
              </li>
              <li className="belt-row">
                <span>发起</span>
                <b>{fmtDate(detail.createdAt)}</b>
              </li>
            </ul>
            <div className="belt-mod-actions">
              <button
                type="button"
                className="belt-button belt-mod-vote is-violation"
                disabled={!canVote(detail) || votingId === detail.id}
                onClick={() => void vote(detail, 'violation')}
              >
                {detail.myVerdict === 'violation' ? '已投违规' : '违规'}
              </button>
              <button
                type="button"
                className="belt-button belt-mod-vote is-clear"
                disabled={!canVote(detail) || votingId === detail.id}
                onClick={() => void vote(detail, 'clear')}
              >
                {detail.myVerdict === 'clear' ? '已投不违规' : '不违规'}
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {panel === 'apply' && !me?.isClerk ? (
        <BeltPortal>
      <div className="belt-modal-backdrop" role="presentation">
          <section
            className="belt-modal"
            role="dialog"
            aria-modal="true"
            aria-label="申请风纪委员"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="belt-page-kicker">CLERK APPLICATION</p>
            <h2>申请风纪委员</h2>
            {pendingApply ? <p className="belt-hint">申请审核中，请等待 Founder 批复。</p> : null}
            {applyError ? (
              <p className="belt-error" role="alert">
                <code>APPLY_ERROR</code> {applyError}
              </p>
            ) : null}
            <ul className="belt-ledger mt-2">
              <li className="belt-row">
                <span>等级要求</span>
                <b>
                  Lv{eligibility?.level ?? '—'} / 需 Lv{eligibility?.requiredLevel ?? 4}
                  {eligibility ? (eligibility.levelOk ? ' · 达标' : ' · 未达标') : ''}
                </b>
              </li>
              <li className="belt-row">
                <span>30 天违规</span>
                <b>
                  {eligibility?.violations30d ?? '—'} 次
                  {eligibility ? (eligibility.cleanOk ? ' · 清白' : ' · 存在违规') : ''}
                </b>
              </li>
            </ul>
            {eligibility && !eligibility.canApply && eligibility.reasons.length > 0 ? (
              <ul className="belt-mod-reasons">
                {eligibility.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            {!eligibility ? <p className="belt-hint">资格数据暂不可用。</p> : null}
            <label className="belt-field">
              <span>申请理由</span>
              <textarea
                className="belt-input"
                rows={4}
                maxLength={400}
                value={applyReason}
                onChange={(event) => setApplyReason(event.target.value)}
                placeholder="说明你为什么适合进入风纪工位…"
              />
            </label>
            <div className="belt-modal-actions">
              <button type="button" className="belt-button" onClick={() => setPanel(null)}>
                取消
              </button>
              <button
                type="button"
                className="belt-button is-signal"
                disabled={applyBusy || pendingApply || !eligibility?.canApply || !applyReason.trim()}
                onClick={() => void submitApply()}
              >
                {applyBusy ? '提交中…' : pendingApply ? '审核中' : '提交申请'}
              </button>
            </div>
          </section>
        </div>
      </BeltPortal>
      ) : null}

      {panel === 'approvals' ? (
        <BeltPortal>
      <div className="belt-modal-backdrop" role="presentation" onClick={() => setPanel(null)}>
          <section
            className="belt-modal"
            role="dialog"
            aria-modal="true"
            aria-label="风纪委员申请审批"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="belt-page-kicker">FOUNDER REVIEW</p>
            <h2>风纪委员申请审批</h2>
            {appsError ? (
              <p className="belt-error" role="alert">
                <code>APPLICATIONS_ERROR</code> {appsError}
              </p>
            ) : null}
            {appsBusy && !apps ? <p className="belt-hint">正在读取申请…</p> : null}
            {apps && apps.length === 0 ? <p className="belt-hint">没有待审批的申请。</p> : null}
            <div className="belt-mod-applications">
              {(apps ?? []).map((application) => (
                <article key={application.id} className="belt-mod-application">
                  <header>
                    <b>@{application.user?.handle ?? '—'}</b>
                    <span className="belt-hint">
                      Lv{application.snapshotLevel} · 违规 {application.snapshotViolations}
                    </span>
                  </header>
                  <p>{application.reason || '（未填写理由）'}</p>
                  <small>{fmtDate(application.createdAt)}</small>
                  <div className="belt-mod-actions">
                    <button
                      type="button"
                      className="belt-button is-signal"
                      disabled={decidingId === application.id}
                      onClick={() => void decide(application, true)}
                    >
                      通过
                    </button>
                    <button
                      type="button"
                      className="belt-button belt-mod-vote is-violation"
                      disabled={decidingId === application.id}
                      onClick={() => void decide(application, false)}
                    >
                      驳回
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <div className="belt-modal-actions">
              <button type="button" className="belt-button" onClick={() => setPanel(null)}>
                关闭
              </button>
            </div>
          </section>
        </div>
      </BeltPortal>
      ) : null}
    </div>
  );
}
