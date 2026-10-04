// Логический анализатор: осциллограммы 8 каналов + декодер UART.
import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Pause, Play } from 'lucide-react';
import type { AnalyzerTrace } from '@esp32lab/sim';
import { useWB } from '../store';
import { modelOf } from '../simController';
import { Empty, IconButton, inputCls, inputBase } from '../../components/ui';

const CH_COLORS = ['#a16207', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#94a3b8'];

function levelAt(tr: AnalyzerTrace, t: number): number {
  let lo = 0; let hi = tr.t.length - 1; let ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (tr.t[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans < 0 ? 0 : tr.v[ans];
}

/** Декодирование UART (8N1) по переходам. */
function decodeUart(tr: AnalyzerTrace, baud: number, from: number, to: number): { t: number; byte: number }[] {
  const bit = 1e6 / baud;
  const out: { t: number; byte: number }[] = [];
  for (let i = 0; i < tr.t.length; i++) {
    if (tr.v[i] !== 0 || tr.t[i] < from - 12 * bit || tr.t[i] > to) continue;
    if (i > 0 && tr.v[i - 1] !== 1) continue;
    const start = tr.t[i];
    let b = 0;
    for (let k = 0; k < 8; k++) b |= levelAt(tr, start + bit * (1.5 + k)) << k;
    if (levelAt(tr, start + bit * 9.5) !== 1) continue;
    out.push({ t: start, byte: b });
    while (i + 1 < tr.t.length && tr.t[i + 1] < start + bit * 9.6) i++;
  }
  return out;
}

export function AnalyzerPanel() {
  const circuit = useWB((s) => s.circuit);
  const simTime = useWB((s) => s.simTime);
  const running = useWB((s) => s.running);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [span, setSpan] = useState(20000); // мкс на экран
  const [follow, setFollow] = useState(true);
  const [frozenEnd, setFrozenEnd] = useState(0);
  const [decode, setDecode] = useState<number>(0);
  const logic = circuit.parts.find((p) => p.type === 'logic');

  useEffect(() => {
    const c = canvas.current;
    if (!c || !logic) return;
    const m = modelOf(logic.id) as { traces: AnalyzerTrace[] } | undefined;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth; const h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue('--muted');
    const grid = css.getPropertyValue('--grid');
    const end = follow ? simTime : frozenEnd;
    const start = end - span;
    const left = 46;
    const rowH = (h - 22) / 8;
    const x = (t: number) => left + ((t - start) / span) * (w - left - 8);
    ctx.font = '11px JetBrains Mono';
    // сетка по времени
    ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.textAlign = 'center';
    for (let i = 0; i <= 10; i++) {
      const t = start + (span * i) / 10;
      const xx = x(t);
      ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, h - 16); ctx.stroke();
      if (i % 2 === 0) ctx.fillText(span >= 20000 ? `${(t / 1000).toFixed(1)} мс` : `${(t / 1000).toFixed(3)} мс`, xx, h - 4);
    }
    for (let ch = 0; ch < 8; ch++) {
      const tr = m?.traces[ch];
      const y0 = 4 + ch * rowH;
      const hi = y0 + rowH * 0.18; const lo = y0 + rowH * 0.78;
      ctx.fillStyle = CH_COLORS[ch]; ctx.textAlign = 'left';
      ctx.fillText(`D${ch}`, 8, (hi + lo) / 2 + 4);
      if (!tr || !tr.t.length) {
        ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(left, lo); ctx.lineTo(w - 8, lo); ctx.stroke();
        continue;
      }
      ctx.strokeStyle = CH_COLORS[ch]; ctx.lineWidth = 1.5; ctx.beginPath();
      let lvl = levelAt(tr, start);
      ctx.moveTo(left, lvl ? hi : lo);
      for (let i = 0; i < tr.t.length; i++) {
        const t = tr.t[i];
        if (t < start) continue;
        if (t > end) break;
        const xx = x(t);
        ctx.lineTo(xx, lvl ? hi : lo);
        lvl = tr.v[i];
        ctx.lineTo(xx, lvl ? hi : lo);
      }
      ctx.lineTo(w - 8, lvl ? hi : lo);
      ctx.stroke();
      if (decode) {
        for (const f of decodeUart(tr, decode, start, end)) {
          const x0 = x(f.t); const x1 = x(f.t + (10 * 1e6) / decode);
          if (x1 - x0 < 14) continue;
          ctx.fillStyle = 'rgba(34,211,238,0.14)'; ctx.fillRect(x0, hi - 1, x1 - x0, lo - hi + 2);
          ctx.fillStyle = '#22d3ee'; ctx.textAlign = 'center';
          const ch = f.byte >= 32 && f.byte < 127 ? `'${String.fromCharCode(f.byte)}' ` : '';
          ctx.fillText(`${ch}0x${f.byte.toString(16).toUpperCase().padStart(2, '0')}`, (x0 + x1) / 2, (hi + lo) / 2 + 4);
        }
      }
    }
  }, [simTime, span, follow, frozenEnd, decode, logic, circuit]);

  if (!logic) {
    return <Empty icon="📊" title="Логический анализатор не подключён" text="Добавьте на схему компонент «Логический анализатор» и подключите его входы D0…D7 к выводам — здесь появятся осциллограммы UART, SPI, I²C и ШИМ." />;
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1">
        <IconButton title={follow ? 'Пауза' : 'Следить'} onClick={() => { if (follow) setFrozenEnd(simTime); setFollow(!follow); }}>{follow ? <Pause size={15} /> : <Play size={15} />}</IconButton>
        <IconButton title="Растянуть" onClick={() => setSpan((s) => Math.max(50, s / 2))}><ZoomIn size={15} /></IconButton>
        <IconButton title="Сжать" onClick={() => setSpan((s) => Math.min(5e6, s * 2))}><ZoomOut size={15} /></IconButton>
        <span className="font-mono text-xs text-muted">окно {span >= 1000 ? `${span / 1000} мс` : `${span} мкс`}</span>
        <span className="ml-auto text-xs text-muted">Декодер UART:</span>
        <select className={`${inputBase} h-7 w-28 px-1.5 text-xs`} value={decode} onChange={(e) => setDecode(Number(e.target.value))}>
          <option value={0}>выкл.</option>
          {[9600, 19200, 38400, 57600, 115200].map((b) => <option key={b} value={b}>{b} бод</option>)}
        </select>
        {!running && <span className="text-xs text-faint">запустите симуляцию</span>}
      </div>
      <canvas ref={canvas} className="min-h-0 w-full flex-1" />
    </div>
  );
}
