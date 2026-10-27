'use client';

import Link from 'next/link';

const TABS = [
  { key: 'channel', label: '频段', en: 'CHANNEL', href: '/belt/channel', icon: '⌁' },
  { key: 'telegraph', label: '新闻', en: 'NEWS', href: '/belt/telegraph', icon: '▤' },
  { key: 'daily', label: '日常', en: 'DAILY', href: '/belt/daily', icon: '✎' },
  { key: 'profile', label: '我的', en: 'ME', href: '/belt/profile', icon: '◉' },
];

const MODERATION_TAB = { key: 'moderation', label: '风纪', en: 'TRIBUNAL', href: '/belt/moderation', icon: '⚖' };

export function BeltMobileTabs({ activeView, canModerate = false }: { activeView: string; canModerate?: boolean }) {
  const active = activeView === 'dispatch' ? 'telegraph' : activeView;
  const tabs = canModerate ? [...TABS, MODERATION_TAB] : TABS;
  return (
    <nav className={`belt-mobile-tabs${canModerate ? ' is-wide' : ''}`} aria-label="移动端主导航">
      {tabs.map((tab) => (
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
