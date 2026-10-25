'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { resolveWsBase, WS_PATH } from '@/lib/api';
import { beltSession } from '@/lib/beltSession';

type CallMode = 'audio' | 'video';

export interface RtcPerson {
  id: string;
  name: string;
  initials: string;
  role: string;
}

const ROSTER: RtcPerson[] = [
  { id: 'fiona', name: 'FIONA', initials: 'FN', role: 'CALLER' },
  { id: 'relay', name: 'R-07', initials: '07', role: 'RELAY' },
  { id: 'observer', name: 'OBSERVER', initials: 'OB', role: 'OBSERVER' },
  { id: 'lin', name: 'LIN', initials: 'LN', role: 'MEMBER' },
];

function formatTime(ms: number): string {
  const total = Math.floor(ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** 真实 WebRTC：本地媒体 + Web Audio 分析 + `/rtc` 信令；无对端时仍可本地自检。 */
export function BeltRTCView() {
  const router = useRouter();
  const [mode, setMode] = useState<CallMode>('audio');
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [hasRemote, setHasRemote] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [ended, setEnded] = useState(false);
  const [status, setStatus] = useState('等待授权…');
  const [streamReady, setStreamReady] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: 34 }, () => 0.04));
  const [people, setPeople] = useState<RtcPerson[]>(ROSTER.slice(0, 2));
  const [activeId, setActiveId] = useState('fiona');
  const [iceState, setIceState] = useState<string>('new');
  const [iceErrorOpen, setIceErrorOpen] = useState(false);

  const localStream = useRef<MediaStream | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const sourceNode = useRef<MediaStreamAudioSourceNode | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const socket = useRef<Socket | null>(null);
  const waveRef = useRef<HTMLCanvasElement | null>(null);
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const raf = useRef<number>(0);
  const callId = useRef<string>('');

  useEffect(() => {
    callId.current =
      new URLSearchParams(window.location.search).get('callId') ||
      `belt-${Date.now().toString(36)}`;
    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStream.current = stream;
        setStatus('本地链路已建立');
        if (localVideo.current) {
          localVideo.current.srcObject = stream;
          void localVideo.current.play().catch(() => undefined);
        }

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContext.current = ctx;
        const node = ctx.createAnalyser();
        node.fftSize = 1024;
        node.smoothingTimeConstant = 0.72;
        analyser.current = node;
        sourceNode.current = ctx.createMediaStreamSource(stream);
        sourceNode.current.connect(node);
        setStreamReady(true);
      } catch {
        // 摄像头被拒/无设备时退化为纯音频
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (cancelled) {
            audioOnly.getTracks().forEach((track) => track.stop());
            return;
          }
          localStream.current = audioOnly;
          setStatus('仅音频链路（摄像头不可用）');
          const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new AudioCtx();
          audioContext.current = ctx;
          const node = ctx.createAnalyser();
          node.fftSize = 1024;
          node.smoothingTimeConstant = 0.72;
          analyser.current = node;
          sourceNode.current = ctx.createMediaStreamSource(audioOnly);
          sourceNode.current.connect(node);
          setStreamReady(true);
        } catch {
          setStatus('无法获取麦克风权限');
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const demo = Number(new URLSearchParams(window.location.search).get('demo') || '2');
    const count = demo >= 4 ? 4 : demo >= 3 ? 3 : 2;
    setPeople(ROSTER.slice(0, count));
    setActiveId(ROSTER[0].id);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((value) => value + 100), 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (people.length < 2) return;
    const timer = setInterval(() => {
      const next = people[Math.floor(Math.random() * people.length)];
      setActiveId((current) => (Math.random() < 0.4 ? current : next.id));
    }, 1100);
    return () => clearInterval(timer);
  }, [people]);

  // 真实波形 + 频谱：无声音时几乎归零
  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const timeData = new Uint8Array(1024);
    const freqData = new Uint8Array(512);

    const draw = () => {
      const analyserNode = analyser.current;
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
      const bars = 72;

      if (!analyserNode) {
        ctx.strokeStyle = 'rgba(236,238,228,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(width, mid);
        ctx.stroke();
        raf.current = requestAnimationFrame(draw);
        return;
      }

      analyserNode.getByteTimeDomainData(timeData);
      analyserNode.getByteFrequencyData(freqData);

      let sum = 0;
      for (let i = 0; i < freqData.length; i += 1) sum += freqData[i];
      const loudness = sum / freqData.length / 255;
      setLevels((previous) =>
        previous.map((value, index) => {
          const target = Math.max(0.02, Math.min(1, loudness * 2.4 + Math.abs(Math.sin(index * 0.7 + Date.now() / 380)) * loudness * 0.5));
          return value * 0.6 + target * 0.4;
        }),
      );

      const gap = width / bars;
      for (let index = 0; index < bars; index += 1) {
        const sampleA = timeData[Math.floor((index / bars) * timeData.length)];
        const sampleB = timeData[Math.floor(((index + 1) / bars) * timeData.length)];
        const amplitude = Math.abs(sampleA - 128) / 128;
        const amplitudeB = Math.abs(sampleB - 128) / 128;
        const envelope = Math.sin((index / (bars - 1)) * Math.PI);
        const barHeight = Math.max(0.7, Math.max(amplitude, amplitudeB * 0.8) * height * 0.42 * envelope);
        ctx.fillStyle = `rgba(236, 238, 228, ${0.08 + Math.max(amplitude, amplitudeB) * 0.5})`;
        ctx.fillRect(index * gap + gap * 0.35, mid - barHeight, Math.max(1, gap * 0.2), barHeight * 2);
      }
      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  // 信令 + WebRTC
  useEffect(() => {
    if (!streamReady) return;
    const token = beltSession.getAccess();
    if (!token) return;
    const s = io(`${resolveWsBase()}/rtc`, {
      path: WS_PATH,
      auth: { token },
      transports: ['websocket'],
    });
    socket.current = s;

    const turnUrl = process.env.NEXT_PUBLIC_TURN_URL || 'turn:openrelay.metered.ca:80';
    const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME || 'openrelayproject';
    const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || 'openrelayproject';
    const pc = new RTCPeerConnection({
      // 局域网 host candidate 优先；STUN 打洞次之；公共 TURN 只做兜底。
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        { urls: turnUrl, username: turnUser, credential: turnCredential },
      ],
      iceCandidatePoolSize: 4,
    });
    peer.current = pc;
    const remote = new MediaStream();
    remoteStream.current = remote;

    localStream.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStream.current!);
    });

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        if (!remote.getTracks().some((existing) => existing.id === track.id)) remote.addTrack(track);
      });
      if (remoteVideo.current) {
        remoteVideo.current.srcObject = remote;
        void remoteVideo.current.play().catch(() => undefined);
      }
      setHasRemote(true);
      setStatus('对端媒体已接入');
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) s.emit('rtc:ice', { callId: callId.current, candidate: event.candidate });
    };

    let iceTimer: ReturnType<typeof setTimeout> | null = null;
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        if (iceTimer) {
          clearTimeout(iceTimer);
          iceTimer = null;
        }
        setIceState('connected');
      } else if (state === 'failed') {
        if (iceTimer) {
          clearTimeout(iceTimer);
          iceTimer = null;
        }
        setIceState('failed');
      } else if (state === 'checking') {
        setIceState('checking');
        if (!iceTimer) {
          iceTimer = setTimeout(() => {
            setIceState((current) => (current === 'connected' || current === 'completed' ? current : 'failed'));
          }, 12_000);
        }
      } else if (state === 'disconnected') {
        setIceState('checking');
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') setIceState('failed');
    };

    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        s.emit('rtc:offer', { callId: callId.current, sdp: pc.localDescription });
      } catch {
        /* 无对端时忽略 */
      }
    };

    s.on('connect', () => {
      setStatus((value) => (value.includes('仅音频') ? value : '信令已连接'));
      s.emit('rtc:join', { callId: callId.current });
    });

    s.on('rtc:offer', async (payload: { sdp: RTCSessionDescriptionInit }) => {
      try {
        await pc.setRemoteDescription(payload.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        s.emit('rtc:answer', { callId: callId.current, sdp: pc.localDescription });
      } catch {
        /* ignore */
      }
    });

    s.on('rtc:answer', async (payload: { sdp: RTCSessionDescriptionInit }) => {
      try {
        if (pc.signalingState === 'have-local-offer') await pc.setRemoteDescription(payload.sdp);
      } catch {
        /* ignore */
      }
    });

    s.on('rtc:ice', async (payload: { candidate: RTCIceCandidateInit }) => {
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch {
        /* ignore */
      }
    });

    return () => {
      s.emit('rtc:leave', { callId: callId.current });
      s.disconnect();
      pc.close();
      remote.getTracks().forEach((track) => track.stop());
    };
  }, [streamReady]);

  const stopTracks = (stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
  };

  const toggleMute = () => {
    const next = !muted;
    localStream.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  };

  const toggleVideo = async () => {
    if (mode === 'video') {
      // 关闭摄像头/屏幕，回到音频
      stopTracks(cameraStream.current);
      cameraStream.current = null;
      setCameraOn(false);
      setMode('audio');
      setStatus('音频模式');
      return;
    }
    try {
      let stream = cameraStream.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        cameraStream.current = stream;
        stream.getVideoTracks().forEach((track) => peer.current?.addTrack(track, stream!));
      }
      if (localVideo.current) {
        localVideo.current.srcObject = stream;
        void localVideo.current.play().catch(() => undefined);
      }
      setCameraOn(true);
      setMode('video');
      setStatus('摄像头已开启');
    } catch {
      setStatus('无法开启摄像头');
    }
  };

  const toggleShare = async () => {
    if (sharing) {
      stopTracks(screenStream.current);
      screenStream.current = null;
      setSharing(false);
      if (mode === 'video' && !cameraOn) setMode('audio');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStream.current = stream;
      stream.getVideoTracks().forEach((track) => {
        peer.current?.addTrack(track, stream);
        track.onended = () => {
          setSharing(false);
          setMode('audio');
        };
      });
      if (remoteVideo.current) {
        remoteVideo.current.srcObject = stream;
        void remoteVideo.current.play().catch(() => undefined);
      }
      setSharing(true);
      setMode('video');
      setStatus('屏幕共享中');
    } catch {
      setStatus('屏幕共享已取消');
    }
  };

  const endCall = () => {
    setEnded(true);
    stopTracks(localStream.current);
    stopTracks(cameraStream.current);
    stopTracks(screenStream.current);
    stopTracks(remoteStream.current);
    peer.current?.close();
    socket.current?.disconnect();
    void audioContext.current?.close();
    window.setTimeout(() => router.push('/belt/direct'), 800);
  };

  useEffect(() => {
    return () => {
      stopTracks(localStream.current);
      stopTracks(cameraStream.current);
      stopTracks(screenStream.current);
      peer.current?.close();
      socket.current?.disconnect();
      void audioContext.current?.close();
    };
  }, []);

  return (
    <div className="rtc2">
      <div className="rtc2-bg" aria-hidden="true">
        <img src="/rtc-bg.jpg" alt="" />
        <span className="rtc2-bg-veil" />
      </div>

      <header className="rtc2-header">
        <div className="rtc2-logo">
          <span className="rtc2-logo-mark"><i /><i /></span>
          <div><b>O.M.V</b><small>帝江号 · 环带中继</small></div>
        </div>
        <p className="rtc2-call-tag">INTERNAL CALL</p>
        <div className="rtc2-head-right">
          <span className={`rtc2-ice rtc2-ice-${iceState}`}>
            {iceState === 'connected' ? '● [P2P LINK ESTABLISHED]' : iceState === 'failed' ? '● [P2P LINK FAILED]' : '○ [P2P NEGOTIATING]'}
          </span>
          <p className="rtc2-header-meta">{status}</p>
        </div>
      </header>

      <div className="rtc2-stage">
        <aside className="rtc2-left">
          <div className={`rtc2-avatars is-${people.length > 4 ? 'scroll' : people.length > 2 ? 'grid' : 'duo'}`}>
            {people.map((person) => {
              const speaking = person.id === activeId;
              return (
                <div key={person.id} className={`rtc2-avatar${speaking ? ' is-active' : ''}`}>
                  <span>{person.initials}</span>
                  <small>{person.name}</small>
                  {speaking ? <i className="rtc2-avatar-live">LIVE</i> : null}
                </div>
              );
            })}
          </div>
          <div className="rtc2-identity">
            <p className="rtc2-eyebrow">COMMUNICATION LINK · {people.length} PARTIES</p>
            <h1 key={activeId} className="rtc2-speaker-name">
              {people.find((person) => person.id === activeId)?.name ?? '—'}
            </h1>
            <p className="rtc2-band">M10 FM MK H</p>
            <p className="rtc2-timer">{formatTime(elapsed)}</p>
          </div>
          <div className="rtc2-meta">
            <span>ROOM <b>{people.map((person) => person.name).join(' / ')}</b></span>
            <span>ACTIVE <b>{people.find((person) => person.id === activeId)?.name ?? '—'}</b></span>
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
                <video
                  ref={remoteVideo}
                  muted={false}
                  playsInline
                  autoPlay
                  className={`rtc2-video-main${!hasRemote && !sharing ? ' is-hidden' : ''}`}
                />
                <span className="rtc2-mode-label">{sharing ? 'SCREEN SHARE' : hasRemote ? 'REMOTE FEED' : 'LOCAL CAMERA'}</span>
              </div>
            )}

            <div className={`rtc2-pip${mode === 'video' && !sharing && !hasRemote ? ' is-full' : ''}${mode === 'audio' || (!cameraOn && !sharing) ? ' is-hidden' : ''}`}>
              <video ref={localVideo} muted playsInline autoPlay />
              <i className="rtc2-pip-corner rtc2-pip-tl" />
              <i className="rtc2-pip-corner rtc2-pip-br" />
            </div>
          </div>
        </main>
      </div>

      <footer className="rtc2-controls">
        <button type="button" className={`rtc2-control${muted ? ' is-on is-danger' : ''}`} onClick={toggleMute}>
          <span className="rtc2-icon rtc2-icon-mute" />
          <small>{muted ? 'UNMUTE' : 'MUTE'}</small>
        </button>
        <button type="button" className={`rtc2-control${mode === 'video' ? ' is-on' : ''}`} onClick={() => void toggleVideo()}>
          <span className="rtc2-icon rtc2-icon-video" />
          <small>{mode === 'video' ? 'AUDIO' : 'VIDEO'}</small>
        </button>
        <button type="button" className={`rtc2-control${sharing ? ' is-on' : ''}`} onClick={() => void toggleShare()}>
          <span className="rtc2-icon rtc2-icon-share" />
          <small>SHARE</small>
        </button>
        <button type="button" className="rtc2-control is-end" onClick={endCall}>
          <span className="rtc2-icon rtc2-icon-end" />
          <small>END</small>
        </button>
      </footer>

      {iceState === 'failed' && !iceErrorOpen ? (
        <button type="button" className="rtc2-ice-error" role="alert" onClick={() => setIceErrorOpen(true)}>
          <b>[ERROR] P2P 物理穿透失败</b>
          <span>原因：网络环境过于严苛（如校园网屏蔽），请尝试切换至手机热点重试。</span>
          <small>点击查看诊断 / RETRY</small>
        </button>
      ) : null}

      {iceErrorOpen ? (
        <div className="rtc2-ice-modal" role="dialog" aria-modal="true" aria-label="P2P 连接失败">
          <p>[ERROR] P2P 物理穿透失败。原因：网络环境过于严苛（如校园网屏蔽），请尝试切换至手机热点重试。</p>
          <div>
            <button type="button" onClick={() => setIceErrorOpen(false)}>返回</button>
            <button type="button" onClick={() => window.location.reload()}>RETRY</button>
          </div>
        </div>
      ) : null}

      {ended ? <div className="rtc2-ended">LINK TERMINATED</div> : null}
    </div>
  );
}
