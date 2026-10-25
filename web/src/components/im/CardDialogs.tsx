'use client';

import { useState } from 'react';
import type { Member } from '@/lib/types';
import { parseMusicUrl } from '@/lib/music';
import { CloseIcon } from './icons';

function Overlay({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#161616]/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="cut-corner max-h-[86dvh] w-full max-w-lg overflow-y-auto border border-ink bg-panel">
        <div className="flex items-start justify-between border-b border-line px-4 py-3">
          <div>
            <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2">{eyebrow}</p>
            <h2 className="mt-0.5 text-[15px] font-extrabold text-ink">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-ink-2 hover:text-ink" aria-label="关闭">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

const field = 'w-full border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink';
const label = 'block font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-2';
const primary = 'cut-corner-sm bg-ink px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40';
const secondary = 'border border-line px-3 py-1.5 text-[11px] text-ink-2 hover:border-ink hover:text-ink';

export interface VoteDraft {
  title: string;
  options: string[];
  multi: boolean;
  anonymous: boolean;
  closesAt: string | null;
}

export function CreateVoteDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: VoteDraft) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [closesAt, setClosesAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const options = optionsText.split('\n').map((line) => line.trim()).filter(Boolean);

  if (!open) return null;

  const submit = async () => {
    if (!title.trim() || options.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        options: options.slice(0, 20),
        multi,
        anonymous,
        closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      });
      setTitle('');
      setOptionsText('');
      onClose();
    } catch (caught) {
      const info = caught as { code?: string; message?: string };
      setError({ code: info.code ?? 'ERROR', message: info.message ?? '创建失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay title="新建投票" eyebrow="Vote / 投票" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>标题</span>
          <input className={field} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="例如：下一阶段主题" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>选项（每行一个，至少 2 个）</span>
          <textarea className={`${field} min-h-[6rem] resize-y`} value={optionsText} onChange={(event) => setOptionsText(event.target.value)} placeholder={'雾海\n锈带\n静默轨道'} />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1.5 text-[12px] text-ink">
            <input type="checkbox" checked={multi} onChange={(event) => setMulti(event.target.checked)} /> 多选
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-ink">
            <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> 匿名
          </label>
          <label className="flex items-center gap-2 text-[12px] text-ink">
            截止
            <input type="datetime-local" className={field} value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
          </label>
        </div>
        {error ? <p className="border border-danger px-2 py-1 text-[11px] text-danger">{error.code}：{error.message}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondary} onClick={onClose}>取消</button>
          <button type="button" className={primary} disabled={busy || !title.trim() || options.length < 2} onClick={() => void submit()}>
            {busy ? '创建中…' : '创建投票'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

export function CreateTaskDialog({
  open,
  members,
  names,
  onClose,
  onCreate,
}: {
  open: boolean;
  members: Member[];
  names: Record<string, string>;
  onClose: () => void;
  onCreate: (draft: { title: string; assigneeIds: string[]; dueAt: string | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  if (!open) return null;

  const toggle = (id: string) => setAssigneeIds((previous) => (previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]));

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        assigneeIds,
        dueAt: dueDate ? new Date(`${dueDate}T23:59:59`).toISOString() : null,
      });
      setTitle('');
      setAssigneeIds([]);
      onClose();
    } catch (caught) {
      const info = caught as { code?: string; message?: string };
      setError({ code: info.code ?? 'ERROR', message: info.message ?? '创建失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay title="新建任务" eyebrow="Task / 任务" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>标题</span>
          <input className={field} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="例如：归档第三轮测绘素材" />
        </label>
        <div>
          <span className={label}>指派给</span>
          <ul className="mt-1 max-h-40 overflow-y-auto border border-line">
            {members.map((member) => (
              <li key={member.userId} className="border-b border-line last:border-b-0">
                <label className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-ink hover:bg-chip">
                  <input type="checkbox" checked={assigneeIds.includes(member.userId)} onChange={() => toggle(member.userId)} />
                  <span className="flex-1 truncate">{names[member.userId] ?? member.displayName ?? member.handle ?? member.userId.slice(0, 8)}</span>
                  <span className="font-mono text-[10px] text-ink-2">@{member.handle ?? '—'}</span>
                </label>
              </li>
            ))}
            {members.length === 0 ? <li className="px-2 py-2 text-[11px] text-ink-2">没有可指派的成员</li> : null}
          </ul>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-ink">
          截止日
          <input type="date" className={field} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        {error ? <p className="border border-danger px-2 py-1 text-[11px] text-danger">{error.code}：{error.message}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondary} onClick={onClose}>取消</button>
          <button type="button" className={primary} disabled={busy || !title.trim()} onClick={() => void submit()}>
            {busy ? '创建中…' : '创建任务'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

export interface MusicDraft {
  url: string;
  title: string;
  artist: string;
  coverUrl: string;
  provider: 'netease' | 'qq' | 'audio' | 'link';
  songId: string | null;
}

const PROVIDER_LABEL: Record<MusicDraft['provider'], string> = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  audio: '音频直链',
  link: '普通链接',
};

export function CreateMusicDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: MusicDraft) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const parsed = parseMusicUrl(url);

  if (!open) return null;

  const submit = async () => {
    if (!title.trim() || !parsed) {
      setError({ code: 'VALIDATION_FAILED', message: '需要有效 URL 与标题' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        url: parsed.url,
        title: title.trim(),
        artist: artist.trim(),
        coverUrl: coverUrl.trim(),
        provider: parsed.provider ?? 'link',
        songId: parsed.songId ?? null,
      });
      setUrl('');
      setTitle('');
      setArtist('');
      setCoverUrl('');
      onClose();
    } catch (caught) {
      setError({ code: 'CREATE_FAILED', message: caught instanceof Error ? caught.message : '创建失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay title="音乐卡片" eyebrow="Music / 音乐" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className={label}>链接（网易云 / QQ 音乐 / mp3 直链）</span>
          <input className={field} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://music.163.com/#/song?id=..." />
          <span className="text-[10px] text-ink-2">
            {url ? (parsed ? `识别为：${PROVIDER_LABEL[parsed.provider ?? 'link']}` : '无法识别的 URL') : '支持网易云、QQ 音乐、mp3/wav/ogg/m4a 直链'}
          </span>
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={label}>标题</span>
            <input className={field} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>艺人</span>
            <input className={field} value={artist} maxLength={80} onChange={(event) => setArtist(event.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={label}>封面 URL（可选）</span>
          <input className={field} value={coverUrl} onChange={(event) => setCoverUrl(event.target.value)} placeholder="https://..." />
        </label>
        {error ? <p className="border border-danger px-2 py-1 text-[11px] text-danger">{error.code}：{error.message}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondary} onClick={onClose}>取消</button>
          <button type="button" className={primary} disabled={busy || !title.trim() || !parsed} onClick={() => void submit()}>
            {busy ? '创建中…' : '创建音乐卡'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

export interface ChartDraft {
  chartType: 'line' | 'bar';
  points: Array<{ name: string; value: number }>;
  series: string;
}

export function CreateChartDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: ChartDraft) => Promise<void>;
}) {
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');
  const [json, setJson] = useState('[{"name":"周一","value":12},{"name":"周二","value":18}]');
  const [series, setSeries] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  if (!open) return null;

  const parsePoints = (): Array<{ name: string; value: number }> | null => {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (!Array.isArray(parsed)) return null;
      const points = parsed
        .map((item) => {
          const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
          if (!record) return null;
          const name = String(record.name ?? '').trim();
          const value = Number(record.value);
          return name && Number.isFinite(value) ? { name, value } : null;
        })
        .filter((point): point is { name: string; value: number } => Boolean(point));
      return points.length >= 2 ? points : null;
    } catch {
      return null;
    }
  };

  const points = parsePoints();

  const submit = async () => {
    if (!points) {
      setError({ code: 'INVALID_JSON', message: '数据需要 ≥2 项 [{name,value}]' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate({ chartType, points, series: series.trim() });
      onClose();
    } catch (caught) {
      setError({ code: 'CREATE_FAILED', message: caught instanceof Error ? caught.message : '创建失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay title="图表卡片" eyebrow="Chart / 图表" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={label}>类型</span>
          {(['line', 'bar'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setChartType(type)}
              className={`border px-2 py-1 text-[11px] ${chartType === type ? 'border-ink bg-accent font-bold text-on-accent' : 'border-line text-ink-2'}`}
            >
              {type === 'line' ? '折线' : '柱状'}
            </button>
          ))}
          <input className={`${field} ml-auto max-w-[10rem]`} value={series} onChange={(event) => setSeries(event.target.value)} placeholder="系列名（可选）" />
        </div>
        <label className="flex flex-col gap-1">
          <span className={label}>JSON 数据 [{`{name,value}`}]</span>
          <textarea
            className={`${field} min-h-[8rem] font-mono text-[12px]`}
            value={json}
            aria-label="图表 JSON 数据"
            onChange={(event) => setJson(event.target.value)}
          />
          <span className="text-[10px] text-ink-2">{points ? `有效 ${points.length} 个点` : '示例：[{"name":"周一","value":12}]'}</span>
        </label>
        {error ? <p className="border border-danger px-2 py-1 text-[11px] text-danger">{error.code}：{error.message}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondary} onClick={onClose}>取消</button>
          <button type="button" className={primary} disabled={busy || !points} onClick={() => void submit()}>
            {busy ? '创建中…' : '创建图表卡'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
