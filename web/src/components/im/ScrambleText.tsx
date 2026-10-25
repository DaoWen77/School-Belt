'use client';

import { useEffect, useState } from 'react';

const POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%@/\\_-+=<>[]{}';

/** 终端 Scramble 解码；prefers-reduced-motion 时直接显示目标文本。 */
export function ScrambleText({ text, className = '', speed = 28 }: { text: string; className?: string; speed?: number }) {
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    if (!text) {
      setDisplay('');
      return;
    }
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(text);
      return;
    }
    let frame = 0;
    let timer: number | null = null;
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const revealed = Math.min(text.length, Math.floor((elapsed / speed) * 1.2));
      const next =
        text.slice(0, revealed) +
        text
          .slice(revealed)
          .split('')
          .map((char) => (char === ' ' || char === '\n' ? char : POOL[Math.floor(Math.random() * POOL.length)]))
          .join('');
      setDisplay(next);
      if (revealed < text.length) frame = requestAnimationFrame(tick);
      else {
        setDisplay(text);
        if (timer) window.clearTimeout(timer);
      }
    };
    frame = requestAnimationFrame(tick);
    timer = window.setTimeout(() => setDisplay(text), 1600);
    return () => {
      cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
    };
  }, [text, speed]);

  return <span className={className}>{display}</span>;
}
