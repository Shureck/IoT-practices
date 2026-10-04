// Транслятор: AST C++ -> JavaScript (функции-генераторы).
// Все пользовательские функции становятся function*, блокирующие вызовы
// (delay, HTTP…) выполняются через yield*, что позволяет симулятору
// управлять виртуальным временем, не блокируя браузер.
import type {
  Block, ClassDecl, Declarator, EnumDecl, Expr, FuncDecl, Param, Program, Stmt, TypeSpec, VarDecl,
} from './ast';
import { CompileError } from './lexer';
import { preprocess } from './preprocess';
import { parse } from './parser';
import { HANDLE_TYPES, LIB_TYPES, TYPE_HEADER } from './known';
import {
  CLASSES, CONSTS, FUNCS, GLOBAL_OBJECTS, HEADER_HINTS, JSON_DOC_TYPES, JSON_METHODS, JSON_TYPES, KNOWN_HEADERS,
  SPECIAL_FUNCS,
} from './api';
import {
  T, arith, intWrap, isCharArr, isFloat, isInt, isNumeric, sizeOf, suggest, tyFromName, tyName, type Ty,
} from './types';

export interface Diag {
  line: number;
  col: number;
  message: string;
  hint?: string;
  severity: 'error' | 'warning';
}

export interface CompileOutput {
  ok: boolean;
  js?: string;
  diagnostics: Diag[];
  includes: string[];
  /** использованные возможности — подсказки UI */
  features: Set<string>;
}

interface Sym {
  name: string;
  js: string;
  ty: Ty;
  kind: 'var' | 'param' | 'global' | 'const' | 'enum' | 'libobj' | 'field' | 'static' | 'func';
  isRef?: boolean;
  isConst?: boolean;
  constVal?: number;
  declLine?: number;
}

interface FuncSig {
  name: string;
  js: string;
  ret: Ty;
  params: { name: string; ty: Ty; isRef: boolean; hasDef: boolean }[];
  line: number;
  decl?: FuncDecl;
  isStatic?: boolean;
}

interface ClassInfo {
  name: string;
  js: string;
  base?: string;
  decl: ClassDecl;
  fields: Map<string, { ty: Ty; init?: Expr; decl: Declarator; spec: TypeSpec }>;
  fieldOrder: string[];
  methods: Map<string, FuncSig[]>;
  ctors: FuncSig[];
  outOfClass: FuncDecl[];
}

interface R {
  c: string;
  t: Ty;
  /** выражение можно использовать слева от '=' */
  lv?: LV;
  /** известное на этапе компиляции значение */
  k?: number;
  /** результат — «временный» (не нужно клонировать структуру) */
  tmp?: boolean;
}

type LV =
  | { kind: 'plain'; code: string; sym?: Sym }
  | { kind: 'index'; obj: string; idx: string }
  | { kind: 'strch'; base: LV; idx: string }
  | { kind: 'json'; code: string }
  | { kind: 'readonly'; why: string };

const MAX_ERRORS = 12;
const OPS_CHECK = 'if(++M.ops>4096)yield 0;';

class Fatal extends Error {}

export function compileSketch(src: string): CompileOutput {
  const c = new Compiler();
  return c.run(src);
}

class Compiler {
  diags: Diag[] = [];
  includes: string[] = [];
  features = new Set<string>();
  scopes: Map<string, Sym>[] = [];
  globals = new Map<string, Sym>();
  funcs = new Map<string, FuncSig[]>();
  classes = new Map<string, ClassInfo>();
  typedefs = new Map<string, TypeSpec>();
  enumTypes = new Set<string>();
  scopedEnums = new Map<string, Map<string, number>>();
  statics: string[] = [];
  staticCounter = 0;
  tmpCounter = 0;
  out: string[] = [];
  // контекст текущей функции
  fn: { ret: Ty; cls?: ClassInfo; line: number; lambdaRets?: Ty[]; isStaticMethod?: boolean } | null = null;
  loopDepth = 0;
  switchDepth = 0;
  inIsrHint = false;

  // ---------- диагностика ----------
  error(message: string, at: { line: number; col?: number }, hint?: string): never {
    throw new CompileError(message, at.line, at.col ?? 1, hint);
  }

  warn(message: string, at: { line: number; col?: number }, hint?: string): void {
    if (this.diags.some((d) => d.line === at.line && d.message === message)) return;
    this.diags.push({ line: at.line, col: at.col ?? 1, message, hint, severity: 'warning' });
  }

  record(e: unknown): void {
    if (e instanceof CompileError) {
      if (!this.diags.some((d) => d.line === e.line && d.message === e.message)) {
        this.diags.push({ line: e.line, col: e.col, message: e.message, hint: e.hint, severity: 'error' });
      }
      if (this.diags.filter((d) => d.severity === 'error').length >= MAX_ERRORS) throw new Fatal();
      return;
    }
    throw e;
  }

  // ---------- точка входа ----------
  run(src: string): CompileOutput {
    let prog: Program;
    try {
      const pp = preprocess(src);
      this.includes = pp.includes.map((i) => i.name);
      for (const inc of pp.includes) {
        if (!KNOWN_HEADERS.has(inc.name)) {
          this.diags.push({
            line: inc.line, col: 1, severity: HEADER_HINTS[inc.name] ? 'error' : 'warning',
            message: `Библиотека ${inc.name} не поддерживается симулятором`,
            hint: HEADER_HINTS[inc.name] ?? 'Код, использующий её, может не работать в симуляторе',
          });
        }
      }
      prog = parse(pp.tokens, [...JSON_TYPES]);
    } catch (e) {
      if (e instanceof CompileError) {
        return { ok: false, diagnostics: [{ line: e.line, col: e.col, message: e.message, hint: e.hint, severity: 'error' }], includes: this.includes, features: this.features };
      }
      throw e;
    }
    try {
      this.compileProgram(prog);
    } catch (e) {
      if (!(e instanceof Fatal)) {
        if (e instanceof CompileError) this.record(e);
        else throw e;
      }
    }
    const ok = !this.diags.some((d) => d.severity === 'error');
    this.diags.sort((a, b) => a.line - b.line);
    return { ok, js: ok ? this.out.join('\n') : undefined, diagnostics: this.diags, includes: this.includes, features: this.features };
  }

  hasInclude(...names: string[]): boolean {
    return names.some((n) => this.includes.includes(n));
  }

  // ---------- типы ----------
  resolveType(spec: TypeSpec, d?: { ptr: number; ref: boolean }): Ty {
    let base = spec.base;
    const ptr = spec.ptr + (d?.ptr ?? 0);
    const td = this.typedefs.get(base);
    if (td) {
      const inner = this.resolveType({ ...td, ptr: td.ptr + ptr, ref: td.ref || spec.ref, isConst: spec.isConst || td.isConst });
      return inner;
    }
    if (base === '__fnptr') {
      const ret = spec.tmpl?.[0];
      return { k: 'fn', ret: ret && typeof ret !== 'number' ? this.resolveType(ret) : T.any };
    }
    if (this.enumTypes.has(base)) base = 'int32';
    if (JSON_TYPES.has(base)) {
      this.needHeader(base, spec.line);
      return T.json;
    }
    if (base === 'std::vector' || base === 'std::array' || base === 'std::function') {
      this.error(`${base} не поддерживается симулятором`, spec, 'Используйте обычный массив: int values[10];');
    }
    if (base === 'Stream' || base === 'Print' || base === 'auto') return T.any;
    const prim = tyFromName(base === 'int32' ? 'int32' : base);
    if (prim.k !== 'cls') {
      if (ptr > 0) {
        // char* / const char* — строка; byte* / int* — «массив»
        if (prim.k === 'int' && prim.ch) return ptr > 1 ? { k: 'arr', of: T.cstr, n: null } : T.cstr;
        if (prim.k === 'void') return T.any;
        if (prim.k === 'String') return T.String;
        return { k: 'arr', of: prim, n: null };
      }
      return prim;
    }
    if (this.classes.has(base)) return { k: 'cls', name: base, user: true };
    if (LIB_TYPES.has(base) || CLASSES[base]) {
      this.needHeader(base, spec.line);
      return { k: 'cls', name: base };
    }
    this.error(`Неизвестный тип «${base}»`, spec);
  }

  needHeader(type: string, line: number): void {
    const hdrs = TYPE_HEADER[type];
    if (!hdrs || this.hasInclude(...hdrs)) return;
    const jsonLike = JSON_TYPES.has(type);
    this.error(`Тип ${type} не объявлен`, { line }, `Подключите библиотеку: #include <${jsonLike ? 'ArduinoJson.h' : hdrs[0]}>`);
  }

  structSize = (name: string): number => {
    const ci = this.classes.get(name);
    if (!ci) return 4;
    let s = 0;
    for (const f of ci.fields.values()) {
      const sz = sizeOf(f.ty, this.structSize);
      const al = Math.min(4, Math.max(1, f.ty.k === 'arr' ? sizeOf(f.ty.of, this.structSize) : sz));
      s = Math.ceil(s / al) * al + sz;
    }
    return Math.ceil(s / 4) * 4 || 1;
  };

  defaultValue(t: Ty): string {
    switch (t.k) {
      case 'bool': return 'false';
      case 'int': case 'float': return '0';
      case 'String': return '""';
      case 'cstr': return 'null';
      case 'json': return 'new L.JsonDocument()';
      case 'cls': {
        if (t.user) return `(yield* $${t.name}.$new())`;
        return this.libCtor(t.name, [], 0);
      }
      default: return 'null';
    }
  }

  libCtor(name: string, args: string[], line: number): string {
    if (HANDLE_TYPES.has(name) || name === 'portMUX_TYPE') return 'null';
    if (name === 'HardwareSerial') {
      return `L.serialPort(${args[0] ?? 0})`;
    }
    if (!CLASSES[name] && !LIB_TYPES.has(name)) this.error(`Неизвестный класс ${name}`, { line });
    if (name === 'WiFiClass' || name === 'EspClass' || name === 'GpioRegs' || name === 'TwoWire' || name === 'SPIClass') {
      this.error(`Объект ${name} уже существует — используйте глобальный (${name === 'TwoWire' ? 'Wire' : name === 'SPIClass' ? 'SPI' : name})`, { line });
    }
    return `new L.${name}(${args.join(', ')})`;
  }

  // ---------- области видимости ----------
  push(): void { this.scopes.push(new Map()); }
  pop(): void { this.scopes.pop(); }

  declare(sym: Sym, at: { line: number; col?: number }): void {
    const top = this.scopes[this.scopes.length - 1];
    if (top.has(sym.name)) this.error(`Переменная «${sym.name}» уже объявлена в этом блоке`, at);
    top.set(sym.name, sym);
  }

