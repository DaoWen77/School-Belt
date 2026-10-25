'use client';

import Link from 'next/link';

const TABS = [
  { key: 'channel', label: '频段', en: 'CHANNEL', href: '/belt/channel', icon: '⌁' },
  { key: 'telegraph', label: '新闻', en: 'NEWS', href: '/belt/telegraph', icon: '▤' },
  { key: 'daily', label: '日常', en: 'DAILY', href: '/belt/daily', icon: '✎' },
  { key: 'profile', label: '我的', en: 'ME', href: '/belt/profile', icon: '◉' },
];

export function BeltMobileTabs({ activeView }: { activeView: string }) {
  const active = activeView === 'dispatch' ? 'telegraph' : activeView;
  return (
    <nav className="belt-mobile-tabs" aria-label="移动端主导航">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`belt-mobile-tab${active === tab.key ? ' is-active' : ''}`}
          aria-current={active === tab.key ? 'page' : undefined}
        >
          <span className="belt-mobile-tab-icon">{tab.icon}</span>
          <b>{tab.label}</b>
          <small>{tab.en}</small>
        </Link>
      ))}
    </nav>
  );
}
