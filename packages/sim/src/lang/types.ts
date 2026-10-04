// Система типов транслятора (упрощённая модель типов C++).

export type Ty =
  | { k: 'void' }
  | { k: 'bool' }
  | { k: 'int'; bits: 8 | 16 | 32 | 64; u: boolean; ch?: boolean }
  | { k: 'float'; bits: 32 | 64 }
  | { k: 'String' }
  | { k: 'cstr' }
  | { k: 'arr'; of: Ty; n: number | null }
  | { k: 'cls'; name: string; user?: boolean }
  | { k: 'fn'; ret: Ty }
  | { k: 'json' }
  | { k: 'null' }
  | { k: 'any' };

export const T = {
  void: { k: 'void' } as Ty,
  bool: { k: 'bool' } as Ty,
  char: { k: 'int', bits: 8, u: false, ch: true } as Ty,
  i8: { k: 'int', bits: 8, u: false } as Ty,
  u8: { k: 'int', bits: 8, u: true } as Ty,
  i16: { k: 'int', bits: 16, u: false } as Ty,
  u16: { k: 'int', bits: 16, u: true } as Ty,
  i32: { k: 'int', bits: 32, u: false } as Ty,
  u32: { k: 'int', bits: 32, u: true } as Ty,
  i64: { k: 'int', bits: 64, u: false } as Ty,
  u64: { k: 'int', bits: 64, u: true } as Ty,
  f32: { k: 'float', bits: 32 } as Ty,
  f64: { k: 'float', bits: 64 } as Ty,
  String: { k: 'String' } as Ty,
  cstr: { k: 'cstr' } as Ty,
  json: { k: 'json' } as Ty,
  any: { k: 'any' } as Ty,
  null: { k: 'null' } as Ty,
};

/** Разбор строкового описания типа из метаданных библиотек. */
export function tyFromName(name: string): Ty {
  switch (name) {
    case 'void': return T.void;
    case 'bool': return T.bool;
    case 'char': return T.char;
    case 'int8': return T.i8;
    case 'uint8': return T.u8;
    case 'int16': return T.i16;
    case 'uint16': return T.u16;
    case 'int': case 'int32': return T.i32;
    case 'uint32': return T.u32;
    case 'int64': return T.i64;
    case 'uint64': return T.u64;
    case 'float': return T.f32;
    case 'double': return T.f64;
    case 'String': return T.String;
    case 'cstr': return T.cstr;
    case 'json': return T.json;
    case 'any': case '': return T.any;
    case 'bytes': return { k: 'arr', of: T.u8, n: null };
    default:
      return { k: 'cls', name };
  }
}

export const isInt = (t: Ty): t is Extract<Ty, { k: 'int' }> => t.k === 'int';
export const isFloat = (t: Ty): t is Extract<Ty, { k: 'float' }> => t.k === 'float';
export const isNumeric = (t: Ty) => t.k === 'int' || t.k === 'float' || t.k === 'bool';
export const isStrLike = (t: Ty) => t.k === 'String' || t.k === 'cstr' || (t.k === 'arr' && t.of.k === 'int' && !!t.of.ch);
export const isCharArr = (t: Ty) => t.k === 'arr' && t.of.k === 'int' && t.of.bits === 8;

export function tyName(t: Ty): string {
  switch (t.k) {
    case 'int':
      if (t.ch) return 'char';
      if (t.bits === 32) return t.u ? 'unsigned long' : 'int';
      if (t.bits === 8) return t.u ? 'byte' : 'int8_t';
      return `${t.u ? 'u' : ''}int${t.bits}_t`;
    case 'float': return t.bits === 32 ? 'float' : 'double';
    case 'arr': return `${tyName(t.of)}[${t.n ?? ''}]`;
    case 'cls': return t.name;
    case 'cstr': return 'const char*';
    case 'fn': return 'функция';
    case 'json': return 'JsonVariant';
    default: return t.k;
  }
}

export function sameTy(a: Ty, b: Ty): boolean {
  if (a.k !== b.k) return false;
  if (a.k === 'int' && b.k === 'int') return a.bits === b.bits && a.u === b.u && !!a.ch === !!b.ch;
  if (a.k === 'float' && b.k === 'float') return a.bits === b.bits;
  if (a.k === 'cls' && b.k === 'cls') return a.name === b.name;
  if (a.k === 'arr' && b.k === 'arr') return sameTy(a.of, b.of);
  return true;
}

/** Обычные арифметические преобразования C++ для бинарных операций. */
export function arith(a: Ty, b: Ty): Ty {
  if (a.k === 'float' || b.k === 'float') {
    const bits = Math.max(a.k === 'float' ? a.bits : 0, b.k === 'float' ? b.bits : 0) as 32 | 64;
    return bits === 64 ? T.f64 : T.f32;
  }
  if (a.k === 'any' || b.k === 'any' || a.k === 'json' || b.k === 'json') return T.any;
  const ai = a.k === 'int' ? a : T.i32 as Extract<Ty, { k: 'int' }>;
  const bi = b.k === 'int' ? b : T.i32 as Extract<Ty, { k: 'int' }>;
  // целочисленное продвижение: всё младше int становится int
  const pa = ai.bits < 32 ? (T.i32 as Extract<Ty, { k: 'int' }>) : ai;
  const pb = bi.bits < 32 ? (T.i32 as Extract<Ty, { k: 'int' }>) : bi;
  const bits = Math.max(pa.bits, pb.bits) as 32 | 64;
  const u = (pa.bits === bits && pa.u) || (pb.bits === bits && pb.u);
  if (bits === 64) return u ? T.u64 : T.i64;
  return u ? T.u32 : T.i32;
}

/** Размер типа в байтах (для sizeof) на ESP32. */
export function sizeOf(t: Ty, structSize?: (name: string) => number): number {
  switch (t.k) {
    case 'bool': return 1;
    case 'int': return t.bits / 8;
    case 'float': return t.bits / 8;
    case 'String': return 16;
    case 'cstr': return 4;
    case 'arr': return (t.n ?? 0) * sizeOf(t.of, structSize);
    case 'cls': return structSize?.(t.name) ?? 4;
    default: return 4;
  }
}

/** Код приведения JS-значения к целому типу. */
export function intWrap(code: string, t: Extract<Ty, { k: 'int' }>): string {
  if (t.bits === 32) return t.u ? `((${code})>>>0)` : `((${code})|0)`;
  if (t.bits === 8) return t.u ? `((${code})&255)` : `((${code})<<24>>24)`;
  if (t.bits === 16) return t.u ? `((${code})&65535)` : `((${code})<<16>>16)`;
  return code; // 64 бита — обычное число JS
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

export function suggest(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  const lower = name.toLowerCase();
  for (const c of candidates) {
    if (c.startsWith('$') || c.startsWith('__')) continue;
    if (c.toLowerCase() === lower) return c;
    const d = levenshtein(lower, c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  const limit = name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
  return bestD <= limit ? best : undefined;
}
