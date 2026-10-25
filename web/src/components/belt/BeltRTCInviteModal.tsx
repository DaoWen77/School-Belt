'use client';

import { BeltAvatar } from './BeltAvatar';

export interface RtcInviteMember {
  userId: string;
  handle: string;
  displayName: string;
  avatarFileId?: string | null;
}

export function BeltRTCInviteModal({
  open,
  channelName,
  members,
  selected,
  loading,
  mode,
  onToggle,
  onClose,
  onStart,
}: {
  open: boolean;
  channelName: string;
  members: RtcInviteMember[];
  selected: string[];
  loading: boolean;
  mode: 'audio' | 'video';
  onToggle: (userId: string) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  if (!open) return null;
  const chosen = members.filter((member) => selected.includes(member.userId));

  return (
    <div className="rtc-invite-backdrop" role="presentation" onClick={onClose}>
      <section
        className="rtc-invite"
        role="dialog"
        aria-modal="true"
        aria-label="邀请成员加入通讯"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="rtc-invite-head">
          <div>
            <p className="rtc-invite-kicker">INVITE TO CALL / {mode === 'video' ? 'VIDEO' : 'VOICE'}</p>
            <h2>邀请成员加入通讯</h2>
            <p>{channelName} · 勾选要邀请的成员</p>
          </div>
          <button type="button" className="rtc-invite-close" aria-label="关闭" onClick={onClose}>×</button>
        </header>

        <div className="rtc-invite-list">
          {loading ? <p className="rtc-invite-empty">正在读取频道成员…</p> : null}
          {!loading && members.length === 0 ? <p className="rtc-invite-empty">当前频道没有可邀请的成员。</p> : null}
          {members.map((member) => {
            const checked = selected.includes(member.userId);
            return (
              <label key={member.userId} className={`rtc-invite-row${checked ? ' is-checked' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(member.userId)} />
                <BeltAvatar fileId={member.avatarFileId} name={member.displayName} size="sm" />
                <span className="rtc-invite-identity">
                  <b>{member.displayName}</b>
                  <small>@{member.handle}</small>
                </span>
                <span className="rtc-invite-check">{checked ? '已选' : '邀请'}</span>
              </label>
            );
          })}
        </div>

        <footer className="rtc-invite-foot">
          <span>已选 {chosen.length} / {members.length} 人</span>
          <div>
            <button type="button" className="rtc-invite-cancel" onClick={onClose}>取消</button>
            <button type="button" className="rtc-invite-start" disabled={loading || chosen.length === 0} onClick={onStart}>
              发起通讯
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
