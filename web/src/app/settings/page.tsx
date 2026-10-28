'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { API_BASE, WS_PATH, api, errorOf } from '@/lib/api';
import { session } from '@/lib/session';
import type { ApiUser, BotConfig, Channel } from '@/lib/types';
import { Avatar } from '@/components/im/Avatar';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { OrgSettings } from '@/components/OrgSettings';
import { RssSettings } from '@/components/RssSettings';
import { IdentitySettings } from '@/components/im/IdentitySettings';
import { ServerSettings } from '@/components/ServerSettings';
import { Phase3Settings } from '@/components/Phase3Settings';
import { precheckFile, uploadFile } from '@/lib/upload';
import { askConfirm } from '@/lib/confirm';
import { invalidateFileUrl } from '@/lib/fileUrl';

interface PageError {
  code: string;
  message: string;
}

interface InviteView {
  id: string;
  codePrefix: string;
  role: string;
  maxUses: number;
  uses: number;
  expiresAt: string;
  status: 'active' | 'exhausted' | 'expired' | 'revoked';
}

/** PATCH /me 在契约里返回裸 PublicUser；兼容旧实现返回 { user } */
function nextUser(value: ApiUser | { user: ApiUser }): ApiUser {
  return 'user' in value && value.user ? value.user : (value as ApiUser);
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [error, setError] = useState<PageError | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [statusPrefix, setStatusPrefix] = useState('');
  const [avatarFileId, setAvatarFileId] = useState<string | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [scopeChannelId, setScopeChannelId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<PageError | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const [aiBase, setAiBase] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiHasKey, setAiHasKey] = useState(false);
  const [aiMasked, setAiMasked] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiError, setAiError] = useState<PageError | null>(null);
  const [aiSaved, setAiSaved] = useState(false);
  const [aiTest, setAiTest] = useState<{ ok: boolean; latencyMs?: number; message?: string } | null>(null);
  const [invites, setInvites] = useState<InviteView[]>([]);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<PageError | null>(null);
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  const [inviteDays, setInviteDays] = useState(7);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteCreating, setInviteCreating] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [botsLoading, setBotsLoading] = useState(false);
  const [botsError, setBotsError] = useState<PageError | null>(null);
  const [botForm, setBotForm] = useState<{ id: string | null; name: string; model: string; avatarFileId: string | null; systemPrompt: string; apiKey: string; enabled: boolean }>({
    id: null,
    name: '',
    model: '',
    avatarFileId: null,
    systemPrompt: '',
    apiKey: '',
    enabled: true,
  });
  const [botBusy, setBotBusy] = useState(false);
  const [botTest, setBotTest] = useState<string | null>(null);
  const isAiAdmin = user?.globalRole === 'owner' || user?.globalRole === 'admin';
  const isBotOwner = user?.globalRole === 'owner';
  const [settingsTab, setSettingsTab] = useState<'profile' | 'security' | 'notification' | 'devices' | 'rss' | 'org' | 'manage'>('profile');

  useEffect(() => {
    if (!session.hasTokens()) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    Promise.all([api<{ user: ApiUser }>('/me'), api<unknown>('/channels').catch(() => null)])
      .then(([me, channels]) => {
        if (cancelled) return;
        setUser(me.user);
        setDisplayName(me.user.displayName);
        setStatusPrefix(me.user.statusPrefix ?? '');
        setAvatarFileId(me.user.avatarFileId ?? null);
        const list = (channels as { channels?: Channel[] } | null)?.channels ?? [];
        const scope = list.find((channel) => channel.joined !== false) ?? list[0] ?? null;
        setScopeChannelId(scope?.id ?? null);
      })
      .catch((caught) => {
        if (cancelled) return;
        const info = errorOf(caught);
        if (info.status === 401) {
          session.clear();
          router.replace('/login');
          return;
        }
        setError(info);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const loadAiConfig = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const data = await api<unknown>('/ai/config');
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const config = (record.config && typeof record.config === 'object' ? record.config : record) as Record<string, unknown>;
      setAiBase(typeof config.baseUrl === 'string' ? config.baseUrl : typeof config.apiBase === 'string' ? config.apiBase : '');
      setAiModel(typeof config.model === 'string' ? config.model : '');
      setAiHasKey(Boolean(config.configured ?? config.hasApiKey ?? config.keyMasked ?? config.apiKeyMasked));
      setAiMasked(
        typeof config.keyMasked === 'string'
          ? config.keyMasked
          : typeof config.apiKeyMasked === 'string'
            ? config.apiKeyMasked
            : null,
      );
    } catch (caught) {
      setAiError(errorOf(caught));
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (!isAiAdmin) return;
    void loadAiConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAiAdmin]);

  const saveAiConfig = async () => {
    if (aiSaving) return;
    setAiSaving(true);
    setAiError(null);
    setAiSaved(false);
    try {
      await api('/ai/config', {
        method: 'PUT',
        body: JSON.stringify({
          baseUrl: aiBase.trim(),
          model: aiModel.trim(),
          ...(aiKey.trim() ? { apiKey: aiKey.trim() } : {}),
        }),
      });
      setAiKey('');
      await loadAiConfig();
      setAiSaved(true);
    } catch (caught) {
      setAiError(errorOf(caught));
    } finally {
      setAiSaving(false);
    }
  };

  const testAi = async () => {
    if (aiTesting) return;
    setAiTesting(true);
    setAiTest(null);
    try {
      const data = await api<unknown>('/ai/test', { method: 'POST', body: JSON.stringify({}) });
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      setAiTest({
        ok: Boolean(record.ok ?? true),
        latencyMs: typeof record.latencyMs === 'number' ? record.latencyMs : undefined,
        message: typeof record.error === 'string' ? record.error : typeof record.message === 'string' ? record.message : undefined,
      });
    } catch (caught) {
      setAiTest({ ok: false, message: `${errorOf(caught).code}：${errorOf(caught).message}` });
    } finally {
      setAiTesting(false);
    }
  };

  const loadInvites = async () => {
    setInviteLoading(true);
    setInviteError(null);
    try {
      const data = await api<unknown>('/invites');
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const list = Array.isArray(record.invites) ? record.invites : Array.isArray(data) ? data : [];
      setInvites(list as InviteView[]);
    } catch (caught) {
      setInviteError(errorOf(caught));
    } finally {
      setInviteLoading(false);
    }
  };

  useEffect(() => {
    if (isAiAdmin) void loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAiAdmin]);

  const createInvite = async () => {
    setInviteCreating(true);
    setInviteError(null);
    setInviteCode(null);
    try {
      const data = await api<unknown>('/invites', {
        method: 'POST',
        body: JSON.stringify({ role: inviteRole, maxUses: inviteMaxUses, expiresInDays: inviteDays }),
      });
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const code = typeof record.code === 'string' ? record.code : null;
      setInviteCode(code);
      await loadInvites();
    } catch (caught) {
      setInviteError(errorOf(caught));
    } finally {
      setInviteCreating(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1200);
    } catch {
      setInviteCopied(false);
    }
  };

  const revokeInvite = async (invite: InviteView) => {
    if (
      !(await askConfirm(`撤销邀请 ${invite.codePrefix}…？已注册用户不受影响。`, {
        title: '撤销邀请',
        confirmText: '撤销邀请',
      }))
    )
      return;
    setRevokingId(invite.id);
    setInviteError(null);
    try {
      await api(`/invites/${invite.id}`, { method: 'DELETE' });
      await loadInvites();
    } catch (caught) {
      setInviteError(errorOf(caught));
    } finally {
      setRevokingId(null);
    }
  };

  const botAvatarInput = useRef<HTMLInputElement | null>(null);

  const loadBots = async () => {
    setBotsLoading(true);
    setBotsError(null);
    try {
      const data = await api<unknown>('/bots');
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const list = Array.isArray(record.bots) ? record.bots : Array.isArray(data) ? data : [];
      setBots(list as BotConfig[]);
    } catch (caught) {
      setBotsError(errorOf(caught));
    } finally {
      setBotsLoading(false);
    }
  };

  useEffect(() => {
    if (isBotOwner) void loadBots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBotOwner]);

  const editBot = (bot: BotConfig | null) => {
    setBotTest(null);
    setBotForm(
      bot
        ? {
            id: bot.id,
            name: bot.name ?? bot.displayName ?? '',
            model: bot.model ?? '',
            avatarFileId: bot.avatarFileId ?? null,
            systemPrompt: bot.systemPrompt ?? '',
            apiKey: '',
            enabled: bot.enabled !== false,
          }
        : { id: null, name: '', model: '', avatarFileId: null, systemPrompt: '', apiKey: '', enabled: true },
    );
  };

  const uploadBotAvatar = async (file: File) => {
    if (!scopeChannelId) {
      setBotsError({ code: 'NO_CHANNEL', message: '没有可用的上传频道' });
      return;
    }
    const precheck = precheckFile(file);
    if (!precheck.ok || precheck.kind !== 'image') {
      setBotsError({ code: 'FILE_TYPE_NOT_ALLOWED', message: 'Bot 头像必须是图片' });
      return;
    }
    setBotBusy(true);
    setBotsError(null);
    try {
      const view = await uploadFile(scopeChannelId, file);
      setBotForm((previous) => ({ ...previous, avatarFileId: view.id }));
    } catch (caught) {
      setBotsError(errorOf(caught));
    } finally {
      setBotBusy(false);
    }
  };

  const saveBot = async () => {
    if (!botForm.name.trim()) {
      setBotsError({ code: 'VALIDATION_FAILED', message: 'Bot 名称不能为空' });
      return;
    }
    setBotBusy(true);
    setBotsError(null);
    try {
      const payload = {
        name: botForm.name.trim(),
        model: botForm.model.trim() || null,
        avatarFileId: botForm.avatarFileId,
        systemPrompt: botForm.systemPrompt,
        enabled: botForm.enabled,
        ...(botForm.apiKey.trim() ? { apiKey: botForm.apiKey.trim() } : {}),
      };
      if (botForm.id) await api(`/bots/${botForm.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/bots', { method: 'POST', body: JSON.stringify(payload) });
      editBot(null);
      await loadBots();
    } catch (caught) {
      setBotsError(errorOf(caught));
    } finally {
      setBotBusy(false);
    }
  };

  const removeBot = async (bot: BotConfig) => {
    if (
      !(await askConfirm(`删除 Bot「${bot.name}」？该操作不可撤销。`, {
        title: '删除 Bot',
        confirmText: '删除 Bot',
        danger: true,
      }))
    )
      return;
    setBotBusy(true);
    setBotsError(null);
    try {
      await api(`/bots/${bot.id}`, { method: 'DELETE' });
      if (botForm.id === bot.id) editBot(null);
      await loadBots();
    } catch (caught) {
      setBotsError(errorOf(caught));
    } finally {
      setBotBusy(false);
    }
  };

  const testBot = async (bot: BotConfig) => {
    setBotBusy(true);
    setBotTest(null);
    setBotsError(null);
    try {
      const data = await api<unknown>(`/bots/${bot.id}/test`, { method: 'POST', body: JSON.stringify({}) });
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      setBotTest(record.ok === false ? `失败：${record.error ?? '未知错误'}` : `连通成功${typeof record.latencyMs === 'number' ? ` · ${record.latencyMs}ms` : ''}`);
    } catch (caught) {
      const info = errorOf(caught);
      setBotTest(`失败：${info.code}：${info.message}`);
    } finally {
      setBotBusy(false);
    }
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      /* 本地一定清空 */
    }
    session.clear();
    router.replace('/login');
  };

  const saveProfile = async () => {
    if (!user || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveState('idle');
    try {
      const updated = nextUser(
        await api<ApiUser | { user: ApiUser }>('/me', {
          method: 'PATCH',
          body: JSON.stringify({
            displayName: displayName.trim(),
            statusPrefix: statusPrefix.trim() ? statusPrefix.trim() : null,
          }),
        }),
      );
      setUser(updated);
      setDisplayName(updated.displayName);
      setStatusPrefix(updated.statusPrefix ?? '');
      if (updated.avatarFileId) {
        invalidateFileUrl(updated.avatarFileId);
        setAvatarVersion((version) => version + 1);
      }
      setSaveState('saved');
    } catch (caught) {
      setSaveError(errorOf(caught));
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (uploading) return;
    if (!scopeChannelId) {
      setSaveError({ code: 'NO_CHANNEL', message: '没有可用于上传头像的频道（需要先加入一个频道）' });
      return;
    }
    const precheck = precheckFile(file);
    if (!precheck.ok || precheck.kind !== 'image') {
      setSaveError({ code: 'FILE_TYPE_NOT_ALLOWED', message: '头像必须是图片文件' });
      return;
    }
    setUploading(true);
    setUploadPercent(0);
    setSaveError(null);
    try {
      const view = await uploadFile(scopeChannelId, file, (progress) => setUploadPercent(progress.percent));
      const updated = nextUser(
        await api<ApiUser | { user: ApiUser }>('/me', {
          method: 'PATCH',
          body: JSON.stringify({ avatarFileId: view.id }),
        }),
      );
      setUser(updated);
      invalidateFileUrl(view.id);
      setAvatarFileId(updated.avatarFileId ?? view.id);
      setAvatarVersion((version) => version + 1);
      setSaveState('saved');
    } catch (caught) {
      setSaveError(errorOf(caught));
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = async () => {
    if (!user) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = nextUser(
        await api<ApiUser | { user: ApiUser }>('/me', {
          method: 'PATCH',
          body: JSON.stringify({ avatarFileId: null }),
        }),
      );
      setUser(updated);
      if (user.avatarFileId) invalidateFileUrl(user.avatarFileId);
      setAvatarFileId(updated.avatarFileId ?? null);
      setAvatarVersion((version) => version + 1);
    } catch (caught) {
      setSaveError(errorOf(caught));
    } finally {
      setSaving(false);
    }
  };

  const panel = 'cut-corner-sm border border-line bg-panel p-4';
  const heading = 'mb-2 font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2';
  const row = 'flex items-baseline justify-between gap-3 border-b border-line/70 py-1.5 text-[12px] last:border-b-0';
  const field = 'w-full border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink';
  const label = 'block font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-2';

  return (
    <div className="h-dvh overflow-y-auto overscroll-contain bg-paper text-ink">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-chrome px-4 text-chrome-fg">
        <Link href="/" className="border border-chrome-fg/25 px-2 py-1 text-[11px] font-semibold text-chrome-fg/85 hover:border-accent hover:text-accent">
          ← 返回频道
        </Link>
        <h1 className="ml-1 font-sans text-[15px] font-extrabold text-white">设置</h1>
        <span className="font-sans text-[9px] uppercase tracking-[0.16em] text-chrome-fg/50">Settings</span>
        <button type="button" onClick={() => void logout()} className="ml-auto border border-chrome-fg/25 px-2 py-1 text-[11px] font-semibold text-chrome-fg/85 hover:border-accent hover:text-accent">
          退出登录
        </button>
      </header>

      <main className="motion-settings-in mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5">
        {error ? (
          <p className="flex items-center gap-2 border border-line bg-panel px-3 py-2 text-[12px] text-ink">
            <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase text-on-accent">{error.code}</span>
            {error.message}
          </p>
        ) : null}

        <nav className="flex flex-wrap gap-1 border border-line bg-panel p-1" aria-label="设置分区">
          {([
            ['profile', '资料'],
            ['security', '安全'],
            ['notification', '通知'],
            ['devices', '设备'],
            ['rss', '新闻塔'],
            ['org', '组织'],
            ['manage', '管理'],
          ] as const).map(([id, text]) => (
            <button
              key={id}
              type="button"
              aria-pressed={settingsTab === id}
              onClick={() => {
                setSettingsTab(id);
                document.getElementById(`tab-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`motion-tab px-2.5 py-1 text-[11px] font-semibold ${settingsTab === id ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'}`}
            >
              {text}
            </button>
          ))}
        </nav>

        <section id="tab-profile" className={panel}>
          <p className={heading}>Profile / 个人资料</p>
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-col items-center gap-1.5">
              <Avatar key={avatarVersion} name={displayName || user?.displayName || '成'} fileId={avatarFileId} size={72} />
              <button
                type="button"
                className="cut-corner-sm border border-line px-2 py-1 text-[10px] text-ink-2 hover:border-ink hover:text-ink disabled:opacity-40"
                disabled={uploading}
                onClick={() => avatarInput.current?.click()}
              >
                {uploading ? `上传 ${uploadPercent}%` : '更换头像'}
              </button>
              {avatarFileId ? (
                <button type="button" className="text-[10px] text-danger" onClick={() => void removeAvatar()}>
                  移除头像
                </button>
              ) : null}
              <input
                ref={avatarInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void uploadAvatar(file);
                }}
              />
            </div>

            <div className="flex min-w-[16rem] flex-1 flex-col gap-2.5">
              <label className="flex flex-col gap-1">
                <span className={label}>显示名</span>
                <input className={field} value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>状态前缀（≤24）</span>
                <input
                  className={field}
                  value={statusPrefix}
                  maxLength={24}
                  onChange={(event) => setStatusPrefix(event.target.value)}
                  placeholder="例如：战术规划中"
                />
                <span className="text-[10px] text-ink-2">显示为 [战术规划中] {displayName || '你的名字'}；留空则隐藏。</span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={saving || !displayName.trim()}
                  className="cut-corner-sm bg-ink px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
                  onClick={() => void saveProfile()}
                >
                  {saving ? '保存中…' : '保存资料'}
                </button>
                {saveState === 'saved' ? <span className="text-[10px] font-semibold text-ink-2">已保存</span> : null}
                <span className="text-[10px] text-ink-2">头像上传 scope：{scopeChannelId ? '首个已加入频道' : '无可用频道'}</span>
              </div>
              {saveError ? (
                <p className="flex items-center gap-2 border border-line px-2 py-1.5 text-[11px] text-ink">
                  <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase text-on-accent">{saveError.code}</span>
                  {saveError.message}
                </p>
              ) : null}
            </div>
          </div>
          <div className={`${row} mt-3`}>
            <span className="text-ink-2">handle</span>
            <span className="font-mono">@{user?.handle ?? '—'}</span>
          </div>
          <div className={row}>
            <span className="text-ink-2">用户 id</span>
            <span className="break-all font-mono text-[10px]">{user?.id ?? '—'}</span>
          </div>
          <div className={row}>
            <span className="text-ink-2">全局角色</span>
            <span>{user?.globalRole ?? '—'}</span>
          </div>
          <div className={row}>
            <span className="text-ink-2">身份证章</span>
            <span className="flex flex-wrap justify-end gap-1">
              <IdentityBadges values={user?.prefixes ?? []} scan />
              {user?.prefixes?.length ? null : <span className="text-ink-2">无</span>}
            </span>
          </div>
          <IdentitySettings />
          <p className="mt-2 text-[10px] leading-relaxed text-ink-2">
            状态前缀与头像由服务端 `PATCH /me` 持久化（task-19 字段）；头像先上传到首个已加入频道，再把 `avatarFileId` 写入资料。
          </p>
        </section>

        <Phase3Settings me={user} isAdmin={isAiAdmin} />

        <RssSettings isOwner={isAiAdmin} />

        <OrgSettings me={user} />

        {isAiAdmin ? (
          <section className={panel}>
            <div className="mb-2 flex items-baseline justify-between">
              <p className={heading}>AI / 智能体配置</p>
              <span className="border border-line px-1 font-sans text-[9px] uppercase tracking-[0.1em] text-ink-2">Owner / Admin</span>
            </div>
            {aiLoading ? <p className="text-[11px] text-ink-2">读取 AI 配置…</p> : null}
            {aiError ? (
              <p className="mb-2 flex items-center gap-2 border border-line px-2 py-1.5 text-[11px] text-ink">
                <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase text-on-accent">{aiError.code}</span>
                {aiError.message}
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className={label}>API Base</span>
                <input
                  className={field}
                  value={aiBase}
                  onChange={(event) => setAiBase(event.target.value)}
                  placeholder="http://127.0.0.1:4010/v1"
                  aria-label="AI API Base"
                  autoComplete="off"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>模型</span>
                <input
                  className={field}
                  value={aiModel}
                  onChange={(event) => setAiModel(event.target.value)}
                  placeholder="mock-model"
                  aria-label="AI 模型"
                  autoComplete="off"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>API Key</span>
                <input
                  className={field}
                  type="password"
                  value={aiKey}
                  onChange={(event) => setAiKey(event.target.value)}
                  placeholder={aiHasKey ? '已配置（留空不修改）' : '未配置'}
                  aria-label="AI API Key"
                  autoComplete="new-password"
                />
              </label>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-2">
              {aiHasKey ? `服务端已保存 Key：${aiMasked ?? '已配置'}；前端永远不读取明文，留空表示不修改。` : '尚未配置 Key；保存时只提交新 Key，读取接口只返回 masked。'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={aiSaving || !aiBase.trim() || !aiModel.trim()}
                className="cut-corner-sm bg-ink px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
                onClick={() => void saveAiConfig()}
              >
                {aiSaving ? '保存中…' : '保存 AI 配置'}
              </button>
              <button
                type="button"
                disabled={aiTesting}
                className="cut-corner-sm border border-line px-3 py-1.5 text-[11px] text-ink-2 hover:border-ink hover:text-ink disabled:opacity-40"
                onClick={() => void testAi()}
              >
                {aiTesting ? '测试中…' : '测试连通性'}
              </button>
              {aiSaved ? <span className="text-[10px] font-semibold text-ink-2">已保存</span> : null}
              {aiTest ? (
                <span className={`text-[10px] ${aiTest.ok ? 'text-ink-2' : 'text-danger'}`}>
                  {aiTest.ok
                    ? `连通成功${typeof aiTest.latencyMs === 'number' ? ` · ${aiTest.latencyMs}ms` : ''}${aiTest.message ? ` · ${aiTest.message}` : ''}`
                    : `失败 · ${aiTest.message ?? 'AI_TEST_FAILED'}`}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-ink-2">
              验证用 mock provider：`127.0.0.1:4010/v1`。真实供应商与真机未在本轮验证；配置保存后 @Bot / /report 走服务端 AI 流。
            </p>
          </section>
        ) : null}

        {isAiAdmin ? (
          <section className={panel}>
            <div className="mb-2 flex items-baseline justify-between">
              <p className={heading}>Invites / 邀请成员</p>
              <span className="border border-line px-1 font-sans text-[9px] uppercase tracking-[0.1em] text-ink-2">Owner / Admin</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <label className="flex flex-col gap-1">
                <span className={label}>角色</span>
                <select className={field} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'member' | 'admin')} aria-label="邀请角色">
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>最大使用次数（1–10）</span>
                <input
                  className={field}
                  type="number"
                  min={1}
                  max={10}
                  value={inviteMaxUses}
                  onChange={(event) => setInviteMaxUses(Math.max(1, Math.min(10, Number(event.target.value) || 1)))}
                  aria-label="邀请最大使用次数"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>有效期天数（1–30）</span>
                <input
                  className={field}
                  type="number"
                  min={1}
                  max={30}
                  value={inviteDays}
                  onChange={(event) => setInviteDays(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}
                  aria-label="邀请有效期天数"
                />
              </label>
              <button
                type="button"
                disabled={inviteCreating}
                className="cut-corner-sm mt-auto bg-ink px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
                onClick={() => void createInvite()}
              >
                {inviteCreating ? '生成中…' : '生成邀请码'}
              </button>
            </div>

            {inviteCode ? (
              <div className="mt-3 border border-ink bg-accent px-3 py-2 text-on-accent">
                <p className="font-sans text-[9px] font-bold uppercase tracking-[0.14em]">一次性的明文邀请码 · 仅显示这一次</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="break-all bg-ink px-2 py-1 font-mono text-[13px] font-bold text-white">{inviteCode}</code>
                  <button type="button" onClick={() => void copyInvite()} className="border border-ink px-2 py-0.5 text-[10px] font-bold">
                    {inviteCopied ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
            ) : null}

            {inviteError ? (
              <p className="mt-2 flex items-center gap-2 border border-line px-2 py-1.5 text-[11px] text-ink">
                <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase text-on-accent">{inviteError.code}</span>
                {inviteError.message}
              </p>
            ) : null}

            <div className="mt-3">
              <div className="mb-1 flex items-baseline justify-between">
                <span className={label}>邀请列表</span>
                <span className="font-mono text-[9px] text-ink-2">{inviteLoading ? '读取中…' : `${invites.length} 条`}</span>
              </div>
              {!inviteLoading && invites.length === 0 ? <p className="text-[11px] text-ink-2">还没有邀请码</p> : null}
              <ul className="flex flex-col">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-[11px] last:border-b-0">
                    <code className="font-mono font-bold text-ink">{invite.codePrefix}…</code>
                    <span className="border border-line px-1 text-[9px]">{invite.role}</span>
                    <span className="text-ink-2">
                      {invite.uses}/{invite.maxUses}
                    </span>
                    <span className="text-ink-2">截止 {invite.expiresAt.slice(0, 10)}</span>
                    <span className={`border px-1 text-[9px] ${invite.status === 'active' ? 'border-ink text-ink' : 'border-line text-ink-2'}`}>{invite.status}</span>
                    {invite.status === 'active' ? (
                      <button type="button" disabled={revokingId === invite.id} className="ml-auto text-[10px] text-danger" onClick={() => void revokeInvite(invite)}>
                        {revokingId === invite.id ? '撤销中…' : '撤销'}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {isBotOwner ? (
          <section className={panel}>
            <div className="mb-2 flex items-baseline justify-between">
              <p className={heading}>Bots / Bot 管理</p>
              <span className="border border-line px-1 font-sans text-[9px] uppercase tracking-[0.1em] text-ink-2">Owner only</span>
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button type="button" className="cut-corner-sm border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-ink" onClick={() => editBot(null)}>
                + 新建 Bot
              </button>
              <span className="text-[10px] text-ink-2">{botsLoading ? '读取中…' : `${bots.length} 个 Bot`}</span>
              {botTest ? <span className={`text-[10px] ${botTest.startsWith('失败') ? 'text-danger' : 'text-ink-2'}`}>{botTest}</span> : null}
            </div>
            {botsError ? (
              <p className="mb-2 flex items-center gap-2 border border-line px-2 py-1.5 text-[11px] text-ink">
                <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase text-on-accent">{botsError.code}</span>
                {botsError.message}
              </p>
            ) : null}
            {!botsLoading && bots.length === 0 ? <p className="mb-2 text-[11px] text-ink-2">还没有 Bot</p> : null}
            <ul className="mb-3 flex flex-col">
              {bots.map((bot) => (
                <li key={bot.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-[11px] last:border-b-0">
                  <Avatar name={bot.name ?? bot.displayName ?? 'BOT'} fileId={bot.avatarFileId} size={24} />
                  <span className="font-semibold text-ink">{bot.name ?? bot.displayName}</span>
                  <span className="border border-ink px-1 text-[9px] font-bold">[BOT]</span>
                  <span className="text-ink-2">{bot.model ?? '默认模型'}</span>
                  <span className={`border px-1 text-[9px] ${bot.enabled !== false ? 'border-ink text-ink' : 'border-line text-ink-2'}`}>
                    {bot.enabled !== false ? 'enabled' : 'disabled'}
                  </span>
                  <span className="ml-auto flex gap-2">
                    <button type="button" onClick={() => editBot(bot)} className="text-[10px] text-ink-2 underline">编辑</button>
                    <button type="button" disabled={botBusy} onClick={() => void testBot(bot)} className="text-[10px] text-ink-2 underline">测试</button>
                    <button type="button" disabled={botBusy} onClick={() => void removeBot(bot)} className="text-[10px] text-danger underline">删除</button>
                  </span>
                </li>
              ))}
            </ul>

            <div className="border border-line bg-paper p-2">
              <p className="mb-1 font-sans text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-2">
                {botForm.id ? `编辑 Bot · ${botForm.name}` : '新建 Bot'}
              </p>
              <div className="flex flex-wrap items-start gap-2">
                <div className="flex flex-col items-center gap-1">
                  <Avatar name={botForm.name || 'BOT'} fileId={botForm.avatarFileId} size={48} />
                  <button type="button" disabled={botBusy} onClick={() => botAvatarInput.current?.click()} className="border border-line px-1.5 py-0.5 text-[9px] text-ink-2">
                    上传头像
                  </button>
                  <input
                    ref={botAvatarInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void uploadBotAvatar(file);
                    }}
                  />
                </div>
                <div className="grid min-w-[16rem] flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className={label}>名称</span>
                    <input className={field} value={botForm.name} onChange={(event) => setBotForm((previous) => ({ ...previous, name: event.target.value }))} aria-label="Bot 名称" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={label}>模型（留空用全局）</span>
                    <input className={field} value={botForm.model} onChange={(event) => setBotForm((previous) => ({ ...previous, model: event.target.value }))} aria-label="Bot 模型" />
                  </label>
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className={label}>System Prompt（Markdown）</span>
                    <textarea
                      className={`${field} min-h-[6rem] font-mono text-[11px]`}
                      value={botForm.systemPrompt}
                      onChange={(event) => setBotForm((previous) => ({ ...previous, systemPrompt: event.target.value }))}
                      aria-label="Bot System Prompt"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={label}>API Key（留空用全局）</span>
                    <input
                      className={field}
                      type="password"
                      value={botForm.apiKey}
                      onChange={(event) => setBotForm((previous) => ({ ...previous, apiKey: event.target.value }))}
                      placeholder="留空 = 使用全局配置"
                      aria-label="Bot API Key"
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="flex items-end gap-2 text-[11px] text-ink">
                    <input type="checkbox" checked={botForm.enabled} onChange={(event) => setBotForm((previous) => ({ ...previous, enabled: event.target.checked }))} />
                    启用
                  </label>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={botBusy || !botForm.name.trim()} className="cut-corner-sm bg-ink px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40" onClick={() => void saveBot()}>
                  {botBusy ? '保存中…' : botForm.id ? '保存修改' : '创建 Bot'}
                </button>
                {botForm.id ? (
                  <button type="button" className="border border-line px-3 py-1.5 text-[11px] text-ink-2" onClick={() => editBot(null)}>
                    取消
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        <section className={panel}>
          <p className={heading}>Link / 链路</p>
          <div className={row}>
            <span className="text-ink-2">API</span>
            <span className="break-all font-mono text-[10px]">{API_BASE}</span>
          </div>
          <div className={row}>
            <span className="text-ink-2">WS 命名空间</span>
            <span className="font-mono">/ws</span>
          </div>
          <div className={row}>
            <span className="text-ink-2">Socket.IO path</span>
            <span className="font-mono">{WS_PATH}</span>
          </div>
          <div className={row}>
            <span className="text-ink-2">凭证存储</span>
            <span>localStorage + 内存</span>
          </div>
        </section>

        <ServerSettings />

        <section className={panel}>
          <p className={heading}>Known limitations / 已知限制</p>
          <div className={row}>
            <span className="text-ink-2">附件</span>
            <span>图片/文件/素材上传已接；不做断点续传</span>
          </div>
          <div className={row}>
            <span className="text-ink-2">卡片</span>
            <span>投票/任务可在消息流内操作；无独立详情页</span>
          </div>
          <div className={row}>
            <span className="text-ink-2">搜索 / 通知中心</span>
            <span>下一轮</span>
          </div>
        </section>

        <p className="font-mono text-[9px] text-ink-2/70">O.M.V 帝江号 · 全域广播 · IM layout</p>
      </main>
    </div>
  );
}
