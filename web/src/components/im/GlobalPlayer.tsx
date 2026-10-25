'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorOf } from '@/lib/api';
import type { Card, MusicCardData } from '@/lib/types';
import { asArray } from '@/lib/normalize';
import { usePlayerStore, type PlayerTrack } from '@/store/player';
import { MusicIcon, PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from './icons';

function trackOf(card: Card): PlayerTrack | null {
  const data = (card.data ?? {}) as Partial<MusicCardData>;
  const provider = data.provider ?? 'link';
  const songId = typeof data.songId === 'string' ? data.songId : null;
  const src =
    provider === 'audio'
      ? typeof data.url === 'string'
        ? data.url
        : null
      : provider === 'netease' && songId
        ? `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(songId)}.mp3`
        : null;
  if (!src) return null;
  return {
    id: card.id,
    title: data.title ?? card.title,
    artist: data.artist,
    src,
    coverUrl: data.coverUrl ?? null,
    channelId: card.channelId,
  };
}

export function GlobalPlayer({ channelId }: { channelId: string | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { queue, currentId, playing, volume, currentTime, duration, setQueue, toggle, next, prev, setVolume, setProgress } =
    usePlayerStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = useMemo(() => queue.find((track) => track.id === currentId) ?? null, [queue, currentId]);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api<unknown>(`/channels/${channelId}/cards?kind=music&limit=50`);
        if (cancelled) return;
        const cards = asArray<Card>(data, ['cards', 'items']);
        setQueue(cards.map(trackOf).filter((track): track is PlayerTrack => Boolean(track)));
      } catch {
        /* 音乐列表接口失败不阻塞聊天 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId, setQueue]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (!playing) {
      audio.pause();
      return;
    }
    setLoading(true);
    setError(null);
    if (audio.src !== current.src) {
      audio.src = current.src;
      audio.load();
    }
    void audio.play().catch(() => {
      setError('播放被浏览器拦截或音频不可用');
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, playing]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  if (queue.length === 0) {
    return (
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line bg-panel px-3 text-[10px] text-ink-2 md:px-4">
        <MusicIcon size={13} /> 常驻播放器 · 队列为空（从音乐卡加入队列）
        <audio ref={audioRef} preload="none" className="hidden" />
      </div>
    );
  }

  const percent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-t border-ink bg-chrome px-2 text-chrome-fg md:px-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center border border-chrome-fg/25 text-accent">
        <MusicIcon size={15} />
      </div>
      <div className="min-w-0 w-32 shrink-0 md:w-44">
        <p className="truncate text-[11px] font-semibold text-white">{current?.title ?? '未选择音乐'}</p>
        <p className="truncate text-[9px] text-chrome-fg/60">{current?.artist ?? `${queue.length} 首队列`}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={prev} className="p-1 text-chrome-fg/75 hover:text-accent" aria-label="上一首">
          <SkipBackIcon size={14} />
        </button>
        <button
          type="button"
          onClick={toggle}
          className="grid h-8 w-8 place-items-center border border-chrome-fg/30 text-accent hover:border-accent"
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
        </button>
        <button type="button" onClick={next} className="p-1 text-chrome-fg/75 hover:text-accent" aria-label="下一首">
          <SkipForwardIcon size={14} />
        </button>
      </div>
      <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
        <span className="w-8 text-right font-mono text-[9px] tabular-nums text-chrome-fg/60">
          {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={currentTime}
          aria-label="播放进度"
          onChange={(event) => {
            const value = Number(event.target.value);
            if (audioRef.current) audioRef.current.currentTime = value;
            setProgress(value, duration);
          }}
          className="h-1 flex-1 accent-[var(--ef-signal)]"
          style={{ background: `linear-gradient(to right, var(--ef-signal) ${percent}%, #555 ${percent}%)` }}
        />
        <span className="w-8 font-mono text-[9px] tabular-nums text-chrome-fg/60">
          {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}
        </span>
      </div>
      <span className="hidden text-[9px] text-chrome-fg/50 lg:inline">{loading ? '加载中…' : error ?? `${queue.length} 首`}</span>
      <label className="hidden shrink-0 items-center gap-1 text-[9px] text-chrome-fg/60 sm:flex">
        音量
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="音量"
          onChange={(event) => setVolume(Number(event.target.value))}
          className="h-1 w-16 accent-[var(--ef-signal)]"
        />
      </label>
      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        onLoadedMetadata={(event) => setProgress(0, event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime, event.currentTarget.duration || 0)}
        onCanPlay={() => setLoading(false)}
        onEnded={next}
        onError={() => {
          setError('音频加载失败');
          setLoading(false);
        }}
      />
    </div>
  );
}
