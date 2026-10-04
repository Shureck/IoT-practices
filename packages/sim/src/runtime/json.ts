// Эмуляция ArduinoJson (v6/v7): JsonDocument, JsonObject, JsonArray, JsonVariant.
// Значение — «живая» ссылка на место в документе, как в настоящей библиотеке.

type J = null | boolean | number | string | J[] | { [k: string]: J };

interface Holder {
  get(): J | undefined;
  set(v: J): boolean;
}

function deepCopy(v: J | undefined): J {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map(deepCopy);
  if (v && typeof v === 'object') {
    const o: Record<string, J> = {};
    for (const [k, x] of Object.entries(v)) o[k] = deepCopy(x);
    return o;
  }
  return v;
}

function toJ(v: unknown): J {
  if (v instanceof JsonValue) return deepCopy(v.raw());
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    // массив символов -> строка
    if (v.every((x) => typeof x === 'number')) {
      let s = '';
      for (const c of v as number[]) { if (c === 0) break; s += String.fromCharCode(c); }
      return s;
    }
    return v.map(toJ);
  }
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o: Record<string, J> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = toJ(x);
    return o;
  }
  if (typeof v === 'object' && 'v' in (v as object)) return toJ((v as { v: unknown }).v);
  if (typeof v === 'object' && typeof (v as { toString?: () => string }).toString === 'function') return (v as { toString: () => string }).toString();
  return String(v);
}

export class JsonValue {
  constructor(protected h: Holder) {}

  raw(): J | undefined { return this.h.get(); }

  // ---- доступ к элементам ----
  get(key: unknown): JsonValue {
    const parent = this;
    const k = typeof key === 'number' ? key : String(key instanceof JsonValue ? key.asString() : key);
    return new JsonValue({
      get() {
        const p = parent.raw();
        if (p === null || p === undefined) return undefined;
        if (typeof k === 'number') return Array.isArray(p) ? p[k] : undefined;
        if (typeof p === 'object' && !Array.isArray(p)) return Object.prototype.hasOwnProperty.call(p, k) ? (p as Record<string, J>)[k] : undefined;
        return undefined;
      },
      set(v: J) {
        let p = parent.raw();
        if (typeof k === 'number') {
          if (p === null || p === undefined) { parent.h.set([]); p = parent.raw(); }
          if (!Array.isArray(p)) return false;
          if (k > p.length) return false;
          p[k] = v;
          return true;
        }
        if (p === null || p === undefined || typeof p !== 'object' || Array.isArray(p)) {
          if (Array.isArray(p)) return false;
          parent.h.set({});
          p = parent.raw();
        }
        (p as Record<string, J>)[k] = v;
        return true;
      },
    });
  }

  getMember(key: unknown): JsonValue { return this.get(String(key)); }
  getElement(i: number): JsonValue { return this.get(i); }

  set(v: unknown): boolean { return this.h.set(toJ(v)); }

  // ---- преобразования ----
  primitive(): unknown {
    const v = this.raw();
    if (v === undefined) return null;
    return v;
  }

  asNumber(): number {
    const v = this.raw();
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return 0;
  }

  asBool(): boolean {
    const v = this.raw();
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return false;
  }

  asString(): string {
    const v = this.raw();
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    return serializeRaw(v, false);
  }

  asCstr(): string | null {
    const v = this.raw();
    return typeof v === 'string' ? v : null;
  }

  as(kind: string): unknown {
    switch (kind) {
      case 'int': return Math.trunc(this.asNumber()) | 0;
      case 'char': return Math.trunc(this.asNumber()) & 255;
      case 'float': return this.asNumber();
      case 'bool': return this.asBool();
      case 'String': return this.asString();
      case 'cstr': return this.asCstr();
      case 'object': {
        const v = this.raw();
        return v && typeof v === 'object' && !Array.isArray(v) ? this : jsonNull();
      }
      case 'array': {
        const v = this.raw();
        return Array.isArray(v) ? this : jsonNull();
      }
      default: return this;
    }
  }

  is(kind: string): boolean {
    const v = this.raw();
    switch (kind) {
      case 'int': return typeof v === 'number' && Number.isInteger(v);
      case 'char': return typeof v === 'number' && Number.isInteger(v);
      case 'float': return typeof v === 'number';
      case 'bool': return typeof v === 'boolean';
      case 'String': case 'cstr': return typeof v === 'string';
      case 'object': return !!v && typeof v === 'object' && !Array.isArray(v);
      case 'array': return Array.isArray(v);
      default: return v !== undefined && v !== null;
    }
  }

  to(kind: string): JsonValue {
    this.h.set(kind === 'array' ? [] : kind === 'object' ? {} : null);
    return this;
  }

  isNull(): boolean {
    const v = this.raw();
    return v === null || v === undefined;
  }

  truthy(): boolean {
    const v = this.raw();
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return true;
  }

  or(def: unknown): unknown {
    const v = this.raw();
    if (typeof def === 'number') return typeof v === 'number' ? v : typeof v === 'boolean' ? +v : def;
    if (typeof def === 'boolean') return typeof v === 'boolean' ? v : def;
    if (typeof def === 'string' || def === null) return typeof v === 'string' ? v : def;
    if (def instanceof JsonValue) return v === null || v === undefined ? def : this;
    return v ?? def;
  }

  // ---- коллекции ----
  size(): number {
    const v = this.raw();
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') return Object.keys(v).length;
    return 0;
  }

