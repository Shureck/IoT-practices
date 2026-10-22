// Мини-язык описания формы значений для файла задачи: из одного описания получаются и проверка
// (с понятными сообщениями по-русски), и таблицы в справочнике — они не расходятся.

export type Level = 'error' | 'warning';
export interface Issue { path: string; message: string; level: Level }

export type Shape =
  | { t: 'str'; max?: number; min?: number }
  | { t: 'num'; min?: number; max?: number; int?: boolean }
  | { t: 'bool' }
  | { t: 'enum'; values: string[] }
  /** момент времени, мс: число или «now», «now-3000», «имя_метки+500» */
  | { t: 'time' }
  /** вывод GPIO: число, «D25», «GPIO25», «near:led1.A», «at:led1.A» */
  | { t: 'pin' }
  /** id детали со схемы (при желании — только данных типов) */
  | { t: 'part'; types?: string[] }
  /** вывод детали: «имя» из списка выводов её типа (проверяется вместе с соседним полем part) */
  | { t: 'partPin' }
  | { t: 'regex' }
  | { t: 'range' }
  | { t: 'numOrRange' }
  /** имя метки, поставленной раньше шагом mark */
  | { t: 'mark' }
  /** новое имя метки */
  | { t: 'name' }
  | { t: 'color' }
  /** число, true/false или текст */
  | { t: 'any' }
  | { t: 'cond' }
  | { t: 'steps' }
  | { t: 'list'; of: Shape; min?: number; max?: number }
  | { t: 'obj'; fields: Record<string, Field> };

export interface Field { shape: Shape; required?: boolean; desc: string; default?: string }

/** Что известно проверяющему о задаче: детали схемы и метки. */
export interface VCtx {
  issues: Issue[];
  /** id детали → тип (по эталонной и стартовой схеме) */
  parts: Map<string, string>;
  /** метки, поставленные ранее в этой проверке */
  marks: Set<string>;
  /** сюда складываются новые метки */
  declare(name: string): void;
  /** рекурсивная проверка вложенных условий и шагов (подставляется из dsl.ts) */
  cond(v: unknown, path: string): void;
  steps(v: unknown, path: string): void;
  /** known pins by part type */
  pinsOf(type: string): string[];
}

export const err = (c: VCtx, path: string, message: string) => { c.issues.push({ path, message, level: 'error' }); };
export const warn = (c: VCtx, path: string, message: string) => { c.issues.push({ path, message, level: 'warning' }); };

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const TIME_RE = /^\s*([A-Za-z_][\w]*)\s*(?:([+-])\s*(\d+(?:\.\d+)?))?\s*$/;

/** Разбор выражения времени: число или имя ± число. */
export function parseTime(v: unknown): { name: string | null; offset: number } | null {
  if (typeof v === 'number' && Number.isFinite(v)) return { name: null, offset: v };
  if (typeof v !== 'string') return null;
  const m = TIME_RE.exec(v);
  if (!m) return null;
  const off = m[3] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0;
  return { name: m[1], offset: off };
}

export const PIN_RE = /^(?:(near|at):([A-Za-z0-9_]+)\.([A-Za-z0-9_.]+)|(?:GPIO)?(\d{1,2})|(D\d{1,2}|RX0|TX0|RX2|TX2|VN|VP))$/i;

export function describe(s: Shape): string {
  switch (s.t) {
    case 'str': return 'текст';
    case 'num': return s.int ? 'целое число' : 'число';
    case 'bool': return 'true / false';
    case 'enum': return s.values.map((x) => `\`${x}\``).join(' · ');
    case 'time': return 'время, мс: число или `now`, `now-3000`, `метка+500`';
    case 'pin': return 'GPIO: число, `D25`, `GPIO25`, `near:led1.A` (вывод детали, напрямую или через резистор) или `at:led1.A` (напрямую)';
    case 'part': return s.types ? `id детали со схемы (тип: ${s.types.join(', ')})` : 'id детали со схемы';
    case 'partPin': return 'имя вывода детали (из таблицы деталей)';
    case 'regex': return 'регулярное выражение (JS)';
    case 'range': return 'диапазон `[от, до]`';
    case 'numOrRange': return 'число или диапазон `[от, до]`';
    case 'mark': return 'имя метки, поставленной раньше (`mark`)';
    case 'name': return 'имя новой метки';
    case 'color': return 'цвет `#rrggbb`';
    case 'any': return 'число, true/false или текст';
    case 'cond': return 'условие';
    case 'steps': return 'список шагов';
    case 'list': return `список: ${describe(s.of)}`;
    case 'obj': return 'объект';
  }
}

