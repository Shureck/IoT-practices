// Задачи из файла: пример проходит проверку, эталон набирает все проверки, ошибки понятны,
// справочник описывает всё, что есть в коде, а встроенные практики выгружаются и загружаются без потерь.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFS, Harness } from '@esp32lab/sim';
import { PRACTICES, checkOptions } from '../src/index';
import {
  CONDS, EXAMPLE_QUIZ, EXAMPLE_TASK, STEPS, TASK_FORMAT, buildReference, parseTaskText, practiceToSpecObject,
  specToPractice, stringifyTask, validateTaskText, type LocatedIssue, type TaskSpec,
} from '../src/spec';

const existing = new Set(PRACTICES.map((p) => p.id));
const create = (text: string) => validateTaskText(text, { mode: 'create', existingIds: existing });
const errors = (r: { issues: LocatedIssue[] }) => r.issues.filter((i) => i.level === 'error');

async function run(spec: TaskSpec, which: 'solution' | 'starter') {
  const p = specToPractice(spec);
  const code = which === 'solution' ? p.solution.code : p.starterCode;
  const circuit = which === 'solution' ? p.solution.circuit ?? p.starterCircuit : p.starterCircuit;
  return Harness.run(code, circuit, p.checks, checkOptions(p));
}

describe('пример задачи', () => {
  const v = create(EXAMPLE_TASK);
  it('проходит проверку формата', () => {
    expect(errors(v), JSON.stringify(errors(v), null, 1)).toEqual([]);
    expect(v.spec?.id).toBe('example-button-call');
    expect(v.spec?.checks).toHaveLength(3);
  });
  it('эталон проходит все проверки, а стартовый код — нет', async () => {
    const sol = await run(v.spec!, 'solution');
    expect(sol.results.filter((r) => !r.ok), JSON.stringify(sol.results)).toEqual([]);
    const start = await run(v.spec!, 'starter');
    expect(start.results.some((r) => !r.ok)).toBe(true);
    expect(start.results.every((r) => !r.ok)).toBe(true);
  }, 60000);
  it('пример-тест проходит проверку', () => {
    const q = create(EXAMPLE_QUIZ);
    expect(errors(q), JSON.stringify(errors(q))).toEqual([]);
    expect(q.spec?.quiz).toHaveLength(3);
    expect(q.spec?.quiz?.[1].correct).toEqual([0, 1, 3]);
    const p = specToPractice(q.spec!);
    expect(p.kind).toBe('quiz');
    expect(p.checks).toEqual([]);
  });
});

