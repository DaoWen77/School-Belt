'use client';

import { useEffect, useState } from 'react';

const SNOW = [
  '0x7F 0x00 ERR_LINK\r\n/dev/relay/07\r\n0xDEAD 0x00\r\nPURGE /relay/07/link\r\n0x1A 0xFF 0x00\r\nSIGNAL LOST\r\n0x4F 0x2A\r\nNO CARRIER',
  'ERR 403\r\n0x00 0x00 0x00\r\nUNAUTHORIZED\r\n /dev/link/07\r\n0xFF 0x1B\r\nPROTOCOL\r\n0x7F 0x00\r\nDENIED',
  '0x2A 0x00 ERR\r\nTRACE /relay/07\r\n0x00 0x00 0x00\r\nPURGE 0x1A\r\nLINK CUT\r\n0xFF 0x00\r\nNO SIGNAL\r\n0x7F',
];

export function BeltDenial({ onDone, reason }: { onDone: () => void; reason?: string }) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    const interval = window.setInterval(() => setCount((value) => Math.max(0, value - 1)), 1000);
    const timeout = window.setTimeout(onDone, 3000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [onDone]);

  return (
    <div className="belt-denial" role="alertdialog" aria-modal="true" aria-live="assertive">
      <div className="belt-denial-snow" aria-hidden="true">
        {SNOW.map((column, index) => (
          <span key={index}>{column}</span>
        ))}
      </div>
      <div className="belt-denial-panel">
        <p className="belt-gate-kicker" style={{ color: '#ff8a7a' }}>
          O.M.V // INTERNAL LINK CHECK
        </p>
        <h1>PROTOCOL DENIED</h1>
        <p>
          {reason ?? (
            <>
              协议拒绝：未授权链路
              <br />
              [站长] 身份标签缺失
            </>
          )}
        </p>
        <div className="belt-denial-count">
          LINK PURGE IN <b>0{count}</b> … 强制断开
        </div>
      </div>
      <span className="belt-sr-only">协议拒绝。未授权链路。三秒后强制返回文明环带。</span>
    </div>
  );
}
