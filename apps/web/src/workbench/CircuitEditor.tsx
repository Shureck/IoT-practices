// Редактор схемы: компоненты, провода, масштаб, взаимодействие при симуляции.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFS, createRouter, pinPos, polyPath, type CircuitDoc, type Part, type PinRef, type Pt } from '@esp32lab/sim';
import { Maximize2, Minus, Plus, AlertTriangle } from 'lucide-react';
import { PartView } from './parts';
import { Junction, WireShape } from './Wire';
import { useWB } from './store';
import { modelOf, partAction, setLiveProp, syncCircuit } from './simController';

interface View { x: number; y: number; k: number }
type Drag =
  | { kind: 'part'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; pressed?: boolean }
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: 'bend'; wireId: string; idx: number; moved: boolean }
  | null;

const SNAP = 10;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

function bbox(doc: CircuitDoc) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of doc.parts) {
    const def = DEFS[p.type];
    if (!def) continue;
    const [bx, by, bw, bh] = def.box;
    const corners: [number, number][] = [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]];
    for (const [cx, cy] of corners) {
      const [wx, wy] = rot(cx, cy, p.rot, p.x, p.y);
      x0 = Math.min(x0, wx); y0 = Math.min(y0, wy); x1 = Math.max(x1, wx); y1 = Math.max(y1, wy);
    }
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 220, y1: 100 };
  return { x0, y0, x1, y1 };
}

function rot(x: number, y: number, r: number, ox: number, oy: number): [number, number] {
  switch (((r % 360) + 360) % 360) {
    case 90: return [ox - y, oy + x];
    case 180: return [ox - x, oy - y];
    case 270: return [ox + y, oy - x];
    default: return [ox + x, oy + y];
  }
}

const INTERACTIVE = new Set(['button', 'switch', 'pir']);

