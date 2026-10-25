'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartCardData } from '@/lib/types';

export default function ChartView({ data }: { data: ChartCardData }) {
  const points = Array.isArray(data.points) ? data.points : [];
  if (points.length === 0) {
    return <p className="border border-line px-2 py-2 text-[11px] text-ink-2">图表没有数据</p>;
  }

  const common = (
    <>
      <CartesianGrid stroke="var(--ef-rule)" strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--ef-ink-2)' }} stroke="var(--ef-rule)" />
      <YAxis tick={{ fontSize: 9, fill: 'var(--ef-ink-2)' }} stroke="var(--ef-rule)" width={28} />
      <Tooltip
        contentStyle={{
          background: 'var(--ef-panel)',
          border: '1px solid var(--ef-ink)',
          borderRadius: 0,
          fontSize: 11,
          color: 'var(--ef-ink)',
        }}
      />
    </>
  );

  return (
    <div className="mt-2 h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        {data.chartType === 'bar' ? (
          <BarChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: -12 }}>
            {common}
            <Bar dataKey="value" fill="var(--ef-signal)" stroke="var(--ef-ink)" strokeWidth={1} />
          </BarChart>
        ) : (
          <LineChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            {common}
            <Line type="monotone" dataKey="value" stroke="var(--ef-ink)" strokeWidth={1.6} dot={{ r: 2, fill: 'var(--ef-signal)', stroke: 'var(--ef-ink)' }} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
