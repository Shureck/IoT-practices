import { describe, expect, it } from 'vitest';
import { DEFS, Harness, compileSketch } from '@esp32lab/sim';
import { MODULES, PRACTICES } from '../src/index';

const only = process.env.PRACTICE;
const list = only ? PRACTICES.filter((p) => p.id === only) : PRACTICES;

describe('структура контента', () => {
  it('уникальные id и порядок', () => {
    const ids = new Set<string>();
    for (const p of PRACTICES) {
      expect(ids.has(p.id), `повтор id ${p.id}`).toBe(false);
      ids.add(p.id);
      expect(MODULES.some((m) => m.id === p.module), `${p.id}: нет модуля ${p.module}`).toBe(true);
    }
    for (const m of MODULES) {
      const orders = PRACTICES.filter((p) => p.module === m.id).map((p) => p.order);
      expect(new Set(orders).size, `модуль ${m.id}: повтор order`).toBe(orders.length);
    }
  });
});

for (const p of list) {
  describe(p.id, () => {
    it('схемы корректны', () => {
      for (const c of [p.starterCircuit, p.solution.circuit].filter(Boolean)) {
        const ids = new Set(c!.parts.map((x) => x.id));
        expect(ids.size).toBe(c!.parts.length);
        for (const part of c!.parts) expect(DEFS[part.type], `${p.id}: тип ${part.type}`).toBeTruthy();
        for (const wire of c!.wires) {
          for (const end of [wire.a, wire.b]) {
            const part = c!.parts.find((x) => x.id === end.part);
            expect(part, `${p.id}: провод к несуществующему ${end.part}`).toBeTruthy();
            expect(DEFS[part!.type].pins.some((pin) => pin.name === end.pin), `${p.id}: нет вывода ${end.part}:${end.pin}`).toBe(true);
          }
        }
      }
    });

    if (p.kind === 'quiz') {
      it('квиз корректен', () => {
        expect(p.quiz?.length).toBeGreaterThan(2);
        for (const q of p.quiz!) {
          expect(q.correct.length).toBeGreaterThan(0);
          for (const i of q.correct) expect(i).toBeLessThan(q.options.length);
        }
      });
      return;
    }

    it('стартовый код компилируется', () => {
      const r = compileSketch(p.starterCode);
      expect(r.diagnostics.filter((d) => d.severity === 'error'), JSON.stringify(r.diagnostics)).toEqual([]);
    });

    it('эталонное решение проходит все проверки', async () => {
      const r = await Harness.run(p.solution.code, p.solution.circuit ?? p.starterCircuit, p.checks, { net: p.net });
      expect(r.compile.diagnostics.filter((d) => d.severity === 'error'), JSON.stringify(r.compile.diagnostics)).toEqual([]);
      const failed = r.results.filter((x) => !x.ok);
      expect(failed, JSON.stringify(failed, null, 1)).toEqual([]);
    }, 120000);

    it('стартовый код не проходит проверки', async () => {
      const r = await Harness.run(p.starterCode, p.starterCircuit, p.checks, { net: p.net });
      expect(r.results.some((x) => !x.ok)).toBe(true);
    }, 120000);
  });
}