describe('ошибки в файле', () => {
  const base = (patch: (s: string) => string) => create(patch(EXAMPLE_TASK));
  it('синтаксис YAML — с номером строки', () => {
    const r = create('id: x\n  title: [broken\n');
    expect(errors(r)[0].message).toMatch(/Ошибка в записи файла/);
    expect(errors(r)[0].line).toBeGreaterThan(0);
  });
  it('JSON тоже читается', () => {
    const r = create(JSON.stringify({ id: 'json-task', module: 1, title: 'Задача', goals: ['Цель'], solution: { code: 'void setup(){}\nvoid loop(){}' }, checks: [{ id: 'a', title: 'Проверка', steps: [{ wait: 100 }] }] }));
    expect(errors(r), JSON.stringify(errors(r))).toEqual([]);
  });
  it('занятый id, чужой модуль и неизвестное поле', () => {
    expect(errors(base((s) => s.replace('id: example-button-call', 'id: m1-blink')))[0].message).toMatch(/уже есть/);
    expect(errors(base((s) => s.replace('module: 1 ', 'module: 9 ')))[0].message).toMatch(/Нет модуля 9/);
    expect(errors(base((s) => s.replace('minutes: 20', 'minutes: 20\nbogus: 1')))[0].message).toMatch(/Неизвестное поле «bogus»/);
  });
  it('схема: неизвестная деталь, вывод и провод к несуществующей детали', () => {
    expect(errors(base((s) => s.replace('type: led, x: 330', 'type: ledd, x: 330')))[0].message).toMatch(/Неизвестный тип детали «ledd»/);
    const noPin = base((s) => s.replace('esp:D14 btn:1 yellow', 'esp:D99 btn:1 yellow'));
    expect(errors(noPin)[0].message).toMatch(/нет вывода «D99»/);
    expect(errors(noPin)[0].line).toBeGreaterThan(0);
    expect(errors(base((s) => s.replace('btn:2 esp:3V3 red', 'btnX:2 esp:3V3 red')))[0].message).toMatch(/которой нет на схеме/);
  });
  it('проверки: неизвестный шаг, условие, деталь, метка, свойство', () => {
    expect(errors(base((s) => s.replace('- hold: { part: btn }', '- holdd: { part: btn }')))[0].message).toMatch(/Неизвестный шаг «holdd»/);
    expect(errors(base((s) => s.replace('{ ledOff: led1 }', '{ ledOf: led1 }')))[0].message).toMatch(/Неизвестное условие «ledOf»/);
    expect(errors(base((s) => s.replace('- waitFor: { ledOn: led1 }', '- waitFor: { ledOn: led9 }')))[0].message).toMatch(/нет детали «led9»/);
    expect(errors(base((s) => s.replace('- waitFor: { ledOn: led1 }', '- waitFor: { ledOn: btn }')))[0].message).toMatch(/тип button/);
    expect(errors(base((s) => s.replace('since: t0', 'since: tt')))[0].message).toMatch(/Метка «tt» не поставлена/);
    expect(errors(base((s) => s.replace('      - mark: t0', '      - set: { part: btn, prop: lux, value: 5 }\n      - mark: t0')))[0].message).toMatch(/нет свойства «lux»/);
    expect(errors(base((s) => s.replace('count: 2 } }', 'count: 2, bad: 1 } }')))[0].message).toMatch(/Неизвестное поле «bad»/);
  });
  it('эталон не компилируется / нет проверок / нет решения', () => {
    expect(errors(base((s) => s.replace('digitalWrite(LED_PIN, now);', 'digitalWrite(LED_PIN, now)')))[0].message).toMatch(/не компилируется/);
    expect(errors(base((s) => s.slice(0, s.indexOf('checks:'))))[0].message).toMatch(/checks/);
    expect(errors(base((s) => s.replace('solution:', 'soluton:')))[0].message).toBeTruthy();
  });
});

describe('проверки из файла ловят неверные решения', () => {
  it('светодиод без резистора, не на тот вывод, вечная печать', async () => {
    const v = create(EXAMPLE_TASK);
    const sol = v.spec!;
    const p = specToPractice(sol);
    const run2 = (code: string, circuit = p.solution.circuit!) => Harness.run(code, circuit, p.checks, checkOptions(p));
    // печатает каждый проход — «ВЫЗОВ!» больше двух раз
    const spam = await run2(p.solution.code.replace('if (now == HIGH && last == LOW)', 'if (now == HIGH)'));
    expect(spam.results.find((r) => r.id === 'once')?.ok).toBe(false);
    expect(spam.results.find((r) => r.id === 'once')?.message).toMatch(/не два раза/);
    // светодиод не реагирует на кнопку
    const dead = await run2(p.solution.code.replace('digitalWrite(LED_PIN, now);', ''));
    expect(dead.results.find((r) => r.id === 'follow')?.message).toMatch(/не загорелся/);
    // провод светодиода убран
    const noWire = structuredClone(p.solution.circuit!);
    noWire.wires = noWire.wires.filter((w) => w.a.part !== 'r1' || w.a.pin !== '2');
    const broken = await run2(p.solution.code, noWire);
    expect(broken.results.find((r) => r.id === 'wiring')?.ok).toBe(false);
  }, 60000);
});

