'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type CallMode = 'audio' | 'video';

const PARTICIPANTS = [
  { id: 'FIONA', initials: 'FN', active: true },
  { id: 'R-07', initials: '07', active: false },
  { id: 'OBS', initials: 'OB', active: false },
];

function formatTime(ms: number): string {
  const total = Math.floor(ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** 极简沉浸式 RTC：景深背景 + 半透明玻璃面板，无仪表盘刻度。 */
export function BeltRTCView() {
  const router = useRouter();
  const [mode, setMode] = useState<CallMode>('audio');
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [elapsed, setElapsed] = useState(6500);
  const [ended, setEnded] = useState(false);
  const waveRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const feedRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((value) => value + 100), 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mode !== 'audio') return;
    const canvas = waveRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    const draw = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const mid = height / 2;
      const bars = 64;
      const gap = width / bars;
      for (let index = 0; index < bars; index += 1) {
        const envelope = Math.sin((index / (bars - 1)) * Math.PI);
        const amplitude =
          (0.08 + Math.abs(Math.sin(time / 700 + index * 0.28) * Math.cos(time / 1100 + index * 0.11)) * 0.92) *
          envelope;
        const barHeight = Math.max(1, amplitude * height * 0.34);
        ctx.fillStyle = `rgba(236, 238, 228, ${0.12 + envelope * 0.42})`;
        ctx.fillRect(index * gap + gap * 0.34, mid - barHeight, Math.max(1, gap * 0.2), barHeight * 2);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'video') return;
    const feed = feedRef.current;
    const video = videoRef.current;
    if (!feed || !video) return;
    feed.width = 1280;
    feed.height = 720;
    const ctx = feed.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    const draw = (time: number) => {
      const w = feed.width;
      const h = feed.height;
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#141712');
      grad.addColorStop(0.55, '#0b0e0a');
      grad.addColorStop(1, '#191d16');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w * 0.6, h * 0.42, 20, w * 0.6, h * 0.42, 360);
      glow.addColorStop(0, 'rgba(220, 224, 200, 0.16)');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(232, 234, 220, 0.05)';
      ctx.fillRect(w * 0.18 + Math.sin(time / 2200) * 8, h * 0.3, 2, h * 0.5);
      ctx.fillRect(w * 0.82 + Math.cos(time / 2600) * 6, h * 0.22, 1, h * 0.58);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.58, w * 0.2, h * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const stream = feed.captureStream(30);
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [mode]);

  const endCall = () => {
    setEnded(true);
    window.setTimeout(() => router.push('/belt/direct'), 800);
  };

  return (
    <div className="rtc2">
      <div className="rtc2-bg" aria-hidden="true">
        <img src="/rtc-bg.jpg" alt="" />
        <span className="rtc2-bg-veil" />
      </div>

      <header className="rtc2-header">
        <div className="rtc2-logo">
          <span className="rtc2-logo-mark">
            <i /><i />
          </span>
          <div>
            <b>O.M.V</b>
            <small>帝江号 · 环带中继</small>
          </div>
        </div>
        <p className="rtc2-call-tag">INTERNAL CALL</p>
        <p className="rtc2-header-meta">RELAY 07 · SECURE</p>
      </header>

      <div className="rtc2-stage">
        <aside className="rtc2-left">
          <div className="rtc2-avatars">
            {PARTICIPANTS.map((person) => (
              <div key={person.id} className={`rtc2-avatar${person.active ? ' is-active' : ''}`}>
                <span>{person.initials}</span>
                <small>{person.id}</small>
              </div>
            ))}
          </div>

          <div className="rtc2-identity">
            <p className="rtc2-eyebrow">COMMUNICATION LINK</p>
            <h1>FIONA</h1>
            <p className="rtc2-band">M10 FM MK H</p>
            <p className="rtc2-timer">{formatTime(elapsed)}</p>
          </div>

          <div className="rtc2-meta">
            <span>SIGNAL <b>98%</b></span>
            <span>LATENCY <b>014 MS</b></span>
            <span>CODEC <b>OPUS 48K</b></span>
          </div>
        </aside>

        <main className="rtc2-center">
          <div className={`rtc2-frame${mode === 'video' ? ' is-video' : ''}`}>
            <i className="rtc2-corner rtc2-tl" />
            <i className="rtc2-corner rtc2-tr" />
            <i className="rtc2-corner rtc2-bl" />
            <i className="rtc2-corner rtc2-br" />

            {mode === 'audio' ? (
              <div className="rtc2-wave-wrap">
                <canvas ref={waveRef} className="rtc2-wave" />
                <span className="rtc2-mode-label">AUDIO LINK</span>
              </div>
            ) : (
              <div className="rtc2-video-wrap">
                <video ref={videoRef} muted playsInline autoPlay />
                <canvas ref={feedRef} className="hidden" aria-hidden="true" />
                <span className="rtc2-mode-label">LIVE VIDEO</span>
              </div>
            )}
          </div>
        </main>
      </div>

      <footer className="rtc2-controls">
        <button type="button" className={`rtc2-control${muted ? ' is-on' : ''}`} onClick={() => setMuted((value) => !value)}>
          <span className="rtc2-icon rtc2-icon-mute" />
          <small>{muted ? 'UNMUTE' : 'MUTE'}</small>
        </button>
        <button type="button" className={`rtc2-control${mode === 'video' ? ' is-on' : ''}`} onClick={() => setMode((value) => (value === 'video' ? 'audio' : 'video'))}>
          <span className="rtc2-icon rtc2-icon-video" />
          <small>{mode === 'video' ? 'AUDIO' : 'VIDEO'}</small>
        </button>
        <button type="button" className={`rtc2-control${sharing ? ' is-on' : ''}`} onClick={() => setSharing((value) => !value)}>
          <span className="rtc2-icon rtc2-icon-share" />
          <small>SHARE</small>
        </button>
        <button type="button" className="rtc2-control is-end" onClick={endCall}>
          <span className="rtc2-icon rtc2-icon-end" />
          <small>END</small>
        </button>
      </footer>

      {ended ? <div className="rtc2-ended">LINK TERMINATED</div> : null}
    </div>
  );
}
