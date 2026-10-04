// Отрисовка компонентов схемы (SVG, локальные координаты как в defs.ts).
import { memo, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { DEFS, glyph, propValue, type Part } from '@esp32lab/sim';

export interface PartViewProps {
  part: Part;
  view?: Record<string, unknown>;
  running: boolean;
  /** модель из симуляции (для тяжёлых данных: буфер OLED) */
  model?: unknown;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const prop = (p: Part, k: string) => propValue(p, k);

const LED_RGB: Record<string, [number, number, number]> = {
  red: [255, 40, 40], green: [40, 230, 90], yellow: [255, 220, 40], blue: [50, 120, 255], white: [255, 255, 245], orange: [255, 140, 20],
};

function Glow({ cx, cy, r, color, k }: { cx: number; cy: number; r: number; color: string; k: number }) {
  if (k <= 0.02) return null;
  const id = `g${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <g pointerEvents="none">
      <defs>
        <radialGradient id={id}>
          <stop offset="0%" stopColor={color} stopOpacity={0.9} />
          <stop offset="45%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} opacity={Math.min(1, k * 1.15)} />
    </g>
  );
}

// ---------------- ESP32 DevKit ----------------
const Esp32 = memo(function Esp32({ part, view }: PartViewProps) {
  const def = DEFS.esp32;
  const led = num(view?.led);
  const power = view?.power !== false;
  return (
    <g>
      <rect x={-2} y={-2} width={224} height={104} rx={7} fill="#000" opacity={0.25} />
      <rect x={0} y={0} width={220} height={100} rx={6} fill="#0f1b2b" stroke="#24364f" strokeWidth={1.2} />
      {/* USB */}
      <rect x={-8} y={38} width={20} height={24} rx={2} fill="#b8c2cc" stroke="#7d8894" />
      <rect x={-6} y={43} width={10} height={14} rx={1} fill="#4b5563" />
      {/* кнопки EN / BOOT */}
      <rect x={18} y={24} width={10} height={10} rx={1.5} fill="#cbd5e1" /><circle cx={23} cy={29} r={3} fill="#475569" />
      <rect x={18} y={66} width={10} height={10} rx={1.5} fill="#cbd5e1" /><circle cx={23} cy={71} r={3} fill="#475569" />
      <text x={23} y={21} fontSize={4} fill="#94a3b8" textAnchor="middle">EN</text>
      <text x={23} y={83} fontSize={4} fill="#94a3b8" textAnchor="middle">BOOT</text>
      {/* светодиоды */}
      <circle cx={38} cy={44} r={2.6} fill={power ? '#ff3b3b' : '#4b1d1d'} />
      <Glow cx={38} cy={44} r={9} color="#ff4040" k={power ? 0.6 : 0} />
      <circle cx={38} cy={56} r={2.6} fill={led > 0.05 ? '#5aa9ff' : '#1d3150'} />
      <Glow cx={38} cy={56} r={13} color="#3b82f6" k={led} />
      <text x={44} y={45.5} fontSize={3.4} fill="#64748b">PWR</text>
      <text x={44} y={57.5} fontSize={3.4} fill="#64748b">IO2</text>
      {/* модуль WROOM */}
      <rect x={64} y={27} width={110} height={46} rx={2} fill="#1e293b" />
      <rect x={68} y={30} width={84} height={40} rx={2} fill="url(#espShield)" stroke="#9aa5b1" strokeWidth={0.6} />
      <defs>
        <linearGradient id="espShield" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#e5e9ef" />
          <stop offset="1" stopColor="#aab4c0" />
        </linearGradient>
      </defs>
      <text x={110} y={46} fontSize={6.2} fontWeight={700} fill="#334155" textAnchor="middle" fontFamily="Inter">ESP32</text>
      <text x={110} y={54} fontSize={3.6} fill="#475569" textAnchor="middle" fontFamily="Inter">WROOM-32 · Wi-Fi + BT</text>
      <text x={110} y={62} fontSize={3} fill="#64748b" textAnchor="middle" fontFamily="JetBrains Mono">240 MHz · 520 KB</text>
      <path d="M156 34 h12 v6 h-8 v6 h8 v6 h-8 v6 h8 v6 h-12" fill="none" stroke="#d4a72c" strokeWidth={1.4} />
      <text x={196} y={52} fontSize={4.2} fill="#64748b" textAnchor="middle" transform="rotate(90 196 52)">DEVKIT V1</text>
      {/* выводы */}
      {def.pins.map((pin) => {
        const top = pin.y < 50;
        const kind = pin.kind;
        const color = kind === 'gnd' ? '#94a3b8' : kind === '3v3' || kind === '5v' ? '#f87171' : '#e2e8f0';
        return (
          <g key={pin.name}>
            <rect x={pin.x - 3.4} y={pin.y - 3.4} width={6.8} height={6.8} rx={1} fill="#111827" stroke="#d4a72c" strokeWidth={0.9} />
            <circle cx={pin.x} cy={pin.y} r={1.5} fill="#d4a72c" />
            <text
              x={pin.x} y={top ? pin.y + 6 : pin.y - 6} fontSize={3.6} fill={color} fontFamily="JetBrains Mono"
              textAnchor={top ? 'end' : 'start'} transform={`rotate(-90 ${pin.x} ${top ? pin.y + 6 : pin.y - 6})`}
              dominantBaseline="middle"
            >
              {pin.label}
            </text>
          </g>
        );
      })}
      {part.locked ? null : null}
    </g>
  );
});

// ---------------- макетная плата ----------------
const Breadboard = memo(function Breadboard() {
  const def = DEFS.breadboard;
  return (
    <g>
      <rect x={0} y={0} width={340} height={210} rx={6} fill="#f1f1ea" stroke="#d6d3c4" />
      <rect x={0} y={100} width={340} height={10} fill="#e4e1d3" />
      {[4, 24, 184, 204].map((y, i) => (
        <line key={y} x1={14} x2={326} y1={y + (i % 2 ? 0 : 0)} y2={y} stroke={i === 0 || i === 3 ? '#3b82f6' : '#ef4444'} strokeWidth={1} opacity={0.75} />
      ))}
      <text x={8} y={12} fontSize={7} fill="#3b82f6">−</text><text x={8} y={23} fontSize={7} fill="#ef4444">+</text>
      <text x={8} y={193} fontSize={7} fill="#ef4444">+</text><text x={8} y={204} fontSize={7} fill="#3b82f6">−</text>
      {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((r) => {
        const y = { a: 50, b: 60, c: 70, d: 80, e: 90, f: 120, g: 130, h: 140, i: 150, j: 160 }[r]!;
        return <text key={r} x={8} y={y + 2.4} fontSize={6} fill="#a8a29e" fontFamily="JetBrains Mono">{r}</text>;
      })}
      {Array.from({ length: 30 }, (_, c) => (c % 5 === 0 || c === 29 ? (
        <text key={c} x={20 + c * 10} y={42} fontSize={5} fill="#a8a29e" textAnchor="middle" fontFamily="JetBrains Mono">{c + 1}</text>
      ) : null))}
      {def.pins.map((pin) => (
        <rect key={pin.name} x={pin.x - 2.3} y={pin.y - 2.3} width={4.6} height={4.6} rx={0.8} fill="#3f3f46" opacity={0.85} />
      ))}
    </g>
  );
});

// ---------------- светодиод ----------------
const Led = memo(function Led({ part, view }: PartViewProps) {
  const color = String(prop(part, 'color'));
  const [r, g, b] = LED_RGB[color] ?? LED_RGB.red;
  const k = num(view?.b);
  const burnt = !!view?.burnt;
  const base = `rgb(${Math.round(r * 0.55)},${Math.round(g * 0.55)},${Math.round(b * 0.55)})`;
  const lit = `rgb(${r},${g},${b})`;
  return (
    <g>
      <line x1={0} y1={0} x2={0} y2={-13} stroke="#9ca3af" strokeWidth={1.4} />
      <path d="M10 0 V-8 L12 -11 V-13" fill="none" stroke="#9ca3af" strokeWidth={1.4} />
      <Glow cx={5} cy={-26} r={26} color={lit} k={burnt ? 0 : k} />
      <path d="M-3 -13 h16 v-15 a8 8 0 0 0 -16 0 z" fill={burnt ? '#2a2a2a' : base} stroke={burnt ? '#111' : `rgba(${r},${g},${b},0.9)`} strokeWidth={0.8}
        opacity={burnt ? 1 : 0.92} />
      {!burnt && <path d="M-3 -13 h16 v-15 a8 8 0 0 0 -16 0 z" fill={lit} opacity={Math.min(1, k * 1.2)} />}
      <rect x={-4} y={-15} width={18} height={2.4} rx={1} fill={burnt ? '#222' : base} opacity={0.9} />
      <ellipse cx={1.5} cy={-30} rx={2} ry={4} fill="#fff" opacity={burnt ? 0.05 : 0.35} />
      {burnt && (
        <g opacity={0.8}>
          <circle cx={4} cy={-42} r={4} fill="#6b7280" className="pulse-soft" />
          <circle cx={8} cy={-49} r={3} fill="#9ca3af" className="pulse-soft" />
        </g>
      )}
      {view?.over && !burnt ? <text x={18} y={-30} fontSize={8}>🔥</text> : null}
    </g>
  );
});

// ---------------- резистор ----------------
const BAND = ['#111', '#7c4a1e', '#dc2626', '#f97316', '#facc15', '#16a34a', '#2563eb', '#7c3aed', '#6b7280', '#f8fafc'];
function bands(ohm: number): string[] {
  let v = ohm;
  let mult = 0;
  while (v >= 100) { v = Math.round(v / 10); mult++; }
  if (v < 10) { return [BAND[0], BAND[Math.round(v)], BAND[Math.max(0, mult)], '#c8a24a']; }
  const d1 = Math.floor(v / 10);
  const d2 = v % 10;
  return [BAND[d1], BAND[d2], mult < 10 ? BAND[mult] : '#c8a24a', '#c8a24a'];
}
const Resistor = memo(function Resistor({ part }: PartViewProps) {
  const ohm = num(prop(part, 'value'), 220);
  const bs = bands(ohm);
  return (
    <g>
      <line x1={0} y1={0} x2={40} y2={0} stroke="#9ca3af" strokeWidth={1.4} />
      <rect x={8} y={-5} width={24} height={10} rx={4.5} fill="#e4cfa3" stroke="#c9ad75" strokeWidth={0.6} />
      {bs.map((c, i) => <rect key={i} x={11.5 + i * 4.6 + (i === 3 ? 2.5 : 0)} y={-5} width={2.4} height={10} fill={c} />)}
    </g>
  );
});

// ---------------- кнопка ----------------
const CAP: Record<string, string> = { red: '#ef4444', green: '#22c55e', blue: '#3b82f6', yellow: '#facc15', black: '#1f2937', white: '#f1f5f9' };
const Button = memo(function Button({ part, view }: PartViewProps) {
  const pressed = !!view?.pressed;
  const cap = CAP[String(prop(part, 'color'))] ?? CAP.red;
  const label = String(prop(part, 'label') ?? '');
  const key = String(prop(part, 'key') ?? '');
  return (
    <g style={{ cursor: 'pointer' }}>
      <line x1={0} y1={0} x2={0} y2={-6} stroke="#9ca3af" strokeWidth={1.4} />
      <line x1={20} y1={0} x2={20} y2={-6} stroke="#9ca3af" strokeWidth={1.4} />
      <rect x={-4} y={-25} width={28} height={20} rx={2.5} fill="#2d3748" stroke="#1a202c" />
      <circle cx={-1} cy={-22} r={1} fill="#111" /><circle cx={21} cy={-22} r={1} fill="#111" />
      <circle cx={-1} cy={-8} r={1} fill="#111" /><circle cx={21} cy={-8} r={1} fill="#111" />
      <circle cx={10} cy={-15} r={pressed ? 6.2 : 7} fill={cap} stroke="rgba(0,0,0,0.35)" strokeWidth={pressed ? 1.6 : 0.8} />
      {!pressed && <circle cx={8} cy={-17.5} r={2.4} fill="#fff" opacity={0.25} />}
      {label && <text x={10} y={-29} fontSize={6} textAnchor="middle" fill="var(--muted)" fontFamily="Inter">{label}</text>}
      {key && <text x={10} y={-12.6} fontSize={5.5} textAnchor="middle" fill="#fff" fontWeight={700} opacity={0.8}>{key.toUpperCase()}</text>}
    </g>
  );
});

const Switch = memo(function Switch({ view }: PartViewProps) {
  const on = !!view?.on;
  return (
    <g style={{ cursor: 'pointer' }}>
      {[0, 10, 20].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={-6} stroke="#9ca3af" strokeWidth={1.4} />)}
      <rect x={-5} y={-20} width={30} height={14} rx={2} fill="#1f2937" stroke="#374151" />
      <rect x={-1} y={-16.5} width={22} height={7} rx={1.5} fill="#111827" />
      <rect x={on ? 11 : 0} y={-17.5} width={10} height={9} rx={1.5} fill="#e5e7eb" style={{ transition: 'x 0.15s' }} />
    </g>
  );
});

const Pot = memo(function Pot({ part, view }: PartViewProps) {
  const pos = num(view?.pos, num(prop(part, 'position'), 50));
  const ang = -135 + (pos / 100) * 270;
  return (
    <g style={{ cursor: 'pointer' }}>
      {[0, 10, 20].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={-8} stroke="#9ca3af" strokeWidth={1.4} />)}
      <rect x={-9} y={-40} width={38} height={33} rx={3} fill="#1d4ed8" stroke="#1e3a8a" />
      <circle cx={10} cy={-24} r={12} fill="#cbd5e1" stroke="#64748b" />
      <g transform={`rotate(${ang} 10 -24)`}>
        <circle cx={10} cy={-24} r={8.5} fill="#e2e8f0" />
        <rect x={9} y={-33} width={2} height={8} rx={1} fill="#1e293b" />
      </g>
      <text x={10} y={-4} fontSize={4.5} textAnchor="middle" fill="#93c5fd" fontFamily="JetBrains Mono">{Math.round(pos)}%</text>
    </g>
  );
});

const Ldr = memo(function Ldr({ view }: PartViewProps) {
  const lux = num(view?.lux, 300);
  return (
    <g>
      <line x1={0} y1={0} x2={0} y2={-10} stroke="#9ca3af" strokeWidth={1.4} />
      <line x1={10} y1={0} x2={10} y2={-10} stroke="#9ca3af" strokeWidth={1.4} />
      <circle cx={5} cy={-17} r={9} fill="#f1e2c4" stroke="#b9a37c" />
      <path d="M-1 -21 h12 M-1 -17 h12 M-1 -13 h12 M11 -21 v4 M-1 -17 v4" stroke="#b45309" strokeWidth={1.1} fill="none" />
      <text x={5} y={-29} fontSize={5} textAnchor="middle" fill="var(--muted)">☀ {lux >= 1000 ? `${(lux / 1000).toFixed(1)}k` : Math.round(lux)} лк</text>
    </g>
  );
});

const Rgb = memo(function Rgb({ view }: PartViewProps) {
  const r = num(view?.r); const g = num(view?.g); const b = num(view?.b);
  const k = Math.max(r, g, b);
  const col = `rgb(${Math.round(55 + 200 * Math.min(1, r * 1.2))},${Math.round(55 + 200 * Math.min(1, g * 1.2))},${Math.round(55 + 200 * Math.min(1, b * 1.2))})`;
  return (
    <g>
      {[0, 10, 20, 30].map((x, i) => <line key={x} x1={x} y1={0} x2={x} y2={i === 1 ? -14 : -12} stroke="#9ca3af" strokeWidth={1.4} />)}
      <Glow cx={15} cy={-26} r={30} color={col} k={k} />
      <path d="M3 -12 h24 v-15 a12 12 0 0 0 -24 0 z" fill="#e5e7eb" opacity={0.75} stroke="#cbd5e1" />
      <path d="M3 -12 h24 v-15 a12 12 0 0 0 -24 0 z" fill={col} opacity={Math.min(0.95, k * 1.3)} />
      <text x={0} y={4.5} fontSize={4} textAnchor="middle" fill="#ef4444">R</text>
      <text x={20} y={4.5} fontSize={4} textAnchor="middle" fill="#22c55e">G</text>
      <text x={30} y={4.5} fontSize={4} textAnchor="middle" fill="#3b82f6">B</text>
    </g>
  );
});

const Buzzer = memo(function Buzzer({ part, view }: PartViewProps) {
  const f = num(view?.freq);
  return (
    <g>
      <line x1={0} y1={0} x2={0} y2={-6} stroke="#ef4444" strokeWidth={1.4} />
      <line x1={10} y1={0} x2={10} y2={-6} stroke="#9ca3af" strokeWidth={1.4} />
      <circle cx={5} cy={-17} r={13} fill="#111827" stroke="#374151" strokeWidth={1.4} />
      <circle cx={5} cy={-17} r={3} fill="#030712" />
      <text x={-6} y={-24} fontSize={6} fill="#f87171">+</text>
      <text x={5} y={-34} fontSize={4.5} textAnchor="middle" fill="var(--faint)">{prop(part, 'kind') === 'active' ? 'активная' : 'пассивная'}</text>
      {f > 0 && (
        <g stroke="#22d3ee" fill="none" strokeWidth={1.3} className="pulse-soft">
          <path d="M22 -24 q5 7 0 14" /><path d="M26 -28 q8 11 0 22" />
          <text x={34} y={-15} fontSize={5} fill="#22d3ee" stroke="none">{Math.round(f)} Гц</text>
        </g>
      )}
    </g>
  );
});

const Relay = memo(function Relay({ view }: PartViewProps) {
  const on = !!view?.on;
  return (
    <g>
      <rect x={0} y={0} width={90} height={42} rx={3} fill="#1e40af" stroke="#1e3a8a" />
      <rect x={22} y={5} width={36} height={30} rx={2} fill="#2563eb" stroke="#1e3a8a" />
      <text x={40} y={18} fontSize={4.3} textAnchor="middle" fill="#dbeafe" fontFamily="Inter" fontWeight={600}>SRD-05VDC</text>
      <text x={40} y={25} fontSize={3.5} textAnchor="middle" fill="#bfdbfe">10A 250VAC</text>
      <circle cx={13} cy={36} r={2.2} fill={on ? '#ef4444' : '#450a0a'} />
      <Glow cx={13} cy={36} r={8} color="#ef4444" k={on ? 0.8 : 0} />
      <rect x={66} y={4} width={20} height={32} rx={1.5} fill="#16a34a" stroke="#14532d" />
      {[10, 20, 30].map((y) => <circle key={y} cx={76} cy={y} r={3} fill="#d1d5db" stroke="#6b7280" />)}
      {['VCC', 'GND', 'IN'].map((t, i) => <text key={t} x={4} y={11.5 + i * 10} fontSize={4} fill="#bfdbfe" fontFamily="JetBrains Mono">{t}</text>)}
      {['NO', 'COM', 'NC'].map((t, i) => <text key={t} x={64} y={11.5 + i * 10} fontSize={3.6} fill="#bbf7d0" textAnchor="end" fontFamily="JetBrains Mono">{t}</text>)}
      <path d={on ? 'M70 20 L70 10' : 'M70 20 L70 30'} stroke="#fde047" strokeWidth={1.4} />
    </g>
  );
});

const Motor = memo(function Motor({ view }: PartViewProps) {
  const lvl = num(view?.level);
  const spinning = lvl > 0.05;
  return (
    <g>
      <line x1={0} y1={0} x2={0} y2={-6} stroke="#ef4444" strokeWidth={1.4} />
      <line x1={20} y1={0} x2={20} y2={-6} stroke="#9ca3af" strokeWidth={1.4} />
      <rect x={-14} y={-50} width={48} height={44} rx={6} fill="#1f2937" stroke="#374151" />
      <circle cx={10} cy={-28} r={19} fill="#0b1220" />
      <g style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: spinning ? `spin ${Math.max(0.08, 0.6 / lvl)}s linear infinite` : undefined }}>
        <circle cx={10} cy={-28} r={18} fill="none" />
        {[0, 72, 144, 216, 288].map((a) => (
          <path key={a} d="M10 -28 q6 -6 4 -16 q-6 2 -4 16" fill="#60a5fa" transform={`rotate(${a} 10 -28)`} opacity={0.9} />
        ))}
      </g>
      <circle cx={10} cy={-28} r={3.5} fill="#cbd5e1" />
      {[[-10, -46], [30, -46], [-10, -10], [30, -10]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.6} fill="#6b7280" />)}
    </g>
  );
});

const Lamp = memo(function Lamp({ view }: PartViewProps) {
  const lvl = num(view?.level);
  return (
    <g>
      <line x1={0} y1={0} x2={0} y2={-8} stroke="#9ca3af" strokeWidth={1.4} />
      <line x1={20} y1={0} x2={20} y2={-8} stroke="#9ca3af" strokeWidth={1.4} />
      <Glow cx={10} cy={-26} r={36} color="#fde68a" k={lvl} />
      <rect x={2} y={-14} width={16} height={8} rx={1.5} fill="#a8a29e" />
      <path d="M3 -14 c-10 -10 -6 -26 7 -26 c13 0 17 16 7 26 z" fill={lvl > 0.05 ? `rgba(253,230,138,${0.35 + lvl * 0.6})` : 'rgba(226,232,240,0.35)'} stroke="#d6d3d1" />
      <path d="M7 -15 l1.5 -10 l2 3 l2 -3 l1.5 10" fill="none" stroke={lvl > 0.05 ? '#f59e0b' : '#78716c'} strokeWidth={0.9} />
    </g>
  );
});

const Lock = memo(function Lock({ view }: PartViewProps) {
  const open = num(view?.level) > 0.5;
  return (
    <g>
      <line x1={0} y1={0} x2={0} y2={-6} stroke="#ef4444" strokeWidth={1.4} />
      <line x1={20} y1={0} x2={20} y2={-6} stroke="#9ca3af" strokeWidth={1.4} />
      <rect x={-14} y={-40} width={36} height={34} rx={3} fill="#52525b" stroke="#27272a" />
      <rect x={-10} y={-36} width={28} height={26} rx={2} fill="#71717a" />
      <rect x={open ? 18 : 22} y={-27} width={14} height={8} rx={1.5} fill="#d4d4d8" stroke="#a1a1aa" style={{ transition: 'x 0.2s' }} />
      <text x={4} y={-44} fontSize={5.5} textAnchor="middle" fill={open ? '#34d399' : 'var(--muted)'} fontWeight={600}>{open ? 'ОТКРЫТО' : 'ЗАКРЫТО'}</text>
    </g>
  );
});

const Servo = memo(function Servo({ part, view }: PartViewProps) {
  const angle = num(view?.angle, 90);
  const horn = String(prop(part, 'horn'));
  const rot = 90 - angle;
  return (
    <g>
      <path d="M0 0 V-14 Q0 -22 6 -24" stroke="#78350f" strokeWidth={1.8} fill="none" />
      <path d="M10 0 V-24" stroke="#dc2626" strokeWidth={1.8} fill="none" />
      <path d="M20 0 V-14 Q20 -22 14 -24" stroke="#f97316" strokeWidth={1.8} fill="none" />
      <rect x={-20} y={-64} width={60} height={40} rx={3} fill="#1d4ed8" stroke="#1e3a8a" />
      <rect x={-26} y={-52} width={72} height={6} rx={1.5} fill="#1e40af" />
      <circle cx={-22} cy={-49} r={1.6} fill="#0b1220" /><circle cx={42} cy={-49} r={1.6} fill="#0b1220" />
      <text x={10} y={-30} fontSize={5} textAnchor="middle" fill="#bfdbfe" fontWeight={600}>SG90</text>
      <circle cx={22} cy={-58} r={8} fill="#e5e7eb" />
      <g transform={`rotate(${-rot} 22 -58)`} style={{ transition: 'transform 0.05s linear' }}>
        {horn === 'barrier' ? (
          <g>
            <rect x={18} y={-61} width={70} height={6} rx={2} fill="#fff" stroke="#9ca3af" strokeWidth={0.5} />
            {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={26 + i * 13} y={-61} width={6.5} height={6} fill="#dc2626" />)}
          </g>
        ) : horn === 'pointer' ? (
          <path d="M22 -61 L52 -58 L22 -55 Z" fill="#f8fafc" stroke="#94a3b8" strokeWidth={0.6} />
        ) : (
          <rect x={18} y={-61} width={28} height={6} rx={3} fill="#f8fafc" stroke="#94a3b8" strokeWidth={0.6} />
        )}
      </g>
      <circle cx={22} cy={-58} r={2.4} fill="#94a3b8" />
      <text x={10} y={-68} fontSize={5} textAnchor="middle" fill="var(--muted)" fontFamily="JetBrains Mono">{Math.round(angle)}°</text>
    </g>
  );
});

const Dht = memo(function Dht({ part, view, running }: PartViewProps) {
  const dht11 = prop(part, 'model') === 'DHT11';
  const fill = dht11 ? '#3b82f6' : '#f8fafc';
  const hole = dht11 ? '#1e3a8a' : '#cbd5e1';
  return (
    <g>
      {[0, 10, 20, 30].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={-8} stroke="#9ca3af" strokeWidth={1.4} />)}
      <rect x={-5} y={-58} width={40} height={50} rx={3} fill={fill} stroke={dht11 ? '#1e40af' : '#cbd5e1'} />
      {Array.from({ length: 5 }, (_, r) => Array.from({ length: 4 }, (_, c) => (
        <rect key={`${r}${c}`} x={0 + c * 8.5} y={-53 + r * 7} width={5} height={4} rx={1} fill={hole} />
      )))}
      <text x={15} y={-12} fontSize={5} textAnchor="middle" fill={dht11 ? '#dbeafe' : '#64748b'} fontWeight={600}>{dht11 ? 'DHT11' : 'DHT22'}</text>
      {running && (
        <g>
          <rect x={38} y={-56} width={42} height={22} rx={4} fill="var(--panel)" stroke="var(--border)" />
          <text x={42} y={-47} fontSize={6} fill="#f97316" fontFamily="JetBrains Mono">{num(view?.t).toFixed(1)}°C</text>
          <text x={42} y={-38} fontSize={6} fill="#38bdf8" fontFamily="JetBrains Mono">{num(view?.h).toFixed(0)}%</text>
        </g>
      )}
    </g>
  );
});

const Hcsr = memo(function Hcsr({ view, running }: PartViewProps) {
  const d = num(view?.d, 100);
  return (
    <g>
      {[0, 10, 20, 30].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={-6} stroke="#9ca3af" strokeWidth={1.4} />)}
      <rect x={-34} y={-48} width={98} height={42} rx={3} fill="#1e3a8a" stroke="#172554" />
      {[-12, 42].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={-27} r={16} fill="#cbd5e1" stroke="#64748b" />
          <circle cx={cx} cy={-27} r={12} fill="#334155" />
          <circle cx={cx} cy={-27} r={9} fill="#475569" opacity={0.6} />
        </g>
      ))}
      <rect x={10} y={-44} width={10} height={6} rx={2} fill="#e5e7eb" />
      <text x={15} y={-10} fontSize={4.5} textAnchor="middle" fill="#bfdbfe" fontWeight={600}>HC-SR04</text>
      {running && (
        <g>
          <path d={`M-12 -46 v${-Math.min(40, 6 + d / 10)}`} stroke="#22d3ee" strokeDasharray="2 3" opacity={0.5} />
          <text x={15} y={-54} fontSize={6} textAnchor="middle" fill="#22d3ee" fontFamily="JetBrains Mono">↕ {Math.round(d)} см</text>
          {view?.echo ? <circle cx={60} cy={-44} r={2} fill="#22d3ee" /> : null}
        </g>
      )}
    </g>
  );
});

const Pir = memo(function Pir({ view }: PartViewProps) {
  const active = !!view?.active;
  return (
    <g style={{ cursor: 'pointer' }}>
      {[0, 10, 20].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={-6} stroke="#9ca3af" strokeWidth={1.4} />)}
      <rect x={-14} y={-48} width={48} height={42} rx={3} fill="#166534" stroke="#14532d" />
      <circle cx={10} cy={-28} r={17} fill="#f8fafc" stroke="#cbd5e1" />
      {[0, 60, 120].map((a) => <path key={a} d="M10 -45 L10 -11" stroke="#e2e8f0" transform={`rotate(${a} 10 -28)`} />)}
      <circle cx={10} cy={-28} r={10} fill="none" stroke="#e2e8f0" />
      <Glow cx={10} cy={-28} r={24} color="#ef4444" k={active ? 0.7 : 0} />
      <text x={10} y={-52} fontSize={5} textAnchor="middle" fill={active ? '#f87171' : 'var(--faint)'}>{active ? 'ДВИЖЕНИЕ!' : 'нажми — движение'}</text>
    </g>
  );
});

const Mq2 = memo(function Mq2({ view, running }: PartViewProps) {
  const alarm = !!view?.alarm;
  return (
    <g>
      {[0, 10, 20, 30].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={-8} stroke="#9ca3af" strokeWidth={1.4} />)}
      <rect x={-9} y={-55} width={48} height={47} rx={3} fill="#1d4ed8" stroke="#1e3a8a" />
      <circle cx={15} cy={-34} r={15} fill="#a8a29e" stroke="#78716c" />
      <circle cx={15} cy={-34} r={11} fill="url(#mesh)" />
      <defs>
        <pattern id="mesh" width="2.5" height="2.5" patternUnits="userSpaceOnUse">
          <rect width="2.5" height="2.5" fill="#57534e" /><circle cx="1.25" cy="1.25" r="0.7" fill="#d6d3d1" />
        </pattern>
      </defs>
      <circle cx={-3} cy={-14} r={1.8} fill={alarm ? '#ef4444' : '#450a0a'} />
      <text x={15} y={-12} fontSize={4.5} textAnchor="middle" fill="#bfdbfe" fontWeight={600}>MQ-2</text>
      {running && <text x={15} y={-59} fontSize={5.5} textAnchor="middle" fill={alarm ? '#f87171' : 'var(--muted)'} fontFamily="JetBrains Mono">{Math.round(num(view?.ppm))} ppm</text>}
    </g>
  );
});

// ---------------- LCD 1602 ----------------
function useGlyphCache() {
  return useMemo(() => new Map<number, number[]>(), []);
}

const Lcd = memo(function Lcd({ view }: PartViewProps) {
  const cols = num(view?.cols, 16);
  const rows = num(view?.rows, 2);
  const on = !!view?.on;
  const bl = !!view?.bl;
  const disp = view?.disp !== false;
  const codes = (view?.codes as number[] | undefined) ?? [];
  const cg = (view?.cg as number[][] | undefined) ?? [];
  const cache = useGlyphCache();
  const cellW = 10;
  const cellH = 15;
  const W = cols * cellW + 20;
  const H = rows * cellH + 18;
  const bg = !on ? '#2b3a14' : bl ? '#9fd23b' : '#55701c';
  const ink = bl ? '#1c2b0a' : '#26330d';
  const dots: JSX.Element[] = [];
  if (on && disp) {
    for (let i = 0; i < cols * rows; i++) {
      const code = codes[i] ?? 32;
      const cx = 14 + (i % cols) * cellW;
      const cy = 11 + Math.floor(i / cols) * cellH;
      let colsBits: number[];
      if (code < 16) {
        const rowsBits = cg[code & 7] ?? [];
        colsBits = [0, 1, 2, 3, 4].map((c) => rowsBits.reduce((acc, bits, y) => acc | (((bits >> (4 - c)) & 1) << y), 0));
      } else {
        if (!cache.has(code)) cache.set(code, glyph(code));
        colsBits = cache.get(code)!;
      }
      for (let c = 0; c < 5; c++) {
        for (let y = 0; y < 8; y++) {
          if ((colsBits[c] >> y) & 1) dots.push(<rect key={`${i}-${c}-${y}`} x={cx + c * 1.62} y={cy + y * 1.62} width={1.45} height={1.45} fill={ink} />);
        }
      }
    }
  }
  return (
    <g>
      <rect x={0} y={0} width={W + 10} height={H + 14} rx={3} fill="#15803d" stroke="#14532d" />
      {[0, 1, 2, 3].map((i) => <circle key={i} cx={i % 2 ? W + 4 : 6} cy={i < 2 ? 6 : H + 8} r={2.5} fill="#0f2c18" />)}
      <rect x={6} y={6} width={W - 2} height={H + 2} rx={2} fill="#111827" />
      <rect x={10} y={8} width={W - 10} height={H - 2} rx={1} fill={bg} />
      {on && bl && <rect x={10} y={8} width={W - 10} height={H - 2} fill="#d9f99d" opacity={0.18} />}
      {on && Array.from({ length: cols * rows }, (_, i) => (
        <rect key={i} x={14 + (i % cols) * cellW - 0.3} y={11 + Math.floor(i / cols) * cellH - 0.3} width={8.3} height={13.2} fill={ink} opacity={0.06} />
      ))}
      {dots}
      <text x={-3} y={12} fontSize={4} fill="var(--muted)" textAnchor="end" fontFamily="JetBrains Mono">GND</text>
      <text x={-3} y={22} fontSize={4} fill="var(--muted)" textAnchor="end" fontFamily="JetBrains Mono">VCC</text>
      <text x={-3} y={32} fontSize={4} fill="var(--muted)" textAnchor="end" fontFamily="JetBrains Mono">SDA</text>
      <text x={-3} y={42} fontSize={4} fill="var(--muted)" textAnchor="end" fontFamily="JetBrains Mono">SCL</text>
    </g>
  );
});

// ---------------- OLED ----------------
const Oled = memo(function Oled({ view, model }: PartViewProps) {
  const ref = useRef<string>('');
  const [url, setUrl] = useState('');
  const rev = num(view?.rev);
  const on = !!view?.on;
  const inv = !!view?.inv;
  useEffect(() => {
    const m = model as { buf?: Uint8Array } | undefined;
    if (!m?.buf) return;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(128, 64);
    for (let i = 0; i < 128 * 64; i++) {
      const v = (m.buf[i] ? 1 : 0) ^ (inv ? 1 : 0);
      const o = i * 4;
      img.data[o] = v ? 140 : 0; img.data[o + 1] = v ? 220 : 0; img.data[o + 2] = v ? 255 : 0; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const u = c.toDataURL();
    if (u !== ref.current) { ref.current = u; setUrl(u); }
  }, [rev, model, inv]);
  return (
    <g>
      {[0, 10, 20, 30].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={-6} stroke="#9ca3af" strokeWidth={1.4} />)}
      <rect x={-14} y={-70} width={58} height={64} rx={3} fill="#1e3a8a" stroke="#172554" />
      <rect x={-11} y={-62} width={52} height={32} rx={1} fill="#020617" />
      {on && url ? <image href={url} x={-10} y={-61} width={50} height={25} style={{ imageRendering: 'pixelated' }} /> : null}
      <text x={15} y={-20} fontSize={4.5} textAnchor="middle" fill="#bfdbfe" fontWeight={600}>OLED 128×64</text>
      {['GND', 'VCC', 'SCL', 'SDA'].map((t, i) => <text key={t} x={i * 10} y={-9} fontSize={3.4} textAnchor="middle" fill="#bfdbfe" fontFamily="JetBrains Mono">{t}</text>)}
    </g>
  );
});

const Neo = memo(function Neo({ part, view }: PartViewProps) {
  const n = num(view?.n, num(prop(part, 'count'), 12));
  const colors = (view?.colors as number[] | undefined) ?? [];
  const cx = 15; const cy = -52; const R = 32;
  return (
    <g>
      {[0, 10, 20, 30].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={-14} stroke="#9ca3af" strokeWidth={1.4} />)}
      <circle cx={cx} cy={cy} r={R + 8} fill="#111827" stroke="#1f2937" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={R - 8} fill="var(--canvas)" />
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const x = cx + R * Math.cos(a);
        const y = cy + R * Math.sin(a);
        const c = colors[i] ?? 0;
        const r = (c >> 16) & 255; const g = (c >> 8) & 255; const b = c & 255;
        const k = Math.max(r, g, b) / 255;
        const col = `rgb(${r},${g},${b})`;
        return (
          <g key={i}>
            <rect x={x - 4} y={y - 4} width={8} height={8} rx={1.2} fill="#e5e7eb" />
            <circle cx={x} cy={y} r={2.8} fill={k > 0.02 ? col : '#9ca3af'} />
            <Glow cx={x} cy={y} r={9} color={col} k={k} />
          </g>
        );
      })}
    </g>
  );
});

const Logic = memo(function Logic() {
  return (
    <g>
      {Array.from({ length: 9 }, (_, i) => <line key={i} x1={i * 10} y1={0} x2={i * 10} y2={-6} stroke={i === 8 ? '#111' : ['#a16207', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed', '#6b7280'][i]} strokeWidth={1.8} />)}
      <rect x={-5} y={-38} width={90} height={32} rx={4} fill="#18181b" stroke="#3f3f46" />
      <text x={40} y={-24} fontSize={6} textAnchor="middle" fill="#e4e4e7" fontWeight={700} fontFamily="Inter">LOGIC 8CH</text>
      <path d="M8 -16 h6 v-5 h6 v5 h6 v-5 h6 v5 h6" stroke="#22d3ee" strokeWidth={1.1} fill="none" />
      {Array.from({ length: 8 }, (_, i) => <text key={i} x={i * 10} y={-9} fontSize={3.4} textAnchor="middle" fill="#a1a1aa" fontFamily="JetBrains Mono">D{i}</text>)}
    </g>
  );
});

const UartBox = memo(function UartBox({ view }: PartViewProps) {
  const on = !!view?.on;
  return (
    <g>
      {[0, 10, 20, 30].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={-6} stroke="#9ca3af" strokeWidth={1.4} />)}
      <rect x={-9} y={-44} width={48} height={38} rx={4} fill="#0a0a0a" stroke="#27272a" />
      <text x={15} y={-21} fontSize={16} textAnchor="middle" fill="#facc15" fontWeight={800}>?</text>
      <circle cx={33} cy={-38} r={1.8} fill={on ? '#22c55e' : '#14532d'} className={on ? 'pulse-soft' : ''} />
      {['VCC', 'GND', 'TX', 'RX'].map((t, i) => <text key={t} x={i * 10} y={-9} fontSize={3.4} textAnchor="middle" fill="#a1a1aa" fontFamily="JetBrains Mono">{t}</text>)}
    </g>
  );
});

const I2cBox = memo(function I2cBox({ view }: PartViewProps) {
  const led = !!view?.led;
  return (
    <g>
      {[0, 10, 20, 30].map((x) => <line key={x} x1={x} y1={0} x2={x} y2={-6} stroke="#9ca3af" strokeWidth={1.4} />)}
      <rect x={-9} y={-44} width={48} height={38} rx={4} fill="#581c87" stroke="#3b0764" />
      <text x={15} y={-25} fontSize={8} textAnchor="middle" fill="#e9d5ff" fontWeight={700}>I²C</text>
      <circle cx={15} cy={-36} r={2.4} fill={led ? '#4ade80' : '#14532d'} />
      <Glow cx={15} cy={-36} r={10} color="#4ade80" k={led ? 0.9 : 0} />
      {['VCC', 'GND', 'SDA', 'SCL'].map((t, i) => <text key={t} x={i * 10} y={-9} fontSize={3.4} textAnchor="middle" fill="#e9d5ff" fontFamily="JetBrains Mono">{t}</text>)}
    </g>
  );
});

const Fallback = ({ part }: PartViewProps) => {
  const def = DEFS[part.type];
  const [x, y, w, h] = def?.box ?? [0, 0, 40, 30];
  return <rect x={x} y={y} width={w} height={h} rx={4} fill="var(--panel-2)" stroke="var(--border)" />;
};

export const RENDERERS: Record<string, ComponentType<PartViewProps>> = {
  esp32: Esp32, breadboard: Breadboard, led: Led, resistor: Resistor, button: Button, switch: Switch, pot: Pot, ldr: Ldr,
  rgb: Rgb, buzzer: Buzzer, relay: Relay, motor: Motor, lamp: Lamp, lock: Lock, servo: Servo, dht22: Dht, hcsr04: Hcsr,
  pir: Pir, mq2: Mq2, lcd1602: Lcd, oled: Oled, neopixel: Neo, logic: Logic, uartbox: UartBox, i2cbox: I2cBox,
};

export function PartView(props: PartViewProps) {
  const R = RENDERERS[props.part.type] ?? Fallback;
  return <R {...props} />;
}

/** Маленькая иконка компонента для палитры. */
export function PartIcon({ type, size = 44 }: { type: string; size?: number }) {
  const def = DEFS[type];
  if (!def) return null;
  const [x, y, w, h] = def.box;
  const pad = 6;
  const part: Part = { id: 'icon', type, x: 0, y: 0, rot: 0, props: {} };
  return (
    <svg width={size} height={size} viewBox={`${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}`} aria-hidden>
      <PartView part={part} running={false} view={type === 'led' ? { b: 0.8 } : type === 'neopixel' ? { colors: [0xff0000, 0xff8800, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0x8800ff, 0xff00ff, 0xff0000, 0xff8800, 0xffff00, 0x00ff00], n: 12 } : { on: true, bl: true, angle: 90, pos: 60, lux: 300 }} />
    </svg>
  );
}
