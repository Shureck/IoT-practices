// Вспомогательные функции для сгенерированного кода (объект R).
import { JsonValue, jsonOf, parseJsonInto, serializeJson } from './json';

/** Аварийная остановка «как на ESP32» (Guru Meditation Error). */
export class Panic extends Error {
  constructor(public kind: string, message: string, public hint?: string) {
    super(message);
  }
}

/** Метка «дробное число» для печати. */
export class FloatTag { constructor(public v: number) {} }
/** Метка «символ» для печати. */
export class CharTag { constructor(public v: number) {} }
export class I64Tag { constructor(public v: number) {} }

/** Ссылка на переменную (для &x и параметров-ссылок). Ведёт себя как массив длины 1. */
export class Ref {
  length = 1;
  constructor(private g: () => unknown, private s: (v: unknown) => unknown) {}
  get v(): unknown { return this.g(); }
  set v(x: unknown) { this.s(x); }
  get 0(): unknown { return this.g(); }
  set 0(x: unknown) { this.s(x); }
}

export function fmtFloat(v: number, digits = 2): string {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  if (Math.abs(v) > 4294967040) return 'ovf';
  const d = Math.max(0, Math.min(Math.trunc(digits), 20));
  // Arduino округляет «половину вверх» добавлением 0.5 * 10^-d
  let s = (Math.abs(v) + 0.5 * 10 ** -d).toString();
  if (s.includes('e')) s = (Math.abs(v) + 0.5 * 10 ** -d).toFixed(d + 2);
  const [ip, fp = ''] = s.split('.');
  const frac = (fp + '0'.repeat(d)).slice(0, d);
  const neg = v < 0 && (Number(ip) !== 0 || /[1-9]/.test(frac)) ? '-' : v < 0 && Object.is(v, -0) ? '' : v < 0 ? '-' : '';
  return `${neg}${ip}${d ? '.' + frac : ''}`;
}

export function intToBase(v: number, base: number, unsigned32 = true): string {
  if (base === 10) return String(v);
  let x = v;
  if (x < 0 && unsigned32) x = x >>> 0;
  return x.toString(base).toUpperCase();
}

/** Преобразование печатаемого значения в текст (как Print::print). */
export function printText(v: unknown, fmt?: unknown): string {
  if (v instanceof FloatTag) return fmtFloat(v.v, fmt === undefined ? 2 : Number(fmt));
  if (v instanceof CharTag) {
    if (fmt !== undefined && Number(fmt) !== 0) return intToBase(v.v, Number(fmt));
    return String.fromCharCode(v.v & 255);
  }
  if (v instanceof I64Tag) return fmt !== undefined ? intToBase(v.v, Number(fmt), false) : String(v.v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return fmtFloat(v, fmt === undefined ? 2 : Number(fmt));
    if (fmt !== undefined) {
      const b = Number(fmt);
      if (b === 0) return String.fromCharCode(v & 255);
      return intToBase(v, b);
    }
    return String(v);
  }
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return cs(v);
  if (v instanceof JsonValue) return v.toPrintString();
  if (typeof v === 'object' && typeof (v as { toString: () => string }).toString === 'function') return (v as { toString: () => string }).toString();
  return String(v);
}

/** Массив кодов символов / строка -> строка JS (до \0). */
export function cs(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x === null || x === undefined) return '';
  if (Array.isArray(x)) {
    let s = '';
    for (const c of x) {
      if (c === 0 || c === undefined) break;
      s += String.fromCharCode(typeof c === 'number' ? c & 255 : 0);
    }
    return s;
  }
  if (x instanceof Ref) return cs(x.v);
  if (x instanceof JsonValue) return x.asString();
  return String(x);
}

export let panicLine = 0;
export const setPanicLine = (l: number) => { panicLine = l; };

