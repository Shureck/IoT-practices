// Файл задачи (YAML или JSON): разбор, проверка, преобразование в Practice и обратно.
import YAML, { LineCounter } from 'yaml';
import { DEFS, compileSketch, type CircuitDoc, type Part, type Wire } from '@esp32lab/sim';
import { MODULES } from '../modules';
import type { Practice, PracticeKind, QuizQuestion } from '../types';
import { ESP } from '../helpers';
import { CONDS, STEPS, stepWeight, validateCond, validateSteps } from './dsl';
import { compileChecks, routesOf } from './runner';
import { isObj, validate, type Issue, type VCtx } from './shape';

export const TASK_FORMAT = 'esp32lab-task/1';

export interface CheckDef { id: string; title: string; timeoutMs?: number; steps: Record<string, unknown>[] }
export interface HttpRouteDef { method?: string; urlContains?: string; urlMatches?: string; status?: number; contentType?: string; body: unknown }

export interface TaskSpec {
  id: string;
  module: number;
  order: number;
  kind: PracticeKind;
  title: string;
  subtitle: string;
  difficulty: 1 | 2 | 3;
  xp: number;
  minutes: number;
  tags: string[];
  story: string;
  goals: string[];
  theory?: string;
  hints: string[];
  starterCode: string;
  starterCircuit: CircuitDoc;
  solution: { code: string; circuit?: CircuitDoc };
  /** null — оставить встроенные проверки (только при правке встроенной задачи) */
  checks: CheckDef[] | null;
  palette?: string[];
  circuitLocked?: boolean;
  httpRoutes?: HttpRouteDef[];
  quiz?: QuizQuestion[];
  passScore?: number;
}

export interface LocatedIssue extends Issue { line?: number }

export const ID_RE = /^[a-z][a-z0-9-]{2,39}$/;
const PART_ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;
const KINDS: PracticeKind[] = ['lab', 'homework', 'case', 'quiz'];
export const SCAFFOLD = 'void setup() {\n  \n}\n\nvoid loop() {\n  \n}\n';

const TOP_KEYS = ['format', 'id', 'module', 'order', 'kind', 'title', 'subtitle', 'difficulty', 'xp', 'minutes', 'tags', 'story', 'goals', 'theory', 'hints',
  'starterCode', 'starterCircuit', 'solution', 'checks', 'palette', 'circuitLocked', 'httpRoutes', 'quiz', 'passScore'];

// ---------- разбор текста ----------

export interface Parsed { value: unknown; issues: LocatedIssue[]; locate(path: string): number | undefined }

function pathTokens(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const m of path.matchAll(/([A-Za-z_][\w-]*)|\[(\d+)\]/g)) out.push(m[2] !== undefined ? Number(m[2]) : m[1]);
  return out;
}

/** Текст → значение. Понимает YAML и JSON; ошибки синтаксиса — с номерами строк. */
export function parseTaskText(text: string): Parsed {
  if (text.length > 600_000) return { value: null, issues: [{ path: '', level: 'error', message: 'Файл слишком большой (больше 600 КБ)' }], locate: () => undefined };
  const lc = new LineCounter();
  const doc = YAML.parseDocument(text, { lineCounter: lc, prettyErrors: false, uniqueKeys: true });
  const issues: LocatedIssue[] = doc.errors.map((e) => {
    const line = e.linePos?.[0]?.line ?? (e.pos ? lc.linePos(e.pos[0]).line : undefined);
    const tip = /compact mappings|implicit key|block mapping/i.test(e.message)
      ? ' Подсказка: текст, в котором есть «: » (двоеточие с пробелом), берите в кавычки: title: "Задача: часть 1".'
      : /flow|bracket|\]/i.test(e.message) ? ' Подсказка: в списках [a, b] запятая разделяет пункты — текст с запятой берите в кавычки.' : '';
    return { path: '', level: 'error' as const, line, message: `Ошибка в записи файла: ${e.message.split('\n')[0]}.${tip}` };
  });
  const locate = (path: string): number | undefined => {
    const toks = pathTokens(path);
    for (let n = toks.length; n >= 0; n--) {
      try {
        const node = n ? doc.getIn(toks.slice(0, n), true) as { range?: number[] } | undefined : doc.contents as { range?: number[] } | null;
        if (node && node.range) return lc.linePos(node.range[0]).line;
      } catch { /* путь не найден */ }
    }
    return undefined;
  };
  if (issues.length) return { value: null, issues, locate };
  return { value: doc.toJS({ maxAliasCount: 20 }), issues, locate };
}

