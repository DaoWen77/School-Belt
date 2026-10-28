'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { beltApi, BeltApiError } from '@/lib/beltApi';
import type { BeltTask, BeltTaskApplication, BeltTaskDetail } from '@/lib/beltTypes';
import { fmtCents, refreshWallet, useBeltWallet } from '@/lib/beltWallet';
import { BeltAvatar } from './BeltAvatar';
import { BeltPortal } from './BeltPortal';

const SCOPES = [
  { key: 'all', label: '全部' },
  { key: 'posted', label: '我发布的' },
  { key: 'taken', label: '我接的' },
] as const;

type Scope = (typeof SCOPES)[number]['key'];

const STATUS_LABEL: Record<string, string> = {
  open: '待接单',
  in_progress: '进行中',
  submitted: '待验收',
  completed: '已完成',
  cancelled: '已取消',
};

const ESCROW_LABEL: Record<string, string> = {
  held: '资金已托管',
  frozen: '资金已托管',
  pending: '托管待处理',
  released: '已结算给接单人',
  refunded: '已退回发起人',
  cancelled: '托管已解除',
};

type Panel =
  | { kind: 'form'; task: BeltTask | null }
  | { kind: 'apply'; task: BeltTask }
  | { kind: 'applications'; task: BeltTask }
  | { kind: 'submit'; task: BeltTask }
  | { kind: 'cancel'; task: BeltTask }
  | { kind: 'accept'; task: BeltTask }
  | null;

function feeOf(task: BeltTask): number {
  return Number.isFinite(task.feeCents) ? task.feeCents : Math.round(task.priceCents * 0.05);
}

function netOf(task: BeltTask): number {
  return Number.isFinite(task.netCents) ? task.netCents : task.priceCents - feeOf(task);
}

function escrowText(task: BeltTask): string | null {
  const escrow = task.escrow;
  if (!escrow) return null;
  if (typeof escrow === 'string') return ESCROW_LABEL[escrow] ?? escrow;
  const status = escrow.status;
  return status ? ESCROW_LABEL[status] ?? status : null;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '无截止';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '无截止' : date.toLocaleDateString('zh-CN');
}