function idxCheck(a: unknown, i: number, write: boolean): void {
  const len = (a as { length: number } | null)?.length;
  if (a === null || a === undefined) throw new Panic('LoadProhibited', 'Обращение к нулевому указателю (NULL)', 'Переменная-указатель не инициализирована');
  if (!Number.isInteger(i)) throw new Panic('LoadProhibited', `Индекс массива должен быть целым, а не ${i}`);
  if (i < 0 || i >= len!) {
    throw new Panic(write ? 'StoreProhibited' : 'LoadProhibited',
      `Выход за границы массива: индекс ${i}, а допустимо 0…${len! - 1}`,
      'На настоящей плате это испортит память или перезагрузит ESP32. Проверьте условие цикла (< вместо <=)');
  }
}

export const R = {
  F: (v: number) => new FloatTag(v),
  C: (v: number) => new CharTag(v),
  I64: (v: number) => new I64Tag(v),
  idiv(a: number, b: number): number {
    if (b === 0) throw new Panic('IntegerDivideByZero', 'Целочисленное деление на ноль', 'Проверьте делитель перед делением');
    return (a / b) | 0;
  },
  udiv(a: number, b: number): number {
    if (b === 0) throw new Panic('IntegerDivideByZero', 'Целочисленное деление на ноль', 'Проверьте делитель перед делением');
    return Math.trunc(a / b) >>> 0;
  },
  ldiv(a: number, b: number): number {
    if (b === 0) throw new Panic('IntegerDivideByZero', 'Целочисленное деление на ноль');
    return Math.trunc(a / b);
  },
  imod(a: number, b: number): number {
    if (b === 0) throw new Panic('IntegerDivideByZero', 'Остаток от деления на ноль');
    return a % b;
  },
  imul64: (a: number, b: number) => a * b,
  ti32: (v: number) => (Number.isFinite(v) ? Math.trunc(v) | 0 : v !== v ? 0 : v > 0 ? 2147483647 : -2147483648),
  tu32: (v: number) => (Number.isFinite(v) ? (v < 0 ? 0 : Math.trunc(v) >>> 0) : 0),
  num(v: unknown): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof JsonValue) return v.asNumber();
    if (v instanceof FloatTag || v instanceof CharTag) return v.v;
    return Number(v) || 0;
  },
  bit64(op: string, a: number, b: number): number {
    const A = BigInt(Math.trunc(a));
    const B = BigInt(Math.trunc(b));
    const r = op === '&' ? A & B : op === '|' ? A | B : A ^ B;
    return Number(r);
  },
  ix(a: unknown, i: number): unknown {
    if (typeof a === 'string') return i >= 0 && i < a.length ? a.charCodeAt(i) & 255 : 0;
    idxCheck(a, i, false);
    return (a as unknown[])[i];
  },
  wi(a: unknown, i: number): number {
    idxCheck(a, i, true);
    return i;
  },
  chAt(s: unknown, i: number): number {
    if (typeof s === 'string') return i >= 0 && i < s.length ? s.charCodeAt(i) & 255 : 0;
    if (Array.isArray(s)) return i >= 0 && i < s.length ? (s[i] as number) : 0;
    if (s === null || s === undefined) throw new Panic('LoadProhibited', 'Обращение к нулевому указателю (NULL)');
    return 0;
  },
  setCh(s: string, i: number, c: number): string {
    if (i < 0 || i >= s.length) return s;
    return s.slice(0, i) + String.fromCharCode(c & 255) + s.slice(i + 1);
  },
  cs,
  fstr: (v: number, d: number) => fmtFloat(v, d),
  istr: (v: number, base: number, u: number) => intToBase(v, base, !!u || base !== 10),
  anystr(v: unknown): string {
    return printText(v);
  },
  charArr(s: string, n: number | null): number[] {
    const len = n ?? s.length + 1;
    const a = new Array<number>(len).fill(0);
    for (let i = 0; i < Math.min(s.length, len); i++) a[i] = s.charCodeAt(i) & 255;
    return a;
  },
  arr(dims: number[], fill: () => unknown): unknown[] {
    const make = (d: number): unknown[] => {
      const n = dims[d];
      if (!Number.isInteger(n) || n < 0) throw new Panic('LoadProhibited', `Недопустимый размер массива: ${n}`);
      const a = new Array(n);
      for (let i = 0; i < n; i++) a[i] = d + 1 < dims.length ? make(d + 1) : fill();
      return a;
    };
    return make(0);
  },
  *arrG(dims: number[], fill: () => Generator<unknown, unknown>): Generator<unknown, unknown[]> {
    const make = function* (d: number): Generator<unknown, unknown[]> {
      const a = new Array(dims[d]);
      for (let i = 0; i < dims[d]; i++) a[i] = d + 1 < dims.length ? yield* make(d + 1) : yield* fill();
      return a;
    };
    return yield* make(0);
  },
  arrInit(list: unknown[], dims: (number | null)[], fill: () => unknown): unknown[] {
    const make = (src: unknown, d: number): unknown[] => {
      const items = Array.isArray(src) ? src : [src];
      const n = dims[d] ?? items.length;
      const a = new Array(n);
      for (let i = 0; i < n; i++) {
        if (d + 1 < dims.length) a[i] = make(i < items.length ? items[i] : [], d + 1);
        else a[i] = i < items.length ? items[i] : fill();
      }
      return a;
    };
    return make(list, 0);
  },
  *arrInitG(list: unknown[], dims: (number | null)[], fill: () => Generator<unknown, unknown>): Generator<unknown, unknown[]> {
    const make = function* (src: unknown, d: number): Generator<unknown, unknown[]> {
      const items = Array.isArray(src) ? src : [src];
      const n = dims[d] ?? items.length;
      const a = new Array(n);
      for (let i = 0; i < n; i++) {
        if (d + 1 < dims.length) a[i] = yield* make(i < items.length ? items[i] : [], d + 1);
        else a[i] = i < items.length ? items[i] : yield* fill();
      }
      return a;
    };
    return yield* make(list, 0);
  },
  ref: (g: () => unknown, s: (v: unknown) => unknown) => new Ref(g, s),
  clone(v: unknown): unknown {
    if (Array.isArray(v)) return v.map((x) => R.clone(x));
    if (v && typeof v === 'object' && typeof (v as { $clone?: () => unknown }).$clone === 'function') return (v as { $clone: () => unknown }).$clone();
    return v;
  },
  truthy(v: unknown): boolean {
    if (v === null || v === undefined) return false;
    if (typeof v === 'object' && typeof (v as { __bool?: () => boolean }).__bool === 'function') return (v as { __bool: () => boolean }).__bool();
    return !!v || v === '';
  },
  iter(v: unknown): Iterable<unknown> {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return Array.from(v, (c) => c.charCodeAt(0));
    if (v instanceof JsonValue) return v.iterate();
    return [];
  },
  constrain: (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x),
  map(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
    // реализация map() из ядра ESP32 (с округлением)
    const t = (v: number) => Math.trunc(v) | 0;
    const dividend = t(outMax) - t(outMin);
    const divisor = t(inMax) - t(inMin);
    const delta = t(x) - t(inMin);
    if (divisor === 0) return -1;
    return t((delta * dividend + Math.trunc(divisor / 2)) / divisor) + t(outMin);
  },
  // ---- строки C ----
  sprintf(buf: unknown[], size: number, fmt: unknown, args: unknown[]): number {
    const s = format(cs(fmt), args);
    if (!Array.isArray(buf)) throw new Panic('StoreProhibited', 'sprintf: буфер не является массивом char');
    const lim = Math.min(size, buf.length);
    if (s.length + 1 > buf.length && size === Infinity) {
      throw new Panic('StoreProhibited', `sprintf: строка длиной ${s.length} не помещается в буфер на ${buf.length} символов`, 'Увеличьте размер массива или используйте snprintf');
    }
    writeStr(buf, s, lim);
    return s.length;
  },
  strcpy(dst: unknown[], src: unknown, n: number): string {
    const s = cs(src);
    if (!Array.isArray(dst)) throw new Panic('StoreProhibited', 'strcpy: приёмник не является массивом char');
    if (n === Infinity && s.length + 1 > dst.length) {
      throw new Panic('StoreProhibited', `strcpy: строка длиной ${s.length} не помещается в массив на ${dst.length}`, 'Увеличьте размер массива');
    }
    writeStr(dst, s.slice(0, n === Infinity ? undefined : n), Math.min(dst.length, n === Infinity ? dst.length : n + 1));
    return s;
  },
  strncpy(dst: unknown[], src: unknown, n: number): string {
    const s = cs(src).slice(0, n);
    for (let i = 0; i < Math.min(n, dst.length); i++) dst[i] = i < s.length ? s.charCodeAt(i) & 255 : 0;
    return s;
  },
  strcat(dst: unknown[], src: unknown, n: number): string {
    const cur = cs(dst);
    const add = cs(src).slice(0, n === Infinity ? undefined : n);
    const s = cur + add;
    if (s.length + 1 > dst.length) throw new Panic('StoreProhibited', `strcat: результат (${s.length} символов) не помещается в массив на ${dst.length}`);
    writeStr(dst, s, dst.length);
    return s;
  },
  strncat(dst: unknown[], src: unknown, n: number): string { return R.strcat(dst, src, n); },
  itoa(v: number, buf: unknown[], base: number): string {
    const s = base === 10 ? String(Math.trunc(v)) : (Math.trunc(v) < 0 ? '-' + Math.abs(Math.trunc(v)).toString(base) : Math.trunc(v).toString(base));
    writeStr(buf, s, buf.length);
    return s;
  },
  dtostrf(v: number, width: number, prec: number, buf: unknown[]): string {
    let s = fmtFloat(v, prec);
    const w = Math.abs(width);
    if (s.length < w) s = width < 0 ? s.padEnd(w) : s.padStart(w);
    writeStr(buf, s, buf.length);
    return s;
  },
  memset(dst: unknown[], v: number, nBytes: number, elem: number): void {
    const n = Math.min(dst.length, Math.ceil(nBytes / elem));
    for (let i = 0; i < n; i++) {
      if (typeof dst[i] === 'boolean') dst[i] = v !== 0;
      else dst[i] = elem === 1 ? v & 255 : v === 0 ? 0 : v;
    }
  },
  memcpy(dst: unknown[], src: unknown, nBytes: number, elem: number): void {
    const s = typeof src === 'string' ? Array.from(src, (c) => c.charCodeAt(0)) : (src as unknown[]);
    const n = Math.min(dst.length, Math.ceil(nBytes / elem));
    for (let i = 0; i < n; i++) dst[i] = R.clone(s[i] ?? 0);
  },
  S: {
    substring(s: string, a: number, b?: number): string {
      const n = s.length;
      let from = Math.max(0, Math.min(a, n));
      let to = b === undefined ? n : Math.max(0, Math.min(b, n));
      if (from > to) [from, to] = [to, from];
      return s.slice(from, to);
    },
    toInt(s: string): number {
      const m = /^\s*([+-]?\d+)/.exec(s);
      return m ? Number(m[1]) | 0 : 0;
    },
    toFloat(s: string): number {
      const m = /^\s*([+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(s);
      return m ? Number(m[1]) : 0;
    },
    remove(s: string, i: number, n?: number): string {
      if (i < 0 || i >= s.length) return s;
      return n === undefined ? s.slice(0, i) : s.slice(0, i) + s.slice(i + n);
    },
    compareTo(a: string, b: string): number {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a.charCodeAt(i) !== b.charCodeAt(i)) return a.charCodeAt(i) - b.charCodeAt(i);
      }
      return a.length - b.length;
    },
  },
  // ---- JSON ----
  jnum(v: unknown): number { return v instanceof JsonValue ? v.asNumber() : R.num(v); },
  jbool(v: unknown): boolean { return v instanceof JsonValue ? v.asBool() : !!v; },
  jstr(v: unknown): string { return v instanceof JsonValue ? v.asString() : cs(v); },
  jcstr(v: unknown): string | null { return v instanceof JsonValue ? v.asCstr() : (v as string); },
  jprim(v: unknown): unknown { return v instanceof JsonValue ? v.primitive() : v; },
  jtruthy(v: unknown): boolean { return v instanceof JsonValue ? v.truthy() : !!v; },
  jor(v: unknown, def: unknown): unknown { return v instanceof JsonValue ? v.or(def) : v ?? def; },
  jeq(a: unknown, b: unknown): boolean {
    const pa = a instanceof JsonValue ? a.primitive() : a;
    const pb = b instanceof JsonValue ? b.primitive() : b;
    if (typeof pa === 'boolean' || typeof pb === 'boolean') return !!pa === !!pb && (typeof pa === typeof pb || typeof pa === 'number' || typeof pb === 'number');
    return pa === pb;
  },
  jser: (doc: unknown, pretty: boolean) => serializeJson(doc as JsonValue, pretty),
  jserTo(doc: unknown, buf: unknown[], pretty: boolean): number {
    const s = serializeJson(doc as JsonValue, pretty);
    writeStr(buf, s, buf.length);
    return Math.min(s.length, buf.length - 1);
  },
  jsonOf,
  parseJsonInto,
};