  containsKey(k: unknown): boolean {
    const v = this.raw();
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, String(k));
  }

  add(val?: unknown): JsonValue | boolean {
    let v = this.raw();
    if (v === null || v === undefined) { this.h.set([]); v = this.raw(); }
    if (!Array.isArray(v)) return false;
    if (val === undefined) {
      v.push(null);
      return this.get(v.length - 1);
    }
    v.push(toJ(val));
    return true;
  }

  addNested(kind: string): JsonValue {
    let v = this.raw();
    if (v === null || v === undefined) { this.h.set([]); v = this.raw(); }
    if (!Array.isArray(v)) return jsonNull();
    v.push(kind === 'array' ? [] : kind === 'object' ? {} : null);
    return this.get(v.length - 1);
  }

  createNestedObject(key?: unknown): JsonValue {
    if (key === undefined) return this.addNested('object');
    const c = this.get(key);
    c.set({});
    return c;
  }

  createNestedArray(key?: unknown): JsonValue {
    if (key === undefined) return this.addNested('array');
    const c = this.get(key);
    c.set([]);
    return c;
  }

  remove(k: unknown): void {
    const v = this.raw();
    if (Array.isArray(v) && typeof k === 'number') v.splice(k, 1);
    else if (v && typeof v === 'object' && !Array.isArray(v)) delete (v as Record<string, J>)[String(k)];
  }

  clear(): void {
    const v = this.raw();
    if (Array.isArray(v)) v.length = 0;
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) delete (v as Record<string, J>)[k];
    else this.h.set(null);
  }

  isEmpty(): boolean { return this.size() === 0; }
  memoryUsage(): number { return serializeRaw(this.raw() ?? null, false).length * 2; }
  overflowed(): boolean { return false; }
  shrinkToFit(): void { /* ничего */ }
  garbageCollect(): boolean { return true; }
  nesting(): number {
    const depth = (x: J | undefined): number => (Array.isArray(x) ? 1 + Math.max(0, ...x.map(depth)) : x && typeof x === 'object' ? 1 + Math.max(0, ...Object.values(x).map(depth)) : 0);
    return depth(this.raw());
  }
  capacity(): number { return 4096; }
  c_str(): string | null { return this.asCstr(); }

  *iterate(): Generator<unknown> {
    const v = this.raw();
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) yield this.get(i);
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) yield new JsonPair(k, this.get(k));
    }
  }

  toPrintString(): string {
    const v = this.raw();
    if (typeof v === 'string') return v;
    if (v === undefined) return 'null';
    return serializeRaw(v, false);
  }

  toString(): string { return this.toPrintString(); }
}

export class JsonPair {
  constructor(private k: string, private v: JsonValue) {}
  key(): string { return this.k; }
  value(): JsonValue { return this.v; }
}

/** Корневой документ. */
export class JsonDocument extends JsonValue {
  private store: { v: J } ;
  constructor(_capacity?: number) {
    const store = { v: null as J };
    super({ get: () => store.v, set: (v: J) => { store.v = v; return true; } });
    this.store = store;
  }
  clear(): void { this.store.v = null; }
}

export function jsonOf(v: unknown): JsonValue {
  if (v instanceof JsonValue) return v;
  const d = new JsonDocument();
  d.set(v);
  return d;
}

export function jsonNull(): JsonValue {
  return new JsonValue({ get: () => null, set: () => false });
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return 'null';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(9)));
}

export function serializeRaw(v: J, pretty: boolean, indent = ''): string {
  if (v === null) return 'null';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  const nl = pretty ? '\n' : '';
  const ind = pretty ? indent + '  ' : '';
  const sep = pretty ? ': ' : ':';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return `[${nl}${v.map((x) => ind + serializeRaw(x, pretty, ind)).join(',' + nl)}${nl}${indent}]`;
  }
  const keys = Object.keys(v);
  if (!keys.length) return '{}';
  return `{${nl}${keys.map((k) => `${ind}${JSON.stringify(k)}${sep}${serializeRaw(v[k], pretty, ind)}`).join(',' + nl)}${nl}${indent}}`;
}

export function serializeJson(doc: JsonValue, pretty: boolean): string {
  if (!(doc instanceof JsonValue)) return 'null';
  return serializeRaw(doc.raw() ?? null, pretty);
}

export class DeserializationError {
  static NAMES = ['Ok', 'EmptyInput', 'IncompleteInput', 'InvalidInput', 'NoMemory', 'TooDeep'];
  constructor(public codeNum: number) {}
  code(): number { return this.codeNum; }
  c_str(): string { return DeserializationError.NAMES[this.codeNum] ?? 'Unknown'; }
  f_str(): string { return this.c_str(); }
  __bool(): boolean { return this.codeNum !== 0; }
  valueOf(): number { return this.codeNum; }
  toString(): string { return this.c_str(); }
}

export function parseJsonInto(doc: JsonValue, input: unknown, length?: number): DeserializationError {
  let text: string;
  if (typeof input === 'string') text = input;
  else if (Array.isArray(input)) {
    const n = length ?? input.length;
    text = '';
    for (let i = 0; i < Math.min(n, input.length); i++) {
      const c = input[i] as number;
      if (length === undefined && c === 0) break;
      text += String.fromCharCode(c);
    }
  } else if (input instanceof JsonValue) text = input.asString();
  else if (input && typeof input === 'object' && typeof (input as { readAll?: () => string }).readAll === 'function') text = (input as { readAll: () => string }).readAll();
  else text = String(input ?? '');
  // UTF-8 байты -> строка
  try { text = decodeURIComponent(escape(text)); } catch { /* уже строка JS */ }
  const t = text.trim();
  if (!t) { doc.set(null); return new DeserializationError(1); }
  try {
    const v = JSON.parse(t) as J;
    doc.set(null);
    (doc as JsonValue).set(v);
    return new DeserializationError(0);
  } catch {
    // неполный или неверный ввод
    let depth = 0;
    let inStr = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
    }
    doc.set(null);
    return new DeserializationError(depth > 0 || inStr ? 2 : 3);
  }
}
