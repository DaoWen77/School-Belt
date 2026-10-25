'use client';

import { useEffect, useState } from 'react';
import { api, errorOf } from '@/lib/api';

interface RssSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  category: 'tech' | 'world' | 'campus' | 'game';
  lastFetchedAt: string | null;
  lastItemCount: number;
  lastError: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

interface FetchReport {
  sourceId: string;
  sourceName: string;
  fetched: number;
  created: number;
  skipped: number;
  error: string | null;
}

interface PageError {
  code: string;
  message: string;
}

const PANEL = 'cut-corner-sm border border-line bg-panel p-3';
const HEADING = 'font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2';
const FIELD = 'w-full border border-line bg-paper px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-ink';

function dateOf(value: string | null): string {
  if (!value) return '从未抓取';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Sprint5 / Phase E：新闻塔 RSS 源管理。
 * 抓取结果只写 belt/telegraph 的 Post，电文页自动出现在 Bento 墙。
 */
export function RssSettings({ isOwner }: { isOwner: boolean }) {
  const [sources, setSources] = useState<RssSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<'tech' | 'world' | 'campus' | 'game'>('tech');
  const [error, setError] = useState<PageError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reports, setReports] = useState<FetchReport[]>([]);

  const load = async () => {
    try {
      const data = await api<{ sources: RssSource[] }>('/rss/sources');
      setSources(data.sources ?? []);
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    if (!isOwner || !name.trim() || !url.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api('/rss/sources', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), url: url.trim(), category }),
      });
      setName('');
      setUrl('');
      setNotice('RSS 源已加入新闻塔。');
      await load();
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (source: RssSource) => {
    if (!isOwner || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/rss/sources/${source.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      await load();
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (source: RssSource) => {
    if (!isOwner || busy) return;
    if (!window.confirm(`移除 RSS 源「${source.name}」？已抓取的电文会保留。`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/rss/sources/${source.id}`, { method: 'DELETE' });
      setNotice(`RSS 源「${source.name}」已移除。`);
      await load();
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const fetchAll = async () => {
    if (!isOwner || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setReports([]);
    try {
      const data = await api<{ reports: FetchReport[] }>('/rss/fetch', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setReports(data.reports ?? []);
      await load();
      const created = (data.reports ?? []).reduce((sum, report) => sum + report.created, 0);
      setNotice(`抓取完成：新增 ${created} 条电文。`);
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="tab-rss" className={PANEL}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className={HEADING}>News Tower / 新闻塔 RSS</p>
        <span className="border border-line px-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-2">
          Phase E · intercept
        </span>
      </div>
      <p className="mb-3 border-l-2 border-ink pl-2 text-[10px] leading-relaxed text-ink-2">
        抓取结果写入环带电文的 <code>telegraph</code> 版块，电文墙会自动拼贴。RSS 源只允许 Owner / Admin 管理。
      </p>

      {error ? (
        <p className="mb-2 flex items-center gap-2 border border-line px-2 py-1.5 text-[11px] text-ink" role="alert">
          <span className="bg-accent px-1 font-mono text-[9px] font-bold uppercase text-on-accent">{error.code}</span>
          {error.message}
        </p>
      ) : null}
      {notice ? <p className="mb-2 border border-line bg-chip px-2 py-1.5 text-[11px] text-ink">{notice}</p> : null}

      {isOwner ? (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-6">
          <input className={`${FIELD} sm:col-span-2`} value={name} onChange={(event) => setName(event.target.value)} placeholder="来源名，如 36Kr" aria-label="RSS 来源名" />
          <input className={`${FIELD} sm:col-span-2`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…/feed.xml" aria-label="RSS 地址" />
          <select className={FIELD} value={category} onChange={(event) => setCategory(event.target.value as typeof category)} aria-label="RSS 分类">
            <option value="tech">科技</option>
            <option value="world">国际</option>
            <option value="campus">校园</option>
            <option value="game">游戏</option>
          </select>
          <button type="button" className="cut-corner-sm bg-ink px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40" disabled={busy || !name.trim() || !url.trim()} onClick={() => void add()}>
            添加源
          </button>
        </div>
      ) : (
        <p className="mb-3 border border-line px-2 py-1.5 text-[10px] text-ink-2">只读：仅 Owner / Admin 可编辑新闻塔。</p>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" className="cut-corner-sm bg-accent px-3 py-1.5 text-[11px] font-bold text-on-accent disabled:opacity-40" disabled={!isOwner || busy || sources.length === 0} onClick={() => void fetchAll()}>
          {busy ? '抓取中…' : '抓取全部'}
        </button>
        <span className="font-mono text-[9px] text-ink-2">{loading ? 'SCANNING…' : `${sources.length} SOURCES`}</span>
      </div>

      {reports.length > 0 ? (
        <ul className="mb-2 border border-line">
          {reports.map((report) => (
            <li key={report.sourceId} className="flex flex-wrap gap-2 border-b border-line px-2 py-1 text-[10px] last:border-b-0">
              <b>{report.sourceName}</b>
              <span>抓取 {report.fetched}</span>
              <span className="text-ink-2">新增 {report.created}</span>
              <span className="text-ink-2">跳过 {report.skipped}</span>
              {report.error ? <span className="ml-auto text-danger">{report.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="flex flex-col">
        {sources.map((source) => (
          <li key={source.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-[11px] last:border-b-0">
            <span className={`h-1.5 w-1.5 shrink-0 ${source.enabled ? 'bg-accent' : 'bg-line'}`} aria-hidden="true" />
            <b className="text-ink">{source.name}</b>
            <span className="max-w-[16rem] truncate font-mono text-[9px] text-ink-2" title={source.url}>{source.url}</span>
            <span className="border border-line px-1 font-mono text-[8px] uppercase text-ink-2">{source.category} · {source.itemCount} ITEMS</span>
            <span className="font-mono text-[8px] text-ink-2">{dateOf(source.lastFetchedAt)}</span>
            {source.lastError ? <span className="text-[9px] text-danger">{source.lastError}</span> : null}
            {isOwner ? (
              <span className="ml-auto flex items-center gap-2">
                <button type="button" className="text-[10px] underline" disabled={busy} onClick={() => void toggle(source)}>
                  {source.enabled ? '停用' : '启用'}
                </button>
                <button type="button" className="text-[10px] text-danger underline" disabled={busy} onClick={() => void remove(source)}>
                  移除
                </button>
              </span>
            ) : null}
          </li>
        ))}
        {!loading && sources.length === 0 ? <li className="text-[11px] text-ink-2">新闻塔还没有 RSS 源。</li> : null}
      </ul>
    </section>
  );
}
