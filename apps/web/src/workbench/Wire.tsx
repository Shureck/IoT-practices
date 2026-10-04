// Отрисовка провода: тень, светлая обводка для тёмных проводов (чтобы чёрный GND был виден на тёмном поле).
import { polyPath, type Pt } from '@esp32lab/sim';

const NAMED: Record<string, string> = { black: '#000000', navy: '#000080', brown: '#8b4513', gray: '#808080', grey: '#808080', purple: '#800080' };

/** Тёмный ли цвет (провод сольётся с тёмным фоном). */
export function isDarkColor(color: string): boolean {
  let c = NAMED[color.toLowerCase()] ?? color;
  if (!c.startsWith('#')) return false;
  if (c.length === 4) c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  const n = parseInt(c.slice(1, 7), 16);
  const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 70;
}

export function WireShape({ path, color, selected }: { path: Pt[]; color: string; selected?: boolean }) {
  const d = polyPath(path);
  const dark = isDarkColor(color);
  return (
    <>
      {selected && <path d={d} stroke="var(--accent)" strokeWidth={5} fill="none" opacity={0.55} strokeLinecap="round" strokeLinejoin="round" />}
      <path d={d} stroke="rgba(0,0,0,0.35)" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(0.6,0.8)" />
      {dark && <path d={d} stroke="var(--wire-halo)" strokeWidth={3.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      <path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** Узел: точка ответвления проводов одной цепи. */
export function Junction({ x, y, color }: { x: number; y: number; color: string }) {
  return <circle cx={x} cy={y} r={2.5} fill={color} stroke={isDarkColor(color) ? 'var(--wire-halo)' : 'rgba(0,0,0,0.45)'} strokeWidth={0.9} pointerEvents="none" />;
}