describe('правка встроенных практик', () => {
  it('выгрузка в файл и обратно сохраняет задачу; checks: builtin', () => {
    for (const p of PRACTICES) {
      const text = stringifyTask(practiceToSpecObject(p));
      const v = validateTaskText(text, { mode: 'edit', existingIds: existing, expectId: p.id, builtin: true });
      expect(errors(v), `${p.id}: ${JSON.stringify(errors(v))}`).toEqual([]);
      const back = specToPractice(v.spec!, p);
      expect(back.id).toBe(p.id);
      expect(back.title).toBe(p.title);
      expect(back.goals).toEqual(p.goals);
      if (p.kind === 'quiz') expect(back.checks).toEqual([]); else expect(back.checks).toBe(p.checks);
      expect(back.starterCircuit.parts.map((x) => [x.id, x.type, x.x, x.y])).toEqual(p.starterCircuit.parts.map((x) => [x.id, x.type, x.x, x.y]));
      expect(back.starterCircuit.wires.map((w) => `${w.a.part}:${w.a.pin}-${w.b.part}:${w.b.pin}`)).toEqual(p.starterCircuit.wires.map((w) => `${w.a.part}:${w.a.pin}-${w.b.part}:${w.b.pin}`));
      if (p.kind === 'quiz') expect(back.quiz).toEqual(p.quiz);
    }
  });
  it('менять id и оставлять builtin у обычной задачи нельзя', () => {
    const p = PRACTICES[0];
    const text = stringifyTask(practiceToSpecObject(p));
    expect(errors(validateTaskText(text.replace(`id: ${p.id}`, 'id: other-id'), { mode: 'edit', existingIds: existing, expectId: p.id, builtin: true }))[0].message).toMatch(/Менять id нельзя/);
    expect(errors(validateTaskText(text, { mode: 'edit', existingIds: existing, expectId: p.id }))[0].message).toMatch(/checks/);
  });
});

describe('справочник', () => {
  const ref = buildReference();
  it('описывает все детали, шаги и условия', () => {
    for (const d of Object.values(DEFS)) expect(ref, d.type).toContain(`\`${d.type}\``);
    for (const k of Object.keys(STEPS)) expect(ref, k).toContain(`#### \`${k}\``);
    for (const k of Object.keys(CONDS)) expect(ref, k).toContain(`#### \`${k}\``);
    expect(ref).toContain(TASK_FORMAT);
    expect(ref).toContain('pinMode');
    expect(ref).toContain('D25');
  });
  it('примеры из справочника условий и шагов проходят проверку формата', () => {
    const base = parseTaskText(EXAMPLE_TASK).value as Record<string, unknown>;
    const parts = (base.starterCircuit as { parts: { id: string }[] }).parts.map((p) => p.id);
    expect(parts).toContain('led1');
    const wrap = (stepsYaml: string) => EXAMPLE_TASK.replace(/checks:[\s\S]*$/, `checks:\n  - id: ex\n    title: Пример\n    steps:\n${stepsYaml.split('\n').map((l) => `      ${l}`).join('\n')}\n`);
    for (const [name, c] of Object.entries(CONDS)) {
      if (['ledWiring', 'lcd', 'neo', 'oled', 'rgb', 'servo', 'buzzer', 'load', 'relay', 'relayOff'].includes(name)) continue; // деталей нет в примере
      const yaml = `- mark: t0\n- mark: x\n- expect: ${c.example}`;
      const r = create(wrap(yaml));
      const errs = errors(r).filter((e) => !/нет детали|на схеме/.test(e.message));
      expect(errs, `${name}: ${c.example} → ${JSON.stringify(errs)}`).toEqual([]);
    }
    for (const [name, s] of Object.entries(STEPS)) {
      if (['motion', 'set', 'pressSeq', 'press', 'hold'].includes(name)) continue;
      const yaml = `- mark: t0\n- mark: x\n${s.example}`;
      const r = create(wrap(yaml));
      const errs = errors(r).filter((e) => !/нет детали|на схеме|Метка «opened»/.test(e.message));
      expect(errs, `${name}: ${s.example} → ${JSON.stringify(errs)}`).toEqual([]);
    }
  });
});

describe('документация не отстаёт от кода', () => {
  const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs');
  const read = (rel: string) => fs.readFileSync(path.join(docs, rel), 'utf8').replace(/\r\n/g, '\n');
  it('docs/TASK_FORMAT.md и docs/examples совпадают с тем, что собирает код (npm run docs:tasks)', () => {
    expect(read('TASK_FORMAT.md')).toBe(buildReference().replace(/\r\n/g, '\n'));
    expect(read('examples/example-task.yaml')).toBe(EXAMPLE_TASK);
    expect(read('examples/example-quiz.yaml')).toBe(EXAMPLE_QUIZ);
  });
});