// ---------- схема ----------

export function circuitToSpec(c: CircuitDoc): { parts: Record<string, unknown>[]; wires: unknown[] } {
  const parts = c.parts.filter((p) => p.type !== 'esp32').map((p) => {
    const o: Record<string, unknown> = { id: p.id, type: p.type, x: p.x, y: p.y };
    if (p.rot) o.rot = p.rot;
    if (Object.keys(p.props ?? {}).length) o.props = p.props;
    if (p.locked === false) o.locked = false;
    return o;
  });
  const wires = c.wires.map((w) => {
    const a = `${w.a.part}:${w.a.pin}`; const b = `${w.b.part}:${w.b.pin}`;
    if (w.pts?.length) return { from: a, to: b, color: w.color, via: w.pts };
    return `${a} ${b} ${w.color}`;
  });
  return { parts, wires };
}

/** Описание схемы из файла → CircuitDoc (плата ESP32 добавляется сама). */
function readCircuit(c: VCtx, v: unknown, path: string, local: Issue[]): CircuitDoc | null {
  const bad = (p: string, m: string) => local.push({ path: p, message: m, level: 'error' });
  if (v === undefined || v === null) return { parts: [ESP()], wires: [] };
  if (!isObj(v)) { bad(path, 'Схема — это объект с полями parts и wires'); return null; }
  for (const k of Object.keys(v)) if (k !== 'parts' && k !== 'wires') bad(`${path}.${k}`, `Неизвестное поле «${k}». В схеме есть только parts и wires`);
  const parts: Part[] = [ESP()];
  const ids = new Set<string>(['esp']);
  const rawParts = v.parts ?? [];
  if (!Array.isArray(rawParts)) { bad(`${path}.parts`, 'parts — это список деталей'); return null; }
  if (rawParts.length > 80) bad(`${path}.parts`, 'Слишком много деталей (больше 80)');
  rawParts.forEach((r, i) => {
    const p = `${path}.parts[${i}]`;
    if (!isObj(r)) return bad(p, 'Деталь — объект: { id, type, x, y }');
    for (const k of Object.keys(r)) if (!['id', 'type', 'x', 'y', 'rot', 'props', 'locked'].includes(k)) bad(`${p}.${k}`, `Неизвестное поле «${k}». Есть: id, type, x, y, rot, props, locked`);
    const id = r.id; const type = r.type;
    if (typeof id !== 'string' || !PART_ID_RE.test(id)) return bad(`${p}.id`, 'id детали — латиница, цифры и «_», начинается с буквы (например led1)');
    if (id === 'esp') return bad(`${p}.id`, 'Плата ESP32 (id «esp») добавляется автоматически — её в списке быть не должно');
    if (ids.has(id)) return bad(`${p}.id`, `Деталь с id «${id}» уже есть`);
    ids.add(id);
    if (typeof type !== 'string' || !DEFS[type]) return bad(`${p}.type`, `Неизвестный тип детали «${String(type)}». Доступные: ${Object.keys(DEFS).filter((t) => t !== 'esp32').join(', ')}`);
    if (type === 'esp32') return bad(`${p}.type`, 'Плата ESP32 добавляется автоматически');
    for (const k of ['x', 'y'] as const) if (typeof r[k] !== 'number' || !Number.isFinite(r[k]) || Math.abs(r[k] as number) > 5000) bad(`${p}.${k}`, `Координата ${k} — число (от −5000 до 5000)`);
    const rot = r.rot ?? 0;
    if (![0, 90, 180, 270].includes(rot as number)) bad(`${p}.rot`, 'Поворот — 0, 90, 180 или 270');
    const props: Record<string, string | number | boolean> = {};
    if (r.props !== undefined) {
      if (!isObj(r.props)) bad(`${p}.props`, 'props — набор «свойство: значение»');
      else {
        for (const [k, val] of Object.entries(r.props)) {
          const def = DEFS[type].props.find((d) => d.key === k);
          if (!def) { bad(`${p}.props.${k}`, `У детали типа ${type} нет свойства «${k}». Есть: ${DEFS[type].props.map((d) => d.key).join(', ') || 'нет свойств'}`); continue; }
          if (def.type === 'number' && (typeof val !== 'number' || !Number.isFinite(val))) bad(`${p}.props.${k}`, `Свойство «${k}» — число`);
          else if (def.type === 'number' && ((def.min !== undefined && (val as number) < def.min) || (def.max !== undefined && (val as number) > def.max))) bad(`${p}.props.${k}`, `Свойство «${k}»: допустимо ${def.min ?? '…'}…${def.max ?? '…'}`);
          else if (def.type === 'bool' && typeof val !== 'boolean') bad(`${p}.props.${k}`, `Свойство «${k}» — true или false`);
          else if (def.type === 'select' && !(def.options ?? []).some((o) => o.value === val)) bad(`${p}.props.${k}`, `Свойство «${k}»: допустимо ${(def.options ?? []).map((o) => o.value).join(', ')}`);
          else if (def.type === 'text' && typeof val !== 'string') bad(`${p}.props.${k}`, `Свойство «${k}» — текст`);
          props[k] = val as string | number | boolean;
        }
      }
    }
    if (r.locked !== undefined && typeof r.locked !== 'boolean') bad(`${p}.locked`, 'locked — true или false');
    parts.push({ id, type, x: Number(r.x), y: Number(r.y), rot: (rot as number) || 0, props, locked: r.locked !== false });
  });
  const typeOf = new Map(parts.map((p) => [p.id, p.type]));
  const wires: Wire[] = [];
  const rawWires = v.wires ?? [];
  if (!Array.isArray(rawWires)) { bad(`${path}.wires`, 'wires — это список проводов'); return { parts, wires }; }
  if (rawWires.length > 300) bad(`${path}.wires`, 'Слишком много проводов (больше 300)');
  const seen = new Set<string>();
  const endpoint = (s: string, p: string): { part: string; pin: string } | null => {
    const i = s.indexOf(':');
    if (i <= 0) { bad(p, `Конец провода записывают «деталь:вывод», например esp:D25 — а здесь «${s}»`); return null; }
    const part = s.slice(0, i); const pin = s.slice(i + 1);
    const type = typeOf.get(part);
    if (!type) { bad(p, `Провод идёт к детали «${part}», которой нет на схеме`); return null; }
    if (!DEFS[type].pins.some((x) => x.name === pin)) { bad(p, `У детали «${part}» (${type}) нет вывода «${pin}». Есть: ${DEFS[type].pins.map((x) => x.name).slice(0, 20).join(', ')}`); return null; }
    return { part, pin };
  };
  rawWires.forEach((r, i) => {
    const p = `${path}.wires[${i}]`;
    let a: string; let b: string; let color = 'green'; let pts: [number, number][] = [];
    if (typeof r === 'string') {
      const tokens = r.trim().split(/\s+/).filter((t) => !['->', '→', '-', '—'].includes(t));
      if (tokens.length < 2 || tokens.length > 3) return bad(p, `Провод — это «откуда куда [цвет]», например "esp:D25 r1:1 green"; здесь: «${r}»`);
      [a, b] = tokens; if (tokens[2]) color = tokens[2];
    } else if (isObj(r)) {
      for (const k of Object.keys(r)) if (!['from', 'to', 'color', 'via'].includes(k)) bad(`${p}.${k}`, `Неизвестное поле «${k}». Есть: from, to, color, via`);
      if (typeof r.from !== 'string' || typeof r.to !== 'string') return bad(p, 'У провода нужны поля from и to');
      a = r.from; b = r.to;
      if (r.color !== undefined) { if (typeof r.color !== 'string') bad(`${p}.color`, 'Цвет — слово или #rrggbb'); else color = r.color; }
      if (r.via !== undefined) {
        if (!Array.isArray(r.via) || r.via.some((q) => !Array.isArray(q) || q.length !== 2 || q.some((n) => typeof n !== 'number'))) bad(`${p}.via`, 'via — список точек изгиба [[x, y], …]');
        else pts = r.via as [number, number][];
      }
    } else return bad(p, 'Провод — строка "esp:D25 r1:1 green" или объект { from, to, color }');
    if (!/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/.test(color)) bad(p, `Цвет провода «${color}» не похож на цвет (слово вроде green или #rrggbb)`);
    const ea = endpoint(a, p); const eb = endpoint(b, p);
    if (!ea || !eb) return;
    if (ea.part === eb.part && ea.pin === eb.pin) return bad(p, 'Провод соединяет вывод сам с собой');
    const key = [`${ea.part}:${ea.pin}`, `${eb.part}:${eb.pin}`].sort().join('|');
    if (seen.has(key)) { local.push({ path: p, message: 'Такой провод уже есть', level: 'warning' }); return; }
    seen.add(key);
    let id = `w_${a}_${b}`.replace(/[^A-Za-z0-9_]/g, '_');
    while (wires.some((w) => w.id === id)) id += '_';
    wires.push({ id, a: ea, b: eb, pts, color });
  });
  void c;
  return { parts, wires };
}

