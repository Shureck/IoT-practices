// Автоматическая разводка проводов: ортогональные трассы по сетке с обходом компонентов.
//
// Идея: каждый вывод «смотрит» наружу из корпуса (ряд ESP32 — вверх/вниз, ножки светодиода — вниз),
// провод выходит из него коротким прямым отрезком, а дальше A* ищет путь по сетке 5×5, штрафуя
// повороты, проход через корпуса, перекрытие чужих выводов и наложение на уже проложенные провода.
// Провода прокладываются по очереди, поэтому следующие обходят предыдущие и расходятся по соседним
// «дорожкам», а не сливаются в одну линию.
import { DEFS, pinPos, rotPoint, type CircuitDoc, type PinRef, type Wire } from './defs';

export type Pt = [number, number];

const G = 5; // шаг сетки трассировки
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/** Стоимости (в шагах сетки). */
const COST = {
  bend: 2.5,
  body: 60, // проход над корпусом компонента
  keepout: 25, // проход через чужой вывод или его «выход»
  hole: 1.2, // проход над отверстием макетки
  overlap: 20, // наложение на провод другой цепи
  overlapSame: -0.4, // провода одной цепи (GND, питание) охотно идут общей шиной
  cross: 5, // пересечение провода
  near: 0.5, // параллельно вплотную к другому проводу
  fan: 3, // движение вдоль ряда выводов прямо перед ними (закрывает подход к соседним выводам)
};

/** Глубина «веерной» зоны перед выводами, в клетках сетки. */
const FAN = 3;

interface PinInfo {
  id: number;
  x: number;
  y: number;
  /** направление выхода из корпуса: 0 →, 1 ↓, 2 ←, 3 ↑; null — любое (макетка) */
  dir: number | null;
  /** конец «выводного» отрезка */
  sx: number;
  sy: number;
}

function partRect(type: string, x: number, y: number, rot: number) {
  const [bx, by, bw, bh] = DEFS[type].box;
  const a = rotPoint(bx, by, rot, x, y);
  const b = rotPoint(bx + bw, by + bh, rot, x, y);
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}

class MinHeap {
  private f = new Float64Array(1024);
  private s = new Int32Array(1024);
  n = 0;
  push(f: number, s: number) {
    if (this.n === this.f.length) {
      const nf = new Float64Array(this.n * 2); nf.set(this.f); this.f = nf;
      const ns = new Int32Array(this.n * 2); ns.set(this.s); this.s = ns;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= f) break;
      this.f[i] = this.f[p]; this.s[i] = this.s[p]; i = p;
    }
    this.f[i] = f; this.s[i] = s;
  }
  topF() { return this.f[0]; }
  pop(): number {
    const top = this.s[0];
    const lf = this.f[--this.n];
    const ls = this.s[this.n];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.f[c + 1] < this.f[c]) c++;
      if (this.f[c] >= lf) break;
      this.f[i] = this.f[c]; this.s[i] = this.s[c]; i = c;
    }
    this.f[i] = lf; this.s[i] = ls;
    return top;
  }
}

export interface Router {
  /** готовые трассы проводов: ломаная от вывода a к выводу b */
  paths: Map<string, Pt[]>;
  /** узлы — точки, где провода одной цепи расходятся (рисуются точкой) */
  junctions: { x: number; y: number; wire: string }[];
  /** трасса для провода, который пользователь тянет сейчас */
  draft(from: PinRef, to: Pt, pts: Pt[]): Pt[];
  /** сведения о выводе: направление выхода и конец выводного отрезка */
  pinInfo(ref: PinRef): PinInfo | undefined;
}

