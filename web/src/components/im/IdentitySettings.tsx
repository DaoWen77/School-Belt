'use client';

import { useEffect, useState } from 'react';
import { api, errorOf } from '@/lib/api';
import { IdentityBadges } from '@/components/im/IdentityBadges';

interface OrgOption {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  prefix: string;
  isDefault: boolean;
  isSelected: boolean;
}

interface OrgOptionsResponse {
  selectedOrganizationId: string | null;
  effectiveOrganizationId: string | null;
  options: OrgOption[];
}

const ROLE_LABEL: Record<OrgOption['role'], string> = {
  owner: '组织 Owner',
  admin: '管理员',
  member: '成员',
};

/**
 * 多组织身份切换：只改 users.display_organization_id。
 * 证章仍由服务端 IdentityService 计算，前端不拼前缀。
 */
export function IdentitySettings() {
  const [data, setData] = useState<OrgOptionsResponse | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    api<OrgOptionsResponse>('/me/organizations')
      .then((result) => {
        setData(result);
        setValue(result.selectedOrganizationId ?? '');
      })
      .catch((caught) => setError(errorOf(caught)));
  }, []);

  const current = data?.options.find((option) => option.id === data.effectiveOrganizationId) ?? null;

  const save = async (next: string) => {
    setBusy(true);
    setError(null);
    try {
      await api('/me/display-organization', {
        method: 'PATCH',
        body: JSON.stringify({ organizationId: next || null }),
      });
      setValue(next);
      // 证章会广播到消息、侧边栏、成员目录；整页重载是最可靠的同步点。
      window.location.reload();
    } catch (caught) {
      setError(errorOf(caught));
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2">Identity / 当前展示身份</p>
        <span className="ml-auto font-mono text-[9px] text-ink-2">MULTI-ORG</span>
      </div>
      <p className="mb-2 text-[10px] leading-relaxed text-ink-2">
        可同时加入多个组织；默认按「全站 Owner → 组织 Owner → 组织管理员 → 成员」展示，也可手动指定。组织证章由服务端计算。
      </p>

      {error ? (
        <p className="mb-2 flex items-center gap-2 border border-line px-2 py-1.5 text-[11px] text-ink" role="alert">
          <span className="bg-accent px-1 font-mono text-[9px] font-bold uppercase text-on-accent">{error.code}</span>
          {error.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1">
          <IdentityBadges values={current ? [current.prefix] : []} scan />
          {!current ? <span className="text-[10px] text-ink-2">暂无组织身份</span> : null}
        </span>
        <select
          value={value}
          disabled={busy || !data}
          onChange={(event) => void save(event.target.value)}
          className="ml-auto min-w-[14rem] border border-line bg-paper px-2 py-1.5 text-[11px] text-ink outline-none focus:border-ink"
          aria-label="当前展示身份"
        >
          <option value="">自动（权重最高）</option>
          {data?.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.prefix} · {ROLE_LABEL[option.role]}{option.isDefault ? ' · 默认' : ''}
            </option>
          ))}
        </select>
        {busy ? <span className="font-mono text-[9px] text-ink-2">SYNCING…</span> : null}
      </div>

      {data && data.options.length === 0 ? (
        <p className="mt-2 text-[10px] text-ink-2">还没有已加入的组织。加入组织后这里会出现可切换的身份。</p>
      ) : null}
    </div>
  );
}
