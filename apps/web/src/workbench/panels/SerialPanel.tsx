// Монитор порта и плоттер.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Eraser, Send, Clock } from 'lucide-react';
import { useWB, type SerialChunk } from '../store';
import { serialSend } from '../simController';
import { IconButton, inputCls, inputBase } from '../../components/ui';
import { storage } from '../../store/app';

const BAUDS = [9600, 19200, 38400, 57600, 115200];

function garble(text: string, from: number, to: number): string {
  let out = '';
  let h = (from * 31 + to) >>> 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) { out += '\n'; continue; }
    h = (Math.imul(h ^ c, 2654435761) + i) >>> 0;
    if (h % 3 === 0) continue;
    out += String.fromCharCode([0xfffd, 0x2592, 0xa4, 0xd8, 0xe6, 0x3f, 0x7e, 0xfe][h % 8]);
  }
  return out;
}

export function SerialPanel() {
  const serial = useWB((s) => s.serial);
  const rev = useWB((s) => s.serialRev);
  const running = useWB((s) => s.running);
  const panic = useWB((s) => s.panic);
  const [baud, setBaud] = useState<number>(() => storage.get('monitorBaud', 115200));
  const [auto, setAuto] = useState(true);
  const [stamps, setStamps] = useState(false);
  const [input, setInput] = useState('');
  const [ending, setEnding] = useState<'\n' | '\r\n' | ''>(() => storage.get('monitorEnding', '\n'));
  const box = useRef<HTMLPreElement>(null);

  const port0 = serial.filter((c) => c.port === 0);
  const mismatch = port0.length > 0 && port0[port0.length - 1].baud !== baud ? port0[port0.length - 1].baud : null;

  const text = useMemo(() => {
    let s = '';
    let lineStart = true;
    for (const c of port0) {
      const t = c.baud === baud ? c.text : garble(c.text, c.baud, baud);
      if (!stamps) { s += t; continue; }
      for (const ch of t.replace(/\r/g, '')) {
        if (lineStart) { s += `[${(c.t / 1e6).toFixed(3).padStart(8)}] `; lineStart = false; }
        s += ch;
        if (ch === '\n') lineStart = true;
      }
    }
    return s.replace(/\r\n/g, '\n').replace(/\r/g, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, baud, stamps]);

  useEffect(() => {
    if (auto && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text, auto]);

  const send = () => {
    if (!running) return;
    serialSend(input + ending);
    useWB.getState().appendSerial({ text: '', baud, t: 0, port: 0 });
    setInput('');
  };

  return (
    <div className="flex h-full flex-col">
      {mismatch && (
        <div className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-warn">
          Скорость монитора {baud} не совпадает с Serial.begin({mismatch}) — поэтому «каракули».
          <button className="underline" onClick={() => { setBaud(mismatch); storage.set('monitorBaud', mismatch); }}>Переключить на {mismatch}</button>
        </div>
      )}
      <pre
        ref={box}
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[12.5px] leading-relaxed"
        onScroll={(e) => {
          const el = e.currentTarget;
          setAuto(el.scrollHeight - el.scrollTop - el.clientHeight < 30);
        }}
      >
        {text || <span className="text-faint">{running ? 'Ждём данных… (не забудьте Serial.begin)' : 'Здесь появится вывод Serial после запуска ▶'}</span>}
        {panic && <span className="text-err">{'\n'}⚠ {panic.message} (строка {panic.line}){panic.hint ? `\n💡 ${panic.hint}` : ''}</span>}
      </pre>
      <div className="flex items-center gap-1.5 border-t border-line px-2 py-1.5">
        <input
          className={`${inputCls} h-8 font-mono text-xs`}
          placeholder={running ? 'Отправить в Serial… (Enter)' : 'Запустите симуляцию, чтобы отправлять данные'}
          value={input}
          disabled={!running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
        <select className={`${inputBase} h-8 w-28 px-1.5 text-xs`} value={ending} onChange={(e) => { setEnding(e.target.value as '\n'); storage.set('monitorEnding', e.target.value); }} title="Конец строки">
          <option value={'\n'}>NL (\n)</option>
          <option value={'\r\n'}>CR+NL</option>
          <option value="">Без конца</option>
        </select>
        <select className={`${inputBase} h-8 w-24 px-1.5 text-xs`} value={baud} onChange={(e) => { setBaud(Number(e.target.value)); storage.set('monitorBaud', Number(e.target.value)); }} title="Скорость монитора">
          {BAUDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <IconButton title="Отправить" onClick={send} disabled={!running}><Send size={15} /></IconButton>
        <IconButton title="Отметки времени" active={stamps} onClick={() => setStamps(!stamps)}><Clock size={15} /></IconButton>
        <IconButton title="Автопрокрутка" active={auto} onClick={() => setAuto(!auto)}><ArrowDownToLine size={15} /></IconButton>
        <IconButton title="Очистить" onClick={() => useWB.getState().clearSerial()}><Eraser size={15} /></IconButton>
      </div>
    </div>
  );
}

// ---------------- плоттер ----------------
const COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#fbbf24', '#a78bfa', '#fb7185', '#34d399', '#60a5fa'];

export function parsePlotLine(line: string): { names: string[]; values: number[] } | null {
  const parts = line.trim().split(/[\s,;\t]+/).filter(Boolean);
  const names: string[] = [];
  const values: number[] = [];
  for (const p of parts) {
    const m = /^(?:([^:=]+)[:=])?(-?\d+(?:\.\d+)?)$/.exec(p);
    if (!m) continue;
    names.push(m[1] ?? `#${values.length + 1}`);
    values.push(Number(m[2]));
  }
  return values.length ? { names, values } : null;
}

export function PlotterPanel() {
  const rev = useWB((s) => s.serialRev);
  const canvas = useRef<HTMLCanvasElement>(null);
  const data = useRef<{ names: string[]; series: number[][]; consumed: string; chunkCount: number }>({ names: [], series: [], consumed: '', chunkCount: 0 });

  useEffect(() => {
    const serial: SerialChunk[] = useWB.getState().serial.filter((c) => c.port === 0);
    const all = serial.map((c) => c.text).join('');
    const d = data.current;
    if (!all.startsWith(d.consumed)) { d.consumed = ''; d.series = []; d.names = []; }
    const fresh = all.slice(d.consumed.length);
    const lastNl = fresh.lastIndexOf('\n');
    if (lastNl >= 0) {
      for (const line of fresh.slice(0, lastNl).split('\n')) {
        const r = parsePlotLine(line);
        if (!r) continue;
        r.values.forEach((v, i) => {
          if (!d.series[i]) d.series[i] = [];
          d.series[i].push(v);
          if (d.series[i].length > 400) d.series[i].shift();
          d.names[i] = r.names[i];
        });
      }
      d.consumed = all.slice(0, d.consumed.length + lastNl + 1);
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  function draw() {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const { series, names } = data.current;
    const css = getComputedStyle(document.documentElement);
    const grid = css.getPropertyValue('--grid');
    const muted = css.getPropertyValue('--muted');
    let min = Infinity; let max = -Infinity;
    for (const s of series) for (const v of s) { if (v < min) min = v; if (v > max) max = v; }
    if (!Number.isFinite(min)) {
      ctx.fillStyle = muted; ctx.font = '13px Inter'; ctx.textAlign = 'center';
      ctx.fillText('Печатайте числа через пробел или «имя:значение» — например Serial.println(String(t) + " " + h);', w / 2, h / 2);
      return;
    }
    if (max === min) { max += 1; min -= 1; }
    const padL = 48; const padT = 26; const padB = 14; const padR = 10;
    const pw = w - padL - padR; const ph = h - padT - padB;
    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = muted; ctx.font = '11px JetBrains Mono'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (ph * i) / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      const v = max - ((max - min) * i) / 4;
      ctx.fillText(Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2), padL - 6, y + 4);
    }
    series.forEach((s, i) => {
      ctx.strokeStyle = COLORS[i % COLORS.length]; ctx.lineWidth = 1.8; ctx.beginPath();
      s.forEach((v, j) => {
        const x = padL + (pw * j) / Math.max(1, 399);
        const y = padT + ph * (1 - (v - min) / (max - min));
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    ctx.textAlign = 'left'; ctx.font = '12px Inter';
    let lx = padL;
    names.forEach((n, i) => {
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fillRect(lx, 8, 10, 10);
      ctx.fillStyle = muted;
      const label = `${n}: ${series[i]?.[series[i].length - 1] ?? ''}`;
      ctx.fillText(label, lx + 14, 17);
      lx += ctx.measureText(label).width + 28;
    });
  }

  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (canvas.current) ro.observe(canvas.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvas} className="h-full w-full" />;
}
