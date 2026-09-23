import type { CSSProperties } from 'react';

const paths = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
  upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M15 8V4H4v11h4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 6a8 8 0 0 1 13.1 2M4.8 16A8 8 0 0 0 18 18" /></>,
  network: <><circle cx="12" cy="12" r="3" /><circle cx="4" cy="4" r="2" /><circle cx="20" cy="5" r="2" /><circle cx="19" cy="20" r="2" /><circle cx="4" cy="20" r="2" /><path d="m6 6 4 4m4 0 4-4M10 14l-4 4m8-4 4 4" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
  sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" /></>,
};

export default function Icon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
