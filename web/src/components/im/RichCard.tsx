'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { api, errorOf } from '@/lib/api';
import type { Card, ChartCardData, MusicCardData, TaskStatus, VoteResult } from '@/lib/types';
import { dayOf } from '@/lib/format';
import { useTasksStore } from '@/store/tasks';
import { usePlayerStore } from '@/store/player';
import { AttachmentList } from '../Attachments';
import { ChartIcon, FileIcon, MusicIcon, TaskIcon, VoteIcon } from './icons';

const ChartView = dynamic(() => import('./ChartView'), { ssr: false, loading: () => <p className="text-[11px] text-ink-2">图表加载中…</p> });

const KIND_LABEL: Record<string, string> = {
  material: '素材',
  vote: '投票',
  task: '任务',
  idea: '灵感',
  artwork: '作品',
  music: '音乐',
  chart: '图表',
};

const TASK_COLUMNS: Array<{ key: TaskStatus; label: string }> = [
  { key: 'todo', label: '待办' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '已完成' },
];

function MusicBody({ data, cardId, channelId }: { data: Partial<MusicCardData>; cardId: string; channelId: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const url = typeof data.url === 'string' ? data.url : '';
  const provider = data.provider ?? 'link';
  const cover = typeof data.coverUrl === 'string' && data.coverUrl && !imageFailed ? data.coverUrl : null;
  const songId = typeof data.songId === 'string' ? data.songId : null;
  /** 不预加载、不嵌 iframe；点击后才给 audio 设置 src */
  const audioSrc =
    provider === 'audio'
      ? url
      : provider === 'netease' && songId
        ? `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(songId)}.mp3`
        : null;

  if (!url) {
    return <p className="mt-2 border border-line px-2 py-1.5 text-[11px] text-ink-2">音乐卡缺少 URL</p>;
  }

  return (
    <div className="mt-2 flex gap-2 border border-line bg-paper p-2">
      {cover ? (
        <img src={cover} alt={data.title ?? '封面'} onError={() => setImageFailed(true)} className="h-16 w-16 shrink-0 border border-line object-cover" />
      ) : (
        <span className="grid h-16 w-16 shrink-0 place-items-center border border-line bg-chip text-[9px] text-ink-2">无封面</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-ink">{data.title ?? '未命名音乐'}</p>
        {data.artist ? <p className="truncate text-[10px] text-ink-2">{data.artist}</p> : null}
        {audioSrc && !audioFailed ? (
          audioOpen ? (
            <audio className="mt-1 w-full" controls autoPlay preload="none" src={audioSrc} onError={() => setAudioFailed(true)}>
              你的浏览器不支持 audio。
            </audio>
          ) : (
            <button
              type="button"
              onClick={() => setAudioOpen(true)}
              className="mt-1 border border-line px-2 py-1 text-[10px] text-ink-2 hover:border-ink hover:text-ink"
            >
              ▶ 播放音乐
            </button>
          )
        ) : null}
        {audioSrc ? (
          <button
            type="button"
            onClick={() =>
              usePlayerStore.getState().addTrack({
                id: cardId,
                title: data.title ?? '未命名音乐',
                artist: data.artist,
                src: audioSrc,
                coverUrl: data.coverUrl ?? null,
                channelId,
              })
            }
            className="mt-1 ml-1 border border-line px-2 py-1 text-[10px] text-ink-2 hover:border-ink hover:text-ink"
          >
            加入队列
          </button>
        ) : null}
        <a href={url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block max-w-full truncate text-[10px] text-ink-2 underline">
          {provider === 'qq' ? '在 QQ 音乐打开' : provider === 'netease' ? '在网易云打开' : '打开链接'}
        </a>
      </div>
    </div>
  );
}

function ChartBody({ data }: { data: Partial<ChartCardData> }) {
  const chartType = data.chartType === 'bar' ? 'bar' : data.chartType === 'line' ? 'line' : null;
  const points = Array.isArray(data.points) ? data.points.filter((point) => point && typeof point.name === 'string' && Number.isFinite(Number(point.value))) : [];
  if (!chartType || points.length === 0) {
    return <p className="mt-2 border border-line px-2 py-1.5 text-[11px] text-ink-2">图表数据为空或格式错误</p>;
  }
  return (
    <div className="mt-1">
      {data.series ? <p className="mb-0.5 text-[10px] text-ink-2">系列：{data.series}</p> : null}
      <ChartView data={{ chartType, points: points.map((point) => ({ name: point.name, value: Number(point.value) })), series: data.series ?? null }} />
    </div>
  );
}

export function RichCard({
  cardId,
  names,
  meId,
  canManage,
  refreshKey,
}: {
  cardId: string;
  names: Record<string, string>;
  meId: string | null;
  canManage: boolean;
  refreshKey: number;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [result, setResult] = useState<VoteResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<Card>(`/cards/${cardId}`);
      setCard(next);
      if (next.kind === 'vote') {
        try {
          const vote = await api<VoteResult>(`/cards/${cardId}/results`);
          setResult(vote);
        } catch {
          setResult(null);
        }
      }
    } catch (caught) {
      setError(errorOf(caught));
    }
  }, [cardId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const toggleOption = (optionId: string) => {
    if (!result || result.closed) return;
    setSelected((previous) => {
      if (result.multi) return previous.includes(optionId) ? previous.filter((id) => id !== optionId) : [...previous, optionId];
      return [optionId];
    });
  };

  const castVote = async () => {
    if (!card || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const vote = await api<VoteResult>(`/cards/${card.id}/vote`, {
        method: 'POST',
        body: JSON.stringify({ optionIds: selected }),
      });
      setResult(vote);
      setSelected(vote.myOptionIds ?? selected);
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const setTaskStatus = async (status: TaskStatus) => {
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Card>(`/cards/${card.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ taskStatus: status }),
      });
      setCard(updated);
      useTasksStore.getState().updateFromCard(updated);
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  if (error && !card) {
    return (
      <div className="border border-line bg-panel px-3 py-2 text-[11px] text-ink-2">
        卡片读取失败（{error.code}）
      </div>
    );
  }

  if (!card) {
    return <div className="border border-line bg-panel px-3 py-2 text-[11px] text-ink-2">正在读取卡片…</div>;
  }

  const status = (card.taskStatus ?? 'todo') as TaskStatus;
  const canEditTask = canManage || card.createdBy === meId;
  const voteData = (card.data ?? {}) as { multi?: boolean; anonymous?: boolean; closesAt?: string | null };
  const counts = result?.counts ?? {};
  const max = Math.max(1, ...Object.values(counts));

  const moveCard = async (direction: -1 | 1) => {
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<unknown>(`/channels/${card.channelId}/cards?kind=${card.kind}&limit=100`);
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const cards = Array.isArray(record.cards) ? (record.cards as Card[]) : Array.isArray(record.items) ? (record.items as Card[]) : [];
      const index = cards.findIndex((item) => item.id === card.id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= cards.length) return;
      const reordered = [...cards];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      await api('/cards/reorder', {
        method: 'POST',
        body: JSON.stringify({ channelId: card.channelId, kind: card.kind, items: reordered.map((item, position) => ({ id: item.id, position })) }),
      });
      await load();
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const convertCard = async (kind: 'task' | 'idea') => {
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/cards/${card.id}/convert`, { method: 'POST', body: JSON.stringify({ kind }) });
      await load();
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="motion-card cut-corner-sm relative max-w-[30rem] border border-line bg-panel px-3 py-2.5">
      <div className="flex items-center gap-1.5 font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-2">
        {card.kind === 'vote' ? (
          <VoteIcon size={12} />
        ) : card.kind === 'task' ? (
          <TaskIcon size={12} />
        ) : card.kind === 'music' ? (
          <MusicIcon size={12} />
        ) : card.kind === 'chart' ? (
          <ChartIcon size={12} />
        ) : (
          <FileIcon size={12} />
        )}
        {KIND_LABEL[card.kind] ?? card.kind}
        {card.kind === 'task' ? <span className="ml-auto">{TASK_COLUMNS.find((column) => column.key === status)?.label}</span> : null}
      </div>

      <p className="mt-1 text-[14px] font-bold leading-snug text-ink">{card.title}</p>
      {card.body ? <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{card.body}</p> : null}

      {card.kind === 'vote' ? (
        <div className="mt-2">
          <div className="mb-1 flex items-center gap-2 text-[10px] text-ink-2">
            <span>{voteData.multi ? '多选' : '单选'}</span>
            {voteData.anonymous ? <span>· 匿名</span> : null}
            {voteData.closesAt ? <span>· 截止 {dayOf(voteData.closesAt)}</span> : null}
            {result ? <span className="ml-auto">共 {result.total} 票</span> : null}
          </div>
          <ul className="flex flex-col gap-1">
            {card.options.map((option) => {
              const count = counts[option.id] ?? 0;
              const picked = selected.includes(option.id);
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    disabled={Boolean(result?.closed)}
                    onClick={() => toggleOption(option.id)}
                    className={`relative flex w-full items-center gap-2 border px-2 py-1.5 text-left text-[12px] ${
                      picked ? 'border-ink bg-accent text-on-accent' : 'border-line bg-paper text-ink hover:border-ink'
                    }`}
                    aria-pressed={picked}
                  >
                    <span className="relative z-10 truncate">{option.label}</span>
                    <span className="relative z-10 ml-auto tabular-nums text-[10px] opacity-70">{count} 票</span>
                    <i
                      aria-hidden="true"
                      className="absolute bottom-0 left-0 top-0 -z-0 bg-chip"
                      style={{ width: `${Math.round((count / max) * 100)}%`, opacity: 0.55 }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] text-ink-2">
              {result?.closed ? '投票已截止' : result?.closesAt ? `截止 ${dayOf(result.closesAt)}` : '未设置截止'}
            </span>
            <button
              type="button"
              onClick={() => void castVote()}
              disabled={busy || selected.length === 0 || Boolean(result?.closed)}
              className="cut-corner-sm ml-auto bg-ink px-3 py-1 text-[11px] font-bold text-white disabled:bg-chip disabled:text-ink-2 disabled:opacity-100"
            >
              {result?.closed ? '已截止' : busy ? '提交中…' : '投票'}
            </button>
          </div>
        </div>
      ) : null}

      {card.kind === 'task' ? (
        <div className="mt-2">
          <p className="text-[10px] text-ink-2">
            指派：{card.assigneeIds.length > 0 ? card.assigneeIds.map((id) => names[id] ?? id.slice(0, 8)).join('、') : '未指派'}
            {card.dueAt ? ` · 截止 ${dayOf(card.dueAt)}` : ''}
          </p>
          {canEditTask ? (
            <div className="mt-1.5 flex items-center gap-1">
              {TASK_COLUMNS.map((column) => (
                <button
                  key={column.key}
                  type="button"
                  disabled={busy || status === column.key}
                  onClick={() => void setTaskStatus(column.key)}
                  className={`cut-corner-sm border px-2 py-1 text-[10px] font-semibold ${
                    status === column.key ? 'border-ink bg-accent text-on-accent' : 'border-line text-ink-2 hover:border-ink hover:text-ink'
                  }`}
                >
                  {column.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {card.kind === 'music' ? <MusicBody data={card.data as Partial<MusicCardData>} cardId={card.id} channelId={card.channelId} /> : null}
      {card.kind === 'chart' ? <ChartBody data={card.data as Partial<ChartCardData>} /> : null}

      {card.attachments.length > 0 ? (
        <div className="mt-2">
          <AttachmentList attachments={card.attachments} compact />
        </div>
      ) : null}

      {error ? <p className="mt-1 text-[10px] text-danger">{error.code}：{error.message}</p> : null}

      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line/70 pt-1.5">
        <button type="button" disabled={busy} className="border border-line px-1.5 py-0.5 text-[9px] text-ink-2 hover:border-ink" onClick={() => void moveCard(-1)}>↑ 上移</button>
        <button type="button" disabled={busy} className="border border-line px-1.5 py-0.5 text-[9px] text-ink-2 hover:border-ink" onClick={() => void moveCard(1)}>↓ 下移</button>
        <button type="button" disabled={busy} className="border border-line px-1.5 py-0.5 text-[9px] text-ink-2 hover:border-ink" onClick={() => void convertCard('task')}>转任务</button>
        <button type="button" disabled={busy} className="border border-line px-1.5 py-0.5 text-[9px] text-ink-2 hover:border-ink" onClick={() => void convertCard('idea')}>转灵感</button>
      </div>
    </div>
  );
}
