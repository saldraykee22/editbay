import type { SVGProps } from 'react';

const paths: Record<string, string> = {
  chat: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.2A2.5 2.5 0 0 1 4 12.5z',
  film: 'M3 5.5h18v13H3zM7 5.5v13M17 5.5v13M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4',
  media: 'M4 6.5h16v11H4zM4 6.5l5.5 5 3-2.5 3.5 3.5 3.5-3',
  brain: 'M9 4.5a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 5 9.5a2.5 2.5 0 0 0 0 5 2.5 2.5 0 0 0 1.5 4.5A2.5 2.5 0 0 0 9 19.5a2 2 0 0 0 2-2v-11a2 2 0 0 0-2-2zM15 4.5a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 19 9.5a2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 1-1.5 4.5 2.5 2.5 0 0 1-2.5.5 2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z',
  sparkles: 'M12 3.5l1.6 4.2 4.4 1.8-4.4 1.8L12 15.5l-1.6-4.2L6 9.5l4.4-1.8zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13a7.8 7.8 0 0 0 0-2l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.3-.9-2 3.4L6.6 11a7.8 7.8 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.3.9 2-3.4z',
  play: 'M8 5.5l11 6.5-11 6.5z',
  pause: 'M8.5 5.5v13M15.5 5.5v13',
  undo: 'M9 7L4 11l5 4M4 11h9a6 6 0 0 1 6 6',
  redo: 'M15 7l5 4-5 4M20 11h-9a6 6 0 0 0-6 6',
  scissors: 'M7 4l10 14M17 4L7 18M5.5 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  download: 'M12 4v11M8 11l4 4 4-4M5 19h14',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13M10.5 11v5M13.5 11v5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  key: 'M14 4a5 5 0 1 1-4.6 7L4 16.4V20h3.6l1.5-1.5V17H11v-1.5h1.5L14 14a5 5 0 0 0 0-10z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  send: 'M4 11.5L20 4l-7.5 16-1.8-6.7z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  wand: 'M5 19L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 10l.8 1.6L21 12l-1.2.4L19 14l-.8-1.6L17 12l1.2-.4z',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  brand: 'M12 3l2.6 6.1L21 12l-6.4 2.9L12 21l-2.6-6.1L3 12l6.4-2.9z',
  music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  volume: 'M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  volumeOff: 'M11 5L6 9H3v6h3l5 4V5zM21 9l-6 6M15 9l6 6',
  fit: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4',
  type: 'M5 6h14M12 6v13M9 19h6',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
  eyeOff: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM4 4l16 16',
  save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 15h8',
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: keyof typeof paths | string;
  size?: number;
}

export function Icon({ name, size = 16, strokeWidth = 1.4, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name] ?? paths.grid!} />
    </svg>
  );
}

export function BrandMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="brand-mark">
      <path d="M3 4h6v16H3z" fill="currentColor" opacity="0.9" />
      <path d="M11 4h4v16h-4z" fill="currentColor" opacity="0.45" />
      <path d="M17 4h4v10h-4z" fill="currentColor" />
      <path d="M3 21h18" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
    </svg>
  );
}