// ---------- проверка файла ----------

export interface ValidateOpts {
  /** «create» — новая задача: id не должен совпадать ни с одной существующей; «edit» — правка с этим id */
  mode: 'create' | 'edit';
  /** id всех существующих задач (встроенных и своих) */
  existingIds: Set<string>;
  /** при правке: id, который обязан остаться прежним */
  expectId?: string;
  /** правка встроенной задачи: можно оставить встроенные проверки («checks: builtin») */
  builtin?: boolean;
}

export interface Validated { spec: TaskSpec | null; issues: LocatedIssue[] }

export function validateTask(raw: unknown, opts: ValidateOpts): Validated {
  const issues: Issue[] = [];
  const E = (path: string, message: string) => issues.push({ path, message, level: 'error' });
  const W = (path: string, message: string) => issues.push({ path, message, level: 'warning' });
  if (!isObj(raw)) { E('', 'В файле должен быть набор полей «ключ: значение» (id, title, goals…)'); return { spec: null, issues }; }
  for (const k of Object.keys(raw)) if (!TOP_KEYS.includes(k)) E(k, `Неизвестное поле «${k}». Допустимые: ${TOP_KEYS.join(', ')}`);
  if (raw.format !== undefined && raw.format !== TASK_FORMAT) W('format', `Формат «${String(raw.format)}» — ожидается «${TASK_FORMAT}»; файл разобран как текущий формат`);

  const str = (key: string, o: { min?: number; max?: number; def?: string; req?: boolean }): string => {
    const v = raw[key];
    if (v === undefined || v === null) { if (o.req) E(key, `Не хватает обязательного поля «${key}»`); return o.def ?? ''; }
    if (typeof v !== 'string') { E(key, 'Ожидается текст'); return o.def ?? ''; }
    if (o.min !== undefined && v.trim().length < o.min) E(key, `Слишком коротко (минимум ${o.min} символов)`);
    if (o.max !== undefined && v.length > o.max) E(key, `Слишком длинно (максимум ${o.max} символов)`);
    return v;
  };
  const int = (key: string, lo: number, hi: number, def: number): number => {
    const v = raw[key];
    if (v === undefined || v === null) return def;
    if (typeof v !== 'number' || !Number.isInteger(v)) { E(key, 'Ожидается целое число'); return def; }
    if (v < lo || v > hi) { E(key, `Допустимо от ${lo} до ${hi}`); return def; }
    return v;
  };
  const list = (key: string, o: { max: number; itemMax: number; min?: number; req?: boolean }): string[] => {
    const v = raw[key];
    if (v === undefined || v === null) { if (o.req) E(key, `Не хватает обязательного поля «${key}» (список)`); return []; }
    if (!Array.isArray(v)) { E(key, 'Ожидается список (каждый пункт со знака «-»)'); return []; }
    if (v.length > o.max) E(key, `В списке не больше ${o.max} пунктов`);
    if (o.min !== undefined && v.length < o.min) E(key, `В списке нужен хотя бы ${o.min} пункт`);
    v.forEach((x, i) => { if (typeof x !== 'string') E(`${key}[${i}]`, 'Пункт — текст'); else if (x.length > o.itemMax) E(`${key}[${i}]`, `Пункт слишком длинный (максимум ${o.itemMax} символов)`); });
    return v.filter((x): x is string => typeof x === 'string');
  };

  // идентификатор
  const id = str('id', { req: true });
  if (id) {
    if (!ID_RE.test(id)) E('id', 'id — строчные латинские буквы, цифры и «-», начинается с буквы, 3–40 символов (например m2-sirena)');
    else if (opts.mode === 'create' && opts.existingIds.has(id)) E('id', `Задача с id «${id}» уже есть. Выберите другой id или правьте существующую`);
    else if (opts.mode === 'edit' && opts.expectId && id !== opts.expectId) E('id', `Менять id нельзя: у этой задачи «${opts.expectId}», а в файле «${id}»`);
  }
  const moduleNo = int('module', 1, 99, 0);
  if (!raw.module) E('module', 'Не хватает обязательного поля «module» (номер модуля)');
  else if (!MODULES.some((m) => m.id === moduleNo)) E('module', `Нет модуля ${moduleNo}. Есть: ${MODULES.map((m) => m.id).join(', ')}`);
  const order = int('order', 1, 999, 500);
  const kindRaw = raw.kind ?? 'lab';
  const kind = KINDS.includes(kindRaw as PracticeKind) ? (kindRaw as PracticeKind) : 'lab';
  if (!KINDS.includes(kindRaw as PracticeKind)) E('kind', `Тип задачи: ${KINDS.join(', ')}`);
  const isQuiz = kind === 'quiz';
  const title = str('title', { min: 3, max: 120, req: true });
  const subtitle = str('subtitle', { max: 200 });
  const difficulty = int('difficulty', 1, 3, 1) as 1 | 2 | 3;
  const xp = int('xp', 10, 2000, 100);
  const minutes = int('minutes', 1, 600, 30);
  const tags = list('tags', { max: 12, itemMax: 40 });
  const story = str('story', { max: 8000 });
  const goals = list('goals', { max: 14, itemMax: 800, min: isQuiz ? 0 : 1, req: !isQuiz });
  const theory = raw.theory === undefined || raw.theory === null ? undefined : str('theory', { max: 40000 });
  const hints = list('hints', { max: 10, itemMax: 1200 });

  // схемы
  const cIssues: Issue[] = [];
  const dummy = {} as VCtx;
  const starterCircuit = readCircuit(dummy, raw.starterCircuit, 'starterCircuit', cIssues) ?? { parts: [ESP()], wires: [] };
  const solRaw = raw.solution;
  let solutionCode = '';
  let solutionCircuit: CircuitDoc | undefined;
  if (!isQuiz) {
    if (!isObj(solRaw)) E('solution', 'Не хватает обязательного поля «solution» с эталонным решением: { code: |, circuit: … }');
    else {
      for (const k of Object.keys(solRaw)) if (k !== 'code' && k !== 'circuit') E(`solution.${k}`, `Неизвестное поле «${k}». В решении есть code и circuit`);
      if (typeof solRaw.code !== 'string' || !solRaw.code.trim()) E('solution.code', 'Не хватает кода эталонного решения (solution.code)');
      else if (solRaw.code.length > 80000) E('solution.code', 'Код слишком длинный');
      else solutionCode = solRaw.code;
      if (solRaw.circuit !== undefined) solutionCircuit = readCircuit(dummy, solRaw.circuit, 'solution.circuit', cIssues) ?? undefined;
    }
  }
  issues.push(...cIssues);

  let starterCode = SCAFFOLD;
  if (isQuiz) starterCode = '';
  else if (raw.starterCode !== undefined && raw.starterCode !== null) {
    if (typeof raw.starterCode !== 'string') E('starterCode', 'Ожидается текст (код)');
    else if (raw.starterCode.length > 80000) E('starterCode', 'Код слишком длинный');
    else starterCode = raw.starterCode;
  }
  if (!isQuiz && solutionCode) {
    const c = compileSketch(solutionCode);
    for (const d of c.diagnostics.filter((x) => x.severity === 'error').slice(0, 5)) E('solution.code', `Эталонное решение не компилируется: ${d.message} (строка ${d.line})`);
  }
  if (!isQuiz && starterCode.trim()) {
    const c = compileSketch(starterCode);
    for (const d of c.diagnostics.filter((x) => x.severity === 'error').slice(0, 3)) W('starterCode', `Стартовый код не компилируется: ${d.message} (строка ${d.line}). Студент увидит ошибку сразу`);
  }

  // палитра
  let palette: string[] | undefined;
  if (raw.palette !== undefined && raw.palette !== null) {
    if (!Array.isArray(raw.palette) || raw.palette.some((x) => typeof x !== 'string')) E('palette', 'palette — список типов деталей, например [led, resistor, button]');
    else {
      palette = raw.palette as string[];
      palette.forEach((t, i) => { if (!DEFS[t]) E(`palette[${i}]`, `Неизвестный тип детали «${t}»`); });
    }
  }
  if (raw.circuitLocked !== undefined && typeof raw.circuitLocked !== 'boolean') E('circuitLocked', 'circuitLocked — true или false');

  // HTTP-маршруты
  let httpRoutes: HttpRouteDef[] | undefined;
  if (raw.httpRoutes !== undefined && raw.httpRoutes !== null) {
    if (!Array.isArray(raw.httpRoutes)) E('httpRoutes', 'httpRoutes — список маршрутов');
    else {
      httpRoutes = [];
      if (raw.httpRoutes.length > 20) E('httpRoutes', 'Не больше 20 маршрутов');
      raw.httpRoutes.forEach((r, i) => {
        const p = `httpRoutes[${i}]`;
        if (!isObj(r)) return E(p, 'Маршрут — объект: { urlContains, status, body }');
        for (const k of Object.keys(r)) if (!['method', 'urlContains', 'urlMatches', 'status', 'contentType', 'body'].includes(k)) E(`${p}.${k}`, `Неизвестное поле «${k}»`);
        if (r.urlContains === undefined && r.urlMatches === undefined) E(p, 'Нужно urlContains или urlMatches — по чему узнавать запрос');
        if (r.urlContains !== undefined && typeof r.urlContains !== 'string') E(`${p}.urlContains`, 'Ожидается текст');
        if (r.urlMatches !== undefined) validate({ issues, parts: new Map(), marks: new Set(), declare() {}, cond() {}, steps() {}, pinsOf: () => [] }, { t: 'regex' }, r.urlMatches, `${p}.urlMatches`);
        if (r.status !== undefined && (typeof r.status !== 'number' || r.status < 100 || r.status > 599)) E(`${p}.status`, 'Код ответа — число 100…599');
        if (r.body === undefined) E(`${p}.body`, 'Не хватает тела ответа (body): текст или объект (станет JSON)');
        else if (typeof r.body === 'string' && r.body.length > 20000) E(`${p}.body`, 'Тело ответа слишком большое');
        httpRoutes!.push(r as unknown as HttpRouteDef);
      });
    }
  }

  // проверки
  let checks: CheckDef[] | null = [];
  const parts = new Map<string, string>([['esp', 'esp32']]);
  for (const c of [starterCircuit, solutionCircuit]) for (const p of c?.parts ?? []) if (!parts.has(p.id)) parts.set(p.id, p.type);
  const pinsOf = (t: string) => DEFS[t]?.pins.map((p) => p.name) ?? [];
  if (isQuiz) {
    if (raw.checks !== undefined && raw.checks !== null && !(Array.isArray(raw.checks) && !raw.checks.length)) W('checks', 'У теста (kind: quiz) автопроверок нет — поле checks игнорируется');
  } else if (opts.builtin && raw.checks === 'builtin') {
    checks = null;
  } else if (!Array.isArray(raw.checks)) {
    E('checks', opts.builtin ? 'checks — список проверок или слово builtin (оставить встроенные проверки)' : 'Не хватает обязательного поля «checks» — списка автопроверок');
  } else {
    const rawChecks = raw.checks as unknown[];
    if (!rawChecks.length) E('checks', 'Нужна хотя бы одна автопроверка');
    if (rawChecks.length > 14) E('checks', 'Не больше 14 проверок');
    const ids = new Set<string>();
    checks = [];
    rawChecks.forEach((ck, i) => {
      const p = `checks[${i}]`;
      if (!isObj(ck)) return E(p, 'Проверка — объект: { id, title, steps }');
      for (const k of Object.keys(ck)) if (!['id', 'title', 'timeoutMs', 'steps'].includes(k)) E(`${p}.${k}`, `Неизвестное поле «${k}». Есть: id, title, timeoutMs, steps`);
      if (typeof ck.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,29}$/.test(ck.id)) E(`${p}.id`, 'id проверки — строчные латинские буквы, цифры и «-» (например blinks)');
      else if (ids.has(ck.id)) E(`${p}.id`, `Проверка с id «${ck.id}» уже есть`);
      else ids.add(ck.id);
      if (typeof ck.title !== 'string' || ck.title.trim().length < 3) E(`${p}.title`, 'У проверки нужно название — студент видит его в результатах (минимум 3 символа)');
      else if (ck.title.length > 200) E(`${p}.title`, 'Название слишком длинное');
      if (ck.timeoutMs !== undefined && (typeof ck.timeoutMs !== 'number' || ck.timeoutMs < 1000 || ck.timeoutMs > 60000)) E(`${p}.timeoutMs`, 'Лимит реального времени на проверку — 1000…60000 мс');
      const marks = new Set<string>();
      const ctx: VCtx = { issues, parts, marks, declare: (n) => { marks.add(n); }, cond: (v, pa) => validateCond(ctx, v, pa), steps: (v, pa) => validateSteps(ctx, v, pa), pinsOf };
      if (ck.steps === undefined) E(`${p}.steps`, 'Не хватает списка шагов (steps)');
      else {
        validateSteps(ctx, ck.steps, `${p}.steps`);
        if (stepWeight(ck.steps) > 2000) E(`${p}.steps`, 'Слишком большая проверка (больше 2000 шагов с учётом повторов)');
      }
      checks!.push(ck as unknown as CheckDef);
    });
  }

  // тест
  let quiz: QuizQuestion[] | undefined;
  let passScore: number | undefined;
  if (isQuiz) {
    if (!Array.isArray(raw.quiz) || !raw.quiz.length) E('quiz', 'У теста нужен список вопросов (quiz)');
    else {
      quiz = [];
      if (raw.quiz.length > 40) E('quiz', 'Не больше 40 вопросов');
      const qids = new Set<string>();
      raw.quiz.forEach((q, i) => {
        const p = `quiz[${i}]`;
        if (!isObj(q)) return E(p, 'Вопрос — объект: { id, text, options, correct, explain }');
        for (const k of Object.keys(q)) if (!['id', 'text', 'options', 'correct', 'explain', 'code'].includes(k)) E(`${p}.${k}`, `Неизвестное поле «${k}»`);
        const qid = typeof q.id === 'string' && /^[A-Za-z0-9_-]{1,30}$/.test(q.id) ? q.id : `q${i + 1}`;
        if (q.id === undefined) { /* id по умолчанию */ } else if (typeof q.id !== 'string' || !/^[A-Za-z0-9_-]{1,30}$/.test(q.id)) E(`${p}.id`, 'id вопроса — латиница, цифры, «-», «_»');
        if (qids.has(qid)) E(`${p}.id`, `Вопрос с id «${qid}» уже есть`);
        qids.add(qid);
        if (typeof q.text !== 'string' || !q.text.trim()) E(`${p}.text`, 'Нужен текст вопроса');
        const opts2 = Array.isArray(q.options) ? q.options : null;
        if (!opts2 || opts2.length < 2 || opts2.length > 8 || opts2.some((o) => typeof o !== 'string' || !o.trim())) E(`${p}.options`, 'Варианты ответа — список из 2–8 непустых строк');
        const correct = Array.isArray(q.correct) ? q.correct : typeof q.correct === 'number' ? [q.correct] : null;
        if (!correct || !correct.length || correct.some((x) => !Number.isInteger(x) || x < 0 || (opts2 !== null && x >= opts2.length)) || new Set(correct).size !== correct.length) E(`${p}.correct`, 'correct — номер (с 0) или список номеров верных вариантов, без повторов, в пределах списка вариантов');
        if (typeof q.explain !== 'string') E(`${p}.explain`, 'Нужно пояснение, которое студент увидит после ответа (explain)');
        if (q.code !== undefined && typeof q.code !== 'string') E(`${p}.code`, 'code — текст');
        quiz!.push({ id: qid, text: String(q.text ?? ''), options: (opts2 ?? []) as string[], correct: (correct ?? []) as number[], explain: String(q.explain ?? ''), ...(typeof q.code === 'string' ? { code: q.code } : {}) });
      });
    }
    if (raw.passScore !== undefined) {
      if (typeof raw.passScore !== 'number' || raw.passScore < 0.1 || raw.passScore > 1) E('passScore', 'passScore — доля верных ответов для зачёта, 0.1…1');
      else passScore = raw.passScore;
    }
  } else if (raw.quiz !== undefined) W('quiz', 'Поле quiz нужно только для kind: quiz — оно игнорируется');

  const hasErr = issues.some((i) => i.level === 'error');
  if (hasErr) return { spec: null, issues };
  const spec: TaskSpec = {
    id, module: moduleNo, order, kind, title, subtitle, difficulty, xp, minutes, tags, story, goals,
    ...(theory ? { theory } : {}), hints, starterCode, starterCircuit,
    solution: isQuiz ? { code: '' } : { code: solutionCode, ...(solutionCircuit ? { circuit: solutionCircuit } : {}) },
    checks: isQuiz ? [] : checks,
    ...(palette ? { palette } : {}), ...(raw.circuitLocked ? { circuitLocked: true } : {}),
    ...(httpRoutes?.length ? { httpRoutes } : {}), ...(quiz ? { quiz } : {}), ...(passScore !== undefined ? { passScore } : {}),
  };
  return { spec, issues };
}