export function createRouter(doc: CircuitDoc): Router {
  // ---------- выводы ----------
  const pins = new Map<string, PinInfo>();
  const pinList: PinInfo[] = [];
  const parts = doc.parts.filter((p) => DEFS[p.type]);
  for (const p of parts) {
    const def = DEFS[p.type];
    const [bx, by, bw, bh] = def.box;
    for (const pin of def.pins) {
      const [x, y] = pinPos(p, pin.name)!;
      let dir: number | null = null;
      let sx = x;
      let sy = y;
      if (p.type !== 'breadboard') {
        const dist = [bx + bw - pin.x, by + bh - pin.y, pin.x - bx, pin.y - by];
        let k = 0;
        for (let i = 1; i < 4; i++) if (dist[i] < dist[k]) k = i;
        dir = (k + Math.round(((p.rot % 360) + 360) % 360 / 90)) % 4;
        const len = Math.max(2 * G, Math.ceil((Math.max(0, dist[k]) + 8) / G) * G);
        sx = x + DX[dir] * len;
        sy = y + DY[dir] * len;
      }
      const info: PinInfo = { id: pinList.length, x, y, dir, sx, sy };
      pinList.push(info);
      pins.set(`${p.id}:${pin.name}`, info);
    }
  }

  // ---------- сетка ----------
  let bx0 = Infinity; let by0 = Infinity; let bx1 = -Infinity; let by1 = -Infinity;
  const grow = (x: number, y: number) => { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); };
  const rects = parts.map((p) => ({ type: p.type, ...partRect(p.type, p.x, p.y, p.rot) }));
  for (const r of rects) { grow(r.x0, r.y0); grow(r.x1, r.y1); }
  for (const pi of pinList) grow(pi.sx, pi.sy);
  for (const w of doc.wires) for (const [x, y] of w.pts) grow(x, y);
  if (!Number.isFinite(bx0)) { bx0 = 0; by0 = 0; bx1 = 100; by1 = 100; }
  const M = 80;
  const x0 = Math.floor((bx0 - M) / G) * G;
  const y0 = Math.floor((by0 - M) / G) * G;
  const W = Math.ceil((bx1 + M - x0) / G) + 1;
  const H = Math.ceil((by1 + M - y0) / G) + 1;
  const N = W * H;
  const cx = (x: number) => Math.max(0, Math.min(W - 1, Math.round((x - x0) / G)));
  const cy = (y: number) => Math.max(0, Math.min(H - 1, Math.round((y - y0) / G)));
  const cell = (x: number, y: number) => cy(y) * W + cx(x);

  const cost = new Float32Array(N);
  const owner = new Int32Array(N); // 0 — свободно, id+1 — зона вывода, -1 — зоны нескольких выводов
  for (const r of rects) {
    if (r.type === 'breadboard') continue;
    const m = 4;
    const i0 = Math.ceil((r.x0 - m - x0) / G + 1e-6);
    const i1 = Math.floor((r.x1 + m - x0) / G - 1e-6);
    const j0 = Math.ceil((r.y0 - m - y0) / G + 1e-6);
    const j1 = Math.floor((r.y1 + m - y0) / G - 1e-6);
    for (let j = Math.max(0, j0); j <= Math.min(H - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) cost[j * W + i] += COST.body;
    }
  }
  const fan = new Uint8Array(N); // 1 — штраф за горизонтальное движение, 2 — за вертикальное
  const zone = new Int32Array(N); // вывод (id+1), к которому относится клетка «веера»; -1 — несколько
  const claim = (c: number, id: number) => { owner[c] = owner[c] === 0 || owner[c] === id + 1 ? id + 1 : -1; };
  for (const pi of pinList) {
    if (pi.dir === null) { cost[cell(pi.x, pi.y)] += COST.hole; continue; }
    const len = Math.abs(pi.sx - pi.x) + Math.abs(pi.sy - pi.y);
    for (let k = 0; k <= len; k += G) claim(cell(pi.x + DX[pi.dir] * k, pi.y + DY[pi.dir] * k), pi.id);
    const bit = pi.dir === 1 || pi.dir === 3 ? 1 : 2;
    for (let k = len + G; k <= len + FAN * G; k += G) {
      const c = cell(pi.x + DX[pi.dir] * k, pi.y + DY[pi.dir] * k);
      fan[c] |= bit;
      zone[c] = zone[c] === 0 || zone[c] === pi.id + 1 ? pi.id + 1 : -1;
    }
  }

  // ---------- занятость ----------
  // для каждой клетки и ребра — первая цепь (net+1) и признак «несколько цепей»
  const hNet = new Int32Array(N); const hMul = new Uint8Array(N); // ребро (i,j)→(i+1,j)
  const vNet = new Int32Array(N); const vMul = new Uint8Array(N); // ребро (i,j)→(i,j+1)
  const nNet = new Int32Array(N); const nMul = new Uint8Array(N);
  const mark = (net: Int32Array, mul: Uint8Array, idx: number, n: number) => {
    if (net[idx] === 0) net[idx] = n + 1; else if (net[idx] !== n + 1) mul[idx] = 1;
  };
  const other = (net: Int32Array, mul: Uint8Array, idx: number, n: number) => net[idx] !== 0 && (mul[idx] === 1 || net[idx] !== n + 1);

  const occupy = (path: number[], n: number) => {
    for (let k = 0; k < path.length; k++) {
      const c = path[k];
      mark(nNet, nMul, c, n);
      if (k === 0) continue;
      const p = path[k - 1];
      if (c === p) continue;
      const d = c - p;
      if (d === 1) mark(hNet, hMul, p, n);
      else if (d === -1) mark(hNet, hMul, c, n);
      else if (d === W) mark(vNet, vMul, p, n);
      else if (d === -W) mark(vNet, vMul, c, n);
    }
  };

  // ---------- A* ----------
  const gScore = new Float32Array(N * 4);
  const prev = new Int32Array(N * 4);
  const heap = new MinHeap();

  /** путь (список клеток) от s к t; startDir/arriveDir — обязательные направления (или null) */
  function search(s: number, t: number, startDir: number | null, arriveDir: number | null, n: number, exempt: number[]): number[] {
    if (s === t) return [s];
    gScore.fill(Infinity);
    heap.n = 0;
    const ti = t % W;
    const tj = (t / W) | 0;
    const h = (c: number) => Math.abs((c % W) - ti) + Math.abs(((c / W) | 0) - tj);
    for (let d = 0; d < 4; d++) {
      if (startDir !== null && d !== startDir) continue;
      gScore[s * 4 + d] = 0;
      prev[s * 4 + d] = -1;
      heap.push(h(s), s * 4 + d);
    }
    let best = Infinity;
    let bestState = -1;
    while (heap.n) {
      if (heap.topF() >= best) break;
      const st = heap.pop();
      const c = st >> 2;
      const d = st & 3;
      const g = gScore[st];
      if (c === t) {
        const total = g + (arriveDir !== null && d !== arriveDir ? COST.bend * 2 : 0);
        if (total < best) { best = total; bestState = st; }
        continue;
      }
      const i = c % W;
      const j = (c / W) | 0;
      for (let nd = 0; nd < 4; nd++) {
        if (nd === ((d + 2) & 3) && prev[st] !== -1) continue; // без разворотов
        const ni = i + DX[nd];
        const nj = j + DY[nd];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nc = nj * W + ni;
        let step = 1 + cost[nc];
        if (nd !== d && prev[st] !== -1) step += COST.bend;
        else if (nd !== d) step += COST.bend * 0.6; // поворот сразу после выхода из вывода
        const o = owner[nc];
        if (o !== 0 && (o === -1 || !exempt.includes(o - 1))) step += COST.keepout;
        // у своего вывода провода одной цепи могут идти вместе (к одному выводу иначе не подойти)
        const z = zone[nc];
        const shared = (o > 0 && exempt.includes(o - 1)) || (z > 0 && exempt.includes(z - 1));
        const same = shared ? -0.4 : COST.overlapSame;
        if (nd === 0 || nd === 2) {
          if (fan[nc] & 1) step += COST.fan;
          const e = nd === 0 ? c : nc;
          if (other(hNet, hMul, e, n)) step += COST.overlap;
          else if (hNet[e] !== 0) step += same;
          if ((nj > 0 && other(hNet, hMul, e - W, n)) || (nj < H - 1 && other(hNet, hMul, e + W, n))) step += COST.near;
          if (vNet[nc] !== 0 || (nj > 0 && vNet[nc - W] !== 0)) if (other(nNet, nMul, nc, n)) step += COST.cross;
        } else {
          if (fan[nc] & 2) step += COST.fan;
          const e = nd === 1 ? c : nc;
          if (other(vNet, vMul, e, n)) step += COST.overlap;
          else if (vNet[e] !== 0) step += same;
          if ((ni > 0 && other(vNet, vMul, e - 1, n)) || (ni < W - 1 && other(vNet, vMul, e + 1, n))) step += COST.near;
          if (hNet[nc] !== 0 || (ni > 0 && hNet[nc - 1] !== 0)) if (other(nNet, nMul, nc, n)) step += COST.cross;
        }
        const ns = nc * 4 + nd;
        const ng = g + step;
        if (ng < gScore[ns]) {
          gScore[ns] = ng;
          prev[ns] = st;
          heap.push(ng + h(nc), ns);
        }
      }
    }
    if (bestState < 0) return [s, t];
    const out: number[] = [];
    for (let st = bestState; st !== -1; st = prev[st]) out.push(st >> 2);
    return out.reverse();
  }

  const cellPt = (c: number): Pt => [x0 + (c % W) * G, y0 + ((c / W) | 0) * G];

  /** клетки вдоль ортогонального отрезка */
  const raster = (a: Pt, b: Pt): number[] => {
    const out: number[] = [];
    const ia = cx(a[0]); const ja = cy(a[1]); const ib = cx(b[0]); const jb = cy(b[1]);
    const si = Math.sign(ib - ia); const sj = Math.sign(jb - ja);
    let i = ia; let j = ja;
    out.push(j * W + i);
    while (i !== ib) { i += si; out.push(j * W + i); }
    while (j !== jb) { j += sj; out.push(j * W + i); }
    return out;
  };

  // ---------- цепи (провода одной цепи могут сходиться без штрафа за «чужую» цепь) ----------
  const uf = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (uf.has(r) && uf.get(r) !== r) r = uf.get(r)!;
    uf.set(k, r);
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a); const rb = find(b); if (ra !== rb) uf.set(ra, rb); };
  for (const p of parts) for (const group of DEFS[p.type].bus ?? []) for (let i = 1; i < group.length; i++) union(`${p.id}:${group[0]}`, `${p.id}:${group[i]}`);
  for (const w of doc.wires) union(`${w.a.part}:${w.a.pin}`, `${w.b.part}:${w.b.pin}`);
  const netIds = new Map<string, number>();
  const netOf = (k: string) => {
    const r = find(k);
    if (!netIds.has(r)) netIds.set(r, netIds.size);
    return netIds.get(r)!;
  };

  /** Прокладка: вывод A → [точки изгиба] → вывод B (B может отсутствовать — тогда до точки). */
  function routeWire(a: PinInfo, pts: Pt[], b: PinInfo | null, end: Pt | null, net: number, commit: boolean): Pt[] {
    const exempt = b ? [a.id, b.id] : [a.id];
    const cells: number[] = [];
    const push = (list: number[]) => { for (const c of list) if (cells[cells.length - 1] !== c) cells.push(c); };
    // выход из вывода A
    push(raster([a.x, a.y], [a.sx, a.sy]));
    const targets: { c: number; arrive: number | null }[] = pts.map(([x, y]) => ({ c: cell(x, y), arrive: null }));
    if (b) targets.push({ c: cell(b.sx, b.sy), arrive: b.dir === null ? null : (b.dir + 2) % 4 });
    else if (end) targets.push({ c: cell(end[0], end[1]), arrive: null });
    let from = cell(a.sx, a.sy);
    let dir: number | null = a.dir;
    for (const t of targets) {
      const seg = search(from, t.c, dir, t.arrive, net, exempt);
      push(seg);
      if (seg.length >= 2) {
        const p = seg[seg.length - 2];
        const q = seg[seg.length - 1];
        dir = q - p === 1 ? 0 : q - p === -1 ? 2 : q - p === W ? 1 : 3;
      } else dir = null;
      from = t.c;
    }
    if (b) push(raster([b.sx, b.sy], [b.x, b.y]));
    if (commit) occupy(cells, net);

    // клетки → ломаная, точные координаты концов
    const raw: Pt[] = cells.map(cellPt);
    raw[0] = [a.x, a.y];
    if (b) raw[raw.length - 1] = [b.x, b.y];
    else if (end) raw.push(end);
    return simplify(raw);
  }

  // порядок: сначала короткие — они остаются прямыми, длинные обходят
  const order = doc.wires
    .map((w) => ({ w, a: pins.get(`${w.a.part}:${w.a.pin}`), b: pins.get(`${w.b.part}:${w.b.pin}`) }))
    .filter((x): x is { w: Wire; a: PinInfo; b: PinInfo } => !!x.a && !!x.b)
    .sort((p, q) => {
      const lp = Math.abs(p.a.x - p.b.x) + Math.abs(p.a.y - p.b.y);
      const lq = Math.abs(q.a.x - q.b.x) + Math.abs(q.a.y - q.b.y);
      return lp - lq || (p.w.id < q.w.id ? -1 : 1);
    });

  const paths = new Map<string, Pt[]>();
  for (const { w, a, b } of order) {
    paths.set(w.id, routeWire(a, w.pts, b, null, netOf(`${w.a.part}:${w.a.pin}`), true));
  }

  // узлы: точки, где сходятся три и более отрезков одной цепи
  const junctions: { x: number; y: number; wire: string }[] = [];
  const byNet = new Map<number, { edges: Set<string>; deg: Map<string, number>; owner: Map<string, string> }>();
  for (const { w } of order) {
    const n = netOf(`${w.a.part}:${w.a.pin}`);
    let rec = byNet.get(n);
    if (!rec) { rec = { edges: new Set(), deg: new Map(), owner: new Map() }; byNet.set(n, rec); }
    const path = paths.get(w.id)!;
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1]; const [bx, by] = path[i];
      const len = Math.abs(bx - ax) + Math.abs(by - ay);
      if (len % G !== 0) continue;
      const sx = Math.sign(bx - ax) * G; const sy = Math.sign(by - ay) * G;
      for (let k = 0; k < len / G; k++) {
        const p = `${ax + sx * k},${ay + sy * k}`; const q = `${ax + sx * (k + 1)},${ay + sy * (k + 1)}`;
        const key = p < q ? `${p}|${q}` : `${q}|${p}`;
        if (rec.edges.has(key)) continue;
        rec.edges.add(key);
        for (const pt of [p, q]) { rec.deg.set(pt, (rec.deg.get(pt) ?? 0) + 1); if (!rec.owner.has(pt)) rec.owner.set(pt, w.id); }
      }
    }
  }
  for (const rec of byNet.values()) {
    for (const [pt, d] of rec.deg) {
      if (d < 3) continue;
      const [x, y] = pt.split(',').map(Number);
      junctions.push({ x, y, wire: rec.owner.get(pt)! });
    }
  }

  return {
    paths,
    junctions,
    pinInfo: (ref) => pins.get(`${ref.part}:${ref.pin}`),
    draft(from, to, pts) {
      const a = pins.get(`${from.part}:${from.pin}`);
      if (!a) return [to];
      return routeWire(a, pts, null, to, netOf(`${from.part}:${from.pin}`), false);
    },
  };
}

/** Убирает повторяющиеся и лежащие на одной прямой точки; диагональные стыки превращает в «Г». */
export function simplify(raw: Pt[]): Pt[] {
  const pts: Pt[] = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    if (last && last[0] !== p[0] && last[1] !== p[1]) pts.push([p[0], last[1]]);
    pts.push(p);
  }
  const out: Pt[] = [];
  for (const p of pts) {
    while (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const col = (a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1]);
      if (!col) break;
      out.pop();
    }
    out.push(p);
  }
  return out;
}

/** SVG-путь по ломаной со скруглёнными углами. */
export function polyPath(points: Pt[], radius = 4): string {
  if (points.length < 2) return '';
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const l1 = Math.hypot(cx - px, cy - py) || 1;
    const l2 = Math.hypot(nx - cx, ny - cy) || 1;
    const r = Math.min(radius, l1 / 2, l2 / 2);
    d += ` L${cx - ((cx - px) / l1) * r} ${cy - ((cy - py) / l1) * r} Q${cx} ${cy} ${cx + ((nx - cx) / l2) * r} ${cy + ((ny - cy) / l2) * r}`;
  }
  const last = points[points.length - 1];
  d += ` L${last[0]} ${last[1]}`;
  return d;
}