function errText(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/** 404/401/403 一律降级成页面提示，空态照常渲染，不阻塞浏览。 */
function degradeText(caught: unknown, fallback: string): string {
  if (caught instanceof BeltApiError) {
    if (caught.status === 404) return '委托链路尚未开放，先当作这里还没有委托。';
    if (caught.status === 401 || caught.status === 403) return '当前身份无法读取委托，稍后可刷新重试。';
  }
  return errText(caught, fallback);
}

/** 写操作错误码 → 中文提示。 */
function writeText(caught: unknown, fallback: string): string {
  if (caught instanceof BeltApiError) {
    if (caught.code === 'INSUFFICIENT_FUNDS') return '商券余额不足，无法托管这笔委托。';
    if (caught.code === 'TASK_CONFLICT') return '委托状态已变化，刷新后再试。';
    if (caught.status === 401) return '登录已过期，请重新进入环塔。';
    if (caught.status === 403) return '当前身份没有这一步权限。';
    if (caught.status === 404) return '委托链路尚未开放。';
  }
  return errText(caught, fallback);
}

function Modal({
  title,
  kicker,
  dismissible = true,
  onClose,
  children,
}: {
  title: string;
  kicker: string;
  /** 含表单时置 false：点遮罩不再误关，草稿不丢 */
  dismissible?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <BeltPortal>
      <div
      className="belt-modal-backdrop"
      role="presentation"
      onClick={() => (dismissible ? onClose() : undefined)}
    >
      <section
        className="belt-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="belt-page-kicker">{kicker}</p>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
      </BeltPortal>
  );
}

export function BeltTasksView() {
  const wallet = useBeltWallet();
  const [scope, setScope] = useState<Scope>('all');
  const [items, setItems] = useState<BeltTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [panel, setPanel] = useState<Panel>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [price, setPrice] = useState('');
  const [deadline, setDeadline] = useState('');
  const [applyMessage, setApplyMessage] = useState('');

  const [apps, setApps] = useState<BeltTaskApplication[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    beltApi<{ items: BeltTask[] }>(`/belt/tasks?scope=${scope}`)
      .then((payload) => {
        if (cancelled) return;
        setItems(Array.isArray(payload?.items) ? payload.items : []);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setItems([]);
        setError(degradeText(caught, '委托读取失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, reloadKey]);

  const openPanel = (next: Panel) => {
    setPanelError(null);
    setBusy(false);
    setPanel(next);
  };

  const openForm = (task: BeltTask | null) => {
    setTitle(task?.title ?? '');
    setDesc(task?.description ?? '');
    setPrice(task ? String(task.priceCents / 100) : '');
    setDeadline(task?.deadline ? task.deadline.slice(0, 10) : '');
    setApplyMessage('');
    setPendingSelect(null);
    openPanel({ kind: 'form', task });
  };

  const openApply = (task: BeltTask) => {
    setApplyMessage('');
    openPanel({ kind: 'apply', task });
  };

  const openApplications = (task: BeltTask) => {
    setApps([]);
    setPendingSelect(null);
    setAppsLoading(true);
    openPanel({ kind: 'applications', task });
    beltApi<BeltTaskDetail>(`/belt/tasks/${task.id}`)
      .then((detail) => setApps(Array.isArray(detail?.applications) ? detail.applications : []))
      .catch((caught: unknown) => setPanelError(degradeText(caught, '申请读取失败')))
      .finally(() => setAppsLoading(false));
  };

  const closePanel = () => {
    if (busy) return;
    setPanel(null);
    setPanelError(null);
    setPendingSelect(null);
  };

  const write = async (message: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setPanelError(null);
    try {
      await action();
      setNotice(message);
      setPanel(null);
      setReloadKey((value) => value + 1);
      void refreshWallet();
    } catch (caught) {
      setPanelError(writeText(caught, '操作失败，稍后再试。'));
    } finally {
      setBusy(false);
    }
  };

  const priceCents = Math.round((Number(price) || 0) * 100);
  const editing = panel?.kind === 'form' ? panel.task : null;
  const priceShort = !editing && wallet !== null && priceCents > wallet;

  const changePrice = (raw: string) => {
    const clean = raw.replace(/[^\d.]/g, '');
    const [head, ...rest] = clean.split('.');
    setPrice(rest.length ? `${head}.${rest.join('')}` : head);
  };

  const submitForm = () => {
    if (!panel || panel.kind !== 'form') return;
    const cleanTitle = title.trim();
    const cleanDesc = desc.trim();
    if (!cleanTitle || !cleanDesc) {
      setPanelError('标题和说明都要填写。');
      return;
    }
    if (!Number.isFinite(priceCents) || priceCents < 100) {
      setPanelError('价格至少 1 券。');
      return;
    }
    const target = panel.task;
    const body: Record<string, unknown> = { title: cleanTitle, description: cleanDesc, priceCents };
    if (deadline) body.deadline = deadline;
    else if (target) body.deadline = null;
    const payload = JSON.stringify(body);
    void write(
      target ? '委托已更新。' : '委托已发布，资金已托管。',
      () =>
        target
          ? beltApi(`/belt/tasks/${target.id}`, { method: 'PATCH', body: payload })
          : beltApi('/belt/tasks', { method: 'POST', body: payload }),
    );
  };

  const submitApply = () => {
    if (!panel || panel.kind !== 'apply') return;
    const task = panel.task;
    const message = applyMessage.trim();
    void write('申请已送达，等待发起人选择。', () =>
      beltApi(`/belt/tasks/${task.id}/apply`, {
        method: 'POST',
        body: JSON.stringify(message ? { message } : {}),
      }),
    );
  };

  const confirmSelect = () => {
    if (!panel || panel.kind !== 'applications' || !pendingSelect) return;
    const task = panel.task;
    const applicationId = pendingSelect;
    setPendingSelect(null);
    void write('已选择接单人，托管资金已冻结。', () =>
      beltApi(`/belt/tasks/${task.id}/select`, { method: 'POST', body: JSON.stringify({ applicationId }) }),
    );
  };

  const confirmSubmit = () => {
    if (!panel || panel.kind !== 'submit') return;
    const task = panel.task;
    void write('已提交交付，等待发起人验收。', () =>
      beltApi(`/belt/tasks/${task.id}/submit`, { method: 'POST', body: JSON.stringify({}) }),
    );
  };

  const confirmCancel = () => {
    if (!panel || panel.kind !== 'cancel') return;
    const task = panel.task;
    void write('委托已取消。', () =>
      beltApi(`/belt/tasks/${task.id}/cancel`, { method: 'POST', body: JSON.stringify({}) }),
    );
  };

  const confirmAccept = () => {
    if (!panel || panel.kind !== 'accept') return;
    const task = panel.task;
    void write('已验收，托管资金已结算。', () =>
      beltApi(`/belt/tasks/${task.id}/accept`, { method: 'POST', body: JSON.stringify({}) }),
    );
  };

  /* 卡内动作一律次级：页头「发布委托」是这一屏唯一主操作 */
  const cardActions = (task: BeltTask) => {
    const actions: ReactNode[] = [];
    if (task.myRole === 'visitor' && task.canApply) {
      actions.push(
        <button key="apply" type="button" className="belt-button" onClick={() => openApply(task)}>
          申请接单
        </button>,
      );
    }
    if (task.myRole === 'creator' && task.canSelect) {
      actions.push(
        <button key="apps" type="button" className="belt-button" onClick={() => openApplications(task)}>
          查看申请{task.applicationCount > 0 ? `（${task.applicationCount}）` : ''}
        </button>,
      );
    }
    if (task.myRole === 'creator' && task.canEdit) {
      actions.push(
        <button key="edit" type="button" className="belt-button" onClick={() => openForm(task)}>
          编辑
        </button>,
      );
    }
    if (task.myRole === 'creator' && task.canCancel) {
      actions.push(
        <button key="cancel" type="button" className="belt-button is-danger" onClick={() => openPanel({ kind: 'cancel', task })}>
          取消委托
        </button>,
      );
    }
    if (task.myRole === 'taker' && task.canSubmit) {
      actions.push(
        <button key="submit" type="button" className="belt-button" onClick={() => openPanel({ kind: 'submit', task })}>
          提交交付
        </button>,
      );
    }
    if (task.myRole === 'creator' && task.canAccept) {
      actions.push(
        <button key="accept" type="button" className="belt-button" onClick={() => openPanel({ kind: 'accept', task })}>
          验收打款
        </button>,
      );
    }
    return actions;
  };

  return (
    <div className="belt-task">
      <header className="belt-task-top">
        <div className="belt-task-tabs" role="tablist" aria-label="委托筛选">
          {SCOPES.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={scope === item.key}
              className={`belt-task-tab${scope === item.key ? ' is-active' : ''}`}
              onClick={() => {
                setScope(item.key);
                setNotice(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="belt-task-top-side">
          <span className="belt-task-balance">
            可用 <b>{fmtCents(wallet)}</b> 券
          </span>
          <button type="button" className="belt-button is-signal" onClick={() => openForm(null)}>
            发布委托
          </button>
        </div>
      </header>

      {notice ? (
        <p className="belt-hint belt-task-notice" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="belt-error" role="alert">
          <code>TASKS_PARTIAL</code> {error}
        </p>
      ) : null}

      {loading ? <p className="belt-hint">正在读取委托…</p> : null}

      {!loading && items.length === 0 ? (
        <section className="belt-empty belt-task-empty">
          <p>{scope === 'posted' ? '你还没有发布委托。' : scope === 'taken' ? '你还没有接下的委托。' : '这里还没有委托。'}</p>
          <button type="button" className="belt-button is-signal" onClick={() => openForm(null)}>
            发布第一条委托
          </button>
        </section>
      ) : null}

      <div className="belt-task-list">
        {items.map((task) => {
          const actions = cardActions(task);
          const escrow = escrowText(task);
          return (
            <article className="belt-task-card" data-status={task.status} key={task.id}>
              <header className="belt-task-card-head">
                <div className="belt-task-card-title">
                  <b>{task.title}</b>
                  <span className={`belt-stamp${task.status === 'open' ? ' is-signal' : ''}${task.status === 'cancelled' ? ' is-danger' : ''}`}>
                    {STATUS_LABEL[task.status] ?? task.status}
                  </span>
                </div>
                <div className="belt-task-amount">
                  <b>{fmtCents(task.priceCents)}</b>
                  <small>券</small>
                </div>
              </header>

              <p className="belt-task-desc">{task.description}</p>

              <div className="belt-task-meta">
                <span className="belt-task-person">
                  <BeltAvatar fileId={task.creator.avatarFileId} name={task.creator.displayName} size="sm" />
                  <span>
                    <small>发起</small>
                    <b>{task.creator.displayName}</b>
                  </span>
                </span>
                {task.taker ? (
                  <span className="belt-task-person">
                    <BeltAvatar fileId={task.taker.avatarFileId} name={task.taker.displayName} size="sm" />
                    <span>
                      <small>接单</small>
                      <b>{task.taker.displayName}</b>
                    </span>
                  </span>
                ) : null}
                <span className="belt-task-fact">截止 {fmtDate(task.deadline)}</span>
                <span className="belt-task-fact">申请 {task.applicationCount}</span>
              </div>

              {task.myApplicationStatus ? (
                <p className="belt-task-note">你的申请 · {task.myApplicationStatus}</p>
              ) : null}
              {escrow || task.status === 'completed' ? (
                <p className="belt-task-note is-escrow">
                  {task.status === 'completed' ? '已完成' : '托管'}
                  {escrow ? ` · ${escrow}` : ''}
                </p>
              ) : null}

              {actions.length > 0 ? <div className="belt-task-actions">{actions}</div> : null}
            </article>
          );
        })}
      </div>

      {panel && panel.kind === 'form' ? (
        <Modal title={panel.task ? '编辑委托' : '发布委托'} kicker="ESCROW ORDER" onClose={closePanel} dismissible={false}>
          <label className="belt-field">
            <span>标题</span>
            <input
              className="belt-input"
              value={title}
              maxLength={60}
              placeholder="一句话说清要办的事"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="belt-field">
            <span>说明</span>
            <textarea
              className="belt-input"
              value={desc}
              maxLength={1000}
              placeholder="交付标准、时间、联系方式…"
              onChange={(event) => setDesc(event.target.value)}
            />
          </label>
          <div className="belt-task-form-row">
            <label className="belt-field">
              <span>价格（券）</span>
              <input
                className="belt-input"
                inputMode="decimal"
                value={price}
                placeholder="最小 1"
                onChange={(event) => changePrice(event.target.value)}
              />
            </label>
            <label className="belt-field">
              <span>截止日（可选）</span>
              <input
                className="belt-input"
                type="date"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
              />
            </label>
          </div>
          <p className="belt-task-fee">成交后平台抽取 5% 服务费</p>
          {priceShort ? (
            <p className="belt-error" role="alert">
              余额不足：当前 {fmtCents(wallet)} 券，需 {fmtCents(priceCents)} 券。
            </p>
          ) : null}
          {panelError ? (
            <p className="belt-error" role="alert">
              {panelError}
            </p>
          ) : null}
          <div className="belt-modal-actions">
            <button type="button" className="belt-button" disabled={busy} onClick={closePanel}>
              取消
            </button>
            <button type="button" className="belt-button is-signal" disabled={busy || priceShort} onClick={submitForm}>
              {busy ? '提交中…' : panel.task ? '保存修改' : '发布并托管'}
            </button>
          </div>
        </Modal>
      ) : null}

      {panel && panel.kind === 'apply' ? (
        <Modal title="申请接单" kicker="APPLICATION" onClose={closePanel} dismissible={false}>
          <p className="belt-hint">
            {panel.task.title} · {fmtCents(panel.task.priceCents)} 券
          </p>
          <label className="belt-field">
            <span>补充说明（可选）</span>
            <textarea
              className="belt-input"
              value={applyMessage}
              maxLength={300}
              placeholder="打算怎么做、多久能交付"
              onChange={(event) => setApplyMessage(event.target.value)}
            />
          </label>
          {panelError ? (
            <p className="belt-error" role="alert">
              {panelError}
            </p>
          ) : null}
          <div className="belt-modal-actions">
            <button type="button" className="belt-button" disabled={busy} onClick={closePanel}>
              取消
            </button>
            <button type="button" className="belt-button is-signal" disabled={busy} onClick={submitApply}>
              {busy ? '提交中…' : '发出申请'}
            </button>
          </div>
        </Modal>
      ) : null}

      {panel && panel.kind === 'applications' ? (
        <Modal title="申请列表" kicker="APPLICATIONS" onClose={closePanel}>
          {appsLoading ? <p className="belt-hint">正在读取申请…</p> : null}
          {panelError ? (
            <p className="belt-error" role="alert">
              {panelError}
            </p>
          ) : null}
          {!appsLoading && apps.length === 0 ? <p className="belt-hint">还没有人申请。</p> : null}
          <div className="belt-task-apps">
            {apps.map((application) => (
              <article className="belt-task-app" key={application.id}>
                <header className="belt-task-person">
                  <BeltAvatar
                    fileId={application.applicant.avatarFileId}
                    name={application.applicant.displayName}
                    size="sm"
                  />
                  <span>
                    <b>{application.applicant.displayName}</b>
                    <small>@{application.applicant.handle}</small>
                  </span>
                </header>
                {application.message ? <p>{application.message}</p> : null}
                <footer className="belt-task-app-foot">
                  <span className="belt-stamp">{application.status}</span>
                  {panel.task.canSelect ? (
                    <button
                      type="button"
                      className="belt-button is-signal"
                      disabled={busy}
                      onClick={() => setPendingSelect(application.id)}
                    >
                      选择 TA
                    </button>
                  ) : null}
                </footer>
              </article>
            ))}
          </div>
          {pendingSelect ? (
            <div className="belt-task-confirm" role="alertdialog" aria-label="确认冻结">
              <p>
                确认选择该用户？将冻结 <b>{fmtCents(panel.task.priceCents)}</b> 券作为托管资金。
              </p>
              <div className="belt-modal-actions">
                <button type="button" className="belt-button" disabled={busy} onClick={() => setPendingSelect(null)}>
                  再想想
                </button>
                <button type="button" className="belt-button is-signal" disabled={busy} onClick={confirmSelect}>
                  {busy ? '冻结中…' : '确认冻结'}
                </button>
              </div>
            </div>
          ) : null}
          <div className="belt-modal-actions">
            <button type="button" className="belt-button" disabled={busy} onClick={closePanel}>
              关闭
            </button>
          </div>
        </Modal>
      ) : null}

      {panel && panel.kind === 'submit' ? (
        <Modal title="提交交付" kicker="DELIVERY" onClose={closePanel} dismissible={false}>
          <p>确认已按委托要求完成交付？发起人验收后，托管资金结算给接单人。</p>
          {panelError ? (
            <p className="belt-error" role="alert">
              {panelError}
            </p>
          ) : null}
          <div className="belt-modal-actions">
            <button type="button" className="belt-button" disabled={busy} onClick={closePanel}>
              取消
            </button>
            <button type="button" className="belt-button is-signal" disabled={busy} onClick={confirmSubmit}>
              {busy ? '提交中…' : '确认提交'}
            </button>
          </div>
        </Modal>
      ) : null}

      {panel && panel.kind === 'cancel' ? (
        <Modal title="取消委托" kicker="CANCEL" onClose={closePanel}>
          <p>
            {panel.task.status === 'open'
              ? '委托还未开始，取消不扣任何费用。'
              : `委托正在进行，取消将把托管的 ${fmtCents(panel.task.priceCents)} 券退回发起人。`}
          </p>
          {panelError ? (
            <p className="belt-error" role="alert">
              {panelError}
            </p>
          ) : null}
          <div className="belt-modal-actions">
            <button type="button" className="belt-button" disabled={busy} onClick={closePanel}>
              保留委托
            </button>
            <button type="button" className="belt-button is-danger" disabled={busy} onClick={confirmCancel}>
              {busy ? '取消中…' : '确认取消'}
            </button>
          </div>
        </Modal>
      ) : null}

      {panel && panel.kind === 'accept' ? (
        <Modal title="验收打款" kicker="SETTLE" onClose={closePanel}>
          <p className="belt-task-settle">
            金额 {fmtCents(panel.task.priceCents)} 券 · 服务费 5%（{fmtCents(feeOf(panel.task))} 券）· 实到{' '}
            {fmtCents(netOf(panel.task))} 券
          </p>
          <p className="belt-hint">确认验收后，托管资金立即结算给接单人，不可撤回。</p>
          {panelError ? (
            <p className="belt-error" role="alert">
              {panelError}
            </p>
          ) : null}
          <div className="belt-modal-actions">
            <button type="button" className="belt-button" disabled={busy} onClick={closePanel}>
              再看看
            </button>
            <button type="button" className="belt-button is-signal" disabled={busy} onClick={confirmAccept}>
              {busy ? '结算中…' : '确认验收'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