/** Проверка с номерами строк. */
export function validateTaskText(text: string, opts: ValidateOpts): { spec: TaskSpec | null; issues: LocatedIssue[] } {
  const parsed = parseTaskText(text);
  if (parsed.issues.length) return { spec: null, issues: parsed.issues };
  const v = validateTask(parsed.value, opts);
  return { spec: v.spec, issues: v.issues.map((i) => ({ ...i, line: parsed.locate(i.path) })) };
}

// ---------- в Practice и обратно ----------

/** Задача из файла → обычная практика. */
export function specToPractice(s: TaskSpec, base?: Practice): Practice {
  return {
    id: s.id, module: s.module, order: s.order, kind: s.kind, title: s.title, subtitle: s.subtitle, difficulty: s.difficulty,
    xp: s.xp, minutes: s.minutes, tags: s.tags, story: s.story, goals: s.goals, theory: s.theory, hints: s.hints,
    starterCode: s.starterCode, starterCircuit: s.starterCircuit, solution: s.solution,
    checks: s.checks ? compileChecks(s.checks) : base?.checks ?? [],
    ...(s.checks ? { checksSpec: s.checks as unknown as Record<string, unknown>[] } : {}),
    ...(s.palette ? { palette: s.palette } : {}), ...(s.circuitLocked ? { circuitLocked: true } : {}),
    ...(s.httpRoutes?.length ? { net: { routes: routesOf(s.httpRoutes) }, httpRoutes: s.httpRoutes as unknown as Record<string, unknown>[] } : base?.net ? { net: base.net } : {}),
    ...(s.quiz ? { quiz: s.quiz } : {}), ...(s.passScore !== undefined ? { passScore: s.passScore } : {}),
  };
}

