'use client';

import { FileIcon, ImageIcon } from './icons';

const KIND_LABEL: Record<string, string> = {
  material: '素材',
  artwork: '作品',
  idea: '灵感',
  vote: '投票',
  task: '任务',
  music: '音乐',
  chart: '图表',
};

/**
 * 纯 CSS 档案封面：无图文本/灵感卡不再显示 NO PREVIEW。
 * 极简网格 + 大号编号 + 类型图标，和终端档案室保持同一套语法。
 */
export function ArchiveCover({
  id,
  kind,
  size = 'card',
  hasImage = false,
}: {
  id: string;
  kind: string;
  size?: 'card' | 'drawer';
  hasImage?: boolean;
}) {
  const label = KIND_LABEL[kind] ?? kind;
  return (
    <span className={`archive-cover archive-cover--${size}`} data-kind={kind}>
      <span className="archive-cover-grid" aria-hidden="true" />
      <span className="archive-cover-index">{id.slice(0, 6).toUpperCase()}</span>
      <span className="archive-cover-mark" aria-hidden="true">
        {hasImage ? <ImageIcon size={size === 'drawer' ? 22 : 18} /> : <FileIcon size={size === 'drawer' ? 22 : 18} />}
      </span>
      <span className="archive-cover-kind">
        {hasImage ? 'IMAGE RECORD' : `${label.toUpperCase()} / ${kind.toUpperCase()}`}
      </span>
      <span className="archive-cover-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