export function CircuitEditor() {
  const circuit = useWB((s) => s.circuit);
  const sel = useWB((s) => s.sel);
  const draft = useWB((s) => s.draft);
  const views = useWB((s) => s.views);
  const running = useWB((s) => s.running);
  const readOnly = useWB((s) => s.readOnly);
  const locked = useWB((s) => s.circuitLocked);
  const set = useWB((s) => s.set);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 2 });
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [hoverPin, setHoverPin] = useState<{ ref: PinRef; x: number; y: number } | null>(null);
  const [hoverPart, setHoverPart] = useState<string | null>(null);
  const drag = useRef<Drag>(null);
  const fitted = useRef(false);
  const canEdit = !readOnly && !locked;
  // автоматическая разводка: провода обходят компоненты и не накладываются друг на друга
  const router = useMemo(() => createRouter({ parts: circuit.parts, wires: circuit.wires }), [circuit.parts, circuit.wires]);

  // синхронизация схемы с идущей симуляцией
  useEffect(() => { if (running) syncCircuit(circuit); }, [circuit, running]);

  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const b = bbox(circuit);
    for (const path of router.paths.values()) {
      for (const [x, y] of path) { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); }
    }
    const pad = 30;
    const k = Math.max(0.5, Math.min(4, Math.min((r.width - pad * 2) / (b.x1 - b.x0), (r.height - pad * 2) / (b.y1 - b.y0))));
    setView({ k, x: r.width / 2 - ((b.x0 + b.x1) / 2) * k, y: r.height / 2 - ((b.y0 + b.y1) / 2) * k });
  }, [circuit, router]);

  const fitRef = useRef(fit);
  fitRef.current = fit;
  const loadSeq = useWB((s) => s.loadSeq);
  useEffect(() => { if (fitted.current) requestAnimationFrame(() => fit()); }, [loadSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (fitted.current) return;
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!fitted.current && el.getBoundingClientRect().width > 50) { fitted.current = true; fit(); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const toWorld = useCallback((cx: number, cy: number): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(cx - r.left - view.x) / view.k, (cy - r.top - view.y) / view.k];
  }, [view]);

  const pinsWorld = useMemo(() => {
    const res: { ref: PinRef; x: number; y: number; label: string; part: Part }[] = [];
    for (const p of circuit.parts) {
      const def = DEFS[p.type];
      if (!def) continue;
      for (const pin of def.pins) {
        const pos = pinPos(p, pin.name)!;
        const gpio = pin.gpio !== undefined ? ` · GPIO${pin.gpio}` : '';
        res.push({ ref: { part: p.id, pin: pin.name }, x: pos[0], y: pos[1], label: `${pin.label ?? pin.name}${gpio}`, part: p });
      }
    }
    return res;
  }, [circuit]);

  const pinAt = useCallback((ref: PinRef) => pinsWorld.find((p) => p.ref.part === ref.part && p.ref.pin === ref.pin), [pinsWorld]);

  const connectedPins = useMemo(() => {
    const s = new Set<string>();
    for (const w of circuit.wires) { s.add(`${w.a.part}:${w.a.pin}`); s.add(`${w.b.part}:${w.b.pin}`); }
    return s;
  }, [circuit.wires]);

  // ---------- колесо: масштаб к курсору ----------
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const k = Math.max(0.35, Math.min(8, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---------- указатель ----------
  const onBgDown = (e: React.PointerEvent) => {
    if (e.button === 2) { set({ draft: null }); return; }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
  };

  const onPartDown = (e: React.PointerEvent, p: Part) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (running && INTERACTIVE.has(p.type)) {
      if (p.type === 'button') {
        if (e.shiftKey) {
          const pressed = !!views[p.id]?.pressed;
          partAction(p.id, pressed ? 'release' : 'press');
        } else {
          partAction(p.id, 'press');
          drag.current = { kind: 'part', id: p.id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false, pressed: true };
        }
        return;
      }
      if (p.type === 'switch') {
        const on = !views[p.id]?.on;
        setLiveProp(p.id, 'on', on);
        useWB.getState().updatePart(p.id, (x) => ({ ...x, props: { ...x.props, on } }), false);
        return;
      }
      if (p.type === 'pir') { partAction(p.id, 'motion'); return; }
    }
    set({ sel: { kind: 'part', id: p.id } });
    if (readOnly) return;
    if (p.locked && locked) return;
    drag.current = { kind: 'part', id: p.id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
  };

  const onPinDown = (e: React.PointerEvent, ref: PinRef) => {
    e.stopPropagation();
    if (!canEdit && !(readOnly === false && !locked)) return;
    if (!canEdit) return;
    const d = useWB.getState().draft;
    if (!d) {
      set({ draft: { from: ref, pts: [] }, sel: null });
      return;
    }
    if (d.from.part === ref.part && d.from.pin === ref.pin) { set({ draft: null }); return; }
    useWB.getState().addWire(d.from, ref, d.pts);
    set({ draft: null });
  };

  const onWireDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (useWB.getState().draft) return;
    set({ sel: { kind: 'wire', id } });
  };

  const onBendDown = (e: React.PointerEvent, wireId: string, idx: number) => {
    e.stopPropagation();
    if (!canEdit) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    useWB.getState().pushHistory();
    drag.current = { kind: 'bend', wireId, idx, moved: false };
  };

  // двойной клик по проводу — новая точка изгиба (провод будет обязательно проходить через неё)
  const onWireDouble = (e: React.MouseEvent, id: string, path: Pt[]) => {
    e.stopPropagation();
    if (!canEdit) return;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const pt: Pt = [snap(wx), snap(wy)];
    // положение вдоль трассы: по нему точка встаёт между существующими изгибами
    const along = (q: Pt) => {
      let best = Infinity; let pos = 0; let acc = 0;
      for (let i = 1; i < path.length; i++) {
        const [ax, ay] = path[i - 1]; const [bx, by] = path[i];
        const len = Math.abs(bx - ax) + Math.abs(by - ay);
        const t = len ? Math.max(0, Math.min(1, ((q[0] - ax) * (bx - ax) + (q[1] - ay) * (by - ay)) / (len * len))) : 0;
        const dist = Math.hypot(ax + (bx - ax) * t - q[0], ay + (by - ay) * t - q[1]);
        if (dist < best) { best = dist; pos = acc + t * len; }
        acc += len;
      }
      return pos;
    };
    useWB.getState().updateWire(id, (w) => {
      const all = [...w.pts, pt].map((p) => ({ p, s: along(p) })).sort((x, y) => x.s - y.s);
      return { ...w, pts: all.map((x) => x.p) };
    });
    set({ sel: { kind: 'wire', id } });
  };

  const removeBend = (e: React.MouseEvent, id: string, idx: number) => {
    e.stopPropagation();
    if (!canEdit) return;
    useWB.getState().updateWire(id, (w) => ({ ...w, pts: w.pts.filter((_, i) => i !== idx) }));
  };

  const onMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    if (useWB.getState().draft) setCursor([snap(w[0]), snap(w[1])]);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.moved) setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
      return;
    }
    if (d.kind === 'part') {
      if (d.pressed) return;
      const dx = (e.clientX - d.sx) / view.k;
      const dy = (e.clientY - d.sy) / view.k;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!d.moved) { useWB.getState().pushHistory(); d.moved = true; }
      const nx = snap(d.ox + dx);
      const ny = snap(d.oy + dy);
      useWB.getState().updatePart(d.id, (p) => (p.x === nx && p.y === ny ? p : { ...p, x: nx, y: ny }), false);
      return;
    }
    if (d.kind === 'bend') {
      d.moved = true;
      useWB.getState().updateWire(d.wireId, (wr) => ({ ...wr, pts: wr.pts.map((pt, i) => (i === d.idx ? [snap(w[0]), snap(w[1])] : pt)) }), false);
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'part' && d.pressed) { partAction(d.id, 'release'); return; }
    if (d?.kind === 'pan' && !d.moved) {
      const dr = useWB.getState().draft;
      if (dr) {
        const w = toWorld(e.clientX, e.clientY);
        set({ draft: { ...dr, pts: [...dr.pts, [snap(w[0]), snap(w[1])]] } });
      } else set({ sel: null });
    }
  };

  // ---------- перетаскивание из палитры ----------
  const onDrop = (e: React.DragEvent) => {
    const type = e.dataTransfer.getData('application/x-esp32lab-part');
    if (!type || !canEdit) return;
    e.preventDefault();
    const [x, y] = toWorld(e.clientX, e.clientY);
    const def = DEFS[type];
    const [bx, by, bw, bh] = def.box;
    useWB.getState().addPart(type, x - (bx + bw / 2), y - (by + bh / 2), false);
  };

  // добавление по клику из палитры — в центр видимой области
  useEffect(() => {
    const handler = (e: Event) => {
      const type = (e as CustomEvent<string>).detail;
      const el = svgRef.current;
      if (!el || !canEdit) return;
      const doc = useWB.getState().circuit;
      const def = DEFS[type];
      const [bx, by, bw, bh] = def.box;
      // ищем свободное место справа от схемы
      const boxes = doc.parts.map((p) => {
        const d = DEFS[p.type];
        const c = [[d.box[0], d.box[1]], [d.box[0] + d.box[2], d.box[1] + d.box[3]]].map(([cx, cy]) => rot(cx, cy, p.rot, p.x, p.y));
        return { x0: Math.min(c[0][0], c[1][0]), y0: Math.min(c[0][1], c[1][1]), x1: Math.max(c[0][0], c[1][0]), y1: Math.max(c[0][1], c[1][1]) };
      });
      const all = bbox(doc);
      const free = (x: number, y: number) => !boxes.some((b) => x + bx < b.x1 + 15 && x + bx + bw > b.x0 - 15 && y + by < b.y1 + 15 && y + by + bh > b.y0 - 15);
      let px = all.x1 + 40 - bx;
      let py = all.y0 - by;
      found: for (let col = 0; col < 6; col++) {
        for (let row = 0; row < 8; row++) {
          const cx = all.x0 - bx + col * 90 + (col === 0 ? 0 : 0);
          const cy = all.y0 - by - 40 - bh + row * 60;
          if (col === 0 && row === 0 && free(cx, cy)) { px = cx; py = cy; break found; }
          const tx = all.x1 + 40 - bx + col * 90;
          const ty = all.y0 - by + row * 70;
          if (free(tx, ty)) { px = tx; py = ty; break found; }
        }
      }
      useWB.getState().addPart(type, px, py, false);
      setTimeout(() => fitRef.current(), 60);
    };
    window.addEventListener('esp32lab:add-part', handler);
    return () => window.removeEventListener('esp32lab:add-part', handler);
  }, [toWorld, canEdit]);

  const ordered = useMemo(() => {
    const rank = (p: Part) => (p.type === 'breadboard' ? 0 : p.type === 'esp32' ? 1 : 2);
    return [...circuit.parts].sort((a, b) => rank(a) - rank(b));
  }, [circuit.parts]);

  const draftFrom = draft ? pinAt(draft.from) : null;
  const draftPath = useMemo(() => (draft && draftFrom && cursor ? router.draft(draft.from, cursor, draft.pts) : null), [router, draft, draftFrom, cursor]);
  const selectedWire = sel?.kind === 'wire' ? circuit.wires.find((w) => w.id === sel.id) : null;
  const gridSize = SNAP * view.k;

  return (
    <div className="relative h-full w-full overflow-hidden select-none" style={{ background: 'var(--canvas)' }}>
      <svg
        ref={svgRef}
        className="h-full w-full touch-none"
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onContextMenu={(e) => { e.preventDefault(); set({ draft: null }); }}
        onDragOver={(e) => { if (canEdit) e.preventDefault(); }}
        onDrop={onDrop}
        style={{ cursor: draft ? 'crosshair' : 'default' }}
      >
        <defs>
          <pattern id="grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse" x={view.x % gridSize} y={view.y % gridSize}>
            <circle cx={1} cy={1} r={view.k > 1.2 ? 0.9 : 0.6} fill="var(--grid)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {ordered.map((p) => {
            const def = DEFS[p.type];
            if (!def) return null;
            const [bx, by, bw, bh] = def.box;
            const v = views[p.id];
            const issues = (v?.issues as string[] | undefined) ?? [];
            const selected = sel?.kind === 'part' && sel.id === p.id;
            return (
              <g
                key={p.id}
                transform={`translate(${p.x},${p.y}) rotate(${p.rot})`}
                onPointerDown={(e) => onPartDown(e, p)}
                onPointerEnter={() => setHoverPart(p.id)}
                onPointerLeave={() => setHoverPart((h) => (h === p.id ? null : h))}
                style={{ cursor: running && INTERACTIVE.has(p.type) ? 'pointer' : readOnly ? 'default' : 'grab' }}
              >
                <rect x={bx} y={by} width={bw} height={bh} fill="transparent" />
                <PartView part={p} view={v} running={running} model={p.type === 'oled' ? modelOf(p.id) : undefined} />
                {selected && (
                  <rect x={bx - 4} y={by - 4} width={bw + 8} height={bh + 8} rx={5} fill="none" stroke="var(--accent)" strokeWidth={1.2 / Math.max(0.6, view.k / 2)} strokeDasharray="4 3" pointerEvents="none" />
                )}
                {issues.length > 0 && (
                  <g transform={`translate(${bx + bw - 2},${by - 2}) rotate(${-p.rot})`} pointerEvents="none">
                    <circle r={6} fill="#f59e0b" />
                    <text y={3} fontSize={8} textAnchor="middle" fill="#111" fontWeight={800}>!</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* провода */}
          {circuit.wires.map((w) => {
            const path = router.paths.get(w.id);
            if (!path) return null;
            const d = polyPath(path);
            const selected = selectedWire?.id === w.id;
            return (
              <g key={w.id} onPointerDown={(e) => onWireDown(e, w.id)} onDoubleClick={(e) => onWireDouble(e, w.id, path)} style={{ cursor: 'pointer' }}>
                <path d={d} stroke="transparent" strokeWidth={8} fill="none" />
                <WireShape path={path} color={w.color} selected={selected} />
                {selected && canEdit && w.pts.map((pt, i) => (
                  <circle key={i} cx={pt[0]} cy={pt[1]} r={3.2} fill="var(--panel)" stroke="var(--accent)" strokeWidth={1.2} onPointerDown={(e) => onBendDown(e, w.id, i)} onDoubleClick={(e) => removeBend(e, w.id, i)} style={{ cursor: 'move' }}><title>Перетащите изгиб · двойной клик — удалить</title></circle>
                ))}
              </g>
            );
          })}

          {router.junctions.map((j) => {
            const wire = circuit.wires.find((x) => x.id === j.wire);
            return wire ? <Junction key={`${j.x},${j.y}`} x={j.x} y={j.y} color={wire.color} /> : null;
          })}

          {/* провод в процессе прокладки */}
          {draftPath && (
            <path d={polyPath(draftPath)} stroke={useWB.getState().wireColor} strokeWidth={2} fill="none" className="wire-draft" pointerEvents="none" strokeLinecap="round" />
          )}

          {/* выводы */}
          {pinsWorld.map((p) => {
            const key = `${p.ref.part}:${p.ref.pin}`;
            const isBB = p.part.type === 'breadboard';
            const show = !!draft || hoverPart === p.ref.part || (hoverPin && `${hoverPin.ref.part}:${hoverPin.ref.pin}` === key);
            const conn = connectedPins.has(key);
            if (isBB && !show && !conn) {
              return (
                <rect key={key} x={p.x - 3} y={p.y - 3} width={6} height={6} fill="transparent"
                  onPointerDown={(e) => onPinDown(e, p.ref)}
                  onPointerEnter={() => setHoverPin({ ref: p.ref, x: p.x, y: p.y })}
                  onPointerLeave={() => setHoverPin(null)} style={{ cursor: canEdit ? 'crosshair' : 'default' }} />
              );
            }
            return (
              <g key={key}>
                <circle
                  cx={p.x} cy={p.y} r={show ? 3.2 : conn ? 1.6 : 2.4}
                  fill={conn ? 'var(--accent)' : show ? 'rgba(34,211,238,0.25)' : 'transparent'}
                  stroke={show ? 'var(--accent)' : 'transparent'} strokeWidth={0.9}
                  onPointerDown={(e) => onPinDown(e, p.ref)}
                  onPointerEnter={() => setHoverPin({ ref: p.ref, x: p.x, y: p.y })}
                  onPointerLeave={() => setHoverPin(null)}
                  style={{ cursor: canEdit ? 'crosshair' : 'default' }}
                />
              </g>
            );
          })}
        </g>
      </svg>

      {/* подсказка по выводу */}
      {hoverPin && (() => {
        const p = pinAt(hoverPin.ref);
        if (!p) return null;
        return (
          <div className="pointer-events-none absolute z-10 rounded-md border border-line bg-panel px-2 py-1 font-mono text-[11px] shadow-lg"
            style={{ left: p.x * view.k + view.x + 10, top: p.y * view.k + view.y - 30 }}>
            <span className="text-faint">{DEFS[p.part.type]?.title}:</span> {p.label}
          </div>
        );
      })()}

      {/* управление видом */}
      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-lg">
        <button className="focus-ring p-1.5 text-muted hover:bg-panel-2 hover:text-text" title="Приблизить" onClick={() => setView((v) => ({ ...v, k: Math.min(8, v.k * 1.25) }))}><Plus size={15} /></button>
        <button className="focus-ring p-1.5 text-muted hover:bg-panel-2 hover:text-text" title="Отдалить" onClick={() => setView((v) => ({ ...v, k: Math.max(0.35, v.k / 1.25) }))}><Minus size={15} /></button>
        <button className="focus-ring p-1.5 text-muted hover:bg-panel-2 hover:text-text" title="Показать всё" onClick={fit}><Maximize2 size={14} /></button>
      </div>

      {draft && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted shadow">
          Кликните по выводу, чтобы закончить провод · клик по полю — изгиб · Esc — отмена
        </div>
      )}
      {!draft && canEdit && circuit.wires.length === 0 && circuit.parts.length > 1 && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-line bg-panel/90 px-3 py-1 text-xs text-muted">
          Чтобы проложить провод — кликните по выводу компонента, затем по выводу платы
        </div>
      )}
      <IssuesOverlay />
    </div>
  );
}

function IssuesOverlay() {
  const views = useWB((s) => s.views);
  const circuit = useWB((s) => s.circuit);
  const list: { title: string; text: string }[] = [];
  for (const p of circuit.parts) {
    const issues = (views[p.id]?.issues as string[] | undefined) ?? [];
    for (const t of issues) list.push({ title: DEFS[p.type]?.title ?? p.type, text: t });
  }
  if (!list.length) return null;
  return (
    <div className="absolute bottom-3 left-3 max-w-[60%] space-y-1">
      {list.slice(0, 3).map((x, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg border border-warn/40 bg-panel/95 px-2.5 py-1.5 text-xs shadow">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
          <span><b className="font-semibold">{x.title}:</b> {x.text}</span>
        </div>
      ))}
    </div>
  );
}
