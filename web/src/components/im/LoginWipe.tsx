'use client';

import { useEffect, useState } from 'react';

/** 登录成功后的全屏斜切快门：登录页写 sessionStorage，主界面播一次 360ms。 */
export function LoginWipe() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let active = false;
    try {
      active = window.sessionStorage.getItem('dj-login-wipe') === '1';
      if (active) window.sessionStorage.removeItem('dj-login-wipe');
    } catch {
      active = false;
    }
    if (!active) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setShow(true);
    const timer = window.setTimeout(() => setShow(false), 400);
    return () => window.clearTimeout(timer);
  }, []);

  return show ? <div className="motion-wipe" aria-hidden="true" /> : null;
}