/** Проверить значение по описанию формы. */
export function validate(c: VCtx, shape: Shape, v: unknown, path: string): void {
  const bad = (what: string) => err(c, path, `Ожидается ${what}`);
  switch (shape.t) {
    case 'str':
      if (typeof v !== 'string') return bad('текст');
      if (shape.min !== undefined && v.length < shape.min) err(c, path, `Текст слишком короткий (минимум ${shape.min} символов)`);
      if (shape.max !== undefined && v.length > shape.max) err(c, path, `Текст слишком длинный (максимум ${shape.max} символов)`);
      return;
    case 'num':
      if (typeof v !== 'number' || !Number.isFinite(v)) return bad('число');
      if (shape.int && !Number.isInteger(v)) err(c, path, 'Нужно целое число');
      if (shape.min !== undefined && v < shape.min) err(c, path, `Значение не меньше ${shape.min}`);
      if (shape.max !== undefined && v > shape.max) err(c, path, `Значение не больше ${shape.max}`);
      return;
    case 'bool':
      if (typeof v !== 'boolean') bad('true или false');
      return;
    case 'enum':
      if (typeof v !== 'string' || !shape.values.includes(v)) err(c, path, `Допустимые значения: ${shape.values.join(', ')}`);
      return;
    case 'time': {
      const t = parseTime(v);
      if (!t) return bad('время: число миллисекунд или «now», «метка+500»');
      if (t.name !== null && t.name !== 'now' && t.name !== 'start' && !c.marks.has(t.name)) {
        err(c, path, `Метка «${t.name}» не поставлена раньше (шаг mark: ${t.name})`);
      }
      return;
    }
    case 'pin':
      if (typeof v === 'number') {
        if (!Number.isInteger(v) || v < 0 || v > 39) err(c, path, 'Номер GPIO — целое от 0 до 39');
        return;
      }
      if (typeof v !== 'string' || !PIN_RE.test(v.trim())) return bad('вывод: 25, «D25», «GPIO25» или «near:led1.A»');
      {
        const m = /^(near|at):([A-Za-z0-9_]+)\.([A-Za-z0-9_.]+)$/i.exec(v.trim());
        if (m) {
          const type = c.parts.get(m[2]);
          if (!type) err(c, path, `На схеме нет детали «${m[2]}»`);
          else if (!c.pinsOf(type).includes(m[3])) err(c, path, `У детали «${m[2]}» (${type}) нет вывода «${m[3]}». Есть: ${c.pinsOf(type).slice(0, 12).join(', ')}`);
        }
      }
      return;
    case 'part':
      if (typeof v !== 'string' || !v) return bad('id детали');
      {
        const type = c.parts.get(v);
        if (!type) err(c, path, `На схеме (эталонной или стартовой) нет детали «${v}»`);
        else if (shape.types && !shape.types.includes(type)) err(c, path, `Деталь «${v}» имеет тип ${type}, а здесь нужна: ${shape.types.join(' или ')}`);
      }
      return;
    case 'partPin':
      if (typeof v !== 'string' || !v) bad('имя вывода');
      return;
    case 'regex':
      if (typeof v !== 'string') return bad('регулярное выражение (текст)');
      try { new RegExp(v, 'i'); } catch (e) { err(c, path, `Некорректное регулярное выражение: ${(e as Error).message}`); }
      return;
    case 'range':
      if (!Array.isArray(v) || v.length !== 2 || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return bad('диапазон из двух чисел: [от, до]');
      if ((v[0] as number) > (v[1] as number)) err(c, path, 'В диапазоне «от» больше «до»');
      return;
    case 'numOrRange':
      if (typeof v === 'number' && Number.isFinite(v)) return;
      validate(c, { t: 'range' }, v, path);
      return;
    case 'mark':
      if (typeof v !== 'string' || !c.marks.has(v)) err(c, path, `Метка «${String(v)}» не поставлена раньше (шаг mark)`);
      return;
    case 'name':
      if (typeof v !== 'string' || !/^[A-Za-z_]\w{0,30}$/.test(v) || v === 'now' || v === 'start') err(c, path, 'Имя метки — латиница, цифры и «_», не «now» и не «start»');
      else c.declare(v);
      return;
    case 'color':
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return;
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) bad('цвет «#rrggbb»');
      return;
    case 'any':
      if (!['number', 'string', 'boolean'].includes(typeof v)) bad('число, true/false или текст');
      return;
    case 'cond':
      c.cond(v, path);
      return;
    case 'steps':
      c.steps(v, path);
      return;
    case 'list':
      if (!Array.isArray(v)) return bad('список');
      if (shape.min !== undefined && v.length < shape.min) err(c, path, `В списке должно быть не меньше ${shape.min} элементов`);
      if (shape.max !== undefined && v.length > shape.max) err(c, path, `В списке должно быть не больше ${shape.max} элементов`);
      v.forEach((x, i) => validate(c, shape.of, x, `${path}[${i}]`));
      return;
    case 'obj': {
      if (!isObj(v)) return bad('объект (набор полей «ключ: значение»)');
      for (const k of Object.keys(v)) {
        if (!(k in shape.fields)) err(c, `${path}.${k}`, `Неизвестное поле «${k}». Допустимые: ${Object.keys(shape.fields).join(', ')}`);
      }
      // part должен проверяться раньше partPin: порядок полей в описании
      for (const [k, f] of Object.entries(shape.fields)) {
        const val = v[k];
        if (val === undefined) {
          if (f.required) err(c, `${path}.${k}`, `Не хватает обязательного поля «${k}»`);
          continue;
        }
        if (f.shape.t === 'partPin') {
          const partId = typeof v.part === 'string' ? v.part : null;
          const type = partId ? c.parts.get(partId) : undefined;
          if (typeof val !== 'string' && typeof val !== 'number') err(c, `${path}.${k}`, 'Ожидается имя вывода');
          else if (type && !c.pinsOf(type).includes(String(val))) err(c, `${path}.${k}`, `У детали «${partId}» (${type}) нет вывода «${val}». Есть: ${c.pinsOf(type).slice(0, 14).join(', ')}`);
          continue;
        }
        validate(c, f.shape, val, `${path}.${k}`);
      }
      return;
    }
  }
}
