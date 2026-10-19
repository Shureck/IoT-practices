// Осциллограф: 4 канала, синхронизация по фронту с порогом, режимы «авто / ждущий / однократный»,
// измерения, курсоры, автонастройка, экспорт CSV. Данные — запись сигнала из модели прибора
// (кусочно-постоянное напряжение + точный ШИМ + пакеты UART/I²C/SPI).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, Crosshair, Wand2, Download, SlidersHorizontal, StepForward, X } from 'lucide-react';
import { DEFS, columns, type EdgeDir, type PinRef, type Waveform, type WaveStats } from '@esp32lab/sim';
import { SCOPE_COLORS as COLORS, setProbe, useWB } from '../store';
import { currentProbeWaves, modelOf } from '../simController';
import { IconButton, inputBase } from '../../components/ui';
/** развёртка, мкс на деление */
const TB = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6];
/** чувствительность, В на деление */
const VDIV = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];
const DX = 10;
const DY = 8;

type Coupling = 'DC' | 'AC' | 'GND';
type Mode = 'auto' | 'normal' | 'single';
interface ChCfg { on: boolean; vdiv: number; pos: number; coupling: Coupling }
interface Cfg {
  ch: ChCfg[];
  tb: number;
  /** положение точки синхронизации по горизонтали, 0…1 */
  hpos: number;
  trig: { src: number; edge: EdgeDir; level: number; mode: Mode };
  cursors: 'off' | 'time' | 'volt';
  /** курсоры: x — доля ширины экрана, y — доля высоты */
  cur: { x1: number; x2: number; y1: number; y2: number; ch: number };
  side: boolean;
}

const DEFAULT: Cfg = {
  ch: [
    { on: true, vdiv: 1, pos: -3, coupling: 'DC' },
    { on: false, vdiv: 1, pos: -3, coupling: 'DC' },
    { on: false, vdiv: 1, pos: -3, coupling: 'DC' },
    { on: false, vdiv: 1, pos: -3, coupling: 'DC' },
  ],
  tb: 1000,
  hpos: 0.5,
  trig: { src: 0, edge: 'rise', level: 1.65, mode: 'auto' },
  cursors: 'off',
  cur: { x1: 0.3, x2: 0.7, y1: 0.3, y2: 0.7, ch: 0 },
  side: true,
};
const STORE_KEY = 'esp32lab:scope:v1';

function loadCfg(): Cfg {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as Partial<Cfg>;
      return { ...DEFAULT, ...c, trig: { ...DEFAULT.trig, ...c.trig }, cur: { ...DEFAULT.cur, ...c.cur }, ch: DEFAULT.ch.map((d, i) => ({ ...d, ...c.ch?.[i] })) };
    }
  } catch { /* приватный режим и т.п. */ }
  return DEFAULT;
}

// ---------- форматирование ----------
export function fmtTime(us: number): string {
  const a = Math.abs(us);
  if (a >= 1e6) return `${+(us / 1e6).toPrecision(3)} с`;
  if (a >= 1e3) return `${+(us / 1e3).toPrecision(3)} мс`;
  if (a >= 1) return `${+us.toPrecision(3)} мкс`;
  return `${+(us * 1e3).toPrecision(3)} нс`;
}
export function fmtFreq(hz: number): string {
  if (hz >= 1e6) return `${+(hz / 1e6).toPrecision(4)} МГц`;
  if (hz >= 1e3) return `${+(hz / 1e3).toPrecision(4)} кГц`;
  return `${+hz.toPrecision(4)} Гц`;
}
export function fmtV(v: number): string {
  if (Math.abs(v) < 1) return `${+(v * 1e3).toPrecision(3)} мВ`;
  return `${+v.toPrecision(3)} В`;
}
const fmtDiv = (us: number) => fmtTime(us).replace(' ', ' ');
const fmtVdiv = (v: number) => (v < 1 ? `${v * 1000} мВ` : `${v} В`);
const EDGE_LABEL: Record<EdgeDir, string> = { rise: '↑', fall: '↓', both: '↕' };

/**
 * Разложить включённые каналы по экрану полосами (как делают автонастройкой настоящие приборы):
 * каждому — своя полоса высотой 8/n делений, чувствительность — чтобы сигнал в неё поместился.
 */
