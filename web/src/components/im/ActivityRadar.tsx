'use client';

import { useEffect, useState } from 'react';
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import { api, errorOf } from '@/lib/api';
import type { ActivityMetrics } from '@/lib/types';

const LABELS: Array<{ key: keyof ActivityMetrics; label: string }> = [
  { key: 'messages', label: '消息' },
  { key: 'active', label: '活跃' },
  { key: 'tasks', label: '任务' },
  { key: 'votes', label: '投票' },
  { key: 'materials', label: '素材' },
];

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalize(data: unknown): ActivityMetrics {
  const root = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const raw = root.metrics ?? root;
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({ key, value }))
      : [];
  const map = new Map<string, unknown>();
  for (const item of list) {
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      if (typeof record.key === 'string') map.set(record.key, record.value);
    }
  }
  return {
    messages: number(map.get('messages')),
    active: number(map.get('active') ?? map.get('activeUsers') ?? root.active ?? root.activeUsers),
    tasks: number(map.get('tasks') ?? map.get('tasksDone') ?? root.tasks ?? root.tasksDone),
    votes: number(map.get('votes') ?? map.get('voteBallots') ?? root.votes ?? root.voteBallots),
    materials: number(map.get('materials') ?? map.get('files') ?? root.materials ?? root.files),
  };
}

export function ActivityRadar() {
  const [metrics, setMetrics] = useState<ActivityMetrics | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<unknown>('/stats/activity')
      .then((data) => {
        if (!cancelled) setMetrics(normalize(data));
      })
      .catch((caught) => {
        if (!cancelled) setError(errorOf(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="px-2 py-1 text-[10px] text-ink-2">统计接口未就绪（{error.code}）</p>;
  }
  if (!metrics) {
    return <p className="px-2 py-1 text-[10px] text-ink-2">读取态势…</p>;
  }

  const data = LABELS.map((item) => ({ subject: item.label, value: metrics[item.key], fullMark: Math.max(1, ...Object.values(metrics)) }));
  const max = Math.max(1, ...Object.values(metrics));

  return (
    <div>
      <div className="relative h-[150px] w-full">
        <div className="motion-radar-ticks" aria-hidden="true" />
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="70%">
            <PolarGrid stroke="var(--ef-rule)" />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: 'var(--ef-ink-2)' }} />
            <Radar dataKey="value" stroke="var(--ef-ink)" fill="var(--ef-signal)" fillOpacity={0.55} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-5 gap-1 px-2 text-center">
        {LABELS.map((item) => (
          <span key={item.key} className="font-mono text-[9px] text-ink-2">
            {item.label}
            <strong className="block text-[10px] text-ink">{metrics[item.key]}/{max}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
