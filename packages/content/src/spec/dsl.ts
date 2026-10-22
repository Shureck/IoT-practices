// Язык автопроверок для файла задачи: шаги (что сделать с платой) и условия (что должно получиться).
// Каждая запись — форма значения (для проверки файла и справочника), описание и исполнение.
// Всё это компилируется в обычные CheckSpec (см. runner.ts), так что проверки работают на том же
// механизме, что и встроенные.
import { CheckFail, DEFS, type CheckContext } from '@esp32lab/sim';
import { checkLedWiring, codeUses } from '../helpers';
import { err, isObj, parseTime, PIN_RE, validate as validateShape, type Field, type Shape, type VCtx } from './shape';

export interface Mark { t: number; serial: number }
export interface RT { h: CheckContext; marks: Map<string, Mark> }
export interface Res { ok: boolean; why?: string }

// ---------- общие вычисления ----------

const GPIO_BY_NAME: Record<string, number> = {};
for (const p of DEFS.esp32.pins) if (p.gpio !== undefined) GPIO_BY_NAME[p.name.toUpperCase()] = p.gpio;

/** Время в мс: число или «now», «метка+500». */
export function timeOf(rt: RT, v: unknown): number {
  const t = parseTime(v);
  if (!t) return rt.h.fail(`Некорректное время: ${String(v)}`);
  if (t.name === null) return t.offset;
  if (t.name === 'now') return rt.h.now + t.offset;
  if (t.name === 'start') return t.offset;
  const m = rt.marks.get(t.name);
  if (!m) return rt.h.fail(`Метка «${t.name}» ещё не поставлена`);
  return m.t + t.offset;
}

/** Номер GPIO по описанию вывода. */
export function pinOf(rt: RT, v: unknown): number {
  const s = String(v).trim();
  const mm = /^(near|at):([A-Za-z0-9_]+)\.([A-Za-z0-9_.]+)$/i.exec(s);
  if (mm) {
    const list = mm[1].toLowerCase() === 'near' ? rt.h.gpioNear(mm[2], mm[3]) : rt.h.gpioAt(mm[2], mm[3]);
    if (!list.length) return rt.h.fail(`Вывод «${mm[3]}» детали «${mm[2]}» не подключён ${mm[1].toLowerCase() === 'near' ? 'ни к одному выводу GPIO' : 'напрямую к выводу GPIO'}`);
    return list[0];
  }
  const m = PIN_RE.exec(s);
  if (!m) return rt.h.fail(`Некорректный вывод: ${s}`);
  if (m[4] !== undefined) return Number(m[4]);
  const g = GPIO_BY_NAME[m[5].toUpperCase()];
  return g === undefined ? rt.h.fail(`Неизвестный вывод: ${s}`) : g;
}

const num = (v: unknown): number => v as number;
const inRange = (x: number, r: number | [number, number], tol = 0): boolean => (typeof r === 'number' ? Math.abs(x - r) <= tol : x >= r[0] && x <= r[1]);
const showRange = (r: number | [number, number]) => (typeof r === 'number' ? String(r) : `${r[0]}…${r[1]}`);

function countOf(n: number, c: unknown): boolean {
  if (c === undefined) return n >= 1;
  if (typeof c === 'number') return n === c;
  const [a, b] = c as [number, number];
  return n >= a && n <= b;
}
const countText = (c: unknown) => (c === undefined ? 'хотя бы 1' : typeof c === 'number' ? `ровно ${c}` : `от ${(c as number[])[0]} до ${(c as number[])[1]}`);

