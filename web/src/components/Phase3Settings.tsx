'use client';

import { useEffect, useState } from 'react';
import { api, errorOf } from '@/lib/api';
import type { ApiUser, Channel, UserLite } from '@/lib/types';

type P3Error = { code: string; message: string };

interface DeviceRow {
  id: string;
  platform?: string;
  name?: string;
  lastActiveAt?: string;
  createdAt?: string;
}

interface ManagedUser extends UserLite {
  status?: string;
  globalRole?: string;
}

/**
 * Phase3 管理面板：安全 / 通知 / 设备 / 成员 / 公告 / 频道。
 * 由设置页「管理」等 Tab 锚点定位；内部所有请求均显示错误，不静默。
 */
export function Phase3Settings({ me, isAdmin }: { me: ApiUser | null; isAdmin: boolean }) {
  const [error, setError] = useState<P3Error | null>(null);
  const [busy, setBusy] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');

  const [notifyLevel, setNotifyLevel] = useState('all');
  const [dndEnabled, setDndEnabled] = useState(false);
  const [dndStart, setDndStart] = useState('');
  const [dndEnd, setDndEnd] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');

  const [devices, setDevices] = useState<DeviceRow[]>([]);

  const [users, setUsers] = useState<ManagedUser[]>([]);

  const [announcement, setAnnouncement] = useState('');
  const [announcementLevel, setAnnouncementLevel] = useState<'info' | 'warning' | 'critical'>('info');
  const [announcementMsg, setAnnouncementMsg] = useState('');

  const [channels, setChannels] = useState<Channel[]>([]);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelVisibility, setNewChannelVisibility] = useState<'public' | 'private'>('public');

  const panel = 'border border-line bg-panel p-3';
  const heading = 'font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-2';
  const field = 'w-full border border-line bg-paper px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink';
  const label = 'block font-sans text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-2';
  const button = 'cut-corner-sm bg-ink px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-40';
  const secondary = 'border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-ink';

  const fail = (caught: unknown) => setError(errorOf(caught));

  const loadSettings = async () => {
    try {
      const data = await api<unknown>('/me/settings');
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const settings = (record.settings ?? record) as Record<string, unknown>;
      if (typeof settings.notifyLevel === 'string') setNotifyLevel(settings.notifyLevel);
      if (typeof settings.dndEnabled === 'boolean') setDndEnabled(settings.dndEnabled);
      if (typeof settings.dndStart === 'string') setDndStart(settings.dndStart);
      if (typeof settings.dndEnd === 'string') setDndEnd(settings.dndEnd);
    } catch (caught) {
      fail(caught);
    }
  };

  const loadDevices = async () => {
    try {
      const data = await api<unknown>('/me/devices');
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      setDevices(Array.isArray(record.devices) ? (record.devices as DeviceRow[]) : []);
    } catch (caught) {
      fail(caught);
    }
  };

  const loadUsers = async () => {
    if (!isAdmin) return;
    try {
      const data = await api<unknown>('/users?limit=100');
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      setUsers(Array.isArray(record.users) ? (record.users as ManagedUser[]) : []);
    } catch (caught) {
      fail(caught);
    }
  };

  const loadAnnouncement = async () => {
    try {
      const data = await api<unknown>('/announcements/current');
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const raw = (record.announcement ?? record) as Record<string, unknown>;
      setAnnouncement(typeof raw.body === 'string' ? raw.body : '');
      if (raw.level === 'warning' || raw.level === 'critical' || raw.level === 'info') setAnnouncementLevel(raw.level);
    } catch {
      setAnnouncement('');
    }
  };

  const loadChannels = async () => {
    try {
      const data = await api<unknown>('/channels');
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      setChannels(Array.isArray(record.channels) ? (record.channels as Channel[]) : []);
    } catch (caught) {
      fail(caught);
    }
  };

  useEffect(() => {
    void loadSettings();
    void loadDevices();
    void loadUsers();
    void loadAnnouncement();
    void loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const changePassword = async () => {
    setBusy(true);
    setError(null);
    setPasswordMsg('');
    try {
      await api('/me/password', { method: 'POST', body: JSON.stringify({ currentPassword: oldPassword, newPassword }) });
      setPasswordMsg('密码已更新，其他会话已撤销');
      setOldPassword('');
      setNewPassword('');
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    setBusy(true);
    setError(null);
    setSettingsMsg('');
    try {
      await api('/me/settings', { method: 'PATCH', body: JSON.stringify({ notifyLevel, dndEnabled, dndStart: dndStart || null, dndEnd: dndEnd || null }) });
      setSettingsMsg('通知设置已保存');
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const removeDevice = async (device: DeviceRow) => {
    if (!window.confirm(`删除设备「${device.name ?? device.platform ?? device.id}」？`)) return;
    try {
      await api(`/me/devices/${device.id}`, { method: 'DELETE' });
      await loadDevices();
    } catch (caught) {
      fail(caught);
    }
  };

  const toggleUser = async (user: ManagedUser) => {
    if (!isAdmin || user.id === me?.id || user.globalRole === 'owner') return;
    const next = user.status === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`${next === 'suspended' ? '封禁' : '解封'} @${user.handle}？`)) return;
    try {
      await api(`/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
      await loadUsers();
    } catch (caught) {
      fail(caught);
    }
  };

  const saveAnnouncement = async () => {
    setBusy(true);
    setError(null);
    setAnnouncementMsg('');
    try {
      await api('/announcements', { method: 'PUT', body: JSON.stringify({ body: announcement, level: announcementLevel }) });
      setAnnouncementMsg(announcement.trim() ? '全服公告已发布' : '全服公告已关闭');
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const createChannel = async () => {
    if (!newChannelName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api('/channels', { method: 'POST', body: JSON.stringify({ name: newChannelName.trim(), slug: `ch-${Date.now().toString(36)}`, visibility: newChannelVisibility }) });
      setNewChannelName('');
      await loadChannels();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const renameChannel = async (channel: Channel) => {
    const name = window.prompt('新频道名', channel.name);
    if (!name?.trim()) return;
    try {
      await api(`/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
      await loadChannels();
    } catch (caught) {
      fail(caught);
    }
  };

  const deleteChannel = async (channel: Channel) => {
    if (!window.confirm(`删除频道「${channel.name}」？此操作不可撤销。`)) return;
    try {
      await api(`/channels/${channel.id}`, { method: 'DELETE' });
      await loadChannels();
    } catch (caught) {
      fail(caught);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="flex items-center gap-2 border border-line px-2 py-1.5 text-[11px] text-ink" role="alert">
          <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase text-on-accent">{error.code}</span>
          {error.message}
          <button type="button" className="ml-auto text-[10px] underline" onClick={() => setError(null)}>关闭</button>
        </p>
      ) : null}

      <section id="tab-security" className={panel}>
        <p className={heading}>Security / 安全</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1"><span className={label}>当前密码</span><input type="password" autoComplete="current-password" className={field} value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} aria-label="当前密码" /></label>
          <label className="flex flex-col gap-1"><span className={label}>新密码（≥8）</span><input type="password" autoComplete="new-password" className={field} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} aria-label="新密码" /></label>
        </div>
        <button type="button" disabled={busy || !oldPassword || newPassword.length < 8} className={`${button} mt-2`} onClick={() => void changePassword()}>修改密码</button>
        {passwordMsg ? <span className="ml-2 text-[10px] text-ink-2">{passwordMsg}</span> : null}
      </section>

      <section id="tab-notification" className={panel}>
        <p className={heading}>Notifications / 通知</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1"><span className={label}>通知级别</span>
            <select className={field} value={notifyLevel} onChange={(event) => setNotifyLevel(event.target.value)} aria-label="通知级别">
              <option value="all">全部</option><option value="mentions">仅提及</option><option value="none">关闭</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-[11px] text-ink"><input type="checkbox" checked={dndEnabled} onChange={(event) => setDndEnabled(event.target.checked)} />免打扰 DND</label>
          {dndEnabled ? (
            <div className="flex items-end gap-2 pb-1.5">
              <label className="flex-1">
                <span className={label}>开始</span>
                <input type="time" className={field} value={dndStart} onChange={(event) => setDndStart(event.target.value)} />
              </label>
              <label className="flex-1">
                <span className={label}>结束</span>
                <input type="time" className={field} value={dndEnd} onChange={(event) => setDndEnd(event.target.value)} />
              </label>
            </div>
          ) : null}
          <button type="button" disabled={busy} className={button} onClick={() => void saveSettings()}>保存通知设置</button>
          {settingsMsg ? <span className="text-[10px] text-ink-2">{settingsMsg}</span> : null}
        </div>
      </section>

      <section id="tab-devices" className={panel}>
        <p className={heading}>Devices / 设备</p>
        {devices.length === 0 ? <p className="mt-1 text-[11px] text-ink-2">暂无设备</p> : null}
        <ul className="mt-1 flex flex-col">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-[11px] last:border-b-0">
              <span className="font-semibold text-ink">{device.name ?? device.platform ?? '设备'}</span>
              <span className="text-ink-2">{device.platform ?? ''}</span>
              <span className="text-ink-2">{device.lastActiveAt ? day(device.lastActiveAt) : ''}</span>
              <button type="button" className="ml-auto text-[10px] text-danger" onClick={() => void removeDevice(device)}>删除</button>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin ? (
        <section id="tab-manage" className={panel}>
          <p className={heading}>Members / 成员管理</p>
          <ul className="mt-1 flex flex-col">
            {users.map((user) => (
              <li key={user.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-[11px] last:border-b-0">
                <span className="font-semibold text-ink">{user.displayName ?? user.handle}</span>
                <span className="font-mono text-[10px] text-ink-2">@{user.handle}</span>
                <span className={`border px-1 text-[9px] ${user.status === 'suspended' ? 'border-danger text-danger' : 'border-line text-ink-2'}`}>{user.status ?? 'active'}</span>
                <span className="text-[9px] uppercase text-ink-2">{user.globalRole ?? 'member'}</span>
                {user.id !== me?.id && user.globalRole !== 'owner' ? (
                  <button type="button" className="ml-auto text-[10px] text-danger underline" onClick={() => void toggleUser(user)}>
                    {user.status === 'suspended' ? '解封' : '封禁'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isAdmin ? (
        <section id="tab-announcement" className={panel}>
          <div className="flex items-baseline justify-between"><p className={heading}>Announcement / 全服公告</p><span className="text-[9px] text-ink-2">owner/admin</span></div>
          <textarea className={`${field} mt-2 min-h-[4.5rem]`} maxLength={2000} value={announcement} onChange={(event) => setAnnouncement(event.target.value)} aria-label="全服公告正文" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select className={field} value={announcementLevel} onChange={(event) => setAnnouncementLevel(event.target.value as typeof announcementLevel)} aria-label="公告级别">
              <option value="info">info</option><option value="warning">warning</option><option value="critical">critical</option>
            </select>
            <button type="button" disabled={busy} className={button} onClick={() => void saveAnnouncement()}>发布 / 关闭</button>
            {announcementMsg ? <span className="text-[10px] text-ink-2">{announcementMsg}</span> : null}
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <section className={panel}>
          <div className="flex items-baseline justify-between"><p className={heading}>Channels / 频道管理</p><span className="text-[9px] text-ink-2">owner/admin</span></div>
          <div className="mt-2 flex flex-wrap gap-2">
            <input className={field} placeholder="新频道名" value={newChannelName} onChange={(event) => setNewChannelName(event.target.value)} aria-label="新频道名" />
            <select className={field} value={newChannelVisibility} onChange={(event) => setNewChannelVisibility(event.target.value as 'public' | 'private')} aria-label="频道可见性">
              <option value="public">公开</option><option value="private">私密</option>
            </select>
            <button type="button" disabled={busy || !newChannelName.trim()} className={button} onClick={() => void createChannel()}>创建频道</button>
          </div>
          <ul className="mt-2 flex flex-col">
            {channels.map((channel) => (
              <li key={channel.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-[11px] last:border-b-0">
                <span className="font-semibold text-ink">{channel.name}</span>
                <span className="text-[9px] text-ink-2">{channel.visibility}</span>
                <button type="button" className="ml-auto text-[10px] text-ink-2 underline" onClick={() => void renameChannel(channel)}>改名</button>
                <button type="button" className="text-[10px] text-danger underline" onClick={() => void deleteChannel(channel)}>删除</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function day(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}