  lookup(name: string, at: { line: number; col?: number }): Sym | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i].get(name);
      if (s) return s;
    }
    if (this.fn?.cls && !this.fn.isStaticMethod) {
      let ci: ClassInfo | undefined = this.fn.cls;
      while (ci) {
        const f = ci.fields.get(name);
        if (f) return { name, js: `this.$${name}`, ty: f.ty, kind: 'field' };
        ci = ci.base ? this.classes.get(ci.base) : undefined;
      }
    }
    const g = this.globals.get(name);
    if (g) {
      if (g.declLine !== undefined && this.fn && g.declLine > this.fn.line && g.kind !== 'func') {
        this.error(`«${name}» используется до объявления (объявлено в строке ${g.declLine})`, at,
          'В C++ глобальную переменную нужно объявить выше функции, которая её использует');
      }
      return g;
    }
    return null;
  }

  allNames(): string[] {
    const names = new Set<string>();
    for (const s of this.scopes) for (const k of s.keys()) names.add(k);
    for (const k of this.globals.keys()) names.add(k);
    for (const k of this.funcs.keys()) names.add(k);
    for (const k of Object.keys(FUNCS)) names.add(k);
    for (const k of Object.keys(CONSTS)) names.add(k);
    for (const k of Object.keys(GLOBAL_OBJECTS)) names.add(k);
    for (const k of SPECIAL_FUNCS) names.add(k);
    return [...names];
  }

  // ---------- программа ----------
  compileProgram(prog: Program): void {
    this.push(); // глобальная область — для enum-констант и т.п.
    // 1. типы: typedef, enum, классы
    for (const it of prog.items) {
      try {
        if (it.kind === 'typedef') this.typedefs.set(it.name, it.type);
        else if (it.kind === 'enum') this.declareEnum(it);
        else if (it.kind === 'class') this.declareClass(it);
      } catch (e) { this.record(e); }
    }
    for (const it of prog.items) {
      try { if (it.kind === 'class') this.declareClassMembers(this.classes.get(it.name)!); } catch (e) { this.record(e); }
    }
    // 2. сигнатуры функций (Arduino сам генерирует прототипы)
    for (const it of prog.items) {
      if (it.kind !== 'func') continue;
      try {
        if (it.owner) {
          const ci = this.classes.get(it.owner);
          if (!ci) this.error(`Неизвестный класс ${it.owner}`, it);
          ci.outOfClass.push(it);
          continue;
        }
        this.declareFunc(it);
      } catch (e) { this.record(e); }
    }
    for (const ci of this.classes.values()) {
      for (const f of ci.outOfClass) {
        try { this.attachOutOfClass(ci, f); } catch (e) { this.record(e); }
      }
    }
    const setup = this.funcs.get('setup');
    const loop = this.funcs.get('loop');
    if (!setup?.some((f) => f.decl?.body)) this.diags.push({ line: 1, col: 1, severity: 'error', message: 'В скетче нет функции void setup()', hint: 'Добавьте: void setup() { … }' });
    if (!loop?.some((f) => f.decl?.body)) this.diags.push({ line: 1, col: 1, severity: 'error', message: 'В скетче нет функции void loop()', hint: 'Добавьте: void loop() { … }' });

    const head: string[] = ['"use strict";', 'let __t, __t2;'];
    const init: string[] = [];
    const body: string[] = [];
    // 3. глобальные переменные и функции в порядке объявления
    for (const it of prog.items) {
      try {
        if (it.kind === 'var') this.globalVar(it, head, init);
        else if (it.kind === 'class') body.push(this.emitClass(this.classes.get(it.name)!));
        else if (it.kind === 'func' && !it.owner && it.body) body.push(this.emitFunc(it));
      } catch (e) { this.record(e); }
    }
    this.out.push(...head, ...this.statics, ...body);
    this.out.push('function* __init(){', ...init, '}');
    this.out.push(`return { init: __init, setup: typeof $setup === "function" ? $setup : null, loop: typeof $loop === "function" ? $loop : null };`);
  }

  declareEnum(e: EnumDecl, scopeOverride?: Map<string, Sym>): void {
    let next = 0;
    const members = new Map<string, number>();
    for (const m of e.members) {
      let v = next;
      if (m.value) {
        const r = this.constEval(m.value);
        if (r === null) this.error(`Значение элемента enum ${m.name} должно быть константой`, m);
        v = r;
      }
      members.set(m.name, v);
      next = v + 1;
      if (!e.scoped) {
        const sym: Sym = { name: m.name, js: String(v), ty: T.i32, kind: 'enum', constVal: v, isConst: true };
        (scopeOverride ?? this.globals).set(m.name, sym);
      }
    }
    if (e.name) {
      this.enumTypes.add(e.name);
      this.scopedEnums.set(e.name, members);
    }
  }

  constEval(e: Expr): number | null {
    switch (e.kind) {
      case 'num': return e.v;
      case 'chr': return e.v;
      case 'bool': return e.v ? 1 : 0;
      case 'id': {
        const g = this.globals.get(e.name) ?? this.scopes[this.scopes.length - 1]?.get(e.name);
        if (g?.constVal !== undefined) return g.constVal;
        const c = CONSTS[e.name];
        if (c && typeof c[0] === 'number') return c[0];
        return null;
      }
      case 'scoped': {
        const m = this.scopedEnums.get(e.scope)?.get(e.name);
        return m ?? null;
      }
      case 'unary': {
        const x = this.constEval(e.x);
        if (x === null) return null;
        if (e.op === '-') return -x;
        if (e.op === '+') return x;
        if (e.op === '~') return ~x;
        if (e.op === '!') return x ? 0 : 1;
        return null;
      }
      case 'binary': {
        const a = this.constEval(e.a);
        const b = this.constEval(e.b);
        if (a === null || b === null) return null;
        switch (e.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': return b === 0 ? null : Number.isInteger(a) && Number.isInteger(b) ? Math.trunc(a / b) : a / b;
          case '%': return b === 0 ? null : a % b;
          case '<<': return a << b;
          case '>>': return a >> b;
          case '&': return a & b;
          case '|': return a | b;
          case '^': return a ^ b;
          default: return null;
        }
      }
      case 'cast': return this.constEval(e.x);
      case 'sizeof': return null;
      default: return null;
    }
  }

  declareClass(c: ClassDecl): void {
    if (this.classes.has(c.name)) this.error(`Класс ${c.name} уже объявлен`, c);
    this.classes.set(c.name, {
      name: c.name, js: `$${c.name}`, base: c.base, decl: c, fields: new Map(), fieldOrder: [], methods: new Map(), ctors: [], outOfClass: [],
    });
  }

  declareClassMembers(ci: ClassInfo): void {
    if (ci.base && !this.classes.has(ci.base)) this.error(`Базовый класс ${ci.base} не найден`, ci.decl);
    for (const f of ci.decl.fields) {
      for (const d of f.decls) {
        const ty = this.declTy(f.type, d);
        ci.fields.set(d.name, { ty, init: d.init, decl: d, spec: f.type });
        ci.fieldOrder.push(d.name);
      }
    }
    for (const m of ci.decl.methods) this.declareMethod(ci, m);
  }

  declareMethod(ci: ClassInfo, m: FuncDecl): void {
    const sig = this.sigOf(m);
    if (m.isCtor) {
      sig.js = `$ctor${ci.ctors.length}`;
      ci.ctors.push(sig);
      return;
    }
    const list = ci.methods.get(m.name) ?? [];
    const existing = list.find((s) => s.params.length === sig.params.length);
    if (existing) {
      if (m.body && !existing.decl?.body) { existing.decl = m; return; }
      if (m.body && existing.decl?.body) this.error(`Метод ${ci.name}::${m.name} уже определён`, m);
      return;
    }
    sig.js = list.length ? `$${m.name}__${list.length}` : `$${m.name}`;
    sig.isStatic = m.isStatic;
    list.push(sig);
    ci.methods.set(m.name, list);
  }

  attachOutOfClass(ci: ClassInfo, f: FuncDecl): void {
    if (f.isCtor || f.name === ci.name) {
      const sig = ci.ctors.find((s) => s.params.length === f.params.length);
      if (sig) { sig.decl = f; return; }
      this.declareMethod(ci, { ...f, isCtor: true });
      return;
    }
    const list = ci.methods.get(f.name);
    const sig = list?.find((s) => s.params.length === f.params.length);
    if (!sig) this.error(`В классе ${ci.name} нет объявления метода ${f.name}`, f);
    sig.decl = f;
  }

  sigOf(f: FuncDecl): FuncSig {
    const ret = f.isCtor ? T.void : this.resolveType(f.ret);
    const params = f.params.map((p) => {
      const ty = this.paramTy(p);
      const isRef = p.type.ref && !p.type.isConst && (ty.k === 'int' || ty.k === 'float' || ty.k === 'bool' || ty.k === 'String' || ty.k === 'cstr');
      return { name: p.name, ty, isRef, hasDef: !!p.def };
    });
    return { name: f.name, js: `$${f.name}`, ret, params, line: f.line, decl: f };
  }

  paramTy(p: Param): Ty {
    const ty = this.resolveType(p.type);
    if (p.dims.length) {
      let t: Ty = ty;
      for (let i = p.dims.length - 1; i >= 0; i--) t = { k: 'arr', of: t, n: null };
      return t;
    }
    return ty;
  }

  declareFunc(f: FuncDecl): void {
    if (f.name === 'main') this.error('В Arduino не нужна функция main() — используйте setup() и loop()', f);
    if (FUNCS[f.name] && !['setup', 'loop'].includes(f.name)) {
      this.warn(`Функция ${f.name} перекрывает встроенную функцию Arduino`, f);
    }
    const sig = this.sigOf(f);
    const list = this.funcs.get(f.name) ?? [];
    const same = list.find((s) => s.params.length === sig.params.length);
    if (same) {
      if (f.body && same.decl?.body) this.error(`Функция ${f.name} уже определена (строка ${same.line})`, f);
      if (f.body) { same.decl = f; same.line = f.line; }
      return;
    }
    if (list.length) sig.js = `$${f.name}__${sig.params.length}`;
    list.push(sig);
    this.funcs.set(f.name, list);
    if (!this.globals.has(f.name)) this.globals.set(f.name, { name: f.name, js: sig.js, ty: { k: 'fn', ret: sig.ret }, kind: 'func' });
    if ((f.name === 'setup' || f.name === 'loop') && (sig.params.length || sig.ret.k !== 'void')) {
      this.error(`Функция ${f.name} должна быть объявлена как void ${f.name}()`, f);
    }
  }

  declTy(spec: TypeSpec, d: Declarator): Ty {
    let ty = this.resolveType(spec, d);
    for (let i = d.dims.length - 1; i >= 0; i--) {
      const dim = d.dims[i];
      let n: number | null = null;
      if (dim) {
        n = this.constEval(dim);
        if (n === null) {
          // размер — выражение, известное только при выполнении (например, const int N = 5 → constEval не видит локальные)
          n = null;
        } else if (n <= 0) this.error('Размер массива должен быть больше нуля', d);
        else if (n > 100000) this.error('Слишком большой массив для ESP32', d);
      }
      ty = { k: 'arr', of: ty, n };
    }
    return ty;
  }

  // ---------- глобальные переменные ----------
  globalVar(v: VarDecl, head: string[], init: string[]): void {
    for (const d of v.decls) {
      const ty0 = this.declTy(v.type, d);
      if (this.globals.has(d.name) && this.globals.get(d.name)!.kind !== 'enum') {
        const prev = this.globals.get(d.name)!;
        this.error(`«${d.name}» уже объявлено${prev.declLine ? ` в строке ${prev.declLine}` : ''}`, d);
      }
      if (this.funcs.has(d.name)) this.error(`Имя «${d.name}» уже занято функцией`, d);
      const js = `$${d.name}`;
      this.fn = { ret: T.void, line: d.line };
      let ty = ty0;
      let initCode: string;
      try {
        ({ ty, code: initCode } = this.varInit(v.type, ty0, d));
      } finally {
        this.fn = null;
      }
      const isConst = !!v.type.isConst && ty.k !== 'cstr';
      let constVal: number | undefined;
      if (isConst && d.init && (ty.k === 'int' || ty.k === 'float' || ty.k === 'bool')) {
        const k = this.constEval(d.init);
        if (k !== null) constVal = ty.k === 'int' ? Math.trunc(k) : k;
      }
      head.push(`let ${js};`);
      init.push(`M.L=${d.line};${js} = ${initCode};`);
      this.globals.set(d.name, { name: d.name, js, ty, kind: 'global', isConst, constVal, declLine: d.line });
    }
  }

  /** Код инициализации переменной (с учётом массивов, конструкторов, auto). */
  varInit(spec: TypeSpec, ty: Ty, d: Declarator): { ty: Ty; code: string } {
    if (ty.k === 'any' && spec.base === 'auto') {
      if (!d.init) this.error('Переменная auto должна быть инициализирована', d);
      const r = this.ex(d.init);
      let t = r.t;
      if (t.k === 'null') t = T.any;
      return { ty: t, code: t.k === 'cls' && t.user && !r.tmp ? `${r.c}.$clone()` : r.c };
    }
    if (ty.k === 'arr') return { ty: ty, code: this.arrayInit(ty, d) };
    if (d.ctorArgs) {
      if (ty.k === 'cls') return { ty, code: this.construct(ty, d.ctorArgs, d) };
      if (ty.k === 'json') {
        const args = d.ctorArgs.map((a) => this.ex(a).c);
        return { ty, code: JSON_DOC_TYPES.has(spec.base) || this.typedefs.has(spec.base) ? `new L.JsonDocument(${args.join(', ')})` : `L.jsonOf(${args[0] ?? 'null'})` };
      }
      if (d.ctorArgs.length === 1) return { ty, code: this.coerce(this.ex(d.ctorArgs[0]), ty, d) };
      if (d.ctorArgs.length === 0) return { ty, code: this.defaultValue(ty) };
      this.error('Неверная инициализация переменной', d);
    }
    if (!d.init) {
      if (ty.k === 'json' && !JSON_DOC_TYPES.has(spec.base)) return { ty, code: 'L.jsonNull()' };
      if (ty.k === 'cls' && spec.ptr + d.ptr > 0) return { ty, code: 'null' };
      return { ty, code: this.defaultValue(ty) };
    }
    if (d.init.kind === 'initlist') {
      if (ty.k === 'cls') return { ty, code: this.construct(ty, d.init.items, d, true) };
      if (d.init.items.length === 1) return { ty, code: this.coerce(this.ex(d.init.items[0]), ty, d) };
      if (d.init.items.length === 0) return { ty, code: this.defaultValue(ty) };
      this.error('Список инициализации {…} подходит только для массивов и структур', d);
    }
    if (ty.k === 'cls' && !ty.user && (d.init.kind === 'fcast' || d.init.kind === 'call') && d.init.kind === 'fcast' && d.init.type.base === ty.name) {
      return { ty, code: this.ex(d.init).c };
    }
    const r = this.ex(d.init);
    if (ty.k === 'float' && d.init.kind === 'binary' && d.init.op === '/' && isInt(this.ex(d.init.a).t) && isInt(this.ex(d.init.b).t)) {
      this.warn('Целочисленное деление: дробная часть будет отброшена до записи во float', d.init,
        'Чтобы получить дробный результат, сделайте одно из чисел дробным: 5.0 / 2');
    }
    return { ty, code: this.coerce(r, ty, d) };
  }

  arrayInit(ty: Extract<Ty, { k: 'arr' }>, d: Declarator): string {
    const dims: string[] = [];
    let t: Ty = ty;
    const dimExprs = d.dims;
    let level = 0;
    while (t.k === 'arr') {
      const de = dimExprs[level];
      if (t.n !== null) dims.push(String(t.n));
      else if (de) {
        const r = this.ex(de);
        if (!isInt(r.t)) this.error('Размер массива должен быть целым числом', d);
        dims.push(r.c);
      } else dims.push('null');
      t = t.of;
      level++;
    }
    const elem = t;
    const fill = this.elemFactory(elem);
    if (d.init) {
      if (d.init.kind === 'str' && elem.k === 'int' && elem.bits === 8 && dims.length === 1) {
        if (ty.n !== null && d.init.v.length + 1 > ty.n) this.error(`Строка "${d.init.v}" не помещается в массив из ${ty.n} символов (нужно ещё место под \\0)`, d);
        return `R.charArr(${JSON.stringify(d.init.v)}, ${dims[0]})`;
      }
      if (d.init.kind !== 'initlist') this.error('Массив инициализируется списком в фигурных скобках: {1, 2, 3}', d);
      const lit = this.initListCode(d.init, ty);
      return `${fill.gen ? '(yield* ' : ''}R.arrInit${fill.gen ? 'G' : ''}(${lit}, [${dims.join(', ')}], ${fill.code})${fill.gen ? ')' : ''}`;
    }
    if (dims.includes('null')) this.error('У массива без инициализатора должен быть указан размер', d);
    return `${fill.gen ? '(yield* ' : ''}R.arr${fill.gen ? 'G' : ''}([${dims.join(', ')}], ${fill.code})${fill.gen ? ')' : ''}`;
  }

  elemFactory(t: Ty): { code: string; gen: boolean } {
    if (t.k === 'cls' && t.user) return { code: `function*(){ return yield* $${t.name}.$new(); }`, gen: true };
    if (t.k === 'cls') return { code: `() => ${this.libCtor(t.name, [], 0)}`, gen: false };
    if (t.k === 'json') return { code: '() => new L.JsonDocument()', gen: false };
    return { code: `() => ${this.defaultValue(t)}`, gen: false };
  }

  initListCode(e: Expr, ty: Ty): string {
    if (ty.k === 'arr') {
      if (e.kind === 'str' && ty.of.k === 'int' && ty.of.bits === 8) return `R.charArr(${JSON.stringify(e.v)}, ${ty.n ?? 'null'})`;
      if (e.kind !== 'initlist') this.error('Ожидался список значений {…}', e);
      if (ty.n !== null && e.items.length > ty.n) this.error(`Слишком много значений: массив рассчитан на ${ty.n}`, e);
      return `[${e.items.map((it) => this.initListCode(it, ty.of)).join(', ')}]`;
    }
    if (ty.k === 'cls' && ty.user && e.kind === 'initlist') return this.construct(ty, e.items, e, true);
    return this.coerce(this.ex(e), ty, e);
  }

  /** Создание объекта класса с аргументами конструктора. */
  construct(ty: Extract<Ty, { k: 'cls' }>, args: Expr[], at: { line: number; col?: number }, brace = false): string {
    if (ty.user) {
      const ci = this.classes.get(ty.name)!;
      if (ci.ctors.length) {
        const sig = this.pickOverload(ci.ctors, args.length, `${ty.name}`, at);
        const codes = this.callArgs(sig, args, at);
        return `(yield* $${ty.name}.$new(${JSON.stringify(sig.js)}${codes.length ? ', ' + codes.join(', ') : ''}))`;
      }
      if (!brace && args.length) this.error(`У структуры ${ty.name} нет конструктора — используйте {…}`, at);
      if (args.length > ci.fieldOrder.length) this.error(`Слишком много значений для ${ty.name}`, at);
      const codes = args.map((a, i) => {
        const f = ci.fields.get(ci.fieldOrder[i])!;
        if (a.kind === 'initlist') {
          if (f.ty.k === 'arr') return `R.arrInit(${this.initListCode(a, f.ty)}, [${f.ty.n ?? 'null'}], ${this.elemFactory(f.ty.of).code})`;
          if (f.ty.k === 'cls' && f.ty.user) return this.construct(f.ty, a.items, a, true);
        }
        return this.coerce(this.ex(a), f.ty, a);
      });
      return `(yield* $${ty.name}.$agg(${codes.join(', ')}))`;
    }
    const codes = args.map((a) => {
      const r = this.ex(a);
      if (r.t.k === 'fn' || r.t.k === 'cls' || r.t.k === 'json' || r.t.k === 'any') return r.c;
      if (isCharArr(r.t)) return `R.cs(${r.c})`;
      return r.c;
    });
    return this.libCtor(ty.name, codes, at.line);
  }

  pickOverload(list: FuncSig[], n: number, name: string, at: { line: number; col?: number }): FuncSig {
    const fit = list.filter((s) => n <= s.params.length && n >= s.params.filter((p) => !p.hasDef).length);
    if (fit.length) return fit.find((s) => s.params.length === n) ?? fit[0];
    const exp = list.map((s) => s.params.length).join(' или ');
    this.error(`${name}: неверное число аргументов (передано ${n}, ожидается ${exp})`, at);
  }

  // ---------- классы ----------
  emitClass(ci: ClassInfo): string {
    const lines: string[] = [];
    const ext = ci.base ? ` extends $${ci.base}` : '';
    lines.push(`class ${ci.js}${ext} {`);
    // конструктор JS: значения по умолчанию (без вызова пользовательских конструкторов)
    lines.push(`constructor(){${ci.base ? 'super();' : ''}`);
    for (const name of ci.fieldOrder) {
      const f = ci.fields.get(name)!;
      lines.push(`this.$${name} = ${this.syncDefault(f.ty)};`);
    }
    lines.push('}');
    // инициализаторы полей (могут вызывать функции) и вложенные структуры
    this.fn = { ret: T.void, cls: ci, line: ci.decl.line };
    this.push();
    try {
      lines.push('*$fieldInit(){');
      if (ci.base) lines.push(`yield* super.$fieldInit();`);
      for (const name of ci.fieldOrder) {
        const f = ci.fields.get(name)!;
        if (f.init || f.decl.ctorArgs || (f.ty.k === 'cls' && f.ty.user) || f.ty.k === 'arr') {
          const { code } = this.varInit(f.spec, f.ty, f.decl);
          lines.push(`this.$${name} = ${code};`);
        }
      }
      lines.push('}');
    } finally {
      this.pop();
      this.fn = null;
    }
    lines.push(`static *$new(ctor, ...a){ const o = new ${ci.js}(); yield* o.$fieldInit(); if (ctor) yield* o[ctor](...a); else if (o.$ctor0 && o.$ctor0.length === 0) yield* o.$ctor0(); return o; }`);
    lines.push(`static *$agg(...a){ const o = new ${ci.js}(); yield* o.$fieldInit(); const k = ${JSON.stringify(ci.fieldOrder.map((n) => `$${n}`))}; for (let i = 0; i < a.length; i++) o[k[i]] = a[i]; return o; }`);
    lines.push(`$clone(){ const o = new ${ci.js}(); for (const k of Object.keys(this)) o[k] = R.clone(this[k]); return o; }`);
    for (const ctor of ci.ctors) {
      if (!ctor.decl?.body) {
        lines.push(`*${ctor.js}(){}`);
        continue;
      }
      lines.push(this.emitFunc(ctor.decl, ci, ctor));
    }
    for (const list of ci.methods.values()) {
      for (const sig of list) {
        if (!sig.decl?.body) this.error(`Метод ${ci.name}::${sig.name} объявлен, но не определён`, { line: sig.line });
        lines.push(this.emitFunc(sig.decl, ci, sig));
      }
    }
    lines.push('}');
    return lines.join('\n');
  }

  syncDefault(t: Ty): string {
    if (t.k === 'cls' && t.user) return 'null';
    if (t.k === 'arr') return 'null';
    return this.defaultValue(t);
  }

  // ---------- функции ----------
  emitFunc(f: FuncDecl, ci?: ClassInfo, sig?: FuncSig): string {
    const s = sig ?? this.funcs.get(f.name)!.find((x) => x.decl === f)!;
    this.fn = { ret: s.ret, cls: ci, line: f.line, isStaticMethod: s.isStatic };
    this.push();
    const params: string[] = [];
    try {
      s.params.forEach((p, i) => {
        const fp = f.params[i];
        const js = `$${p.name}`;
        this.declare({ name: p.name, js: p.isRef ? `${js}.v` : js, ty: p.ty, kind: 'param', isRef: p.isRef, isConst: fp.type.isConst && p.ty.k !== 'cstr' && p.ty.k !== 'arr' }, fp);
        if (fp.def) {
          const r = this.ex(fp.def);
          params.push(`${js} = ${this.coerce(r, p.ty, fp.def)}`);
        } else params.push(js);
      });
      const lines: string[] = [];
      const name = ci ? (f.isCtor ? s.js : s.js) : s.js;
      const prefix = ci ? (s.isStatic ? 'static *' : '*') : 'function* ';
      lines.push(`${prefix}${name}(${params.join(', ')}){`);
      lines.push('M.ops+=2;');
      if (f.isCtor && ci) {
        // список инициализации
        for (const ini of f.inits ?? []) {
          if (ini.name === ci.base) {
            const base = this.classes.get(ci.base)!;
            const bsig = this.pickOverload(base.ctors, ini.args.length, ci.base, ini);
            lines.push(`yield* super.${bsig.js}(${this.callArgs(bsig, ini.args, ini).join(', ')});`);
            continue;
          }
          const fld = ci.fields.get(ini.name);
          if (!fld) this.error(`В классе ${ci.name} нет поля ${ini.name}`, ini);
          if (fld.ty.k === 'cls') lines.push(`this.$${ini.name} = ${this.construct(fld.ty, ini.args, ini)};`);
          else if (ini.args.length === 1) lines.push(`this.$${ini.name} = ${this.coerce(this.ex(ini.args[0]), fld.ty, ini)};`);
          else this.error(`Неверная инициализация поля ${ini.name}`, ini);
        }
      }
      lines.push(...this.blockBody(f.body!));
      lines.push('}');
      if (ci) return lines.join('\n');
      return lines.join('\n');
    } finally {
      this.pop();
      this.fn = null;
    }
  }

  blockBody(b: Block): string[] {
    const out: string[] = [];
    for (const st of b.body) {
      try {
        out.push(this.stmt(st));
      } catch (e) {
        this.record(e);
      }
    }
    return out;
  }

  // ---------- операторы ----------
  stmt(s: Stmt): string {
    const L = `M.L=${s.line};`;
    switch (s.kind) {
      case 'block': {
        this.push();
        try {
          return `{\n${this.blockBody(s).join('\n')}\n}`;
        } finally { this.pop(); }
      }
      case 'empty': return ';';
      case 'expr': {
        if (s.expr.kind === 'binary' && (s.expr.op === '==' || s.expr.op === '<' || s.expr.op === '>')) {
          this.warn('Результат сравнения не используется', s.expr, s.expr.op === '==' ? 'Для присваивания используйте один знак «=»' : undefined);
        }
        if (s.expr.kind === 'id') {
          const sym = this.lookup(s.expr.name, s.expr);
          if (sym?.kind === 'func' || FUNCS[s.expr.name]) this.error(`Функция ${s.expr.name} не вызвана — не хватает скобок: ${s.expr.name}()`, s.expr);
        }
        return `${L}${this.ex(s.expr, true).c};`;
      }
      case 'var': return this.localVar(s);
      case 'if': {
        if (s.cond.kind === 'assign' && s.cond.op === '=') {
          this.warn('В условии стоит присваивание «=»', s.cond, 'Для сравнения используйте «==»');
        }
        const c = this.cond(s.cond);
        let code = `${L}if (${c}) ${this.wrapStmt(s.then)}`;
        if (s.else) code += ` else ${this.wrapStmt(s.else)}`;
        return code;
      }
      case 'while': {
        if (s.cond.kind === 'assign' && s.cond.op === '=') this.warn('В условии стоит присваивание «=»', s.cond, 'Для сравнения используйте «==»');
        const c = this.cond(s.cond);
        this.loopDepth++;
        try {
          return `${L}while (${c}) {${OPS_CHECK}\n${this.wrapInner(s.body)}\n}`;
        } finally { this.loopDepth--; }
      }
      case 'do': {
        this.loopDepth++;
        let body: string;
        try { body = this.wrapInner(s.body); } finally { this.loopDepth--; }
        return `${L}do {${OPS_CHECK}\n${body}\n} while (${this.cond(s.cond)});`;
      }
      case 'for': {
        this.push();
        try {
          let init = '';
          if (s.init) init = s.init.kind === 'var' ? this.localVar(s.init, true) : this.ex(s.init.expr, true).c;
          const c = s.cond ? this.cond(s.cond) : 'true';
          const u = s.update ? this.ex(s.update, true).c : '';
          this.loopDepth++;
          let body: string;
          try { body = this.wrapInner(s.body); } finally { this.loopDepth--; }
          return `${L}for (${init}; ${c}; ${u}) {${OPS_CHECK}\n${body}\n}`;
        } finally { this.pop(); }
      }
      case 'forrange': {
        const it = this.ex(s.iter);
        this.push();
        try {
          let elemTy: Ty;
          if (it.t.k === 'arr') elemTy = it.t.of;
          else if (it.t.k === 'json') elemTy = T.json;
          else if (it.t.k === 'String' || it.t.k === 'cstr') elemTy = T.char;
          else this.error('Цикл for (x : …) работает только с массивами и JSON-массивами', s.iter);
          let declTy = this.resolveType(s.type);
          if (s.type.base === 'auto') declTy = elemTy;
          if (declTy.k === 'cls' && declTy.name === 'JsonPair') elemTy = declTy;
          const n = this.tmpCounter++;
          const arr = `__a${n}`;
          const idx = `__i${n}`;
          if (s.byRef && it.t.k === 'arr' && (elemTy.k === 'int' || elemTy.k === 'float' || elemTy.k === 'bool' || elemTy.k === 'String')) {
            this.declare({ name: s.name, js: `${arr}[${idx}]`, ty: elemTy, kind: 'var' }, s);
            this.loopDepth++;
            try {
              const body = this.wrapInner(s.body);
              return `${L}{ const ${arr} = ${it.c}; for (let ${idx} = 0; ${idx} < ${arr}.length; ${idx}++) {${OPS_CHECK}\n${body}\n} }`;
            } finally { this.loopDepth--; }
          }
          this.declare({ name: s.name, js: `$${s.name}`, ty: declTy, kind: 'var' }, s);
          this.loopDepth++;
          try {
            const body = this.wrapInner(s.body);
            const conv = declTy.k === 'json' || elemTy.k === declTy.k ? `$${s.name}` : this.coerce({ c: `$${s.name}`, t: elemTy }, declTy, s);
            return `${L}for (let $${s.name} of R.iter(${it.c})) {${OPS_CHECK}${conv !== `$${s.name}` ? `$${s.name} = ${conv};` : ''}\n${body}\n}`;
          } finally { this.loopDepth--; }
        } finally { this.pop(); }
      }
      case 'switch': {
        const d = this.ex(s.disc);
        if (!isInt(d.t) && d.t.k !== 'bool' && d.t.k !== 'any') {
          this.error(`switch работает только с целыми числами и символами, а здесь ${tyName(d.t)}`, s.disc,
            d.t.k === 'String' ? 'Для строк используйте if (s == "…") … else if …' : undefined);
        }
        const seen = new Set<number>();
        this.switchDepth++;
        this.push();
        try {
          const cases = s.cases.map((c) => {
            let head: string;
            if (c.test) {
              const k = this.constEval(c.test);
              const r = this.ex(c.test);
              if (k === null && !(r.k !== undefined)) this.error('В case должна быть константа', c.test);
              const v = k ?? r.k!;
              if (seen.has(v)) this.error(`Повторяющееся значение case ${v}`, c.test);
              seen.add(v);
              head = `case ${v}:`;
            } else head = 'default:';
            const body = c.body.map((st) => { try { return this.stmt(st); } catch (e) { this.record(e); return ''; } });
            return `${head}\n${body.join('\n')}`;
          });
          return `${L}switch (${d.t.k === 'bool' ? `+(${d.c})` : d.c}) {\n${cases.join('\n')}\n}`;
        } finally { this.pop(); this.switchDepth--; }
      }
      case 'break':
        if (!this.loopDepth && !this.switchDepth) this.error('break вне цикла или switch', s);
        return 'break;';
      case 'continue':
        if (!this.loopDepth) this.error('continue вне цикла', s);
        return 'continue;';
      case 'return': {
        const ret = this.fn!.ret;
        if (this.fn!.lambdaRets) {
          if (!s.value) return `${L}return;`;
          const r = this.ex(s.value);
          this.fn!.lambdaRets.push(r.t);
          return `${L}return ${ret.k === 'any' ? r.c : this.coerce(r, ret, s.value)};`;
        }
        if (!s.value) {
          if (ret.k !== 'void') this.error(`Функция должна вернуть значение типа ${tyName(ret)}`, s);
          return `${L}return;`;
        }
        if (ret.k === 'void') this.error('Функция void не может возвращать значение', s);
        if (s.value.kind === 'initlist' && ret.k === 'cls') return `${L}return ${this.construct(ret, s.value.items, s.value, true)};`;
        const r = this.ex(s.value);
        let c = this.coerce(r, ret, s.value);
        if (ret.k === 'cls' && ret.user && r.lv) c = `${c}.$clone()`;
        return `${L}return ${c};`;
      }
      case 'localtype': {
        const d = s.decl;
        if (d.kind === 'enum') { this.declareEnum(d, this.scopes[this.scopes.length - 1]); return ''; }
        if (d.kind === 'typedef') { this.typedefs.set(d.name, d.type); return ''; }
        this.error('Объявляйте struct/class вне функций', s);
      }
      // eslint-disable-next-line no-fallthrough
      default:
        this.error('Неподдерживаемая инструкция', s);
    }
  }

  wrapStmt(s: Stmt): string {
    if (s.kind === 'block') return this.stmt(s);
    this.push();
    try {
      if (s.kind === 'var') this.error('Объявление переменной должно быть внутри фигурных скобок { }', s);
      return `{\n${this.stmt(s)}\n}`;
    } finally { this.pop(); }
  }

  wrapInner(s: Stmt): string {
    if (s.kind === 'block') {
      this.push();
      try { return this.blockBody(s).join('\n'); } finally { this.pop(); }
    }
    return this.stmt(s);
  }

  localVar(v: VarDecl, noLine = false): string {
    const parts: string[] = [];
    for (const d of v.decls) {
      const ty0 = this.declTy(v.type, d);
      if (v.isStatic) {
        const id = `$$s${this.staticCounter++}_${d.name}`;
        this.statics.push(`let ${id}, ${id}_i = false;`);
        const { ty, code } = this.varInit(v.type, ty0, d);
        this.declare({ name: d.name, js: id, ty, kind: 'static', isConst: v.type.isConst && ty.k !== 'cstr' }, d);
        parts.push(`if (!${id}_i) { ${id}_i = true; ${id} = ${code}; }`);
        continue;
      }
      // локальная ссылка: int &r = x;
      if (d.ref && d.init) {
        const r = this.ex(d.init);
        if (!r.lv || r.t.k === 'cls' || r.t.k === 'arr' || r.t.k === 'json') {
          const { ty, code } = this.varInit(v.type, ty0.k === 'any' ? r.t : ty0, { ...d, ref: false });
          this.declare({ name: d.name, js: `$${d.name}`, ty, kind: 'var' }, d);
          parts.push(`let $${d.name} = ${r.t.k === 'cls' || r.t.k === 'arr' || r.t.k === 'json' ? r.c : code}`);
          continue;
        }
        this.declare({ name: d.name, js: `$${d.name}.v`, ty: ty0.k === 'any' ? r.t : ty0, kind: 'var', isRef: true }, d);
        parts.push(`let $${d.name} = ${this.mkRef(r)}`);
        continue;
      }
      const { ty, code } = this.varInit(v.type, ty0, d);
      if (this.lookupLocalTop(d.name)) this.error(`Переменная «${d.name}» уже объявлена в этом блоке`, d);
      const shadow = this.globals.get(d.name);
      if (shadow && shadow.kind === 'global' && this.fn && this.scopes.length <= 3 && !noLine) {
        this.warn(`Локальная переменная «${d.name}» скрывает глобальную с тем же именем`, d,
          'Если вы хотели изменить глобальную переменную, уберите тип перед именем');
      }
      this.declare({ name: d.name, js: `$${d.name}`, ty, kind: 'var', isConst: !!v.type.isConst && ty.k !== 'cstr' }, d);
      parts.push(`let $${d.name} = ${code}`);
    }
    if (noLine) return parts.join(', ').replace(/, let /g, ', ');
    return `M.L=${v.line};${parts.join(';')};`;
  }

  lookupLocalTop(name: string): boolean {
    return this.scopes[this.scopes.length - 1].has(name);
  }

  mkRef(r: R): string {
    const lv = r.lv!;
    if (lv.kind === 'plain') return `R.ref(() => ${lv.code}, (__v) => ${lv.code} = __v)`;
    if (lv.kind === 'index') return `((__o, __k) => R.ref(() => __o[__k], (__v) => __o[__k] = __v))(${lv.obj}, R.wi(${lv.obj}, ${lv.idx}))`;
    this.error('Нельзя взять ссылку на это выражение', { line: 0 });
  }

  /** Условие (приведение к bool в контексте if/while). */
  cond(e: Expr): string {
    const r = this.ex(e);
    return this.truthy(r, e);
  }

  truthy(r: R, at: { line: number; col?: number }): string {
    switch (r.t.k) {
      case 'bool': case 'int': return r.c;
      case 'float': return `(${r.c} !== 0)`;
      case 'json': return `R.jtruthy(${r.c})`;
      case 'cls': return CLASSES[r.t.name]?.truthy ? `R.truthy(${r.c})` : `(${r.c} != null)`;
      case 'cstr': case 'arr': case 'fn': case 'any': return `R.truthy(${r.c})`;
      case 'String': return `(${r.c} != null)`;
      case 'null': return 'false';
      case 'void': this.error('Функция void не возвращает значение — его нельзя проверить в условии', at);
    }
    return r.c;
  }

  // ---------- приведение типов ----------
  coerce(r: R, to: Ty, at: { line: number; col?: number }): string {
    const from = r.t;
    if (to.k === 'any') return isCharArr(from) ? r.c : r.c;
    if (from.k === 'void') this.error('Функция ничего не возвращает (void), её результат нельзя использовать', at);
    if (from.k === 'json') {
      switch (to.k) {
        case 'int': return intWrap(`R.jnum(${r.c})`, to);
        case 'float': return to.bits === 32 ? `Math.fround(R.jnum(${r.c}))` : `R.jnum(${r.c})`;
        case 'bool': return `R.jbool(${r.c})`;
        case 'String': return `R.jstr(${r.c})`;
        case 'cstr': return `R.jcstr(${r.c})`;
        case 'json': return r.c;
        default: return r.c;
      }
    }
    switch (to.k) {
      case 'int': {
        if (from.k === 'int') {
          if (from.bits === to.bits && from.u === to.u) return r.c;
          if (to.bits === 64) return r.c;
          if (r.k !== undefined && Number.isInteger(r.k)) {
            // константа: заворачиваем сразу
            const v = Function(`return ${intWrap(String(r.k), to)}`)() as number;
            if (v !== r.k && to.bits < 32) this.warn(`Значение ${r.k} не помещается в ${tyName(to)} и станет ${v}`, at);
            return String(v);
          }
          return intWrap(r.c, to);
        }
        if (from.k === 'bool') return `(+${r.c})`;
        if (from.k === 'float') {
          if (to.bits === 64) return `Math.trunc(${r.c})`;
          return to.u && to.bits === 32 ? `R.tu32(${r.c})` : intWrap(`R.ti32(${r.c})`, to);
        }
        if (from.k === 'null') return '0';
        if (from.k === 'any') return intWrap(`R.num(${r.c})`, to);
        if (from.k === 'String') this.error('Нельзя присвоить строку String целой переменной', at, 'Используйте s.toInt()');
        if (from.k === 'cstr' || isCharArr(from)) this.error('Нельзя присвоить строку целой переменной', at, 'Для преобразования используйте atoi(s) или String(s).toInt()');
        if (from.k === 'cls' && (from.name === 'hw_timer_t' || from.name.endsWith('Handle_t'))) return r.c;
        this.error(`Нельзя преобразовать ${tyName(from)} в ${tyName(to)}`, at);
      }
      // eslint-disable-next-line no-fallthrough
      case 'float':
        if (from.k === 'int' || from.k === 'float') return to.bits === 32 && !(from.k === 'float' && from.bits === 32) ? `Math.fround(${r.c})` : r.c;
        if (from.k === 'bool') return `(+${r.c})`;
        if (from.k === 'any') return `R.num(${r.c})`;
        if (from.k === 'null') return '0';
        if (from.k === 'String') this.error('Нельзя присвоить String числу', at, 'Используйте s.toFloat()');
        if (from.k === 'cstr' || isCharArr(from)) this.error('Нельзя присвоить строку числу', at, 'Используйте atof(s)');
        this.error(`Нельзя преобразовать ${tyName(from)} в ${tyName(to)}`, at);
      // eslint-disable-next-line no-fallthrough
      case 'bool':
        if (from.k === 'bool') return r.c;
        if (from.k === 'int' || from.k === 'float') return `(${r.c} != 0)`;
        return `!!(${this.truthy(r, at)})`;
      case 'String':
        if (from.k === 'String') return r.c;
        if (from.k === 'null') this.error('Нельзя присвоить NULL строке String', at);
        return this.strOf(r, at);
      case 'cstr':
        if (from.k === 'cstr' || from.k === 'null') return r.c;
        if (isCharArr(from)) return r.c;
        if (from.k === 'String') {
          this.error('String нельзя присвоить const char* напрямую', at, 'Используйте .c_str(): const char* p = s.c_str();');
        }
        if (from.k === 'any') return r.c;
        if (from.k === 'arr') return r.c;
        this.error(`Нельзя преобразовать ${tyName(from)} в строку const char*`, at);
      // eslint-disable-next-line no-fallthrough
      case 'arr':
        if (from.k === 'arr' || from.k === 'null' || from.k === 'any' || from.k === 'cstr') return r.c;
        if (from.k === 'String') this.error('String нельзя присвоить указателю', at, 'Используйте .c_str()');
        this.error(`Нельзя преобразовать ${tyName(from)} в ${tyName(to)}`, at);
      // eslint-disable-next-line no-fallthrough
      case 'cls':
        if (from.k === 'cls') {
          if (from.name === to.name) return r.c;
          if (from.user && to.user && this.isSubclass(from.name, to.name)) return r.c;
          if (!from.user && !to.user) return r.c; // библиотечные — без строгой проверки
          this.error(`Нельзя преобразовать ${from.name} в ${to.name}`, at);
        }
        if (from.k === 'null' || from.k === 'any') return r.c;
        if (to.name === 'IPAddress' && from.k === 'cstr') return `L.IPAddress.from(${r.c})`;
        if (to.name.endsWith('Handle_t') || to.name === 'hw_timer_t') return r.c;
        this.error(`Нельзя преобразовать ${tyName(from)} в ${to.name}`, at);
      // eslint-disable-next-line no-fallthrough
      case 'json':
        if ((from as Ty).k === "json") return r.c;
        return `L.jsonOf(${this.plainArg(r)})`;
      case 'fn':
        if (from.k === 'fn' || from.k === 'null' || from.k === 'any') return r.c;
        this.error('Ожидалась функция', at);
      // eslint-disable-next-line no-fallthrough
      default:
        return r.c;
    }
  }

  isSubclass(a: string, b: string): boolean {
    let ci = this.classes.get(a);
    while (ci) {
      if (ci.name === b) return true;
      ci = ci.base ? this.classes.get(ci.base) : undefined;
    }
    return false;
  }

  /** Строковое представление для конкатенации со String. */
  strOf(r: R, at: { line: number; col?: number }): string {
    const t = r.t;
    switch (t.k) {
      case 'String': return r.c;
      case 'cstr': return `R.cs(${r.c})`;
      case 'arr': if (isCharArr(t)) return `R.cs(${r.c})`; break;
      case 'int': return t.ch ? `String.fromCharCode(${r.c} & 255)` : `String(${r.c})`;
      case 'float': return `R.fstr(${r.c}, 2)`;
      case 'bool': return `(${r.c} ? "1" : "0")`;
      case 'json': return `R.jstr(${r.c})`;
      case 'cls': if (t.name === 'IPAddress') return `${r.c}.toString()`; break;
      case 'any': return `R.anystr(${r.c})`;
      default: break;
    }
    this.error(`Нельзя преобразовать ${tyName(t)} в строку`, at);
  }

  /** Аргумент «печатающей» функции: помечаем float и char. */
  printArg(r: R): string {
    if (r.t.k === 'float') return `R.F(${r.c})`;
    if (r.t.k === 'int' && r.t.ch) return `R.C(${r.c})`;
    if (r.t.k === 'int' && r.t.bits === 64) return `R.I64(${r.c})`;
    if (r.t.k === 'int' && r.t.u && r.t.bits === 32) return r.c;
    return r.c;
  }

  plainArg(r: R): string {
    if (isCharArr(r.t)) return `R.cs(${r.c})`;
    return r.c;
  }

  // ---------- выражения ----------
  ex(e: Expr, stmtCtx = false): R {
    switch (e.kind) {
      case 'num': {
        const t = e.nt === 'double' ? T.f64 : e.nt === 'float' ? T.f32 : e.nt === 'uint' || e.nt === 'ulong' ? T.u32 : e.nt === 'llong' ? T.i64 : e.nt === 'ullong' ? T.u64 : T.i32;
        const c = Number.isFinite(e.v) ? (e.v < 0 ? `(${e.v})` : String(e.v)) : 'Infinity';
        return { c: e.nt === 'float' ? String(Math.fround(e.v)) : c, t, k: e.v };
      }
      case 'str': return { c: JSON.stringify(e.v), t: T.cstr, tmp: true };
      case 'chr': return { c: String(e.v), t: T.char, k: e.v };
      case 'bool': return { c: String(e.v), t: T.bool, k: e.v ? 1 : 0 };
      case 'null': return { c: 'null', t: T.null };
      case 'this':
        if (!this.fn?.cls) this.error('this можно использовать только внутри методов класса', e);
        return { c: 'this', t: { k: 'cls', name: this.fn.cls.name, user: true } };
      case 'id': return this.ident(e);
      case 'scoped': return this.scoped(e);
      case 'unary': return this.unary(e, stmtCtx);
      case 'binary': return this.binary(e);
      case 'assign': return this.assign(e, stmtCtx);
      case 'cond': {
        const c = this.cond(e.c);
        const a = this.ex(e.a);
        const b = this.ex(e.b);
        let t: Ty;
        if (isNumeric(a.t) && isNumeric(b.t)) t = a.t.k === 'bool' && b.t.k === 'bool' ? T.bool : arith(a.t, b.t);
        else if (a.t.k === 'String' || b.t.k === 'String') t = T.String;
        else if (a.t.k === 'null') t = b.t;
        else t = a.t;
        const ac = t.k === 'String' ? this.strOf(a, e) : t.k === a.t.k ? a.c : this.coerce(a, t, e);
        const bc = t.k === 'String' ? this.strOf(b, e) : t.k === b.t.k ? b.c : this.coerce(b, t, e);
        return { c: `(${c} ? ${ac} : ${bc})`, t, tmp: true };
      }
      case 'comma': {
        const parts = e.items.map((x) => this.ex(x, true));
        return { c: `(${parts.map((p) => p.c).join(', ')})`, t: parts[parts.length - 1].t };
      }
      case 'call': return this.call(e);
      case 'index': return this.index(e);
      case 'member': return this.member(e);
      case 'cast': return this.cast(e.type, this.ex(e.x), e);
      case 'fcast': return this.fcast(e);
      case 'sizeof': {
        if (e.type) {
          const t = this.resolveType(e.type);
          return { c: String(sizeOf(t, this.structSize)), t: T.u32, k: sizeOf(t, this.structSize) };
        }
        const x = e.x!;
        if (x.kind === 'id' || x.kind === 'member' || x.kind === 'index') {
          const r = this.ex(x);
          if (r.t.k === 'arr') {
            let el: Ty = r.t.of;
            let mult = '';
            if (r.t.n !== null) {
              const k = sizeOf(r.t, this.structSize);
              return { c: String(k), t: T.u32, k };
            }
            while (el.k === 'arr' && el.n !== null) { mult += `*${el.n}`; el = el.of; }
            return { c: `(${r.c}.length${mult}*${sizeOf(el, this.structSize)})`, t: T.u32 };
          }
          if (r.t.k === 'String') return { c: '16', t: T.u32, k: 16 };
          return { c: String(sizeOf(r.t, this.structSize)), t: T.u32, k: sizeOf(r.t, this.structSize) };
        }
        const r = this.ex(x);
        if (r.t.k === 'cstr' && x.kind === 'str') return { c: String(x.v.length + 1), t: T.u32, k: x.v.length + 1 };
        return { c: String(sizeOf(r.t, this.structSize)), t: T.u32, k: sizeOf(r.t, this.structSize) };
      }
      case 'lambda': return this.lambda(e);
      case 'initlist': {
        if (e.items.length === 1) return this.ex(e.items[0]);
        this.error('Список {…} здесь не поддерживается — объявите массив или структуру', e);
      }
      // eslint-disable-next-line no-fallthrough
      case 'new': {
        const t = this.resolveType(e.type);
        if (t.k === 'cls') return { c: this.construct(t, e.args, e), t, tmp: true };
        this.error('new поддерживается только для классов', e);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.error(`Неподдерживаемое выражение ${(e as any).kind}`, e as any);
  }

  ident(e: Extract<Expr, { kind: 'id' }>): R {
    const sym = this.lookup(e.name, e);
    if (sym) {
      if (sym.kind === 'enum' || (sym.constVal !== undefined && sym.kind === 'global' && (sym.ty.k === 'int'))) {
        return { c: sym.js, t: sym.ty, k: sym.constVal, lv: sym.kind === 'enum' ? { kind: 'readonly', why: 'элемент enum' } : { kind: 'plain', code: sym.js, sym } };
      }
      if (sym.kind === 'func') return { c: sym.js, t: sym.ty };
      return { c: sym.js, t: sym.ty, lv: { kind: 'plain', code: sym.js, sym } };
    }
    const funcs = this.funcs.get(e.name);
    if (funcs) return { c: funcs[0].js, t: { k: 'fn', ret: funcs[0].ret } };
    if (e.name in CONSTS) {
      const [v, ty] = CONSTS[e.name];
      if (typeof v === 'number') {
        const c = Number.isNaN(v) ? 'NaN' : Number.isFinite(v) ? (v < 0 ? `(${v})` : String(v)) : 'Infinity';
        return { c, t: tyFromName(ty), k: v };
      }
      return { c: JSON.stringify(v), t: tyFromName(ty) };
    }
    if (e.name in GLOBAL_OBJECTS) {
      const g = GLOBAL_OBJECTS[e.name];
      if (g.header && !this.hasInclude(g.header) && !(e.name === 'WiFi' && this.hasInclude('HTTPClient.h', 'WebServer.h', 'WiFiClient.h', 'PubSubClient.h', 'WiFiMulti.h'))) {
        this.error(`${e.name} не объявлен`, e, `Подключите библиотеку: #include <${g.header}>`);
      }
      if (e.name === 'WiFi') this.features.add('wifi');
      return { c: `L.${e.name}`, t: { k: 'cls', name: g.cls }, lv: { kind: 'readonly', why: 'встроенный объект' } };
    }
    if (FUNCS[e.name]) return { c: `F.${e.name}`, t: { k: 'fn', ret: tyFromName(FUNCS[e.name].replace(/^[*~]+/, '')) } };
    if (/^(DDR|PORT|PIN)[A-H]$/.test(e.name)) {
      this.error(`${e.name} — регистр микроконтроллера AVR (Arduino Uno), у ESP32 его нет`, e,
        'У ESP32 выводы управляются регистрами GPIO: GPIO.out_w1ts = (1 << 2); — включить GPIO2');
    }
    const s = suggest(e.name, this.allNames());
    this.error(`«${e.name}» не объявлено`, e, s ? `Возможно, вы имели в виду «${s}»?` : 'Объявите переменную перед использованием или проверьте опечатку');
  }

  scoped(e: Extract<Expr, { kind: 'scoped' }>): R {
    const en = this.scopedEnums.get(e.scope);
    if (en) {
      const v = en.get(e.name);
      if (v === undefined) this.error(`В перечислении ${e.scope} нет элемента ${e.name}`, e);
      return { c: String(v), t: T.i32, k: v };
    }
    if (e.scope === 'std') {
      if (e.name === 'string') return { c: '""', t: T.String };
      return this.ident({ kind: 'id', name: e.name, line: e.line, col: e.col });
    }
    if (e.scope === 'DeserializationError') {
      const codes: Record<string, number> = { Ok: 0, EmptyInput: 1, IncompleteInput: 2, InvalidInput: 3, NoMemory: 4, TooDeep: 5 };
      if (!(e.name in codes)) this.error(`Неизвестный код DeserializationError::${e.name}`, e);
      return { c: String(codes[e.name]), t: T.i32, k: codes[e.name] };
    }
    const meta = CLASSES[e.scope];
    if (meta?.statics?.[e.name]) {
      return { c: `L.${e.scope}.${e.name}`, t: { k: 'fn', ret: tyFromName(meta.statics[e.name]) } };
    }
    const ci = this.classes.get(e.scope);
    if (ci) {
      const m = ci.methods.get(e.name);
      if (m?.[0]?.isStatic) return { c: `${ci.js}.${m[0].js}`, t: { k: 'fn', ret: m[0].ret } };
    }
    this.error(`Неизвестное имя ${e.scope}::${e.name}`, e);
  }

  checkAssignable(r: R, at: { line: number; col?: number }, what = 'изменить'): LV {
    if (!r.lv) this.error(`Это выражение нельзя ${what} — слева от «=» должна стоять переменная`, at);
    if (r.lv.kind === 'readonly') this.error(`Нельзя ${what}: ${r.lv.why}`, at);
    if (r.lv.kind === 'plain' && r.lv.sym?.isConst) {
      this.error(`Нельзя ${what} константу «${r.lv.sym.name}»`, at, 'Уберите const из объявления, если значение должно меняться');
    }
    return r.lv;
  }

  /** Код присваивания значения (уже приведённого) в lvalue. */
  store(lv: LV, val: string): string {
    switch (lv.kind) {
      case 'plain': return `${lv.code} = ${val}`;
      case 'index': return `${lv.obj}[R.wi(${lv.obj}, ${lv.idx})] = ${val}`;
      case 'strch': return this.store(lv.base, `R.setCh(${this.load(lv.base)}, ${lv.idx}, ${val})`);
      case 'json': return `${lv.code}.set(${val})`;
      default: throw new Error('readonly');
    }
  }

  load(lv: LV): string {
    switch (lv.kind) {
      case 'plain': return lv.code;
      case 'index': return `R.ix(${lv.obj}, ${lv.idx})`;
      case 'strch': return `R.chAt(${this.load(lv.base)}, ${lv.idx})`;
      case 'json': return lv.code;
      default: return 'undefined';
    }
  }

  assign(e: Extract<Expr, { kind: 'assign' }>, stmtCtx: boolean): R {
    const target = this.ex(e.target);
    const lv = this.checkAssignable(target, e.target);
    const t = target.t;
    if (e.op === '=') {
      if (t.k === 'arr' && !(t.n === null)) {
        if (e.value.kind === 'str') this.error('Массиву нельзя присвоить строку через «=»', e, 'Используйте strcpy(buf, "текст") или String');
        this.error('Массивы нельзя присваивать целиком', e, 'Копируйте поэлементно в цикле или используйте memcpy');
      }
      if (lv.kind === 'json') {
        const v = this.ex(e.value);
        return { c: `${lv.code}.set(${v.t.k === 'json' ? v.c : this.plainJsonVal(v)})`, t: T.json };
      }
      let val: string;
      if (e.value.kind === 'initlist' && t.k === 'cls') val = this.construct(t, e.value.items, e.value, true);
      else {
        const v = this.ex(e.value);
        val = this.coerce(v, t, e);
        if (t.k === 'cls' && t.user && v.lv) val = `${val}.$clone()`;
        if (t.k === 'float' && e.value.kind === 'binary' && e.value.op === '/' && isInt(v.t)) {
          this.warn('Целочисленное деление: дробная часть будет отброшена до записи во float', e.value,
            'Сделайте одно из чисел дробным: 5.0 / 2 или (float)a / b');
        }
      }
      return { c: stmtCtx ? this.store(lv, val) : `(${this.store(lv, val)})`, t };
    }
    // составное присваивание
    const op = e.op.slice(0, -1);
    if (t.k === 'String' && op === '+') {
      const v = this.ex(e.value);
      const sv = v.t.k === 'String' ? v.c : this.strOf(v, e);
      return { c: `(${this.store(lv, `${this.load(lv)} + ${sv}`)})`, t };
    }
    if (lv.kind === 'json') this.error('Составное присваивание для JSON не поддерживается', e, 'Запишите явно: doc["x"] = doc["x"].as<int>() + 1;');
    const bin = this.binop(op, { c: this.load(lv), t }, this.ex(e.value), e);
    const val = this.coerce(bin, t, e);
    return { c: `(${this.store(lv, val)})`, t };
  }

  plainJsonVal(v: R): string {
    if (v.t.k === 'int' && v.t.ch) return `String.fromCharCode(${v.c})`;
    if (isCharArr(v.t)) return `R.cs(${v.c})`;
    if (v.t.k === 'cls' && v.t.name === 'IPAddress') return `${v.c}.toString()`;
    return v.c;
  }

  unary(e: Extract<Expr, { kind: 'unary' }>, stmtCtx: boolean): R {
    if (e.op === '++' || e.op === '--') {
      const x = this.ex(e.x);
      const lv = this.checkAssignable(x, e.x);
      const t = x.t;
      if (!(isInt(t) || isFloat(t))) {
        if (t.k === 'arr' || t.k === 'cstr') this.error('Арифметика указателей (p++) не поддерживается', e, 'Используйте индекс: p[i]');
        this.error(`Операция ${e.op} не применима к ${tyName(t)}`, e);
      }
      const d = e.op === '++' ? '+ 1' : '- 1';
      const wrap = (code: string) => (t.k === 'int' ? intWrap(code, t) : code);
      // дробные и 64-битные — нативный оператор JS
      if ((t.k === 'float' || (t.k === 'int' && t.bits === 64)) && (lv.kind === 'plain' || lv.kind === 'index')) {
        const target = lv.kind === 'plain' ? lv.code : `${lv.obj}[R.wi(${lv.obj}, ${lv.idx})]`;
        return { c: e.postfix ? `${target}${e.op}` : `${e.op}${target}`, t };
      }
      // в роли инструкции (i++; for (...; i++)) значение не нужно
      if (stmtCtx && lv.kind === 'plain') return { c: `${lv.code} = ${wrap(`${lv.code} ${d}`)}`, t };
      const nv = wrap(`(__t ${d})`);
      if (e.postfix) return { c: `(__t = ${this.load(lv)}, ${this.store(lv, nv)}, __t)`, t };
      return { c: `(__t = ${this.load(lv)}, ${this.store(lv, nv)})`, t };
    }
    if (e.op === '&') {
      const x = this.ex(e.x);
      if (x.t.k === 'fn' || x.t.k === 'arr' || x.t.k === 'cls' || x.t.k === 'json') return { c: x.c, t: x.t };
      if (!x.lv || x.lv.kind === 'readonly') this.error('Нельзя взять адрес этого выражения', e);
      if (x.lv.kind === 'strch' || x.lv.kind === 'json') this.error('Нельзя взять адрес этого выражения', e);
      return { c: this.mkRef(x), t: { k: 'arr', of: x.t, n: 1 } };
    }
    if (e.op === '*') {
      const x = this.ex(e.x);
      if (x.t.k === 'arr') return { c: `R.ix(${x.c}, 0)`, t: x.t.of, lv: { kind: 'index', obj: x.c, idx: '0' } };
      if (x.t.k === 'cstr') return { c: `R.chAt(${x.c}, 0)`, t: T.char };
      if (x.t.k === 'cls' || x.t.k === 'json' || x.t.k === 'any') return x;
      this.error('Разыменование (*) применимо только к указателям', e);
    }
    const x = this.ex(e.x);
    switch (e.op) {
      case '!': return { c: `!${this.truthy(x, e)}`, t: T.bool, k: x.k !== undefined ? (x.k ? 0 : 1) : undefined };
      case '-':
        if (x.t.k === 'json') return { c: `(-R.jnum(${x.c}))`, t: T.f64 };
        if (!isNumeric(x.t) && x.t.k !== 'any') this.error(`Унарный минус не применим к ${tyName(x.t)}`, e);
        if (x.k !== undefined) {
          const t = x.t.k === 'bool' ? T.i32 : arith(x.t, x.t);
          const v = t.k === 'int' && t.u ? (-x.k >>> 0) : -x.k;
          return { c: `(${v})`, t, k: v };
        }
        {
          const t = x.t.k === 'bool' ? T.i32 : arith(x.t, T.i32);
          return { c: isInt(t) ? intWrap(`-${x.c}`, t) : `(-${x.c})`, t };
        }
      case '+': return { c: `(+${x.c})`, t: x.t.k === 'bool' ? T.i32 : arith(x.t, T.i32), k: x.k };
      case '~': {
        if (!isInt(x.t) && x.t.k !== 'bool') this.error(`Операция ~ применима только к целым`, e);
        const t = arith(x.t, T.i32);
        return { c: isInt(t) ? intWrap(`~${x.c}`, t) : `(~${x.c})`, t, k: x.k !== undefined && isInt(t) ? Function(`return ${intWrap(`~${x.k}`, t)}`)() : undefined };
      }
    }
    this.error(`Неизвестный оператор ${e.op}`, e);
  }

  binary(e: Extract<Expr, { kind: 'binary' }>): R {
    if (e.op === '&&' || e.op === '||') {
      const a = this.ex(e.a);
      const b = this.ex(e.b);
      return { c: `(${this.truthy(a, e.a)} ${e.op} ${this.truthy(b, e.b)})`, t: T.bool };
    }
    const a = this.ex(e.a);
    const b = this.ex(e.b);
    return this.binop(e.op, a, b, e);
  }

  binop(op: string, a: R, b: R, at: { line: number; col?: number }): R {
    // JSON: значение по умолчанию doc["x"] | 0
    if (op === '|' && a.t.k === 'json') {
      const t = b.t.k === 'cstr' || isCharArr(b.t) ? T.cstr : b.t.k === 'json' ? T.json : b.t;
      return { c: `R.jor(${a.c}, ${this.plainJsonVal(b)})`, t, tmp: true };
    }
    if (a.t.k === 'json' || b.t.k === 'json') {
      if (op === '==' || op === '!=') {
        const c = `R.jeq(${a.t.k === 'json' ? a.c : this.plainJsonVal(a)}, ${b.t.k === 'json' ? b.c : this.plainJsonVal(b)})`;
        return { c: op === '==' ? c : `!${c}`, t: T.bool };
      }
      if (a.t.k === 'String' || b.t.k === 'String') {
        if (op !== '+') this.error('С JSON-значениями и строками допустимы только + и ==', at);
        return { c: `(${this.strOf(a, at)} + ${this.strOf(b, at)})`, t: T.String };
      }
      const na: R = a.t.k === 'json' ? { c: `R.jnum(${a.c})`, t: T.f64 } : a;
      const nb: R = b.t.k === 'json' ? { c: `R.jnum(${b.c})`, t: T.f64 } : b;
      return this.binop(op, na, nb, at);
    }
    // строки
    const aStr = a.t.k === 'String';
    const bStr = b.t.k === 'String';
    const aC = a.t.k === 'cstr' || isCharArr(a.t);
    const bC = b.t.k === 'cstr' || isCharArr(b.t);
    if (op === '+') {
      if (aStr || bStr) {
        if ((aStr && (b.t.k === 'arr' && !isCharArr(b.t))) || (bStr && (a.t.k === 'arr' && !isCharArr(a.t)))) this.error('Нельзя прибавить массив к строке', at);
        return { c: `(${this.strOf(a, at)} + ${this.strOf(b, at)})`, t: T.String, tmp: true };
      }
      if (aC && bC) {
        this.error('Нельзя сложить две строки в кавычках через «+»', at,
          'Оберните первую в String: String("Темп: ") + "°C" — или используйте два вызова print');
      }
      if ((aC && isNumeric(b.t)) || (bC && isNumeric(a.t))) {
        this.error('Строка в кавычках + число — это не склейка строк, а сдвиг указателя', at,
          'Используйте String("Значение: ") + x или два вызова: Serial.print("Значение: "); Serial.println(x);');
      }
    }
    if (['==', '!=', '<', '>', '<=', '>='].includes(op) && (aStr || bStr || aC || bC)) {
      if ((aStr || aC) && (bStr || bC)) {
        if (!aStr && !bStr && (op === '==' || op === '!=') && a.t.k !== 'arr' && b.t.k !== 'arr') {
          this.warn('Сравнение двух const char* через «==» на настоящем ESP32 сравнивает адреса, а не текст', at,
            'Используйте strcmp(a, b) == 0 или String(a) == b');
        } else if (!aStr && !bStr && (op === '==' || op === '!=')) {
          this.warn('Массивы символов через «==» сравниваются по адресу', at, 'Используйте strcmp(a, b) == 0');
        }
        const ac = aStr ? a.c : `R.cs(${a.c})`;
        const bc = bStr ? b.c : `R.cs(${b.c})`;
        const jsop = op === '==' ? '===' : op === '!=' ? '!==' : op;
        return { c: `(${ac} ${jsop} ${bc})`, t: T.bool };
      }
      if ((aStr || aC) && b.t.k === 'null') return { c: `(${a.c} ${op === '==' ? '==' : '!='} null)`, t: T.bool };
      if ((bStr || bC) && a.t.k === 'null') return { c: `(${b.c} ${op === '==' ? '==' : '!='} null)`, t: T.bool };
      if ((aStr && isInt(b.t) && (b.t as Extract<Ty, { k: 'int' }>).ch) || (bStr && isInt(a.t) && (a.t as Extract<Ty, { k: 'int' }>).ch)) {
        this.error('Нельзя сравнить String с символом', at, 'Сравнивайте со строкой: s == "a", или символ: s[0] == \'a\'');
      }
      this.error(`Нельзя сравнить ${tyName(a.t)} и ${tyName(b.t)}`, at);
    }
    // объекты/указатели
    if (['==', '!='].includes(op) && (a.t.k === 'cls' || b.t.k === 'cls' || a.t.k === 'null' || b.t.k === 'null' || a.t.k === 'fn' || b.t.k === 'fn' || a.t.k === 'arr' || b.t.k === 'arr' || a.t.k === 'any' || b.t.k === 'any')) {
      return { c: `(${a.c} ${op} ${b.c})`, t: T.bool };
    }
    if (!(isNumeric(a.t) || a.t.k === 'any') || !(isNumeric(b.t) || b.t.k === 'any')) {
      if (a.t.k === 'void' || b.t.k === 'void') this.error('Функция void ничего не возвращает — её нельзя использовать в выражении', at);
      this.error(`Оператор «${op}» не применим к ${tyName(a.t)} и ${tyName(b.t)}`, at,
        a.t.k === 'String' || b.t.k === 'String' ? 'Для чисел из строки используйте .toInt() / .toFloat()' : undefined);
    }
    // константная свёртка простых случаев
    const t = arith(a.t, b.t);
    switch (op) {
      case '==': case '!=': case '<': case '>': case '<=': case '>=': {
        const jsop = op === '==' ? '===' : op === '!=' ? '!==' : op;
        const ac = a.t.k === 'bool' ? `+${a.c}` : a.c;
        const bc = b.t.k === 'bool' ? `+${b.c}` : b.c;
        return { c: `(${ac} ${jsop} ${bc})`, t: T.bool };
      }
      case '+': case '-': {
        if (t.k === 'float' || t.k === 'any') return { c: `(${a.c} ${op} ${b.c})`, t, k: a.k !== undefined && b.k !== undefined ? (op === '+' ? a.k + b.k : a.k - b.k) : undefined };
        const c = intWrap(`${a.c} ${op} ${b.c}`, t as Extract<Ty, { k: 'int' }>);
        return { c, t, k: a.k !== undefined && b.k !== undefined ? Function(`return ${intWrap(`${a.k} ${op} ${b.k}`, t as Extract<Ty, { k: 'int' }>)}`)() : undefined };
      }
      case '*': {
        if (t.k === 'float' || t.k === 'any') return { c: `(${a.c} * ${b.c})`, t };
        const ti = t as Extract<Ty, { k: 'int' }>;
        if (ti.bits === 64) return { c: `(${a.c} * ${b.c})`, t };
        const mul = (x: string, y: string) => (ti.u ? `(Math.imul(${x}, ${y})>>>0)` : `Math.imul(${x}, ${y})`);
        const c = mul(a.c, b.c);
        // свёртка — по значениям констант, а не по их именам в коде
        return { c, t, k: a.k !== undefined && b.k !== undefined ? Function(`return ${mul(String(a.k), String(b.k))}`)() : undefined };
      }
      case '/': {
        if (t.k === 'float' || t.k === 'any') return { c: `(${a.c} / ${b.c})`, t };
        if (b.k === 0) this.error('Деление на ноль', at);
        const ti = t as Extract<Ty, { k: 'int' }>;
        const c = ti.bits === 64 ? `R.ldiv(${a.c}, ${b.c})` : ti.u ? `R.udiv(${a.c}, ${b.c})` : `R.idiv(${a.c}, ${b.c})`;
        return { c, t, k: a.k !== undefined && b.k !== undefined && b.k !== 0 ? Math.trunc(a.k / b.k) : undefined };
      }
      case '%': {
        if (t.k === 'float') this.error('Остаток от деления % работает только с целыми', at, 'Для дробных используйте fmod(a, b)');
        if (b.k === 0) this.error('Деление на ноль', at);
        return { c: `R.imod(${a.c}, ${b.c})`, t, k: a.k !== undefined && b.k !== undefined && b.k !== 0 ? a.k % b.k : undefined };
      }
      case '<<': case '>>': case '&': case '|': case '^': {
        if (t.k === 'float') this.error(`Побитовая операция «${op}» не применима к дробным числам`, at);
        const ta = a.t.k === 'int' && a.t.bits < 32 ? T.i32 : a.t.k === 'bool' ? T.i32 : a.t;
        const rt = op === '<<' || op === '>>' ? (ta as Ty) : t;
        const ti = rt as Extract<Ty, { k: 'int' }>;
        let c: string;
        if (ti.k === 'int' && ti.bits === 64) {
          if (op === '<<') c = `(${a.c} * 2 ** (${b.c}))`;
          else if (op === '>>') c = `Math.floor(${a.c} / 2 ** (${b.c}))`;
          else c = `R.bit64(${JSON.stringify(op)}, ${a.c}, ${b.c})`;
        } else if (op === '>>' && ti.k === 'int' && ti.u) c = `(${a.c} >>> ${b.c})`;
        else c = ti.k === 'int' && ti.u ? `((${a.c} ${op} ${b.c})>>>0)` : `(${a.c} ${op} ${b.c})`;
        let k: number | undefined;
        if (a.k !== undefined && b.k !== undefined) {
          try { k = Function(`return ${c}`)(); } catch { k = undefined; }
        }
        return { c, t: rt, k };
      }
    }
    this.error(`Неизвестный оператор ${op}`, at);
  }

  index(e: Extract<Expr, { kind: 'index' }>): R {
    const o = this.ex(e.obj);
    const i = this.ex(e.idx);
    if (o.t.k === 'json') {
      const key = i.t.k === 'json' ? `R.jstr(${i.c})` : isCharArr(i.t) ? `R.cs(${i.c})` : i.c;
      const c = `${o.c}.get(${key})`;
      return { c, t: T.json, lv: { kind: 'json', code: c } };
    }
    if (o.t.k === 'cls' && o.t.name === 'IPAddress') return { c: `${o.c}.octet(${i.c})`, t: T.u8 };
    if (!isInt(i.t) && i.t.k !== 'bool' && i.t.k !== 'any') {
      if (isFloat(i.t)) this.error('Индекс массива должен быть целым числом', e.idx, 'Приведите к int: arr[(int)x]');
      this.error(`Индекс массива должен быть целым числом, а не ${tyName(i.t)}`, e.idx);
    }
    if (o.t.k === 'arr') {
      if (o.t.n !== null && i.k !== undefined && (i.k < 0 || i.k >= o.t.n)) {
        this.error(`Индекс ${i.k} вне границ массива (допустимо 0…${o.t.n - 1})`, e.idx);
      }
      return { c: `R.ix(${o.c}, ${i.c})`, t: o.t.of, lv: { kind: 'index', obj: o.c, idx: i.c } };
    }
    if (o.t.k === 'String') {
      return { c: `R.chAt(${o.c}, ${i.c})`, t: T.char, lv: o.lv && o.lv.kind !== 'readonly' ? { kind: 'strch', base: o.lv, idx: i.c } : { kind: 'readonly', why: 'временная строка' } };
    }
    if (o.t.k === 'cstr') return { c: `R.chAt(${o.c}, ${i.c})`, t: T.char, lv: { kind: 'readonly', why: 'строковый литерал нельзя менять' } };
    if (o.t.k === 'any') return { c: `R.ix(${o.c}, ${i.c})`, t: T.any, lv: { kind: 'index', obj: o.c, idx: i.c } };
    this.error(`Квадратные скобки [] нельзя применить к ${tyName(o.t)}`, e);
  }

  member(e: Extract<Expr, { kind: 'member' }>): R {
    const o = this.ex(e.obj);
    if (o.t.k === 'cls' && o.t.user) {
      let ci = this.classes.get(o.t.name);
      while (ci) {
        const f = ci.fields.get(e.name);
        if (f) {
          const code = `${o.c}.$${e.name}`;
          return { c: code, t: f.ty, lv: { kind: 'plain', code } };
        }
        if (ci.methods.has(e.name)) this.error(`${e.name} — метод, вызовите его со скобками: ${e.name}()`, e);
        ci = ci.base ? this.classes.get(ci.base) : undefined;
      }
      const all = [...(this.classes.get(o.t.name)?.fields.keys() ?? [])];
      const s = suggest(e.name, all);
      this.error(`В ${o.t.name} нет поля «${e.name}»`, e, s ? `Возможно, «${s}»?` : undefined);
    }
    if (o.t.k === 'cls') {
      const meta = CLASSES[o.t.name];
      const ft = meta?.fields?.[e.name];
      if (ft) {
        const code = `${o.c}.${e.name}`;
        return { c: code, t: tyFromName(ft), lv: { kind: 'plain', code } };
      }
      if (meta?.methods[e.name]) this.error(`${e.name} — метод, вызовите его со скобками: ${e.name}()`, e);
      this.error(`У ${o.t.name} нет поля «${e.name}»`, e);
    }
    if (o.t.k === 'String' && ['length', 'c_str'].includes(e.name)) this.error(`${e.name} — метод, нужны скобки: .${e.name}()`, e);
    this.error(`Нельзя обратиться к «.${e.name}» у ${tyName(o.t)}`, e);
  }

  cast(spec: TypeSpec, x: R, at: { line: number; col?: number }): R {
    const t = this.resolveType(spec);
    if (t.k === 'void') return { c: x.c, t: T.void };
    if (t.k === 'int' && (x.t.k === 'cstr' || x.t.k === 'String')) {
      this.error(`Приведение строки к ${tyName(t)} не преобразует текст в число`, at, 'Используйте atoi(s) или s.toInt()');
    }
    if (t.k === 'arr' && (x.t.k === 'arr' || x.t.k === 'cstr' || x.t.k === 'any')) return { c: x.c, t: x.t.k === 'cstr' ? T.cstr : t };
    if (t.k === 'cstr' && x.t.k === 'arr') return { c: x.c, t: T.cstr };
    if (t.k === 'int' || t.k === 'float' || t.k === 'bool') {
      const c = this.coerce(x, t, at);
      let k: number | undefined;
      if (x.k !== undefined) {
        try { k = Function(`"use strict"; const R={ti32:(v)=>Math.trunc(v)|0,tu32:(v)=>Math.trunc(v)>>>0,num:(v)=>+v}; return ${c}`)(); } catch { k = undefined; }
      }
      return { c, t, k };
    }
    return { c: this.coerce(x, t, at), t };
  }

  fcast(e: Extract<Expr, { kind: 'fcast' }>): R {
    const t = this.resolveType(e.type);
    if (t.k === 'String') {
      if (e.args.length === 0) return { c: '""', t: T.String, tmp: true };
      const a = this.ex(e.args[0]);
      if (e.args.length >= 2) {
        const b = this.ex(e.args[1]);
        if (a.t.k === 'float') return { c: `R.fstr(${a.c}, ${b.c})`, t: T.String, tmp: true };
        if (isInt(a.t)) return { c: `R.istr(${a.c}, ${b.c}, ${a.t.u ? 1 : 0})`, t: T.String, tmp: true };
      }
      return { c: this.strOf(a, e), t: T.String, tmp: true };
    }
    if (t.k === 'cls') return { c: this.construct(t, e.args, e, false), t, tmp: true };
    if (t.k === 'json') return { c: 'new L.JsonDocument()', t: T.json, tmp: true };
    if (e.args.length !== 1) this.error(`Приведение ${tyName(t)}(…) принимает один аргумент`, e);
    return this.cast(e.type, this.ex(e.args[0]), e);
  }

  lambda(e: Extract<Expr, { kind: 'lambda' }>): R {
    const saved = this.fn;
    const savedLoop = this.loopDepth;
    const savedSwitch = this.switchDepth;
    const ret = e.ret ? this.resolveType(e.ret) : T.any;
    this.fn = { ret, cls: saved?.cls, line: saved?.line ?? e.line, lambdaRets: [] };
    this.loopDepth = 0;
    this.switchDepth = 0;
    this.push();
    try {
      const params = e.params.map((p) => {
        const ty = this.paramTy(p);
        this.declare({ name: p.name, js: `$${p.name}`, ty, kind: 'param' }, p);
        return p.def ? `$${p.name} = ${this.coerce(this.ex(p.def), ty, p.def)}` : `$${p.name}`;
      });
      const body = this.blockBody(e.body).join('\n');
      const rets = this.fn.lambdaRets!;
      const rt = e.ret ? ret : rets.length ? rets[0] : T.void;
      const bind = saved?.cls ? '.bind(this)' : '';
      return { c: `(function*(${params.join(', ')}){M.ops+=2;\n${body}\n})${bind}`, t: { k: 'fn', ret: rt } };
    } finally {
      this.pop();
      this.fn = saved;
      this.loopDepth = savedLoop;
      this.switchDepth = savedSwitch;
    }
  }

  // ---------- вызовы ----------
  callArgs(sig: FuncSig, args: Expr[], at: { line: number; col?: number }): string[] {
    return args.map((a, i) => {
      const p = sig.params[i];
      if (!p) return this.ex(a).c;
      if (p.isRef) {
        const r = this.ex(a);
        if (!r.lv || r.lv.kind === 'readonly' || r.lv.kind === 'json' || r.lv.kind === 'strch') {
          this.error(`Аргумент ${i + 1} функции ${sig.name} передаётся по ссылке — нужна переменная`, a);
        }
        if (r.lv.kind === 'plain' && r.lv.sym?.isRef) return r.lv.code.replace(/\.v$/, '');
        return this.mkRef(r);
      }
      if (a.kind === 'initlist' && p.ty.k === 'cls') return this.construct(p.ty, a.items, a, true);
      if (a.kind === 'initlist' && p.ty.k === 'arr') return `R.arrInit(${this.initListCode(a, { ...p.ty, n: null })}, [null], () => 0)`;
      const r = this.ex(a);
      let c = this.coerce(r, p.ty, a);
      if (p.ty.k === 'cls' && p.ty.user && r.lv && !(sig.decl?.params[i]?.type.ref)) c = `${c}.$clone()`;
      void at;
      return c;
    });
  }

  call(e: Extract<Expr, { kind: 'call' }>): R {
    const cal = e.callee;
    if (cal.kind === 'id') {
      // локальная переменная-функция (лямбда, указатель на функцию)
      const local = this.lookupVarOnly(cal.name, cal);
      if (local) {
        if (local.ty.k !== 'fn' && local.ty.k !== 'any') this.error(`«${cal.name}» — переменная, а не функция`, cal);
        const args = e.args.map((a) => this.plainArg(this.ex(a)));
        return { c: `(yield* ${local.js}(${args.join(', ')}))`, t: local.ty.k === 'fn' ? local.ty.ret : T.any, tmp: true };
      }
      // метод своего класса без this->
      if (this.fn?.cls) {
        let ci: ClassInfo | undefined = this.fn.cls;
        while (ci) {
          const m = ci.methods.get(cal.name);
          if (m) {
            const sig = this.pickOverload(m, e.args.length, cal.name, e);
            const target = sig.isStatic ? ci.js : 'this';
            return { c: `(yield* ${target}.${sig.js}(${this.callArgs(sig, e.args, e).join(', ')}))`, t: sig.ret, tmp: true };
          }
          ci = ci.base ? this.classes.get(ci.base) : undefined;
        }
      }
      const user = this.funcs.get(cal.name);
      if (user) {
        const sig = this.pickOverload(user, e.args.length, `Функция ${cal.name}`, e);
        if (!sig.decl?.body && !user.some((u) => u.decl?.body)) this.error(`Функция ${cal.name} объявлена, но не определена`, e);
        return { c: `(yield* ${sig.js}(${this.callArgs(sig, e.args, e).join(', ')}))`, t: sig.ret, tmp: true };
      }
      if (SPECIAL_FUNCS.has(cal.name)) return this.special(cal.name, e);
      if (FUNCS[cal.name]) return this.builtin(cal.name, e);
      if (this.classes.has(cal.name)) {
        return { c: this.construct({ k: 'cls', name: cal.name, user: true }, e.args, e), t: { k: 'cls', name: cal.name, user: true }, tmp: true };
      }
      if (/^(Serial|serial)\.?/.test(cal.name)) this.error(`Неизвестная функция ${cal.name}`, cal);
      const s = suggest(cal.name, [...this.funcs.keys(), ...Object.keys(FUNCS), ...SPECIAL_FUNCS]);
      this.error(`Функция «${cal.name}» не объявлена`, cal, s ? `Возможно, вы имели в виду «${s}»?` : 'Проверьте имя функции и регистр букв');
    }
    if (cal.kind === 'member') return this.methodCall(cal, e);
    if (cal.kind === 'scoped') {
      const r = this.scoped(cal);
      if (r.t.k !== 'fn') this.error(`${cal.scope}::${cal.name} — не функция`, cal);
      if (cal.scope === 'std') return this.call({ ...e, callee: { kind: 'id', name: cal.name, line: cal.line, col: cal.col } });
      const ci = this.classes.get(cal.scope);
      if (ci) {
        const sig = this.pickOverload(ci.methods.get(cal.name)!, e.args.length, cal.name, e);
        return { c: `(yield* ${r.c}(${this.callArgs(sig, e.args, e).join(', ')}))`, t: r.t.ret, tmp: true };
      }
      return { c: `${r.c}(${e.args.map((a) => this.plainArg(this.ex(a))).join(', ')})`, t: r.t.ret, tmp: true };
    }
    // вызов результата выражения: arr[i]() и т.п.
    const f = this.ex(cal);
    if (f.t.k !== 'fn' && f.t.k !== 'any') this.error('Это выражение нельзя вызвать как функцию', cal);
    return { c: `(yield* ${f.c}(${e.args.map((a) => this.plainArg(this.ex(a))).join(', ')}))`, t: f.t.k === 'fn' ? f.t.ret : T.any, tmp: true };
  }

  lookupVarOnly(name: string, at: { line: number; col?: number }): Sym | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i].get(name);
      if (s && s.kind !== 'enum' && s.kind !== 'func') return s;
    }
    const g = this.globals.get(name);
    if (g && g.kind === 'global') {
      void at;
      return g;
    }
    return null;
  }

  /** Аргументы для библиотечных функций/методов. */
  libArgs(args: Expr[], printable: boolean): string[] {
    return args.map((a) => {
      const r = this.ex(a);
      if (r.t.k === 'void') this.error('Функция void ничего не возвращает — её нельзя передать как аргумент', a);
      if (printable) return this.printArg(r);
      return r.c;
    });
  }

  builtin(name: string, e: Extract<Expr, { kind: 'call' }>): R {
    const meta = FUNCS[name];
    const blocking = meta.startsWith('*');
    const ret = tyFromName(meta.replace(/^[*~]+/, ''));
    this.checkBuiltinArgs(name, e);
    if (name === 'attachInterrupt' || name === 'timerAttachInterrupt' || name === 'xTaskCreate' || name === 'xTaskCreatePinnedToCore') this.features.add('rtos');
    if (name.startsWith('ledc') || name === 'analogWrite') this.features.add('pwm');
    const args = this.libArgs(e.args, false);
    const c = `F.${name}(${args.join(', ')})`;
    return { c: blocking ? `(yield* ${c})` : c, t: ret, tmp: true };
  }

  checkBuiltinArgs(name: string, e: Extract<Expr, { kind: 'call' }>): void {
    const n = e.args.length;
    const need: Record<string, [number, number]> = {
      pinMode: [2, 2], digitalWrite: [2, 2], digitalRead: [1, 1], analogRead: [1, 1], delay: [1, 1],
      delayMicroseconds: [1, 1], millis: [0, 0], micros: [0, 0], analogWrite: [2, 2], tone: [2, 3], noTone: [1, 1],
      pulseIn: [2, 3], attachInterrupt: [3, 3], detachInterrupt: [1, 1], ledcSetup: [3, 3], ledcAttachPin: [2, 2],
      ledcWrite: [2, 2], random: [1, 2], randomSeed: [1, 1],
    };
    const r = need[name];
    if (r && (n < r[0] || n > r[1])) {
      const exp = r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`;
      this.error(`${name}: неверное число аргументов (передано ${n}, нужно ${exp})`, e);
    }
    if (name === 'pinMode' && n === 2 && e.args[1].kind === 'id' && !['INPUT', 'OUTPUT', 'INPUT_PULLUP', 'INPUT_PULLDOWN', 'OUTPUT_OPEN_DRAIN', 'OPEN_DRAIN', 'ANALOG', 'PULLUP', 'PULLDOWN'].includes(e.args[1].name)) {
      const v = this.lookup(e.args[1].name, e.args[1]);
      if (!v) this.error(`Неизвестный режим вывода «${e.args[1].name}»`, e.args[1], 'Возможные режимы: INPUT, OUTPUT, INPUT_PULLUP, INPUT_PULLDOWN');
    }
    if (name === 'digitalWrite' && n === 2 && e.args[1].kind === 'id' && (e.args[1].name === 'ON' || e.args[1].name === 'OFF')) {
      this.error(`${e.args[1].name} не определено`, e.args[1], 'Используйте HIGH или LOW');
    }
  }

  special(name: string, e: Extract<Expr, { kind: 'call' }>): R {
    const A = e.args;
    const n = A.length;
    const want = (min: number, max = min) => {
      if (n < min || n > max) this.error(`${name}: неверное число аргументов (передано ${n}, нужно ${min === max ? min : `${min}–${max}`})`, e);
    };
    const num = (i: number): R => {
      const r = this.ex(A[i]);
      if (r.t.k === 'json') return { c: `R.jnum(${r.c})`, t: T.f64 };
      if (!isNumeric(r.t) && r.t.k !== 'any') this.error(`${name}: аргумент ${i + 1} должен быть числом, а не ${tyName(r.t)}`, A[i]);
      return r.t.k === 'bool' ? { c: `+${r.c}`, t: T.i32 } : r;
    };
    const math1 = (fn: string): R => { want(1); const a = num(0); return { c: `Math.${fn}(${a.c})`, t: T.f64 }; };
    switch (name) {
      case 'F': case 'PSTR': want(1); return this.ex(A[0]);
      case 'min': case 'max': {
        want(2);
        const a = num(0); const b = num(1);
        const t = arith(a.t, b.t);
        return { c: `Math.${name}(${a.c}, ${b.c})`, t };
      }
      case 'fmin': case 'fmax': { want(2); return { c: `Math.${name.slice(1)}(${num(0).c}, ${num(1).c})`, t: T.f64 }; }
      case 'abs': case 'fabs': {
        want(1);
        const a = num(0);
        const t = name === 'fabs' ? T.f64 : a.t.k === 'int' && a.t.bits < 32 ? T.i32 : a.t;
        return { c: `Math.abs(${a.c})`, t };
      }
      case 'constrain': {
        want(3);
        const a = num(0); const lo = num(1); const hi = num(2);
        const t = arith(arith(a.t, lo.t), hi.t);
        return { c: `R.constrain(${a.c}, ${lo.c}, ${hi.c})`, t: a.t.k === 'float' ? t : arith(a.t, T.i32) };
      }
      case 'map': {
        want(5);
        const args = [0, 1, 2, 3, 4].map((i) => num(i));
        if (args.some((a) => a.t.k === 'float')) {
          this.warn('map() работает с целыми числами — дробная часть аргументов отбрасывается', e,
            'Для дробных чисел посчитайте вручную: out = (x - a) * (d - c) / (b - a) + c');
        }
        return { c: `R.map(${args.map((a) => a.c).join(', ')})`, t: T.i32 };
      }
      case 'sq': { want(1); const a = num(0); const t = arith(a.t, a.t); return { c: isInt(t) ? `R.imul64(${a.c}, ${a.c})` : `(${a.c} * ${a.c})`, t }; }
      case 'sqrt': case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan': case 'exp': case 'log':
      case 'log10': case 'cbrt': case 'trunc':
        return math1(name);
      case 'floor': case 'ceil': case 'round': return math1(name === 'round' ? 'round' : name);
      case 'lround': { want(1); return { c: `Math.round(${num(0).c})`, t: T.i32 }; }
      case 'pow': { want(2); return { c: `Math.pow(${num(0).c}, ${num(1).c})`, t: T.f64 }; }
      case 'atan2': { want(2); return { c: `Math.atan2(${num(0).c}, ${num(1).c})`, t: T.f64 }; }
      case 'hypot': { want(2); return { c: `Math.hypot(${num(0).c}, ${num(1).c})`, t: T.f64 }; }
      case 'fmod': { want(2); return { c: `(${num(0).c} % ${num(1).c})`, t: T.f64 }; }
      case 'isnan': { want(1); return { c: `Number.isNaN(${num(0).c})`, t: T.bool }; }
      case 'isinf': { want(1); const a = num(0); return { c: `(Math.abs(${a.c}) === Infinity)`, t: T.bool }; }
      case 'radians': { want(1); return { c: `(${num(0).c} * Math.PI / 180)`, t: T.f64 }; }
      case 'degrees': { want(1); return { c: `(${num(0).c} * 180 / Math.PI)`, t: T.f64 }; }
      case 'bit': case 'BIT': { want(1); const a = num(0); return { c: `((1 << ${a.c})>>>0)`, t: T.u32, k: a.k !== undefined ? (1 << a.k) >>> 0 : undefined }; }
      case 'bitRead': { want(2); return { c: `((${num(0).c} >> ${num(1).c}) & 1)`, t: T.i32 }; }
      case 'highByte': { want(1); return { c: `((${num(0).c} >> 8) & 255)`, t: T.u8 }; }
      case 'lowByte': { want(1); return { c: `(${num(0).c} & 255)`, t: T.u8 }; }
      case 'makeWord': { want(2); return { c: `(((${num(0).c} & 255) << 8) | (${num(1).c} & 255))`, t: T.u16 }; }
      case 'bitSet': case 'bitClear': case 'bitWrite': {
        want(name === 'bitWrite' ? 3 : 2);
        const x = this.ex(A[0]);
        const lv = this.checkAssignable(x, A[0]);
        const bitn = num(1).c;
        let val: string;
        if (name === 'bitSet') val = `(${this.load(lv)} | (1 << ${bitn}))`;
        else if (name === 'bitClear') val = `(${this.load(lv)} & ~(1 << ${bitn}))`;
        else val = `(${this.truthy(this.ex(A[2]), A[2])} ? (${this.load(lv)} | (1 << ${bitn})) : (${this.load(lv)} & ~(1 << ${bitn})))`;
        return { c: `(${this.store(lv, this.coerce({ c: val, t: T.i32 }, x.t, e))})`, t: x.t };
      }
      case 'swap': {
        want(2);
        const a = this.ex(A[0]); const b = this.ex(A[1]);
        const la = this.checkAssignable(a, A[0]); const lb = this.checkAssignable(b, A[1]);
        return { c: `(__t2 = ${this.load(la)}, ${this.store(la, this.load(lb))}, ${this.store(lb, '__t2')})`, t: T.void };
      }
      case 'sizeof': return this.ex({ kind: 'sizeof', x: A[0], line: e.line, col: e.col });
      case 'sprintf': case 'snprintf': {
        const off = name === 'snprintf' ? 1 : 0;
        if (n < 2 + off) this.error(`${name}: не хватает аргументов`, e);
        const buf = this.ex(A[0]);
        if (buf.t.k === 'String') this.error(`${name} пишет в массив символов, а не в String`, A[0], 'Объявите буфер: char buf[64]; sprintf(buf, …);');
        if (!(buf.t.k === 'arr')) this.error(`${name}: первым аргументом должен быть массив символов char buf[N]`, A[0]);
        const size = off ? this.ex(A[1]).c : 'Infinity';
        const fmt = this.ex(A[1 + off]);
        const rest = A.slice(2 + off).map((a) => this.fmtArg(a));
        return { c: `R.sprintf(${buf.c}, ${size}, ${this.plainArg(fmt)}, [${rest.join(', ')}])`, t: T.i32 };
      }
      case 'strcpy': case 'strncpy': case 'strcat': case 'strncat': {
        want(name.includes('n') && name !== 'strcat' ? 3 : 2);
        const dst = this.ex(A[0]);
        if (dst.t.k === 'String') this.error(`${name} работает с массивами char, а не со String`, A[0], 'Для String используйте присваивание s = "…" или s += "…"');
        if (dst.t.k !== 'arr') this.error(`${name}: первым аргументом должен быть массив символов`, A[0]);
        const src = this.ex(A[1]);
        const nn = n > 2 ? this.ex(A[2]).c : 'Infinity';
        return { c: `R.${name}(${dst.c}, ${this.plainArg(src)}, ${nn})`, t: T.cstr };
      }
      case 'itoa': case 'ltoa': case 'utoa': {
        want(3);
        const v = num(0); const buf = this.ex(A[1]); const base = num(2);
        if (buf.t.k !== 'arr') this.error(`${name}: второй аргумент — массив char`, A[1]);
        return { c: `R.itoa(${v.c}, ${buf.c}, ${base.c})`, t: T.cstr };
      }
      case 'dtostrf': {
        want(4);
        const buf = this.ex(A[3]);
        if (buf.t.k !== 'arr') this.error('dtostrf: четвёртый аргумент — массив char', A[3]);
        return { c: `R.dtostrf(${num(0).c}, ${num(1).c}, ${num(2).c}, ${buf.c})`, t: T.cstr };
      }
      case 'memset': {
        want(3);
        const dst = this.ex(A[0]);
        const elem = dst.t.k === 'arr' ? sizeOf(dst.t.of, this.structSize) : 1;
        return { c: `R.memset(${dst.c}, ${num(1).c}, ${num(2).c}, ${elem})`, t: T.void };
      }
      case 'memcpy': {
        want(3);
        const dst = this.ex(A[0]); const src = this.ex(A[1]);
        const elem = dst.t.k === 'arr' ? sizeOf(dst.t.of, this.structSize) : 1;
        return { c: `R.memcpy(${dst.c}, ${this.plainArg(src)}, ${num(2).c}, ${elem})`, t: T.void };
      }
      case 'serializeJson': case 'serializeJsonPretty': {
        want(2, 3);
        const doc = this.ex(A[0]);
        const out = this.ex(A[1]);
        const pretty = name === 'serializeJsonPretty' ? 'true' : 'false';
        const ser = `R.jser(${doc.c}, ${pretty})`;
        if (out.t.k === 'String') {
          const lv = this.checkAssignable(out, A[1]);
          return { c: `(${this.store(lv, ser)}).length`, t: T.u32 };
        }
        if (out.t.k === 'arr') return { c: `R.jserTo(${doc.c}, ${out.c}, ${pretty})`, t: T.u32 };
        if (out.t.k === 'cls') return { c: `${out.c}.print(${ser})`, t: T.u32 };
        this.error('serializeJson: второй аргумент — String, массив char или Serial', A[1]);
      }
      // eslint-disable-next-line no-fallthrough
      default:
        this.error(`Функция ${name} не поддерживается`, e);
    }
  }

  fmtArg(a: Expr): string {
    const r = this.ex(a);
    if (r.t.k === 'String') {
      this.warn('В printf/sprintf строку String нужно передавать как s.c_str()', a, 'На ESP32 без .c_str() будет мусор или перезагрузка');
      return r.c;
    }
    if (r.t.k === 'json') return `R.jprim(${r.c})`;
    if (r.t.k === 'cls' && r.t.name === 'IPAddress') return `${r.c}.toString()`;
    return r.c;
  }

  methodCall(m: Extract<Expr, { kind: 'member' }>, e: Extract<Expr, { kind: 'call' }>): R {
    const o = this.ex(m.obj);
    const name = m.name;
    const t = o.t;
    // String
    if (t.k === 'String' || t.k === 'cstr' || isCharArr(t)) {
      if (t.k !== 'String') {
        if (name === 'length' || name === 'equals' || name === 'indexOf' || name === 'toInt') {
          this.error(`У строки const char* нет метода ${name}()`, m, `Оберните в String: String(s).${name}(…) или используйте strlen/strcmp`);
        }
        this.error(`У ${tyName(t)} нет методов`, m, 'Методы есть у String: String s = "…";');
      }
      return this.stringMethod(o, name, e);
    }
    if (t.k === 'json') {
      if (name === 'as' || name === 'is' || name === 'to') {
        const tt = e.tmpl?.[0];
        if (!tt) this.error(`${name}<Тип>() требует указать тип в угловых скобках`, m);
        const target = JSON_TYPES.has(tt.base) ? 'json' : this.resolveType(tt);
        const kind = target === 'json' ? (tt.base.includes('Array') ? 'array' : tt.base.includes('Object') ? 'object' : 'variant') : this.jsonKind(target);
        if (name === 'is') return { c: `${o.c}.is(${JSON.stringify(kind)})`, t: T.bool };
        if (name === 'to') return { c: `${o.c}.to(${JSON.stringify(kind)})`, t: T.json };
        const rt: Ty = target === 'json' ? T.json : target;
        return { c: `${o.c}.as(${JSON.stringify(kind)})`, t: rt.k === 'int' ? rt : rt, tmp: true };
      }
      if (name === 'add' && e.tmpl?.length) {
        const kind = e.tmpl[0].base.includes('Object') ? 'object' : e.tmpl[0].base.includes('Array') ? 'array' : 'variant';
        return { c: `${o.c}.addNested(${JSON.stringify(kind)})`, t: T.json };
      }
      const meta = JSON_METHODS[name];
      if (!meta) {
        const s = suggest(name, Object.keys(JSON_METHODS));
        this.error(`У JSON-значения нет метода ${name}()`, m, s ? `Возможно, ${s}()?` : undefined);
      }
      const args = e.args.map((a) => { const r = this.ex(a); return r.t.k === 'json' ? r.c : this.plainJsonVal(r); });
      return { c: `${o.c}.${name}(${args.join(', ')})`, t: tyFromName(meta), tmp: true };
    }
    if (t.k === 'cls' && t.user) {
      let ci = this.classes.get(t.name);
      while (ci) {
        const ms = ci.methods.get(name);
        if (ms) {
          const sig = this.pickOverload(ms, e.args.length, `${t.name}::${name}`, e);
          return { c: `(yield* ${o.c}.${sig.js}(${this.callArgs(sig, e.args, e).join(', ')}))`, t: sig.ret, tmp: true };
        }
        if (ci.fields.has(name)) {
          const f = ci.fields.get(name)!;
          if (f.ty.k === 'fn') return { c: `(yield* ${o.c}.$${name}(${e.args.map((a) => this.ex(a).c).join(', ')}))`, t: f.ty.ret, tmp: true };
          this.error(`${name} — поле, а не метод`, m);
        }
        ci = ci.base ? this.classes.get(ci.base) : undefined;
      }
      const all = [...(this.classes.get(t.name)?.methods.keys() ?? [])];
      const s = suggest(name, all);
      this.error(`В классе ${t.name} нет метода ${name}()`, m, s ? `Возможно, ${s}()?` : undefined);
    }
    if (t.k === 'cls') {
      const meta = CLASSES[t.name];
      if (!meta) this.error(`У ${t.name} нет методов`, m);
      const mt = meta.methods[name];
      if (!mt) {
        const s = suggest(name, Object.keys(meta.methods));
        this.error(`У ${t.name} нет метода ${name}()`, m, s ? `Возможно, вы имели в виду ${s}()?` : 'Проверьте регистр букв в имени метода');
      }
      const blocking = mt.includes('*');
      const printable = mt.includes('~');
      const ret = tyFromName(mt.replace(/^[*~]+/, ''));
      this.libMethodChecks(t.name, name, e);
      let args = this.libArgs(e.args, printable);
      if (t.name === 'HardwareSerial' && name === 'printf') args = [this.plainArg(this.ex(e.args[0])), ...e.args.slice(1).map((a) => this.fmtArg(a))];
      const c = `${o.c}.${name}(${args.join(', ')})`;
      return { c: blocking ? `(yield* ${c})` : c, t: ret, tmp: true };
    }
    if (t.k === 'any') {
      return { c: `${o.c}.${name}(${e.args.map((a) => this.ex(a).c).join(', ')})`, t: T.any, tmp: true };
    }
    if (t.k === 'arr') this.error(`У массива нет метода ${name}()`, m, name === 'length' || name === 'size' ? 'Длину массива считают так: sizeof(arr) / sizeof(arr[0])' : undefined);
    this.error(`У значения типа ${tyName(t)} нет метода ${name}()`, m);
  }

  jsonKind(t: Ty): string {
    switch (t.k) {
      case 'int': return t.ch ? 'char' : 'int';
      case 'float': return 'float';
      case 'bool': return 'bool';
      case 'String': return 'String';
      case 'cstr': return 'cstr';
      default: return 'variant';
    }
  }

  libMethodChecks(cls: string, name: string, e: Extract<Expr, { kind: 'call' }>): void {
    if (cls === 'HardwareSerial' && (name === 'print' || name === 'println') && e.args.length > 2) {
      this.error(`Serial.${name} принимает одно значение (и, необязательно, формат)`, e, 'Выведите по частям или используйте Serial.printf("…%d…", x)');
    }
    if (cls === 'HardwareSerial' && name === 'begin' && e.args.length === 0) {
      this.error('Serial.begin требует скорость, например Serial.begin(115200)', e);
    }
    if (cls === 'WiFiClass' && name === 'begin') this.features.add('wifi');
    if (cls === 'PubSubClient') this.features.add('mqtt');
    if (cls === 'HTTPClient') this.features.add('http');
    if (cls === 'WebServer') this.features.add('webserver');
  }

  stringMethod(o: R, name: string, e: Extract<Expr, { kind: 'call' }>): R {
    const A = e.args;
    const arg = (i: number): string => {
      const r = this.ex(A[i]);
      if (r.t.k === 'int' && r.t.ch) return `String.fromCharCode(${r.c})`;
      if (r.t.k === 'String') return r.c;
      if (r.t.k === 'cstr' || isCharArr(r.t)) return `R.cs(${r.c})`;
      return r.c;
    };
    const nums = (i: number): string => this.ex(A[i]).c;
    const mutate = (val: string, ret: Ty = T.void): R => {
      if (!o.lv || o.lv.kind === 'readonly') return { c: val, t: T.String };
      return { c: `(${this.store(o.lv, val)}${ret.k === 'void' ? ', undefined' : ', true'})`, t: ret };
    };
    switch (name) {
      case 'length': return { c: `${o.c}.length`, t: T.u32 };
      case 'c_str': return { c: o.c, t: T.cstr };
      case 'isEmpty': return { c: `(${o.c}.length === 0)`, t: T.bool };
      case 'charAt': return { c: `R.chAt(${o.c}, ${nums(0)})`, t: T.char };
      case 'indexOf': return { c: `${o.c}.indexOf(${arg(0)}${A[1] ? `, ${nums(1)}` : ''})`, t: T.i32 };
      case 'lastIndexOf': return { c: `${o.c}.lastIndexOf(${arg(0)}${A[1] ? `, ${nums(1)}` : ''})`, t: T.i32 };
      case 'substring': return { c: `R.S.substring(${o.c}, ${nums(0)}${A[1] ? `, ${nums(1)}` : ''})`, t: T.String, tmp: true };
      case 'startsWith': return { c: `${o.c}.startsWith(${arg(0)}${A[1] ? `, ${nums(1)}` : ''})`, t: T.bool };
      case 'endsWith': return { c: `${o.c}.endsWith(${arg(0)})`, t: T.bool };
      case 'equals': return { c: `(${o.c} === ${arg(0)})`, t: T.bool };
      case 'equalsIgnoreCase': return { c: `(${o.c}.toLowerCase() === ${arg(0)}.toLowerCase())`, t: T.bool };
      case 'compareTo': return { c: `R.S.compareTo(${o.c}, ${arg(0)})`, t: T.i32 };
      case 'toInt': return { c: `R.S.toInt(${o.c})`, t: T.i32 };
      case 'toFloat': return { c: `R.S.toFloat(${o.c})`, t: T.f32 };
      case 'toDouble': return { c: `R.S.toFloat(${o.c})`, t: T.f64 };
      case 'trim': return mutate(`${o.c}.trim()`);
      case 'toUpperCase': return mutate(`${o.c}.toUpperCase()`);
      case 'toLowerCase': return mutate(`${o.c}.toLowerCase()`);
      case 'replace': return mutate(`${o.c}.split(${arg(0)}).join(${arg(1)})`);
      case 'remove': return mutate(`R.S.remove(${o.c}, ${nums(0)}${A[1] ? `, ${nums(1)}` : ''})`);
      case 'concat': {
        const r = this.ex(A[0]);
        return mutate(`${o.c} + ${this.strOf(r, A[0])}`, T.bool);
      }
      case 'setCharAt': return mutate(`R.setCh(${o.c}, ${nums(0)}, ${nums(1)})`);
      case 'reserve': return { c: 'true', t: T.bool };
      case 'toCharArray': case 'getBytes': {
        const buf = this.ex(A[0]);
        if (buf.t.k !== 'arr') this.error(`${name}: первым аргументом должен быть массив`, A[0]);
        return { c: `R.strcpy(${buf.c}, ${o.c}, ${A[1] ? `${nums(1)} - 1` : 'Infinity'})`, t: T.void };
      }
      case 'clear': return mutate('""');
      default: {
        const all = ['length', 'c_str', 'charAt', 'indexOf', 'lastIndexOf', 'substring', 'startsWith', 'endsWith', 'equals', 'equalsIgnoreCase', 'compareTo', 'toInt', 'toFloat', 'trim', 'toUpperCase', 'toLowerCase', 'replace', 'remove', 'concat', 'setCharAt', 'toCharArray', 'isEmpty'];
        const s = suggest(name, all);
        this.error(`У String нет метода ${name}()`, e, s ? `Возможно, ${s}()?` : undefined);
      }
    }
  }
}