function stack(chs: ChCfg[], ranges?: ({ lo: number; hi: number } | null)[]): ChCfg[] {
  const on = chs.map((c, i) => (c.on ? i : -1)).filter((i) => i >= 0);
  const band = DY / Math.max(1, on.length);
  return chs.map((c, i) => {
    const k = on.indexOf(i);
    if (k < 0) return c;
    const r = ranges?.[i] ?? { lo: 0, hi: 3.3 };
    const span = Math.max(0.05, r.hi - r.lo);
    const vdiv = VDIV.find((v) => span / v <= band - 0.5) ?? VDIV[VDIV.length - 1];
    // низ полосы k (сверху вниз) + отступ; ноль канала — на высоте −lo над низом полосы
    const bottom = DY / 2 - (k + 1) * band + 0.25;
    return { ...c, vdiv, pos: Math.round((bottom - r.lo / vdiv) * 10) / 10 };
  });
}

interface Frame { t: number; trig: boolean }
interface Ui {
  status: string;
  meas: (WaveStats | null)[];
  curT: { t1: number; t2: number; v1: (number | null)[]; v2: (number | null)[] } | null;
  window: { a: number; b: number } | null;
}

export function ScopePanel() {
  const circuit = useWB((s) => s.circuit);
  const simTime = useWB((s) => s.simTime);
  const running = useWB((s) => s.running);
  const scope = circuit.parts.find((p) => p.type === 'scope');
  const probes = useWB((s) => s.probes);
  const probePick = useWB((s) => s.probePick);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cfg, setCfgState] = useState<Cfg>(loadCfg);
  const [run, setRun] = useState<'run' | 'stop'>('run');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState(0);
  const [ui, setUi] = useState<Ui>({ status: '', meas: [], curT: null, window: null });
  const wavesRef = useRef<(Waveform | null)[] | null>(null);
  const frameRef = useRef<Frame | null>(null);
  const armRef = useRef(0);
  const dragRef = useRef<{ kind: string; x0: number; pan0: number } | null>(null);
  const geomRef = useRef({ L: 0, T: 0, W: 0, H: 0 });

  const setCfg = useCallback((f: (c: Cfg) => Cfg) => {
    setCfgState((c) => {
      const n = f(c);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(n)); } catch { /* нет хранилища */ }
      return n;
    });
  }, []);
  const setCh = (i: number, p: Partial<ChCfg>) => setCfg((c) => ({ ...c, ch: c.ch.map((x, k) => (k === i ? { ...x, ...p } : x)) }));
  const setTrig = (p: Partial<Cfg['trig']>) => setCfg((c) => ({ ...c, trig: { ...c.trig, ...p } }));

  // источник канала: щуп (точка схемы) или вход детали «Осциллограф»; после остановки симуляции
  // остаётся последняя запись
  const m = scope ? (modelOf(scope.id) as { waves: Waveform[] } | undefined) : undefined;
  const pw = currentProbeWaves();
  const live = running ? [0, 1, 2, 3].map((i) => (probes[i] ? pw[i] : m?.waves[i] ?? null)) : null;
  if (live && (!wavesRef.current || live.some((w, i) => w !== wavesRef.current![i]))) {
    if (live[cfg.trig.src] !== wavesRef.current?.[cfg.trig.src]) frameRef.current = null;
    wavesRef.current = live;
  }
  const srcLabel = (i: number): string => {
    const r: PinRef | null = probes[i];
    if (r) {
      const part = circuit.parts.find((p) => p.id === r.part);
      const pin = part ? DEFS[part.type]?.pins.find((x) => x.name === r.pin) : null;
      return `${part ? DEFS[part.type]?.title ?? r.part : r.part} · ${pin?.label ?? r.pin}`;
    }
    return scope ? `вход CH${i + 1} осциллографа` : 'не подключён';
  };
  const pick = (i: number) => {
    useWB.getState().set({ probePick: probePick === i ? null : i });
    if (!cfg.ch[i].on) setCfg((c) => ({ ...c, ch: stack(c.ch.map((x, k) => (k === i ? { ...x, on: true } : x))) }));
  };

  // размер холста
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setSize({ w: c.clientWidth, h: c.clientHeight }));
    ro.observe(c);
    return () => ro.disconnect();
  }, [scope?.id]);

  // колесо мыши: развёртка (Shift — В/дел источника синхронизации)
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const up = e.deltaY < 0;
      if (e.shiftKey) {
        setCfg((cf) => {
          const i = cf.trig.src;
          const k = VDIV.indexOf(cf.ch[i].vdiv);
          const nk = Math.max(0, Math.min(VDIV.length - 1, k + (up ? -1 : 1)));
          return { ...cf, ch: cf.ch.map((x, j) => (j === i ? { ...x, vdiv: VDIV[nk] } : x)) };
        });
      } else {
        setCfg((cf) => {
          const k = TB.indexOf(cf.tb);
          return { ...cf, tb: TB[Math.max(0, Math.min(TB.length - 1, k + (up ? -1 : 1)))] };
        });
      }
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [setCfg, scope?.id]);

  // сбор кадра и отрисовка
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w || !size.h) return;
    const waves = wavesRef.current;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = 22; const R = 22; const T = 8; const B = 20;
    const SW = size.w - L - R; const SH = size.h - T - B;
    geomRef.current = { L, T, W: SW, H: SH };
    const divW = SW / DX; const divH = SH / DY;
    const midY = T + SH / 2;
    const now = simTime;
    const W = cfg.tb * DX;
    const pre = W * cfg.hpos;
    const post = W - pre;

    // --- синхронизация ---
    let status = '';
    const src = waves?.[cfg.trig.src] ?? null;
    if (waves && run === 'run' && !src) status = 'нет сигнала';
    else if (waves && src && run === 'run') {
      const { level, edge, mode } = cfg.trig;
      if (mode === 'single') {
        const t = src.firstEdge(Math.max(armRef.current, src.start), now - post, level, edge);
        if (t !== null) {
          frameRef.current = { t, trig: true };
          status = 'Стоп';
          setTimeout(() => setRun('stop'), 0);
        } else status = 'Ждёт';
      } else {
        const before = now - post;
        const t = src.empty ? null : src.lastEdge(before, Math.max(src.start, before - Math.max(20 * W, 2e6)), level, edge, Math.max(W, 10));
        const autoTimeout = Math.max(2 * W, 200_000);
        if (t !== null && (mode === 'normal' || before - t <= autoTimeout)) { frameRef.current = { t, trig: true }; status = 'Синхр.'; }
        else if (mode === 'auto') { frameRef.current = { t: before, trig: false }; status = 'Авто'; }
        else status = 'Ждёт';
      }
    } else if (run === 'stop') status = 'Стоп';
    const frame = frameRef.current;
    const a = frame ? frame.t - pre + (run === 'stop' ? pan : 0) : now - W;
    const b = a + W;
    const dataEnd = Math.min(b, now);

    // --- экран ---
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.strokeStyle = 'rgba(148,163,184,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= DX; i++) { const x = Math.round(L + i * divW) + 0.5; ctx.moveTo(x, T); ctx.lineTo(x, T + SH); }
    for (let i = 0; i <= DY; i++) { const y = Math.round(T + i * divH) + 0.5; ctx.moveTo(L, y); ctx.lineTo(L + SW, y); }
    ctx.stroke();
    // оси с рисками
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.beginPath();
    const cx = Math.round(L + SW / 2) + 0.5; const cy = Math.round(midY) + 0.5;
    ctx.moveTo(cx, T); ctx.lineTo(cx, T + SH); ctx.moveTo(L, cy); ctx.lineTo(L + SW, cy);
    for (let i = 0; i <= DX * 5; i++) { const x = L + (i * divW) / 5; ctx.moveTo(x, cy - 3); ctx.lineTo(x, cy + 3); }
    for (let i = 0; i <= DY * 5; i++) { const y = T + (i * divH) / 5; ctx.moveTo(cx - 3, y); ctx.lineTo(cx + 3, y); }
    ctx.stroke();

    const meas: (WaveStats | null)[] = [];
    const yOf = (i: number, v: number) => midY - (v / cfg.ch[i].vdiv + cfg.ch[i].pos) * divH;

    if (waves && frame) {
      const cols = Math.max(2, Math.round(SW));
      for (let i = 0; i < 4; i++) {
        const ch = cfg.ch[i];
        const w = waves[i];
        if (!ch.on || !w) { meas.push(null); continue; }
        const st = dataEnd > a ? w.stats(Math.max(a, w.start), dataEnd) : null;
        meas.push(st);
        const shift = ch.coupling === 'AC' ? (st?.avg ?? 0) : 0;
        ctx.save();
        ctx.beginPath(); ctx.rect(L, T, SW, SH); ctx.clip();
        ctx.strokeStyle = COLORS[i]; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
        ctx.beginPath();
        if (ch.coupling === 'GND') {
          const y = yOf(i, 0);
          ctx.moveTo(L, y); ctx.lineTo(L + SW, y);
        } else if (dataEnd > a) {
          const n = Math.max(1, Math.round((cols * (dataEnd - a)) / W));
          const col = columns(w, a, dataEnd, n);
          let pen = false;
          for (let j = 0; j < n; j++) {
            if (Number.isNaN(col.min[j])) { pen = false; continue; }
            const x = L + ((j + 0.5) * SW) / cols;
            const yf = yOf(i, col.first[j] - shift); const yl = yOf(i, col.last[j] - shift);
            const y0 = yOf(i, col.min[j] - shift); const y1 = yOf(i, col.max[j] - shift);
            if (!pen) { ctx.moveTo(x, yf); pen = true; } else ctx.lineTo(x, yf);
            if (Math.abs(y1 - y0) > 0.5) { ctx.lineTo(x, y0); ctx.lineTo(x, y1); }
            ctx.lineTo(x, yl);
          }
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // метки нуля каналов (слева)
    ctx.font = 'bold 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      if (!cfg.ch[i].on) continue;
      const y = Math.max(T + 6, Math.min(T + SH - 6, yOf(i, 0)));
      ctx.fillStyle = COLORS[i];
      ctx.beginPath(); ctx.moveTo(2, y - 7); ctx.lineTo(L - 6, y - 7); ctx.lineTo(L - 1, y); ctx.lineTo(L - 6, y + 7); ctx.lineTo(2, y + 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#05080f'; ctx.fillText(String(i + 1), 10, y + 0.5);
    }
    // уровень синхронизации (справа)
    {
      const i = cfg.trig.src;
      const y = Math.max(T + 6, Math.min(T + SH - 6, yOf(i, cfg.trig.level)));
      ctx.fillStyle = COLORS[i];
      ctx.beginPath(); ctx.moveTo(size.w - 2, y - 7); ctx.lineTo(L + SW + 6, y - 7); ctx.lineTo(L + SW + 1, y); ctx.lineTo(L + SW + 6, y + 7); ctx.lineTo(size.w - 2, y + 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#05080f'; ctx.fillText('T', size.w - 11, y + 0.5);
      if (dragRef.current?.kind === 'level') {
        ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = COLORS[i]; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + SW, y); ctx.stroke(); ctx.restore();
      }
    }
    // момент синхронизации (сверху)
    if (frame?.trig) {
      const x = L + ((frame.t - a) / W) * SW;
      if (x >= L - 1 && x <= L + SW + 1) {
        ctx.fillStyle = '#fb923c';
        ctx.beginPath(); ctx.moveTo(x - 6, 0); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 8); ctx.closePath(); ctx.fill();
      }
    }
    // курсоры
    let curT: Ui['curT'] = null;
    if (cfg.cursors === 'time') {
      const t1 = a + cfg.cur.x1 * W; const t2 = a + cfg.cur.x2 * W;
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
      for (const xf of [cfg.cur.x1, cfg.cur.x2]) { const x = L + xf * SW; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + SH); ctx.stroke(); }
      ctx.restore();
      curT = {
        t1: t1 - (frame?.trig ? frame.t : a), t2: t2 - (frame?.trig ? frame.t : a),
        v1: (waves ?? []).map((w, i) => (w && cfg.ch[i].on && t1 <= now ? w.valueAt(t1) : null)),
        v2: (waves ?? []).map((w, i) => (w && cfg.ch[i].on && t2 <= now ? w.valueAt(t2) : null)),
      };
    } else if (cfg.cursors === 'volt') {
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = COLORS[cfg.cur.ch]; ctx.lineWidth = 1;
      for (const yf of [cfg.cur.y1, cfg.cur.y2]) { const y = T + yf * SH; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + SW, y); ctx.stroke(); }
      ctx.restore();
    }
    // подписи внизу
    ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    let x = L;
    for (let i = 0; i < 4; i++) {
      if (!cfg.ch[i].on) continue;
      const s = `${i + 1}: ${fmtVdiv(cfg.ch[i].vdiv)}${cfg.ch[i].coupling !== 'DC' ? ` ${cfg.ch[i].coupling}` : ''}`;
      ctx.fillStyle = COLORS[i]; ctx.fillText(s, x, size.h - 6);
      x += ctx.measureText(s).width + 12;
    }
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'right';
    ctx.fillText(`${fmtDiv(cfg.tb)}/дел   T: ${cfg.trig.src + 1} ${EDGE_LABEL[cfg.trig.edge]} ${fmtV(cfg.trig.level)}`, L + SW, size.h - 6);
    if (!waves || !waves.some(Boolean)) {
      ctx.textAlign = 'center'; ctx.fillStyle = '#94a3b8'; ctx.font = '12px Inter, sans-serif';
      ctx.fillText(waves ? 'Поставьте щуп: кнопка ⌖ у канала справа, затем клик по проводу на схеме' : 'Запустите симуляцию — здесь появится сигнал', L + SW / 2, midY - 12);
      if (!scope && !probes.some(Boolean)) ctx.fillText('Щупом можно смотреть любой провод или вывод — даже на закреплённой схеме практики', L + SW / 2, midY + 8);
    } else if (!frame) {
      ctx.textAlign = 'center'; ctx.fillStyle = '#94a3b8'; ctx.font = '12px Inter, sans-serif';
      ctx.fillText(`Ждём синхронизацию: канал ${cfg.trig.src + 1}, ${cfg.trig.edge === 'rise' ? 'фронт' : cfg.trig.edge === 'fall' ? 'спад' : 'перепад'} через ${fmtV(cfg.trig.level)}`, L + SW / 2, midY - 12);
    }

    const next: Ui = { status, meas, curT, window: frame ? { a, b } : null };
    setUi((u) => (JSON.stringify(u) === JSON.stringify(next) ? u : next));
  }, [simTime, cfg, run, pan, size, m, probes, scope, running]);

  // мышь: перетаскивание уровня синхронизации, нулей каналов, курсоров; панорама записи в «Стоп»
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left; const y = e.clientY - r.top;
    const { L, T, W, H } = geomRef.current;
    const divH = H / DY; const midY = T + H / 2;
    const yOf = (i: number, v: number) => midY - (v / cfg.ch[i].vdiv + cfg.ch[i].pos) * divH;
    let kind = '';
    if (x > L + W) kind = 'level';
    else if (x < L) {
      let best = 99;
      cfg.ch.forEach((ch, i) => { if (ch.on) { const d = Math.abs(yOf(i, 0) - y); if (d < best) { best = d; kind = `pos${i}`; } } });
      if (best > 14) kind = '';
    } else if (cfg.cursors === 'time') {
      const d1 = Math.abs(L + cfg.cur.x1 * W - x); const d2 = Math.abs(L + cfg.cur.x2 * W - x);
      if (Math.min(d1, d2) < 8) kind = d1 <= d2 ? 'x1' : 'x2';
    } else if (cfg.cursors === 'volt') {
      const d1 = Math.abs(T + cfg.cur.y1 * H - y); const d2 = Math.abs(T + cfg.cur.y2 * H - y);
      if (Math.min(d1, d2) < 8) kind = d1 <= d2 ? 'y1' : 'y2';
    }
    if (!kind && run === 'stop') kind = 'pan';
    if (!kind) return;
    dragRef.current = { kind, x0: x, pan0: pan };
    e.currentTarget.setPointerCapture(e.pointerId);
    onMove(e);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left; const y = e.clientY - r.top;
    const { L, T, W, H } = geomRef.current;
    const cursor = (() => {
      if (x > L + W) return 'ns-resize';
      if (x < L) return 'ns-resize';
      if (cfg.cursors === 'time' && Math.min(Math.abs(L + cfg.cur.x1 * W - x), Math.abs(L + cfg.cur.x2 * W - x)) < 8) return 'ew-resize';
      if (cfg.cursors === 'volt' && Math.min(Math.abs(T + cfg.cur.y1 * H - y), Math.abs(T + cfg.cur.y2 * H - y)) < 8) return 'ns-resize';
      return run === 'stop' ? 'grab' : 'default';
    })();
    e.currentTarget.style.cursor = d?.kind === 'pan' ? 'grabbing' : cursor;
    if (!d) return;
    const divH = H / DY; const midY = T + H / 2;
    const volts = (i: number) => ((midY - y) / divH - cfg.ch[i].pos) * cfg.ch[i].vdiv;
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    if (d.kind === 'level') {
      const v = volts(cfg.trig.src);
      const step = cfg.ch[cfg.trig.src].vdiv / 25;
      setTrig({ level: Math.round(v / step) * step });
    } else if (d.kind.startsWith('pos')) {
      const i = Number(d.kind.slice(3));
      const pos = Math.round(((midY - y) / divH) * 10) / 10;
      setCh(i, { pos: Math.max(-DY / 2, Math.min(DY / 2, pos)) });
    } else if (d.kind === 'x1' || d.kind === 'x2') {
      setCfg((c) => ({ ...c, cur: { ...c.cur, [d.kind]: clamp((x - L) / W) } }));
    } else if (d.kind === 'y1' || d.kind === 'y2') {
      setCfg((c) => ({ ...c, cur: { ...c.cur, [d.kind]: clamp((y - T) / H) } }));
    } else if (d.kind === 'pan') {
      setPan(d.pan0 - ((x - d.x0) / W) * cfg.tb * DX);
    }
  };
  const onUp = () => { dragRef.current = null; };

  const toggleRun = () => {
    if (run === 'run') { setRun('stop'); setPan(0); return; }
    setPan(0);
    if (cfg.trig.mode === 'single') { armRef.current = simTime; frameRef.current = null; }
    setRun('run');
  };
  const single = () => {
    setTrig({ mode: 'single' });
    armRef.current = simTime; frameRef.current = null; setPan(0); setRun('run');
  };

  // автонастройка: каналы с сигналом, чувствительность, развёртка на ~3 периода, порог посередине
  const autoset = () => {
    const waves = wavesRef.current;
    if (!waves) return;
    const now = simTime;
    const stats = waves.map((w) => (!w || w.empty ? null : w.stats(Math.max(w.start, now - 1e6), now)));
    const live = stats.map((s) => !!s && (s.vpp > 0.05 || Math.abs(s.avg) > 0.05));
    if (!live.some(Boolean)) return;
    let src = 0; let best = -1;
    stats.forEach((s, i) => { if (live[i] && s!.vpp > best) { best = s!.vpp; src = i; } });
    const s = stats[src]!;
    const tb = s.period ? TB.find((x) => x * DX >= s.period! * 3) ?? TB[TB.length - 1] : cfg.tb;
    setCfg((c) => ({
      ...c,
      tb,
      hpos: 0.5,
      trig: { ...c.trig, src, edge: 'rise', level: +((s.vmax + s.vmin) / 2).toFixed(3), mode: c.trig.mode === 'single' ? 'auto' : c.trig.mode },
      ch: stack(c.ch.map((ch, i) => ({ ...ch, on: live[i], coupling: 'DC' })), stats.map((st) => (st ? { lo: Math.min(0, st.vmin), hi: Math.max(0, st.vmax) } : null))),
    }));
    setPan(0); setRun('run');
  };

  const exportCsv = () => {
    const waves = wavesRef.current;
    const win = ui.window;
    if (!waves || !win) return;
    const n = 2000;
    const on = cfg.ch.map((c, i) => (c.on ? i : -1)).filter((i) => i >= 0);
    const rows = ['t_us,' + on.map((i) => `CH${i + 1}_V`).join(',')];
    const end = Math.min(win.b, simTime);
    for (let k = 0; k <= n; k++) {
      const t = win.a + ((end - win.a) * k) / n;
      rows.push([t.toFixed(3), ...on.map((i) => waves[i]?.valueAt(t)?.toFixed(4) ?? '')].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url; el.download = 'oscillogram.csv'; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sel = `${inputBase} h-7 px-1.5 text-xs`;
  const statusTone = ui.status === 'Синхр.' ? 'text-ok' : ui.status === 'Стоп' ? 'text-err' : 'text-warn';
  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-line px-2 py-1 text-xs">
          <button onClick={toggleRun} title={run === 'run' ? 'Остановить (заморозить кадр)' : 'Пуск'}
            className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 font-semibold ${run === 'run' ? 'bg-ok/15 text-ok' : 'bg-err/15 text-err'}`}>
            {run === 'run' ? <><Play size={13} /> Пуск</> : <><Square size={12} /> Стоп</>}
          </button>
          <IconButton title="Однократный запуск: поймать одно событие и остановиться" active={cfg.trig.mode === 'single' && run === 'run'} onClick={single}><StepForward size={15} /></IconButton>
          <IconButton title="Автонастройка" onClick={autoset}><Wand2 size={15} /></IconButton>
          <span className="ml-1 shrink-0 text-muted">Развёртка</span>
          <select className={`${sel} w-[92px] shrink-0`} value={cfg.tb} onChange={(e) => setCfg((c) => ({ ...c, tb: Number(e.target.value) }))} title="Время на одно деление (колесо мыши над экраном)">
            {TB.map((t) => <option key={t} value={t}>{fmtTime(t)}/дел</option>)}
          </select>
          <span className="ml-1 shrink-0 text-muted">Синхр.</span>
          <select className={`${sel} w-[60px] shrink-0`} value={cfg.trig.src} onChange={(e) => setTrig({ src: Number(e.target.value) })} title="Источник синхронизации">
            {[0, 1, 2, 3].map((i) => <option key={i} value={i}>CH{i + 1}</option>)}
          </select>
          <div className="flex shrink-0 overflow-hidden rounded-md border border-line">
            {(['rise', 'fall', 'both'] as EdgeDir[]).map((e) => (
              <button key={e} title={e === 'rise' ? 'По фронту' : e === 'fall' ? 'По спаду' : 'По любому перепаду'} onClick={() => setTrig({ edge: e })}
                className={`h-[26px] w-7 text-sm ${cfg.trig.edge === e ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-panel-2'}`}>{EDGE_LABEL[e]}</button>
            ))}
          </div>
          <input type="number" step={0.05} className={`${sel} w-[70px] shrink-0`} value={cfg.trig.level} title="Порог синхронизации, В (или перетащите метку T справа от экрана)"
            onChange={(e) => setTrig({ level: Number(e.target.value) })} />
          <span className="shrink-0 text-muted">В</span>
          <select className={`${sel} w-[104px] shrink-0`} value={cfg.trig.mode} onChange={(e) => { const mode = e.target.value as Mode; setTrig({ mode }); if (mode === 'single') single(); else if (run === 'stop') setRun('run'); }} title="Режим синхронизации">
            <option value="auto">Авто</option>
            <option value="normal">Ждущий</option>
            <option value="single">Однократный</option>
          </select>
          <span className={`ml-1 shrink-0 font-semibold ${statusTone}`}>{ui.status || (running ? '' : 'нет симуляции')}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <select className={`${sel} w-[118px]`} value={cfg.cursors} onChange={(e) => setCfg((c) => ({ ...c, cursors: e.target.value as Cfg['cursors'] }))} title="Курсоры">
              <option value="off">Курсоры: нет</option>
              <option value="time">Курсоры: время</option>
              <option value="volt">Курсоры: уровень</option>
            </select>
            <IconButton title="Сохранить кадр в CSV" onClick={exportCsv}><Download size={15} /></IconButton>
            <IconButton title={cfg.side ? 'Скрыть настройки каналов' : 'Показать настройки каналов'} active={cfg.side} onClick={() => setCfg((c) => ({ ...c, side: !c.side }))}><SlidersHorizontal size={15} /></IconButton>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <canvas ref={canvas} className="absolute inset-0 h-full w-full touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
          {cfg.cursors !== 'off' && <CursorReadout cfg={cfg} ui={ui} />}
        </div>
      </div>
      {cfg.side && (
        <div className="w-[236px] shrink-0 overflow-y-auto border-l border-line text-[11.5px]">
          {cfg.ch.map((ch, i) => (
            <div key={i} className="border-b border-line px-2 py-1.5">
              <label className="flex items-center gap-1.5 font-semibold" style={{ color: COLORS[i] }}>
                <input type="checkbox" checked={ch.on} onChange={(e) => setCh(i, { on: e.target.checked })} /> CH{i + 1}
                <span className="ml-auto flex gap-1 font-normal text-muted">
                  <select className={`${sel} h-6 w-[70px]`} value={ch.vdiv} onChange={(e) => setCh(i, { vdiv: Number(e.target.value) })} title="Вольт на деление">
                    {VDIV.map((v) => <option key={v} value={v}>{fmtVdiv(v)}</option>)}
                  </select>
                  <select className={`${sel} h-6 w-[52px]`} value={ch.coupling} onChange={(e) => setCh(i, { coupling: e.target.value as Coupling })}
                    title="Вход: DC — как есть; AC — без постоянной составляющей; GND — нулевая линия">
                    {(['DC', 'AC', 'GND'] as Coupling[]).map((x) => <option key={x}>{x}</option>)}
                  </select>
                </span>
              </label>
              <div className="mt-1 flex items-center gap-1">
                <button onClick={() => pick(i)} title="Щуп: кликните по проводу или выводу на схеме"
                  className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 ${probePick === i ? 'border-current' : 'border-line text-muted hover:text-text'}`}
                  style={probePick === i ? { color: COLORS[i] } : undefined}>
                  <Crosshair size={12} />{probePick === i ? 'укажите…' : 'Щуп'}
                </button>
                <span className={`min-w-0 flex-1 truncate ${probes[i] ? '' : 'text-faint'}`} title={srcLabel(i)}>{srcLabel(i)}</span>
                {probes[i] && <button className="shrink-0 text-faint hover:text-err" title="Снять щуп" onClick={() => setProbe(i, null)}><X size={13} /></button>}
              </div>
              {ch.on && <Meas st={ui.meas[i]} />}
            </div>
          ))}
          <div className="space-y-1 px-2 py-2 text-muted">
            <div className="flex items-center gap-2">
              <span className="shrink-0">Точка синхр.</span>
              <input type="range" min={0} max={100} value={Math.round(cfg.hpos * 100)} className="min-w-0 flex-1" onChange={(e) => setCfg((c) => ({ ...c, hpos: Number(e.target.value) / 100 }))} title="Где на экране момент синхронизации (слева — видно, что было после)" />
            </div>
            {cfg.cursors === 'volt' && (
              <div className="flex items-center gap-2">
                <span className="shrink-0">Курсоры по</span>
                <select className={`${sel} h-6 w-[64px]`} value={cfg.cur.ch} onChange={(e) => setCfg((c) => ({ ...c, cur: { ...c.cur, ch: Number(e.target.value) } }))}>
                  {[0, 1, 2, 3].map((i) => <option key={i} value={i}>CH{i + 1}</option>)}
                </select>
              </div>
            )}
            <p className="pt-1 leading-snug text-faint">
              <Crosshair size={11} className="mr-1 inline" />Перетаскивайте метки: слева — ноль канала, справа — порог T. Колесо — развёртка, Shift+колесо — В/дел. В «Стоп» запись можно двигать мышью и растягивать.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Meas({ st }: { st: WaveStats | null | undefined }) {
  if (!st) return <div className="mt-1 text-faint">нет данных</div>;
  const row = (k: string, v: string) => <div className="flex justify-between gap-2"><span className="text-muted">{k}</span><span className="font-mono">{v}</span></div>;
  return (
    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
      {row('Частота', st.freq ? fmtFreq(st.freq) : '—')}
      {row('Период', st.period ? fmtTime(st.period) : '—')}
      {row('Импульс', st.width ? fmtTime(st.width) : '—')}
      {row('Заполн.', st.duty !== null ? `${(st.duty * 100).toFixed(1)} %` : '—')}
      {row('Vмакс', fmtV(st.vmax))}
      {row('Vмин', fmtV(st.vmin))}
      {row('Размах', fmtV(st.vpp))}
      {row('Vср', fmtV(st.avg))}
      {row('СКЗ', fmtV(st.rms))}
    </div>
  );
}

function CursorReadout({ cfg, ui }: { cfg: Cfg; ui: Ui }) {
  const box = 'pointer-events-none absolute right-6 top-2 rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] leading-[1.45] text-slate-100';
  if (cfg.cursors === 'time' && ui.curT) {
    const { t1, t2, v1, v2 } = ui.curT;
    const dt = t2 - t1;
    return (
      <div className={box}>
        <div>t1 {fmtTime(t1)} · t2 {fmtTime(t2)}</div>
        <div>Δt {fmtTime(Math.abs(dt))}{dt !== 0 ? ` · 1/Δt ${fmtFreq(1e6 / Math.abs(dt))}` : ''}</div>
        {v1.map((v, i) => (v !== null || v2[i] !== null) && (
          <div key={i} style={{ color: COLORS[i] }}>CH{i + 1}: {v !== null ? fmtV(v) : '—'} → {v2[i] !== null ? fmtV(v2[i]!) : '—'}{v !== null && v2[i] !== null ? ` (Δ ${fmtV(v2[i]! - v)})` : ''}</div>
        ))}
      </div>
    );
  }
  if (cfg.cursors === 'volt') {
    const i = cfg.cur.ch; const ch = cfg.ch[i];
    const volts = (yf: number) => ((0.5 - yf) * DY - ch.pos) * ch.vdiv;
    const a = volts(cfg.cur.y1); const b = volts(cfg.cur.y2);
    return (
      <div className={box} style={{ color: COLORS[i] }}>
        <div>CH{i + 1}: V1 {fmtV(a)} · V2 {fmtV(b)}</div>
        <div>ΔV {fmtV(Math.abs(a - b))}</div>
      </div>
    );
  }
  return null;
}