/** Практика (в том числе встроенная) → файл задачи; встроенные проверки-код выгрузить нельзя: `checks: builtin`. */
export function practiceToSpecObject(p: Practice): Record<string, unknown> {
  const o: Record<string, unknown> = {
    format: TASK_FORMAT, id: p.id, module: p.module, order: p.order, kind: p.kind, title: p.title, subtitle: p.subtitle,
    difficulty: p.difficulty, xp: p.xp, minutes: p.minutes, tags: p.tags, story: p.story, goals: p.goals,
  };
  if (p.theory) o.theory = p.theory;
  o.hints = p.hints;
  if (p.kind === 'quiz') {
    o.quiz = p.quiz;
    if (p.passScore !== undefined) o.passScore = p.passScore;
    return o;
  }
  o.starterCode = p.starterCode;
  o.starterCircuit = circuitToSpec(p.starterCircuit);
  o.solution = { code: p.solution.code, ...(p.solution.circuit ? { circuit: circuitToSpec(p.solution.circuit) } : {}) };
  if (p.palette) o.palette = p.palette;
  if (p.circuitLocked) o.circuitLocked = true;
  if (p.httpRoutes) o.httpRoutes = p.httpRoutes;
  o.checks = p.checksSpec ?? 'builtin';
  return o;
}

export function stringifyTask(o: Record<string, unknown>, header?: string): string {
  const body = YAML.stringify(o, { lineWidth: 0, blockQuote: 'literal' });
  return header ? `${header.trim().split('\n').map((l) => `# ${l}`.trimEnd()).join('\n')}\n\n${body}` : body;
}

export { CONDS, STEPS };
