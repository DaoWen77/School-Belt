import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../styles/tokens.css';
import '../styles/app.css';
import 'highlight.js/styles/github.css';
import '../styles/tailwind.css';
import '../styles/im.css';
import '../styles/workspace.css';
import '../styles/sprint4.css';
import '../styles/motion.css';
import '../styles/identity.css';
import '../styles/belt.css';
import '../styles/rtc.css';
import '../styles/rtc-media.css';
import '../styles/rtc-conference.css';
import '../styles/rtc-entry.css';
import '../styles/drawer.css';
import '../styles/archive.css';

export const metadata: Metadata = {
  title: 'O.M.V 帝江号 · 全域广播',
  description: '邀请制协作空间：频道、私聊、群聊与实时消息（真实 API / WS）',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F4F4F2',
};

const THEME_BOOT = "try{var t=localStorage.getItem('dj-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-CN"
      data-theme="light"
      data-ef-accent="yellow"
      data-ef-paper="neutral"
      data-ef-cut="standard"
      data-ef-ground="hatch"
      data-ef-density="standard"
      data-ef-motion="full"
    >
      <body className="ef dj im-body">
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {children}
      </body>
    </html>
  );
}
