'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type CallMode = 'audio' | 'video';

const PARTICIPANTS = [
  { id: 'FIONA', label: 'FIONA', role: 'CALLER', active: true },
  { id: 'RELAY-07', label: 'R-07', role: 'RELAY', active: false },
  { id: 'OBSERVER', label: 'OBS', role: 'OBSERVER', active: false },
];

const COORDS = [
  'LAT 31.2304 N',
  'LON 121.4737 E',
  'ALT 0004.2 M',
  'BRG 137.03°',
  'SIG -42.8 dBm',
  'ENC AES-256',
  'PKT 00042/00042',
];

function pad(value: number, size = 2): string {
  return String(Math.floor(value)).padStart(size, '0');
}

function formatTime(ms: number): string {
  const total = Math.floor(ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/** 终末地式沉浸式 RTC 通话界面：音频波形 / 视频双模式，纯前端模拟。 */
export function BeltRTCView() {
  const router = useRouter();
  const [mode, setMode] = useState<CallMode>('audio');
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [elapsed, setElapsed] = useState(6500);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: 34 }, () => 0.18));
  const [ended, setEnded] = useState(false);
  const waveRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const feedRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((value) => value + 100), 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setLevels((previous) =>
        previous.map((value, index) => {
          const target = 0.12 + Math.abs(Math.sin(Date.now() / (420 + index * 17) + index * 0.7)) * 0.8;
          return value * 0.55 + target * 0.45;
        }),
      );
    }, 90);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mode !== 'audio') return;
    const canvas = waveRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    const bars = 92;
    const draw = (time: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const mid = height / 2;
      const gap = width / bars;
      for (let index = 0; index < bars; index += 1) {
        const phase = time / 420 + index * 0.32;
        const envelope = 0.28 + 0.72 * Math.abs(Math.sin(index / bars * Math.PI));
        const amplitude = (0.12 + Math.abs(Math.sin(phase) * Math.cos(phase * 0.41 + index)) * 0.88) * envelope;
        const barHeight = Math.max(2, amplitude * height * 0.42);
        const x = index * gap + gap * 0.28;
        const barWidth = Math.max(1, gap * 0.36);
        const gradient = ctx.createLinearGradient(0, mid - barHeight, 0, mid + barHeight);
        gradient.addColorStop(0, 'rgba(255,250,0,0)');
        gradient.addColorStop(0.28, 'rgba(255,250,0,0.85)');
        gradient.addColorStop(0.5, 'rgba(255,250,0,1)');
        gradient.addColorStop(0.72, 'rgba(255,250,0,0.85)');
        gradient.addColorStop(1, 'rgba(255,250,0,0)');
        ctx.fillStyle = gradient;
        ctx.shadowColor = 'rgba(255,250,0,0.55)';
        ctx.shadowBlur = 8;
        ctx.fillRect(x, mid - barHeight, barWidth, barHeight * 2);
      }
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(232,232,224,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(width, mid + 0.5);
      ctx.stroke();
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
    const ctx = feed.getContext('2d');
    if (!ctx) return;
    feed.width = 960;
    feed.height = 540;
    let frame = 0;
    const draw = (time: number) => {
      const w = feed.width;
      const h = feed.height;
      ctx.fillStyle = '#070a06';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,250,0,0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 48) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      const cx = w / 2 + Math.sin(time / 900) * 120;
      const cy = h / 2 + Math.cos(time / 1200) * 60;
      ctx.strokeStyle = 'rgba(0,255,255,0.7)';
      ctx.shadowColor = 'rgba(0,255,255,0.6)';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(cx, cy, 54 + Math.sin(time / 260) * 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 84, cy);
      ctx.lineTo(cx + 84, cy);
      ctx.moveTo(cx, cy - 84);
      ctx.lineTo(cx, cy + 84);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,250,0,0.8)';
      ctx.font = '16px monospace';
      ctx.fillText('LIVE // FIONA // RELAY 07', 28, 42);
      ctx.fillStyle = 'rgba(232,232,224,0.45)';
      ctx.font = '12px monospace';
      ctx.fillText(`FRAME ${Math.floor(time / 33) % 100000}`, 28, 64);
      ctx.fillStyle = 'rgba(0,255,255,0.25)';
      for (let index = 0; index < 24; index += 1) {
        const x = (index * 137 + time / 40) % w;
        const y = (index * 89 + Math.sin(time / 500 + index) * 30) % h;
        ctx.fillRect(x, y, 2, 2);
      }
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
    window.setTimeout(() => router.push('/belt/direct'), 900);
  };

  if (ended) {
    return (
      <div className="rtc-overlay rtc-ended">
        <p className="rtc-kicker">LINK TERMINATED</p>
        <h1>CALL ENDED</h1>
        <p>通话已断开 · 返回链路列表</p>
      </div>
    );
  }

  return (
    <div className="rtc-overlay">
      <div className="rtc-noise" aria-hidden="true" />
      <header className="rtc-top">
        <span>O.M.V / BELT RELAY 07</span>
        <span>INTERNAL CALL</span>
        <span className="rtc-live">● SECURE CHANNEL</span>
      </header>

      <div className={`rtc-stage is-${mode}`}>
        <aside className="rtc-left">
          <p className="rtc-kicker">INCOMING CALL / 内部通讯</p>
          <h1>FIONA</h1>
          <p className="rtc-band">M10 FM MK H</p>
          <div className="rtc-time">
            <b>{formatTime(elapsed)}</b>
            <span>CALL TIME</span>
          </div>
          <div className="rtc-signal">
            <span>SIGNAL <b>98%</b></span>
            <span>CODEC <b>OPUS 48K</b></span>
            <span>LATENCY <b>014 MS</b></span>
          </div>
        </aside>

        <main className="rtc-center">
          {mode === 'audio' ? (
            <div className="rtc-wave-wrap">
              <span className="rtc-cross rtc-cross-tl" />
              <span className="rtc-cross rtc-cross-tr" />
              <span className="rtc-cross rtc-cross-bl" />
              <span className="rtc-cross rtc-cross-br" />
              <canvas ref={waveRef} className="rtc-wave" />
              <div className="rtc-wave-label">
                <span>AUDIO WAVEFORM</span>
                <span>CH-01 / MONO</span>
              </div>
            </div>
          ) : (
            <div className="rtc-video-wrap">
              <div className="rtc-video-frame">
                <span className="rtc-corner rtc-corner-tl" />
                <span className="rtc-corner rtc-corner-tr" />
                <span className="rtc-corner rtc-corner-bl" />
                <span className="rtc-corner rtc-corner-br" />
                <video ref={videoRef} muted playsInline autoPlay />
                <div className="rtc-video-hud">
                  <span>LIVE FEED</span>
                  <span>FIONA // CAM 01</span>
                </div>
              </div>
              <canvas ref={feedRef} className="hidden" aria-hidden="true" />
              <div className="rtc-dot-matrix" aria-hidden="true">
                {Array.from({ length: 26 }, (_, index) => <i key={index} />)}
              </div>
            </div>
          )}
        </main>

        <aside className="rtc-right">
          <div className="rtc-db">
            <span className="rtc-db-label">DB</span>
            <div className="rtc-db-bars">
              {levels.map((level, index) => (
                <i
                  key={index}
                  className={level > 0.66 ? 'is-hot' : level > 0.38 ? 'is-mid' : ''}
                  style={{ height: `${Math.max(4, level * 100)}%` }}
                />
              ))}
            </div>
            <span className="rtc-db-value">-12.4</span>
          </div>

          {mode === 'video' ? (
            <>
              <div className="rtc-participants">
                {PARTICIPANTS.map((person) => (
                  <div key={person.id} className={`rtc-person${person.active ? ' is-active' : ''}`}>
                    <span>{person.label.slice(0, 2)}</span>
                    <small>{person.role}</small>
                  </div>
                ))}
              </div>
              <div className="rtc-radar">
                <span className="rtc-radar-sweep" />
                <span className="rtc-radar-dot" />
                <p>RADAR / 07</p>
              </div>
              <div className="rtc-coords">
                {COORDS.map((line) => <span key={line}>{line}</span>)}
              </div>
            </>
          ) : (
            <div className="rtc-coords rtc-coords-audio">
              {COORDS.slice(0, 5).map((line) => <span key={line}>{line}</span>)}
            </div>
          )}
        </aside>
      </div>

      <footer className="rtc-controls">
        <button type="button" className={`rtc-control${muted ? ' is-danger' : ''}`} onClick={() => setMuted((value) => !value)}>
          <b>◉</b>
          <span>{muted ? 'UNMUTE' : 'MUTE'}</span>
        </button>
        <button type="button" className={`rtc-control${mode === 'video' ? ' is-active' : ''}`} onClick={() => setMode((value) => (value === 'video' ? 'audio' : 'video'))}>
          <b>▣</b>
          <span>{mode === 'video' ? 'AUDIO' : 'VIDEO'}</span>
        </button>
        <button type="button" className={`rtc-control${sharing ? ' is-active' : ''}`} onClick={() => setSharing((value) => !value)}>
          <b>⇱</b>
          <span>SHARE</span>
        </button>
        <button type="button" className="rtc-control is-hangup" onClick={endCall}>
          <b>■</b>
          <span>END</span>
        </button>
      </footer>

      <p className="rtc-footnote">ENCRYPTED · BELT RTC · CHANNEL 07 · {mode.toUpperCase()} MODE</p>
    </div>
  );
}
