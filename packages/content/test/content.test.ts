import { describe, expect, it } from 'vitest';
import { DEFS, Harness, TASK_DEVICES, compileSketch } from '@esp32lab/sim';
import { MODULES, PRACTICES, checkOptions } from '../src/index';

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
      const r = await Harness.run(p.solution.code, p.solution.circuit ?? p.starterCircuit, p.checks, checkOptions(p));
      expect(r.compile.diagnostics.filter((d) => d.severity === 'error'), JSON.stringify(r.compile.diagnostics)).toEqual([]);
      const failed = r.results.filter((x) => !x.ok);
      expect(failed, JSON.stringify(failed, null, 1)).toEqual([]);
    }, 120000);

    // студент мог оставить ручки датчиков где угодно, пока отлаживал (или перенастроить «чёрный ящик»), —
    // на проверку это влиять не должно
    it('эталон проходит при любом положении ручек датчиков', async () => {
      const base = p.solution.circuit ?? p.starterCircuit;
      for (const edge of ['min', 'max'] as const) {
        const c = structuredClone(base);
        for (const part of c.parts) {
          for (const d of DEFS[part.type]?.props ?? []) {
            if (d.live) part.props[d.key] = d.type === 'bool' ? edge === 'max' : (edge === 'max' ? d.max : d.min)!;
            else if (TASK_DEVICES.includes(part.type)) {
              const opts = d.options ?? [];
              part.props[d.key] = d.type === 'select' ? opts[edge === 'max' ? opts.length - 1 : 0].value : d.type === 'number' ? (edge === 'max' ? d.max : d.min)! : 'XYZ';
            }
          }
        }
        const r = await Harness.run(p.solution.code, c, p.checks, checkOptions(p));
        const failed = r.results.filter((x) => !x.ok);
        expect(failed, `ручки на ${edge}: ${JSON.stringify(failed, null, 1)}`).toEqual([]);
      }
    }, 120000);

    it('стартовый код не проходит проверки', async () => {
      const r = await Harness.run(p.starterCode, p.starterCircuit, p.checks, checkOptions(p));
      expect(r.results.some((x) => !x.ok)).toBe(true);
    }, 120000);
  });
}
