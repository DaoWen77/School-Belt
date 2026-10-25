import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12l16-7-6 16-3-7-7-2z" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="5" width="16" height="14" />
      <path d="M4 15l4-4 4 4 3-3 5 5" />
      <circle cx="9" cy="9" r="1.2" />
    </svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v5h5M10 13h6M10 16h6" />
    </svg>
  );
}

export function VoteIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </svg>
  );
}

export function TaskIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M8 12l3 3 5-6" />
    </svg>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 12l6-6a3 3 0 014 4l-8 8a5 5 0 01-7-7l7-7" />
    </svg>
  );
}

export function DownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h9M17 18h3" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="15" cy="18" r="2" />
    </svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 4H5v16h5M14 8l4 4-4 4M9 12h9" />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7" />
    </svg>
  );
}

export function MusicIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20V4M4 20h16" />
      <path d="M7 16l4-5 3 3 5-7" />
    </svg>
  );
}

export function StickerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 5h14v9l-5 5H5z" />
      <path d="M14 19v-5h5M8 9h8M8 12h5" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="8" y="8" width="11" height="11" />
      <path d="M5 15V5h10" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 4l12 8-12 8z" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 4v16M17 4v16" />
    </svg>
  );
}

export function SkipBackIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18 5v14L8 12zM6 5v14" />
    </svg>
  );
}

export function SkipForwardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 5v14l10-7zM18 5v14" />
    </svg>
  );
}

export function RadarIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 12l6-4M12 4v2M20 12h-2" />
    </svg>
  );
}

export function ArchiveIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h16v4H4zM6 10v10h12V10M9 14h6" />
    </svg>
  );
}

export function MomentsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4c3 4 3 12 0 16M4 12h16" />
    </svg>
  );
}
