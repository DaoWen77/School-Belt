'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';

export interface ConferenceParticipant {
  id: string;
  name: string;
  initials: string;
  role: string;
  color: string;
}

const DEFAULT_PARTICIPANTS: ConferenceParticipant[] = [
  { id: 'fiona', name: 'FIONA', initials: 'FN', role: 'CALLER', color: '#f4f5ea' },
  { id: 'relay', name: 'R-07', initials: '07', role: 'RELAY', color: '#00ffff' },
  { id: 'observer', name: 'OBSERVER', initials: 'OB', role: 'OBSERVER', color: '#ff9a1f' },
  { id: 'lin', name: 'LIN', initials: 'LN', role: 'MEMBER', color: '#ff2e88' },
  { id: 'yue', name: 'YUE', initials: 'YU', role: 'MEMBER', color: '#8dff2e' },
  { id: 'chen', name: 'CHEN', initials: 'CH', role: 'MEMBER', color: '#b26bff' },
];

const THRESHOLD = 0.42;

/**
 * 多人会议模拟：本地随机振幅驱动 ActiveSpeaker。
 * 1 人 -> 主画面；2 人 -> 双主画面；3+ -> 会议网格；无人 -> 待机 Logo。
 */
export function RTCConference({
  surface = 'belt',
  title = '极光通讯',
  subtitle = 'AURORA CONFERENCE',
}: {
  surface?: 'internal' | 'belt';
  title?: string;
  subtitle?: string;
}) {
  const router = useRouter();
  const [participants] = useState(DEFAULT_PARTICIPANTS);
  const [volumes, setVolumes] = useState<Record<string, number>>(() =>
    Object.fromEntries(DEFAULT_PARTICIPANTS.map((person) => [person.id, 0.05])),
  );
  const [idle, setIdle] = useState(true);
  const [muted, setMuted] = useState(false);
  const [video, setVideo] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [scripted, setScripted] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = useMemo(
    () =>
      participants
        .filter((person) => (volumes[person.id] ?? 0) >= THRESHOLD)
        .sort((a, b) => (volumes[b.id] ?? 0) - (volumes[a.id] ?? 0)),
    [participants, volumes],
  );

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!scripted) return;
    const timer = setInterval(() => {
      const roll = Math.random();
      const speakerCount = roll < 0.34 ? 0 : roll < 0.7 ? 1 : roll < 0.9 ? 2 : 3;
      const shuffled = [...participants].sort(() => Math.random() - 0.5);
      const speakers = new Set(shuffled.slice(0, speakerCount).map((person) => person.id));
      setVolumes((previous) =>
        Object.fromEntries(
          participants.map((person) => {
            const base = speakers.has(person.id) ? 0.55 + Math.random() * 0.42 : 0.04 + Math.random() * 0.12;
            return [person.id, previous[person.id] * 0.25 + base * 0.75];
          }),
        ),
      );
    }, 620);
    return () => clearInterval(timer);
  }, [participants, scripted]);

  useEffect(() => {
    if (active.length > 0) {
      setIdle(false);
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      return;
    }
    if (!idleTimer.current) {
      idleTimer.current = setTimeout(() => setIdle(true), 1500);
    }
    return () => {
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
    };
  }, [active.length]);

  const modeClass =
    active.length === 0 ? 'is-idle' : active.length === 1 ? 'is-solo' : active.length === 2 ? 'is-duo' : 'is-grid';
  const visible = active.length > 0 ? active : participants.slice(0, 1);

  return (
    <div className={`rtc-conf is-${surface}`}>
      <header className="rtc-conf-head">
        <div className="rtc-conf-brand">
          <span className="rtc-conf-mark" />
          <div>
            <b>O.M.V</b>
            <small>{subtitle}</small>
          </div>
        </div>
        <div className="rtc-conf-title">
          <span>{title}</span>
          <b>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</b>
        </div>
        <div className="rtc-conf-count">{participants.length} 参会 · {active.length} 发言</div>
      </header>

      <main className={`rtc-conf-stage ${modeClass}`}>
        <AnimatePresence mode="popLayout">
          {idle ? (
            <motion.div
              key="idle"
              className="rtc-conf-idle"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.45 }}
            >
              <span className="rtc-conf-idle-rings" />
              <b>等待发言</b>
              <small>VOICE CHANNEL READY · {subtitle}</small>
            </motion.div>
          ) : (
            visible.map((person) => (
              <motion.article
                layout
                key={person.id}
                className="rtc-conf-tile is-speaking"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 180, damping: 24 }}
              >
                <div className="rtc-conf-tile-top">
                  <span>{person.role}</span>
                  <b>{Math.round((volumes[person.id] ?? 0) * 100)}</b>
                </div>
                <div className="rtc-conf-avatar" style={{ borderColor: person.color, color: person.color }}>
                  {video ? <span className="rtc-conf-cam" /> : <b>{person.initials}</b>}
                </div>
                <div className="rtc-conf-name">
                  <b>{person.name}</b>
                  <span className="rtc-conf-wave">
                    {[0.4, 0.8, 0.55, 1, 0.7, 0.45, 0.85].map((height, index) => (
                      <i key={index} style={{ height: `${height * 100}%`, background: person.color }} />
                    ))}
                  </span>
                </div>
              </motion.article>
            ))
          )}
        </AnimatePresence>
      </main>

      <aside className="rtc-conf-rail">
        {participants.map((person) => {
          const speaking = active.some((row) => row.id === person.id);
          return (
            <div key={person.id} className={`rtc-conf-mini${speaking ? ' is-speaking' : ''}`}>
              <span style={{ borderColor: speaking ? person.color : undefined }}>{person.initials}</span>
              <b>{person.name}</b>
              {speaking ? (
                <span className="rtc-conf-mini-wave">
                  {[0.4, 0.9, 0.55, 0.75].map((height, index) => (
                    <i key={index} style={{ height: `${height * 100}%` }} />
                  ))}
                </span>
              ) : null}
            </div>
          );
        })}
      </aside>

      <footer className="rtc-conf-controls">
        <button type="button" className={`rtc-conf-btn${muted ? ' is-danger' : ''}`} onClick={() => setMuted((value) => !value)}>
          <span>◉</span><small>{muted ? '已静音' : '静音'}</small>
        </button>
        <button type="button" className={`rtc-conf-btn${video ? ' is-on' : ''}`} onClick={() => setVideo((value) => !value)}>
          <span>▣</span><small>视频</small>
        </button>
        <button type="button" className={`rtc-conf-btn${sharing ? ' is-on' : ''}`} onClick={() => setSharing((value) => !value)}>
          <span>⇱</span><small>共享</small>
        </button>
        <button type="button" className={`rtc-conf-btn${scripted ? ' is-on' : ''}`} onClick={() => setScripted((value) => !value)}>
          <span>≈</span><small>模拟</small>
        </button>
        <button type="button" className="rtc-conf-btn is-end" onClick={() => router.push(surface === 'belt' ? '/belt/channel' : '/')}>
          <span>■</span><small>结束</small>
        </button>
      </footer>
    </div>
  );
}