export type RT = typeof R;

function writeStr(buf: unknown[], s: string, lim: number): void {
  const n = Math.min(s.length, lim - 1);
  for (let i = 0; i < n; i++) buf[i] = s.charCodeAt(i) & 255;
  if (n >= 0 && n < buf.length) buf[n] = 0;
}

/** printf-форматирование: %d %i %u %ld %lu %f %.2f %s %c %x %X %o %e %g %p %%. */
export function format(fmt: string, args: unknown[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|z|j|t|L)?([diouxXeEfFgGcsp%])/g,
    (_m, flags: string, width: string | undefined, prec: string | undefined, _len: string | undefined, conv: string) => {
      if (conv === '%') return '%';
      let w = width === '*' ? Number(args[ai++]) : width ? Number(width) : 0;
      const p = prec === '*' ? Number(args[ai++]) : prec !== undefined ? Number(prec) : undefined;
      let arg = args[ai++];
      if (arg instanceof FloatTag || arg instanceof CharTag || arg instanceof I64Tag) arg = arg.v;
      if (arg instanceof JsonValue) arg = arg.primitive();
      let s: string;
      const n = typeof arg === 'boolean' ? (arg ? 1 : 0) : typeof arg === 'number' ? arg : Number(arg);
      switch (conv) {
        case 'd': case 'i': s = String(Math.trunc(n || 0)); break;
        case 'u': s = String(Math.trunc(n || 0) >>> 0); break;
        case 'x': s = (Math.trunc(n || 0) >>> 0).toString(16); break;
        case 'X': s = (Math.trunc(n || 0) >>> 0).toString(16).toUpperCase(); break;
        case 'o': s = (Math.trunc(n || 0) >>> 0).toString(8); break;
        case 'f': case 'F': s = Number.isFinite(n) ? n.toFixed(p ?? 6) : Number.isNaN(n) ? 'nan' : n > 0 ? 'inf' : '-inf'; break;
        case 'e': case 'E': s = n.toExponential(p ?? 6).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); break;
        case 'g': case 'G': s = String(Number(n.toPrecision(p || 6))); break;
        case 'c': s = String.fromCharCode(typeof arg === 'string' ? arg.charCodeAt(0) : n & 255); break;
        case 's': s = arg === null || arg === undefined ? '(null)' : cs(arg); if (p !== undefined) s = s.slice(0, p); break;
        case 'p': s = '0x3ffb' + ((Math.random() * 0xffff) | 0).toString(16); break;
        default: s = '';
      }
      if ((conv === 'd' || conv === 'i' || conv === 'f' || conv === 'F') && flags.includes('+') && n >= 0) s = '+' + s;
      if ((conv === 'd' || conv === 'i') && p !== undefined) {
        const neg = s.startsWith('-');
        const digits = neg ? s.slice(1) : s;
        s = (neg ? '-' : '') + digits.padStart(p, '0');
      }
      if (w && s.length < w) {
        if (flags.includes('-')) s = s.padEnd(w);
        else if (flags.includes('0') && conv !== 's' && conv !== 'c') {
          const neg = s.startsWith('-') || s.startsWith('+');
          s = neg ? s[0] + s.slice(1).padStart(w - 1, '0') : s.padStart(w, '0');
        } else s = s.padStart(w);
      }
      w = 0;
      return s;
    });
}