function sinceOf(rt: RT, v: Record<string, unknown>): number {
  return typeof v.since === 'string' ? rt.marks.get(v.since)?.serial ?? 0 : 0;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const colorOf = (v: unknown): number => (typeof v === 'number' ? v : parseInt(String(v).slice(1), 16));

// ---------- форма полей (короткие записи) ----------

const f = (shape: Shape, desc: string, required = false, def?: string): Field => ({ shape, desc, required, default: def });
const PART = (types?: string[]): Shape => ({ t: 'part', types });
const T_FROM = f({ t: 'time' }, 'Начало окна, мс', true);
const T_TO = f({ t: 'time' }, 'Конец окна, мс', true);
const CNT = f({ t: 'numOrRange' }, 'Сколько раз: число (ровно) или диапазон [от, до]');
const SINCE = f({ t: 'mark' }, 'Считать только то, что появилось после этой метки');
const LIGHT_TYPES = ['led'];

// ---------- условия ----------

export interface CondDef {
  desc: string;
  example: string;
  value: Shape;
  eval(rt: RT, v: any): Res | Promise<Res>;
}

const ok = (b: boolean, why: string): Res => (b ? { ok: true } : { ok: false, why });

export const CONDS: Record<string, CondDef> = {
  all: {
    desc: 'Все вложенные условия верны.',
    example: '{ all: [ { ledOn: led1 }, { relayOff: relay } ] }',
    value: { t: 'list', of: { t: 'cond' }, min: 1 },
    async eval(rt, v: Record<string, unknown>[]) {
      for (const c of v) { const r = await evalCond(rt, c); if (!r.ok) return r; }
      return { ok: true };
    },
  },
  any: {
    desc: 'Верно хотя бы одно из условий.',
    example: '{ any: [ { ledOn: red }, { ledOn: green } ] }',
    value: { t: 'list', of: { t: 'cond' }, min: 1 },
    async eval(rt, v: Record<string, unknown>[]) {
      const whys: string[] = [];
      for (const c of v) { const r = await evalCond(rt, c); if (r.ok) return r; whys.push(r.why ?? ''); }
      return { ok: false, why: `Не выполнено ни одно из условий: ${whys.join('; ')}` };
    },
  },
  not: {
    desc: 'Вложенное условие НЕ верно.',
    example: '{ not: { ledOn: led1 } }',
    value: { t: 'cond' },
    async eval(rt, v: Record<string, unknown>) {
      const r = await evalCond(rt, v);
      return r.ok ? { ok: false, why: 'Должно быть наоборот: условие выполнилось, а не должно было' } : { ok: true };
    },
  },
  ledOn: {
    desc: 'Светодиод горит (яркость больше 5 %).',
    example: '{ ledOn: led1 }',
    value: PART(LIGHT_TYPES),
    eval: (rt, id: string) => ok(rt.h.ledOn(id), `Светодиод «${id}» должен гореть, а он не горит`),
  },
  ledOff: {
    desc: 'Светодиод не горит.',
    example: '{ ledOff: led1 }',
    value: PART(LIGHT_TYPES),
    eval: (rt, id: string) => ok(!rt.h.ledOn(id), `Светодиод «${id}» горит, а не должен`),
  },
  led: {
    desc: 'Яркость светодиода (0…1) в заданных пределах. Для ШИМ/затухания.',
    example: '{ led: { part: led1, above: 0.3, below: 0.7 } }',
    value: { t: 'obj', fields: { part: f(PART(LIGHT_TYPES), 'Светодиод', true), above: f({ t: 'num', min: 0, max: 1 }, 'Яркость больше'), below: f({ t: 'num', min: 0, max: 1 }, 'Яркость меньше') } },
    eval(rt, v) {
      const b = rt.h.led(v.part);
      const want = [v.above !== undefined ? `больше ${Math.round(v.above * 100)} %` : '', v.below !== undefined ? `меньше ${Math.round(v.below * 100)} %` : ''].filter(Boolean).join(' и ');
      return ok((v.above === undefined || b > v.above) && (v.below === undefined || b < v.below), `Яркость светодиода «${v.part}» ${Math.round(b * 100)} %, а нужно ${want}`);
    },
  },
  rgb: {
    desc: 'Яркость каналов RGB-светодиода (0…1) в диапазонах.',
    example: '{ rgb: { part: rgb, r: [0.5, 1], g: [0, 0.1], b: [0, 0.1] } }',
    value: { t: 'obj', fields: { part: f(PART(['rgb']), 'RGB-светодиод', true), r: f({ t: 'range' }, 'Красный'), g: f({ t: 'range' }, 'Зелёный'), b: f({ t: 'range' }, 'Синий') } },
    eval(rt, v) {
      const [r, g, b] = rt.h.rgb(v.part);
      const bad = (['r', 'g', 'b'] as const).filter((k, i) => v[k] && !inRange([r, g, b][i], v[k]));
      return ok(!bad.length, `Цвет «${v.part}»: R ${r.toFixed(2)}, G ${g.toFixed(2)}, B ${b.toFixed(2)} — канал(ы) ${bad.join(', ').toUpperCase()} вне ожидаемого диапазона`);
    },
  },
  gpio: {
    desc: 'Состояние вывода ESP32: `high` / `low` — выход с этим уровнем, `output` — настроен на выход, `input` — не выход, `pwm` — на нём ШИМ. Необязательно — напряжение на выводе.',
    example: '{ gpio: { pin: 2, is: output } }',
    value: { t: 'obj', fields: { pin: f({ t: 'pin' }, 'Вывод', true), is: f({ t: 'enum', values: ['high', 'low', 'output', 'input', 'pwm'] }, 'Ожидаемое состояние'), voltage: f({ t: 'range' }, 'Напряжение на выводе, В') } },
    eval(rt, v) {
      const pin = pinOf(rt, v.pin);
      const g = rt.h.gpio(pin);
      const states: Record<string, boolean> = { high: g.isOutput && g.level === 1, low: g.isOutput && g.level === 0, output: g.isOutput, input: !g.isOutput, pwm: !!g.pwm && g.pwm.duty > 0 };
      if (v.is !== undefined && !states[v.is]) {
        const hint = v.is === 'output' ? ' — добавьте pinMode(…, OUTPUT) в setup()' : '';
        return { ok: false, why: `GPIO${pin}: ожидалось «${v.is}», а сейчас ${g.isOutput ? `выход, уровень ${g.level}` : 'не выход'}${hint}` };
      }
      if (v.voltage && !inRange(g.voltage, v.voltage)) return { ok: false, why: `Напряжение на GPIO${pin} ${g.voltage.toFixed(2)} В, а нужно ${showRange(v.voltage)} В` };
      return { ok: true };
    },
  },
  relay: {
    desc: 'Реле включено.',
    example: '{ relay: relay1 }',
    value: PART(['relay']),
    eval: (rt, id: string) => ok(rt.h.relayOn(id), `Реле «${id}» должно быть включено`),
  },
  relayOff: {
    desc: 'Реле выключено.',
    example: '{ relayOff: relay1 }',
    value: PART(['relay']),
    eval: (rt, id: string) => ok(!rt.h.relayOn(id), `Реле «${id}» должно быть выключено`),
  },
  servo: {
    desc: 'Угол сервопривода (цель), градусы.',
    example: '{ servo: { part: sv, angle: 90, tol: 5 } }',
    value: { t: 'obj', fields: { part: f(PART(['servo']), 'Сервопривод', true), angle: f({ t: 'num', min: 0, max: 180 }, 'Угол', true), tol: f({ t: 'num', min: 0 }, 'Допуск, градусы', false, '5') } },
    eval(rt, v) { const a = rt.h.servoAngle(v.part); return ok(Math.abs(a - v.angle) <= (v.tol ?? 5), `Угол сервопривода «${v.part}» ${Math.round(a)}°, а нужно ${v.angle}°`); },
  },
  buzzer: {
    desc: 'Пищалка звучит (`sounding: true`, по умолчанию) или молчит; при желании — с нужной частотой.',
    example: '{ buzzer: { part: bz, freq: [900, 1100] } }',
    value: { t: 'obj', fields: { part: f(PART(['buzzer']), 'Пищалка', true), sounding: f({ t: 'bool' }, 'Звучит ли', false, 'true'), freq: f({ t: 'numOrRange' }, 'Частота, Гц: число (±5 %) или диапазон') } },
    eval(rt, v) {
      const fr = rt.h.buzzerFreq(v.part);
      if (v.sounding === false) return ok(fr === 0, `Пищалка «${v.part}» должна молчать, а звучит (${fr} Гц)`);
      if (fr <= 0) return { ok: false, why: `Пищалка «${v.part}» молчит, а должна звучать` };
      if (v.freq !== undefined && !inRange(fr, v.freq, typeof v.freq === 'number' ? v.freq * 0.05 : 0)) return { ok: false, why: `Пищалка «${v.part}» звучит на ${fr} Гц, а нужно ${showRange(v.freq)} Гц` };
      return { ok: true };
    },
  },
  load: {
    desc: 'Уровень нагрузки (мотор, лампа, замок): 0…1.',
    example: '{ load: { part: lock, above: 0.5 } }',
    value: { t: 'obj', fields: { part: f(PART(['motor', 'lamp', 'lock']), 'Нагрузка', true), above: f({ t: 'num', min: 0, max: 1 }, 'Больше'), below: f({ t: 'num', min: 0, max: 1 }, 'Меньше') } },
    eval(rt, v) {
      const l = rt.h.loadLevel(v.part);
      const want = [v.above !== undefined ? `больше ${v.above}` : '', v.below !== undefined ? `меньше ${v.below}` : ''].filter(Boolean).join(' и ');
      return ok((v.above === undefined || l > v.above) && (v.below === undefined || l < v.below), `Уровень нагрузки «${v.part}» ${l.toFixed(2)}, а нужно ${want}`);
    },
  },
  lcd: {
    desc: 'Текст на дисплее LCD 1602. Без `line` проверяется весь экран (строки через перевод строки).',
    example: '{ lcd: { part: lcd, line: 1, contains: "Temp" } }',
    value: { t: 'obj', fields: { part: f(PART(['lcd1602']), 'Дисплей', true), line: f({ t: 'num', int: true, min: 1, max: 4 }, 'Номер строки с 1'), equals: f({ t: 'str' }, 'Точно равно (без хвостовых пробелов)'), contains: f({ t: 'str' }, 'Содержит (без учёта регистра)'), matches: f({ t: 'regex' }, 'Подходит под выражение') } },
    eval(rt, v) {
      const lines = rt.h.lcd(v.part);
      const text = v.line !== undefined ? (lines[v.line - 1] ?? '') : lines.join('\n');
      const okAll = (v.equals === undefined || text.trim() === String(v.equals).trim())
        && (v.contains === undefined || text.toLowerCase().includes(String(v.contains).toLowerCase()))
        && (v.matches === undefined || new RegExp(v.matches, 'i').test(text));
      return ok(okAll, `На дисплее «${v.part}»${v.line ? ` в строке ${v.line}` : ''}: «${text.replace(/\n/g, ' / ')}»${v.equals !== undefined ? `, а ожидалось «${v.equals}»` : v.contains !== undefined ? `, а ожидалось «${v.contains}»` : ''}`);
    },
  },
  neo: {
    desc: 'Цвет пикселя адресной ленты NeoPixel. Без `pixel` — хотя бы у одного пикселя.',
    example: '{ neo: { part: ring, pixel: 0, color: "#ff0000" } }',
    value: { t: 'obj', fields: { part: f(PART(['neopixel']), 'Лента', true), pixel: f({ t: 'num', int: true, min: 0, max: 23 }, 'Номер пикселя с 0'), color: f({ t: 'color' }, 'Цвет', true) } },
    eval(rt, v) {
      const cols = rt.h.neo(v.part);
      const want = colorOf(v.color);
      const good = v.pixel !== undefined ? cols[v.pixel] === want : cols.some((c) => c === want);
      return ok(good, `На ленте «${v.part}»${v.pixel !== undefined ? ` у пикселя ${v.pixel} цвет ${cols[v.pixel] === undefined ? 'не задан' : hex(cols[v.pixel])}` : ' нет ни одного пикселя нужного цвета'}, а нужен ${hex(want)}`);
    },
  },
  oled: {
    desc: 'На OLED-дисплее что-то нарисовано: число включённых «байтов» экрана больше порога.',
    example: '{ oled: { part: oled, litAbove: 20 } }',
    value: { t: 'obj', fields: { part: f(PART(['oled']), 'Дисплей', true), litAbove: f({ t: 'num', min: 0 }, 'Сумма значений буфера больше', true) } },
    eval(rt, v) { const n = rt.h.oledPixels(v.part); return ok(n > v.litAbove, `На дисплее «${v.part}» почти ничего не нарисовано (${n})`); },
  },
  serial: {
    desc: 'Вывод в Serial: сколько раз встречается текст (`contains`, без учёта регистра) или выражение (`matches`). По умолчанию — хотя бы раз.',
    example: '{ serial: { contains: "ВЫЗОВ", since: t0, count: 2 } }',
    value: { t: 'obj', fields: { contains: f({ t: 'str' }, 'Текст'), matches: f({ t: 'regex' }, 'Выражение'), since: SINCE, count: CNT } },
    eval(rt, v) {
      const text = rt.h.serialSince(sinceOf(rt, v));
      let n = 0;
      if (v.contains !== undefined) { const needle = String(v.contains).toLowerCase(); const hay = text.toLowerCase(); for (let i = hay.indexOf(needle); i >= 0 && needle; i = hay.indexOf(needle, i + needle.length)) n++; }
      else if (v.matches !== undefined) n = (text.match(new RegExp(v.matches, 'gi')) ?? []).length;
      const what = v.contains !== undefined ? `«${v.contains}»` : `по выражению ${v.matches}`;
      return ok(countOf(n, v.count), `В Serial ${what} встретилось ${n} раз(а), а нужно ${countText(v.count)}`);
    },
  },
  serialNumber: {
    desc: 'Последнее число, напечатанное в Serial, в нужных пределах.',
    example: '{ serialNumber: { near: 90, tol: 3 } }',
    value: { t: 'obj', fields: { since: SINCE, min: f({ t: 'num' }, 'Не меньше'), max: f({ t: 'num' }, 'Не больше'), near: f({ t: 'num' }, 'Около значения'), tol: f({ t: 'num', min: 0 }, 'Допуск для near', false, '0') } },
    eval(rt, v) {
      const nums = rt.h.numbers(rt.h.serialSince(sinceOf(rt, v)));
      if (!nums.length) return { ok: false, why: 'В Serial не напечатано ни одного числа' };
      const x = nums[nums.length - 1];
      const good = (v.min === undefined || x >= v.min) && (v.max === undefined || x <= v.max) && (v.near === undefined || Math.abs(x - v.near) <= (v.tol ?? 0));
      return ok(good, `Последнее напечатанное число — ${x}${v.near !== undefined ? `, а ожидалось около ${v.near}` : v.min !== undefined || v.max !== undefined ? `, а ожидалось ${v.min ?? '…'}…${v.max ?? '…'}` : ''}`);
    },
  },
  toggles: {
    desc: 'Сколько раз вывод ESP32 переключился за окно времени. По умолчанию — хотя бы раз.',
    example: '{ toggles: { pin: 25, from: 1000, to: 4000, min: 4 } }',
    value: { t: 'obj', fields: { pin: f({ t: 'pin' }, 'Вывод', true), from: T_FROM, to: T_TO, min: f({ t: 'num', int: true, min: 0 }, 'Не меньше раз', false, '1'), max: f({ t: 'num', int: true, min: 0 }, 'Не больше раз'), eq: f({ t: 'num', int: true, min: 0 }, 'Ровно раз') } },
    eval(rt, v) {
      const pin = pinOf(rt, v.pin); const n = rt.h.toggles(pin, timeOf(rt, v.from), timeOf(rt, v.to));
      const good = v.eq !== undefined ? n === v.eq : n >= (v.min ?? 1) && (v.max === undefined || n <= v.max);
      return ok(good, `GPIO${pin} переключился ${n} раз(а) за окно, а нужно ${v.eq !== undefined ? `ровно ${v.eq}` : `не меньше ${v.min ?? 1}${v.max !== undefined ? `, не больше ${v.max}` : ''}`}`);
    },
  },
  period: {
    desc: 'Средний период мигания вывода (по фронтам 0→1) в окне, мс.',
    example: '{ period: { pin: 2, from: 0, to: 8200, ms: 2000, tol: 60 } }',
    value: { t: 'obj', fields: { pin: f({ t: 'pin' }, 'Вывод', true), from: T_FROM, to: T_TO, ms: f({ t: 'num', min: 0 }, 'Ожидаемый период, мс', true), tol: f({ t: 'num', min: 0 }, 'Допуск, мс', true) } },
    eval(rt, v) {
      const pin = pinOf(rt, v.pin); const a = timeOf(rt, v.from); const b = timeOf(rt, v.to);
      const per = rt.h.period(pin, a, b);
      if (per === null) return { ok: false, why: `GPIO${pin} не мигает: за ${((b - a) / 1000).toFixed(0)} с не было переключений` };
      return ok(Math.abs(per - v.ms) <= v.tol, `GPIO${pin} мигает с периодом ${Math.round(per)} мс, а нужно ${v.ms} мс`);
    },
  },
  duty: {
    desc: 'Доля времени, когда вывод во включённом состоянии (0…1), в окне.',
    example: '{ duty: { pin: 2, from: 0, to: 8000, value: 0.5, tol: 0.08 } }',
    value: { t: 'obj', fields: { pin: f({ t: 'pin' }, 'Вывод', true), from: T_FROM, to: T_TO, value: f({ t: 'num', min: 0, max: 1 }, 'Ожидаемая доля', true), tol: f({ t: 'num', min: 0, max: 1 }, 'Допуск', false, '0.08') } },
    eval(rt, v) {
      const pin = pinOf(rt, v.pin); const d = rt.h.dutyOver(pin, timeOf(rt, v.from), timeOf(rt, v.to));
      return ok(Math.abs(d - v.value) <= (v.tol ?? 0.08), `GPIO включён ${Math.round(d * 100)} % времени, а нужно ${Math.round(v.value * 100)} %`);
    },
  },
  wired: {
    desc: 'Как подключён вывод детали: к какому-то GPIO (`gpio` — напрямую или через резистор, `gpio-direct` — напрямую), к земле (`gnd`, `gnd-via-resistor`), к `3v3` или `vin`. Для `gpio` можно потребовать конкретный вывод (`pin`).',
    example: '{ wired: { part: led1, pin: C, to: gnd-via-resistor } }',
    value: { t: 'obj', fields: { part: f(PART(), 'Деталь', true), pin: f({ t: 'partPin' }, 'Вывод детали', true), to: f({ t: 'enum', values: ['gpio', 'gpio-direct', 'gnd', 'gnd-via-resistor', '3v3', 'vin'] }, 'Куда подключён', true), gpio: f({ t: 'pin' }, 'Конкретный GPIO (для to: gpio / gpio-direct)') } },
    eval(rt, v) {
      const { h } = rt; const name = `${v.part}.${v.pin}`;
      if (v.to === 'gpio' || v.to === 'gpio-direct') {
        const list = v.to === 'gpio' ? h.gpioNear(v.part, v.pin) : h.gpioAt(v.part, v.pin);
        if (!list.length) return { ok: false, why: `Вывод «${name}» не подключён ${v.to === 'gpio' ? 'ни к одному выводу GPIO' : 'напрямую к выводу GPIO'}` };
        if (v.gpio !== undefined) { const want = pinOf(rt, v.gpio); return ok(list.includes(want), `Вывод «${name}» подключён к GPIO${list.join(', GPIO')}, а нужен GPIO${want}`); }
        return { ok: true };
      }
      if (v.to === 'gnd') return ok(h.onGnd(v.part, v.pin, false), `Вывод «${name}» должен идти на GND`);
      if (v.to === 'gnd-via-resistor') return ok(h.onGnd(v.part, v.pin, true), `Вывод «${name}» должен идти на GND (напрямую или через резистор)`);
      return ok(h.onNet(v.part, v.pin, v.to === '3v3' ? '3V3' : 'VIN'), `Вывод «${name}» должен быть подключён к ${v.to === '3v3' ? '3V3' : 'VIN (5 В)'}`);
    },
  },
  ledWiring: {
    desc: 'Светодиод подключён правильно: анод через резистор к GPIO, катод на GND.',
    example: '{ ledWiring: led1 }',
    value: PART(LIGHT_TYPES),
    eval(rt, id: string) {
      try { checkLedWiring(rt.h, id, `Светодиод «${id}»`); return { ok: true }; } catch (e) { if (e instanceof CheckFail) return { ok: false, why: e.message }; throw e; }
    },
  },
  codeUses: {
    desc: 'Код студента (без комментариев) содержит выражение. Регистр важен.',
    example: '{ codeUses: "\\\\bdelay\\\\s*\\\\(" }',
    value: { t: 'regex' },
    eval: (rt, re: string) => ok(codeUses(rt.h, new RegExp(re)), `В коде не найдено нужной конструкции (${re})`),
  },
  codeNotUses: {
    desc: 'Код студента (без комментариев) НЕ содержит выражение.',
    example: '{ codeNotUses: "\\\\bdelay\\\\s*\\\\(10000" }',
    value: { t: 'regex' },
    eval: (rt, re: string) => ok(!codeUses(rt.h, new RegExp(re)), `В коде есть то, чего быть не должно (${re})`),
  },
  http: {
    desc: 'Программа отправила HTTP-запрос: адрес содержит текст (`urlContains`, без учёта регистра) или подходит под выражение (`urlMatches`), метод — `method`.',
    example: '{ http: { urlContains: "api.open-meteo.com", method: GET } }',
    value: { t: 'obj', fields: { urlContains: f({ t: 'str' }, 'Адрес содержит'), urlMatches: f({ t: 'regex' }, 'Адрес подходит под выражение'), method: f({ t: 'str' }, 'Метод (GET, POST…)'), count: CNT } },
    eval(rt, v) {
      const reqs = rt.h.requests.filter((r) => (v.method === undefined || r.method.toUpperCase() === String(v.method).toUpperCase())
        && (v.urlContains === undefined || r.url.toLowerCase().includes(String(v.urlContains).toLowerCase()))
        && (v.urlMatches === undefined || new RegExp(v.urlMatches, 'i').test(r.url)));
      return ok(countOf(reqs.length, v.count), `Подходящих HTTP-запросов ${reqs.length}, а нужно ${countText(v.count)} (всего запросов: ${rt.h.requests.length})`);
    },
  },
  mqtt: {
    desc: 'Программа опубликовала MQTT-сообщение: тема подходит под фильтр (`topic`, поддерживаются `+` и `#`), текст сообщения содержит `payloadContains`.',
    example: '{ mqtt: { topic: "station/+/temp", payloadContains: "21" } }',
    value: { t: 'obj', fields: { topic: f({ t: 'str' }, 'Фильтр темы', false, '#'), payloadContains: f({ t: 'str' }, 'Сообщение содержит'), count: CNT } },
    eval(rt, v) {
      const msgs = rt.h.mqttLog(v.topic ?? '#').filter((m) => v.payloadContains === undefined || m.payload.includes(String(v.payloadContains)));
      return ok(countOf(msgs.length, v.count), `Подходящих MQTT-сообщений ${msgs.length}, а нужно ${countText(v.count)}`);
    },
  },
  warnings: {
    desc: 'Предупреждения симулятора («светодиод сгорел», «вывод перегружен»…): `none: true` — их нет; `contains` — есть предупреждение с этим текстом.',
    example: '{ warnings: { none: true } }',
    value: { t: 'obj', fields: { none: f({ t: 'bool' }, 'Предупреждений нет'), contains: f({ t: 'str' }, 'Есть предупреждение с текстом') } },
    eval(rt, v) {
      const w = rt.h.warnings();
      if (v.none) return ok(w.length === 0, `Симулятор предупреждает: ${w[0]}${w.length > 1 ? ` (и ещё ${w.length - 1})` : ''}`);
      if (v.contains !== undefined) return ok(w.some((x) => x.toLowerCase().includes(String(v.contains).toLowerCase())), `Нет предупреждения с текстом «${v.contains}»`);
      return { ok: true };
    },
  },
};

/** Условие — объект ровно с одним ключом из CONDS. */
export async function evalCond(rt: RT, c: unknown): Promise<Res> {
  const [name, value] = Object.entries(c as Record<string, unknown>)[0];
  return CONDS[name].eval(rt, value);
}

export function validateCond(c: VCtx, v: unknown, path: string) {
  if (!isObj(v)) return err(c, path, 'Условие — это объект с одним ключом, например { ledOn: led1 }');
  const keys = Object.keys(v);
  if (keys.length !== 1) return err(c, path, `В условии должен быть ровно один ключ, а здесь ${keys.length}: ${keys.join(', ') || '—'}. Несколько условий объединяют через all / any`);
  const name = keys[0];
  const def = CONDS[name];
  if (!def) return err(c, `${path}.${name}`, `Неизвестное условие «${name}». Доступные: ${Object.keys(CONDS).join(', ')}`);
  validateShape(c, def.value, v[name], `${path}.${name}`);
}

// ---------- шаги ----------

export interface StepDef {
  desc: string;
  example: string;
  value: Shape;
  /** дополнительные ключи рядом с основным */
  extra?: Record<string, Field>;
  /** дополнительная проверка (например, свойство детали) */
  check?(c: VCtx, v: any, step: Record<string, unknown>, path: string): void;
  run(rt: RT, v: any, step: Record<string, unknown>): Promise<void>;
}

const MSG = f({ t: 'str', max: 400 }, 'Своё сообщение при неудаче (если не задано — понятный текст по умолчанию)');
const MARK_OUT = f({ t: 'name' }, 'Поставить метку в момент, когда условие выполнилось');

/** Запустить вложенные шаги. */
export async function runSteps(rt: RT, steps: Record<string, unknown>[]): Promise<void> {
  for (const s of steps) {
    const key = Object.keys(s).find((k) => k in STEPS)!;
    await STEPS[key].run(rt, s[key], s);
  }
}

const failWith = (rt: RT, step: Record<string, unknown>, fallback: string): never => rt.h.fail(typeof step.message === 'string' && step.message ? step.message : fallback);

export const STEPS: Record<string, StepDef> = {
  wait: {
    desc: 'Дать симуляции поработать столько-то миллисекунд виртуального времени.',
    example: '- wait: 1500',
    value: { t: 'num', min: 0, max: 600000 },
    run: (rt, ms) => rt.h.wait(num(ms)),
  },
  until: {
    desc: 'Работать до абсолютного момента (если он уже прошёл — ничего не делать).',
    example: '- until: t0+9300',
    value: { t: 'time' },
    run: (rt, t) => rt.h.until(timeOf(rt, t)),
  },
  set: {
    desc: 'Выставить свойство детали — как поворот ручки датчика: освещённость, положение потенциометра, расстояние, температуру…',
    example: '- set: { part: ldr, prop: lux, value: 2000 }',
    value: { t: 'obj', fields: { part: f(PART(), 'Деталь', true), prop: f({ t: 'str' }, 'Свойство (из таблицы деталей)', true), value: f({ t: 'any' }, 'Значение: число, true/false или текст', true) } },
    check(c, v, _s, path) {
      const type = typeof v?.part === 'string' ? c.parts.get(v.part) : undefined;
      const def = type ? DEFS[type]?.props.find((p) => p.key === v.prop) : undefined;
      if (type && !def) return err(c, `${path}.prop`, `У детали «${v.part}» (${type}) нет свойства «${v.prop}». Есть: ${DEFS[type].props.map((p) => p.key).join(', ') || 'нет свойств'}`);
      if (!def) return;
      if (def.type === 'number' && typeof v.value !== 'number') err(c, `${path}.value`, `Свойство «${def.key}» — число`);
      else if (def.type === 'number' && ((def.min !== undefined && v.value < def.min) || (def.max !== undefined && v.value > def.max))) err(c, `${path}.value`, `Свойство «${def.key}»: допустимо ${def.min ?? '…'}…${def.max ?? '…'}`);
      if (def.type === 'bool' && typeof v.value !== 'boolean') err(c, `${path}.value`, `Свойство «${def.key}» — true или false`);
      if (def.type === 'select' && !(def.options ?? []).some((o) => o.value === v.value)) err(c, `${path}.value`, `Свойство «${def.key}»: допустимо ${(def.options ?? []).map((o) => o.value).join(', ')}`);
    },
    async run(rt, v) { rt.h.set(v.part, v.prop, v.value); },
  },
  press: {
    desc: 'Нажать и отпустить кнопку: держать `ms` мс, затем (необязательно) подождать `after` мс.',
    example: '- press: { part: btn, ms: 300 }',
    value: { t: 'obj', fields: { part: f(PART(['button']), 'Кнопка', true), ms: f({ t: 'num', min: 10, max: 60000 }, 'Сколько держать, мс', false, '200'), after: f({ t: 'num', min: 0, max: 60000 }, 'Пауза после, мс', false, '0') } },
    async run(rt, v) { await rt.h.press(v.part, v.ms ?? 200); if (v.after) await rt.h.wait(v.after); },
  },
  pressSeq: {
    desc: 'Нажать несколько кнопок по очереди (кодовая клавиатура).',
    example: '- pressSeq: { parts: [b1, b2, b3, b4], ms: 150, gap: 250 }',
    value: { t: 'obj', fields: { parts: f({ t: 'list', of: PART(['button']), min: 1, max: 50 }, 'Кнопки по порядку', true), ms: f({ t: 'num', min: 10, max: 60000 }, 'Сколько держать каждую, мс', false, '150'), gap: f({ t: 'num', min: 0, max: 60000 }, 'Пауза между нажатиями, мс', false, '250') } },
    async run(rt, v) { for (const id of v.parts as string[]) { await rt.h.press(id, v.ms ?? 150); await rt.h.wait(v.gap ?? 250); } },
  },
  hold: {
    desc: 'Зажать кнопку (`on: true`, по умолчанию) или отпустить (`on: false`) — не ждёт, время идёт в следующих шагах.',
    example: '- hold: { part: btn, on: true }',
    value: { t: 'obj', fields: { part: f(PART(['button']), 'Кнопка', true), on: f({ t: 'bool' }, 'Зажать', false, 'true') } },
    async run(rt, v) { rt.h.hold(v.part, v.on !== false); },
  },
  motion: {
    desc: 'Сработал датчик движения (PIR).',
    example: '- motion: pir',
    value: PART(['pir']),
    async run(rt, id) { rt.h.motion(id); },
  },
  send: {
    desc: 'Отправить текст в Serial программе (как из монитора порта). `\\n` — перевод строки.',
    example: '- send: "KEY?\\n"',
    value: { t: 'str', max: 400 },
    async run(rt, text) { rt.h.send(String(text)); },
  },
  mqttPublish: {
    desc: 'Опубликовать MQTT-сообщение «от внешнего мира» (программа должна быть на него подписана).',
    example: '- mqttPublish: { topic: "station/cmd", payload: "on" }',
    value: { t: 'obj', fields: { topic: f({ t: 'str', min: 1 }, 'Тема', true), payload: f({ t: 'str' }, 'Сообщение', true), retain: f({ t: 'bool' }, 'Retained', false, 'false') } },
    async run(rt, v) { rt.h.mqttPublish(v.topic, v.payload, !!v.retain); },
  },
  mark: {
    desc: 'Запомнить текущий момент и позицию в выводе Serial под именем — дальше на метку можно ссылаться: время `имя+500`, `since: имя`.',
    example: '- mark: t0',
    value: { t: 'name' },
    async run(rt, name) { rt.marks.set(String(name), { t: rt.h.now, serial: rt.h.mark() }); },
  },
  expect: {
    desc: 'Проверить условие прямо сейчас; если не выполнено — проверка провалена.',
    example: '- expect: { ledOn: led1 }\n  message: "Нажали кнопку — светодиод не загорелся"',
    value: { t: 'cond' },
    extra: { message: MSG },
    async run(rt, c, step) { const r = await evalCond(rt, c); if (!r.ok) failWith(rt, step, r.why ?? 'Условие не выполнено'); },
  },
  waitFor: {
    desc: 'Ждать, пока условие станет верным (проверяется каждые `step` мс), но не дольше `timeout` мс; не дождались — проверка провалена.',
    example: '- waitFor: { relay: relay1 }\n  timeout: 1000\n  as: opened',
    value: { t: 'cond' },
    extra: { timeout: f({ t: 'num', min: 1, max: 600000 }, 'Сколько ждать, мс', false, '2000'), step: f({ t: 'num', min: 1, max: 10000 }, 'Как часто проверять, мс', false, '10'), as: MARK_OUT, message: MSG },
    async run(rt, c, step) {
      const end = rt.h.now + ((step.timeout as number | undefined) ?? 2000);
      const every = (step.step as number | undefined) ?? 10;
      let r = await evalCond(rt, c);
      while (!r.ok && rt.h.now < end) { await rt.h.wait(every); r = await evalCond(rt, c); }
      if (!r.ok) failWith(rt, step, `Не дождались (ждали ${((step.timeout as number | undefined) ?? 2000)} мс): ${r.why ?? 'условие не выполнено'}`);
      if (typeof step.as === 'string') rt.marks.set(step.as, { t: rt.h.now, serial: rt.h.mark() });
    },
  },
  always: {
    desc: 'Условие должно быть верным всё время в течение `for` мс (проверяется каждые `step` мс). Например, «светодиод горит ровно, без мигания».',
    example: '- always: { ledOn: led1 }\n  for: 2000',
    value: { t: 'cond' },
    extra: { for: f({ t: 'num', min: 1, max: 600000 }, 'Как долго, мс', true), step: f({ t: 'num', min: 1, max: 10000 }, 'Как часто проверять, мс', false, '20'), message: MSG },
    async run(rt, c, step) {
      const end = rt.h.now + (step.for as number); const every = (step.step as number | undefined) ?? 20;
      for (;;) {
        const r = await evalCond(rt, c);
        if (!r.ok) failWith(rt, step, r.why ?? 'Условие нарушилось');
        if (rt.h.now >= end) break;
        await rt.h.wait(Math.min(every, end - rt.h.now));
      }
    },
  },
  never: {
    desc: 'Условие не должно выполниться ни разу в течение `for` мс. Например, «зелёный и красный никогда не горят вместе».',
    example: '- never: { all: [ { ledOn: red }, { ledOn: green } ] }\n  for: 60000\n  message: "Опасно: красный и зелёный вместе"',
    value: { t: 'cond' },
    extra: { for: f({ t: 'num', min: 1, max: 600000 }, 'Как долго, мс', true), step: f({ t: 'num', min: 1, max: 10000 }, 'Как часто проверять, мс', false, '20'), message: MSG },
    async run(rt, c, step) {
      const end = rt.h.now + (step.for as number); const every = (step.step as number | undefined) ?? 20;
      for (;;) {
        const r = await evalCond(rt, c);
        if (r.ok) failWith(rt, step, 'Произошло то, чего быть не должно');
        if (rt.h.now >= end) break;
        await rt.h.wait(Math.min(every, end - rt.h.now));
      }
    },
  },
  repeat: {
    desc: 'Повторить вложенные шаги несколько раз.',
    example: '- repeat:\n    times: 3\n    steps:\n      - press: { part: btn }\n      - wait: 500',
    value: { t: 'obj', fields: { times: f({ t: 'num', int: true, min: 1, max: 200 }, 'Сколько раз', true), steps: f({ t: 'steps' }, 'Шаги', true) } },
    async run(rt, v) { for (let i = 0; i < v.times; i++) await runSteps(rt, v.steps); },
  },
  if: {
    desc: 'Выполнить разные шаги в зависимости от условия.',
    example: '- if:\n    cond: { ledOn: led1 }\n    then:\n      - wait: 100\n    else:\n      - fail: "Светодиод не горит"',
    value: { t: 'obj', fields: { cond: f({ t: 'cond' }, 'Условие', true), then: f({ t: 'steps' }, 'Если верно', true), else: f({ t: 'steps' }, 'Если нет') } },
    async run(rt, v) { const r = await evalCond(rt, v.cond); await runSteps(rt, r.ok ? v.then : v.else ?? []); },
  },
  fail: {
    desc: 'Провалить проверку с сообщением (обычно внутри `if`).',
    example: '- fail: "Так делать нельзя"',
    value: { t: 'str', min: 1, max: 400 },
    async run(rt, text) { rt.h.fail(String(text)); },
  },
};

export function validateSteps(c: VCtx, v: unknown, path: string) {
  if (!Array.isArray(v)) return err(c, path, 'Ожидается список шагов (каждый — со знака «-»)');
  if (!v.length) return err(c, path, 'Список шагов пуст');
  v.forEach((s, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(s)) return err(c, p, 'Шаг — это объект, например `- wait: 500`');
    const actions = Object.keys(s).filter((k) => k in STEPS);
    if (actions.length !== 1) {
      const unknown = Object.keys(s).filter((k) => !(k in STEPS));
      if (!actions.length) return err(c, p, `Неизвестный шаг «${unknown[0] ?? ''}». Доступные: ${Object.keys(STEPS).join(', ')}`);
      return err(c, p, `В одном шаге несколько действий (${actions.join(', ')}) — разнесите по разным шагам`);
    }
    const name = actions[0]; const def = STEPS[name];
    for (const k of Object.keys(s)) {
      if (k !== name && !(def.extra && k in def.extra)) err(c, `${p}.${k}`, `Шагу «${name}» не нужно поле «${k}»${def.extra ? `. Допустимые дополнительные: ${Object.keys(def.extra).join(', ')}` : ''}`);
    }
    validateShape(c, def.value, s[name], `${p}.${name}`);
    for (const [k, fld] of Object.entries(def.extra ?? {})) {
      if (s[k] === undefined) { if (fld.required) err(c, `${p}.${k}`, `Шагу «${name}» нужно поле «${k}»`); continue; }
      validateShape(c, fld.shape, s[k], `${p}.${k}`);
    }
    def.check?.(c, s[name], s, `${p}.${name}`);
  });
}

/** Сколько «шагов» выполнится (с учётом повторов) — защита от гигантских проверок. */
export function stepWeight(steps: unknown): number {
  if (!Array.isArray(steps)) return 0;
  let n = 0;
  for (const s of steps as Record<string, any>[]) {
    n += 1;
    if (isObj(s) && isObj(s.repeat)) n += (Number(s.repeat.times) || 1) * stepWeight(s.repeat.steps);
    if (isObj(s) && isObj(s.if)) n += stepWeight(s.if.then) + stepWeight(s.if.else);
    if (isObj(s) && isObj(s.pressSeq) && Array.isArray(s.pressSeq.parts)) n += s.pressSeq.parts.length;
  }
  return n;
}
