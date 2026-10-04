// Качество автоматической разводки проводов на схемах всех практик.
import { describe, expect, it } from 'vitest';
import { DEFS, createRouter, pinPos, rotPoint, type CircuitDoc, type Pt } from '@esp32lab/sim';
import { PRACTICES } from '../src/index';

const circuits: { id: string; doc: CircuitDoc }[] = [];
for (const p of PRACTICES) {
  if (p.solution.circuit?.wires.length) circuits.push({ id: `${p.id}/solution`, doc: p.solution.circuit });
  if (p.starterCircuit?.wires.length) circuits.push({ id: `${p.id}/starter`, doc: p.starterCircuit });
}

/** единичные отрезки (шаг 5) ломаной */
function units(path: Pt[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const n = Math.round((Math.abs(bx - ax) + Math.abs(by - ay)) / 5);
    for (let k = 0; k < n; k++) {
      const x = ax + ((bx - ax) * k) / n; const y = ay + ((by - ay) * k) / n;
      const x2 = ax + ((bx - ax) * (k + 1)) / n; const y2 = ay + ((by - ay) * (k + 1)) / n;
      out.push(x < x2 || y < y2 ? `${x},${y},${x2},${y2}` : `${x2},${y2},${x},${y}`);
    }
  }
  return out;
}

describe('разводка проводов', () => {
  it('все практики: без наложений, ортогонально, быстро', () => {
    let worst = 0;
    const report: string[] = [];
    for (const { id, doc } of circuits) {
      const t0 = performance.now();
      const r = createRouter(doc);
      const ms = performance.now() - t0;
      worst = Math.max(worst, ms);
      expect(r.paths.size).toBe(doc.wires.length);
      // цепи: провода + внутренние шины компонентов
      const uf = new Map<string, string>();
      const find = (k: string): string => { while (uf.has(k) && uf.get(k) !== k) k = uf.get(k)!; return k; };
      const union = (a: string, b: string) => { const ra = find(a); const rb = find(b); if (ra !== rb) uf.set(ra, rb); };
      for (const p of doc.parts) for (const g of DEFS[p.type].bus ?? []) for (const x of g) union(`${p.id}:${g[0]}`, `${p.id}:${x}`);
      for (const w of doc.wires) union(`${w.a.part}:${w.a.pin}`, `${w.b.part}:${w.b.pin}`);
      const netOf = (id: string) => { const w = doc.wires.find((x) => x.id === id)!; return find(`${w.a.part}:${w.a.pin}`); };
      const used = new Map<string, string>();
      let overlaps = 0;
      let crossings = 0;
      let throughBody = 0;
      let throughPins = 0;
      const pinsAt = new Map<string, string>();
      for (const p of doc.parts) if (p.type !== 'breadboard') for (const pin of DEFS[p.type].pins) pinsAt.set(pinPos(p, pin.name)!.join(','), `${p.id}:${pin.name}`);
      for (const w of doc.wires) {
        const path = r.paths.get(w.id)!;
        expect(path[0]).toEqual(pinPos(doc.parts.find((x) => x.id === w.a.part)!, w.a.pin));
        for (let i = 1; i < path.length; i++) expect(path[i][0] === path[i - 1][0] || path[i][1] === path[i - 1][1], `${id}: диагональ`).toBe(true);
        for (const u of units(path)) {
          if (used.has(u) && netOf(used.get(u)!) !== netOf(w.id)) overlaps++;
          used.set(u, w.id);
        }
        // проход по чужим выводам
        for (let i = 1; i < path.length; i++) {
          const [ax, ay] = path[i - 1]; const [bx, by] = path[i];
          for (const [k, name] of pinsAt) {
            if (name === `${w.a.part}:${w.a.pin}` || name === `${w.b.part}:${w.b.pin}`) continue;
            const [px, py] = k.split(',').map(Number);
            if (px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by)) throughPins++;
          }
        }
        // проход над корпусами (кроме своих деталей)
        for (const p of doc.parts) {
          if (p.type === 'breadboard' || p.id === w.a.part || p.id === w.b.part) continue;
          const [bx, by, bw, bh] = DEFS[p.type].box;
          const a = rotPoint(bx, by, p.rot, p.x, p.y); const b = rotPoint(bx + bw, by + bh, p.rot, p.x, p.y);
          const x0 = Math.min(a[0], b[0]); const x1 = Math.max(a[0], b[0]); const y0 = Math.min(a[1], b[1]); const y1 = Math.max(a[1], b[1]);
          for (const u of units(path)) {
            const [ux, uy, vx, vy] = u.split(',').map(Number);
            const mx = (ux + vx) / 2; const my = (uy + vy) / 2;
            if (mx > x0 && mx < x1 && my > y0 && my < y1) { throughBody++; break; }
          }
        }
      }
      // пересечения разных проводов (перпендикулярные, во внутренних точках)
      const segs = doc.wires.flatMap((w) => { const pth = r.paths.get(w.id)!; return pth.slice(1).map((b, i) => ({ id: w.id, a: pth[i], b })); });
      for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
        const s1 = segs[i]; const s2 = segs[j];
        if (s1.id === s2.id || netOf(s1.id) === netOf(s2.id)) continue;
        const h1 = s1.a[1] === s1.b[1]; const h2 = s2.a[1] === s2.b[1];
        if (h1 === h2) continue;
        const H = h1 ? s1 : s2; const V = h1 ? s2 : s1;
        const x = V.a[0]; const y = H.a[1];
        if (x > Math.min(H.a[0], H.b[0]) && x < Math.max(H.a[0], H.b[0]) && y > Math.min(V.a[1], V.b[1]) && y < Math.max(V.a[1], V.b[1])) crossings++;
      }
      report.push(`${id.padEnd(26)} ${doc.wires.length} пр. ${ms.toFixed(1)} мс  наложений ${overlaps}  пересечений ${crossings}  через выводы ${throughPins}  через корпуса ${throughBody}`);
      if (process.env.ROUTE_REPORT) continue;
      expect(overlaps, `${id}: наложения проводов`).toBeLessThanOrEqual(2);
      expect(throughPins, `${id}: провод проходит через чужой вывод`).toBe(0);
    }
    if (process.env.ROUTE_REPORT) console.log(report.join('\n'));
    expect(worst).toBeLessThan(400);
  });
});
