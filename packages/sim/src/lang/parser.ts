// Рекурсивный парсер подмножества C++ для скетчей Arduino.
import type {
  Block, ClassDecl, Declarator, EnumDecl, Expr, FuncDecl, Param, Program, Stmt, TopLevel, TypeSpec,
  TypedefDecl, VarDecl,
} from './ast';
import { CompileError, type Token } from './lexer';
import { IGNORED_QUALIFIERS, LIB_TYPES, PRIMITIVE_WORDS, TYPE_MODIFIERS } from './known';

const BIN_PREC: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
  '<': 7, '<=': 7, '>': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const TEMPLATE_METHODS = new Set(['as', 'is', 'to', 'add', 'createNestedArray', 'get']);

export function parse(tokens: Token[], extraTypes: Iterable<string> = []): Program {
  return new Parser(tokens, extraTypes).program();
}

class Parser {
  i = 0;
  userTypes = new Set<string>();
  /** typedef-указатели на функции */
  fnTypes = new Set<string>();

  constructor(private t: Token[], extraTypes: Iterable<string>) {
    for (const x of extraTypes) this.userTypes.add(x);
    // предварительный проход: собираем имена пользовательских типов
    for (let k = 0; k < t.length - 1; k++) {
      const a = t[k];
      if (a.k !== 'id') continue;
      if ((a.v === 'struct' || a.v === 'class' || a.v === 'union') && t[k + 1].k === 'id') this.userTypes.add(t[k + 1].v);
      if (a.v === 'enum') {
        let j = k + 1;
        if (t[j].k === 'id' && (t[j].v === 'class' || t[j].v === 'struct')) j++;
        if (t[j].k === 'id') this.userTypes.add(t[j].v);
      }
      if (a.v === 'using' && t[k + 1].k === 'id' && t[k + 2]?.v === '=') this.userTypes.add(t[k + 1].v);
      if (a.v === 'typedef') {
        // имя — последний идентификатор перед ';' на верхнем уровне скобок
        let j = k + 1;
        let depth = 0;
        let last = '';
        let fnName = '';
        for (; j < t.length; j++) {
          const b = t[j];
          if (b.k === 'op' && (b.v === '{' || b.v === '(')) depth++;
          if (b.k === 'op' && (b.v === '}' || b.v === ')')) depth--;
          if (b.k === 'op' && b.v === ';' && depth <= 0) break;
          if (b.k === 'op' && b.v === '*' && t[j - 1]?.v === '(' && t[j + 1]?.k === 'id') fnName = t[j + 1].v;
          if (b.k === 'id' && depth === 0) last = b.v;
        }
        if (fnName) { this.userTypes.add(fnName); this.fnTypes.add(fnName); } else if (last) this.userTypes.add(last);
      }
    }
  }

  // ------------- утилиты -------------
  get cur(): Token { return this.t[this.i]; }
  peek(o = 1): Token { return this.t[Math.min(this.i + o, this.t.length - 1)]; }
  next(): Token { return this.t[this.i++]; }
  isOp(v: string, o = 0): boolean { const x = this.peek(o); return x.k === 'op' && x.v === v; }
  isId(v?: string, o = 0): boolean { const x = this.peek(o); return x.k === 'id' && (v === undefined || x.v === v); }
  eatOp(v: string): boolean { if (this.isOp(v)) { this.i++; return true; } return false; }
  eatId(v: string): boolean { if (this.isId(v)) { this.i++; return true; } return false; }

  err(msg: string, tok: Token = this.cur, hint?: string): never {
    throw new CompileError(msg, tok.line, tok.col, hint);
  }

  describe(tok: Token): string {
    if (tok.k === 'eof') return 'конец файла';
    if (tok.k === 'str') return `строка "${tok.v}"`;
    return `«${tok.v}»`;
  }

  expectOp(v: string, what?: string): Token {
    if (this.isOp(v)) return this.next();
    const prev = this.t[this.i - 1];
    if (v === ';' && prev) {
      throw new CompileError(`Пропущена «;» в конце строки${what ? ` (${what})` : ''}`, prev.line, prev.col + prev.v.length,
        'Каждая инструкция в C++ заканчивается точкой с запятой');
    }
    if (v === ')' || v === '}' || v === ']') {
      this.err(`Ожидалась «${v}», а встретилось ${this.describe(this.cur)}`, this.cur, 'Проверьте, что все скобки закрыты');
    }
    this.err(`Ожидалась «${v}»${what ? ` ${what}` : ''}, а встретилось ${this.describe(this.cur)}`);
  }

  expectId(what: string): Token {
    if (this.cur.k === 'id') return this.next();
    this.err(`Ожидалось имя ${what}, а встретилось ${this.describe(this.cur)}`);
  }

  // ------------- типы -------------
  isTypeName(name: string): boolean {
    return name in PRIMITIVE_WORDS || TYPE_MODIFIERS.has(name) || this.userTypes.has(name) || LIB_TYPES.has(name);
  }

  /** Может ли с текущей позиции начинаться тип. */
  isTypeStart(o = 0): boolean {
    const x = this.peek(o);
    if (x.k !== 'id') return false;
    if (x.v === 'const' || x.v === 'struct' || x.v === 'enum' || x.v === 'unsigned' || x.v === 'signed') return true;
    if (IGNORED_QUALIFIERS.has(x.v) && x.v !== 'typename') return this.isTypeStart(o + 1) || x.v === 'volatile';
    if (x.v === 'std' && this.isOp('::', o + 1)) return ['string', 'vector', 'array', 'function'].includes(this.peek(o + 2).v);
    return this.isTypeName(x.v);
  }

  parseType(): TypeSpec {
    const start = this.cur;
    let isConst = false;
    let unsigned: boolean | null = null;
    let longs = 0;
    let short = false;
    let base = '';
    let tmpl: TypeSpec['tmpl'];
    for (;;) {
      const x = this.cur;
      if (x.k !== 'id') break;
      if (x.v === 'const') { isConst = true; this.i++; continue; }
      if (IGNORED_QUALIFIERS.has(x.v) || x.v === 'struct' || x.v === 'enum' || x.v === 'union') { this.i++; continue; }
      if (x.v === 'unsigned') { unsigned = true; this.i++; continue; }
      if (x.v === 'signed') { unsigned = false; this.i++; continue; }
      if (x.v === 'long') { longs++; this.i++; continue; }
      if (x.v === 'short') { short = true; this.i++; continue; }
      if (base) break;
      if (x.v === 'std' && this.isOp('::', 1)) {
        this.i += 2;
        const nm = this.expectId('типа').v;
        base = nm === 'string' ? 'String' : `std::${nm}`;
        continue;
      }
      if (x.v in PRIMITIVE_WORDS || this.userTypes.has(x.v) || LIB_TYPES.has(x.v)) {
        // int / char / double могут сочетаться с long/unsigned
        base = x.v;
        this.i++;
        continue;
      }
      break;
    }
    // шаблонные аргументы
    if (base && this.isOp('<')) {
      this.i++;
      tmpl = [];
      while (!this.isOp('>')) {
        if (this.cur.k === 'num') tmpl.push(this.next().n!);
        else tmpl.push(this.parseType());
        if (!this.eatOp(',')) break;
      }
      // '>>' в std::vector<std::vector<int>> не поддерживаем — достаточно одного уровня
      this.expectOp('>', 'в конце аргументов шаблона');
    }
    let canon: string;
    if (!base) {
      if (longs === 0 && unsigned === null && !short) this.err(`Ожидался тип, а встретилось ${this.describe(this.cur)}`, start);
      base = 'int';
    }
    if (base === 'int' || base === 'char' || base === 'double') {
      if (base === 'double') canon = 'double';
      else if (base === 'char') canon = unsigned === true ? 'uint8' : unsigned === false ? 'int8' : 'char';
      else if (short) canon = unsigned ? 'uint16' : 'int16';
      else if (longs >= 2) canon = unsigned ? 'uint64' : 'int64';
      else canon = unsigned ? 'uint32' : 'int32';
    } else if (base in PRIMITIVE_WORDS) {
      canon = PRIMITIVE_WORDS[base];
      if (unsigned && canon === 'int32') canon = 'uint32';
    } else canon = base;
    // trailing const, указатели и ссылки
    let ptr = 0;
    let ref = false;
    for (;;) {
      if (this.isId('const')) { this.i++; continue; }
      if (this.isOp('*')) { ptr++; this.i++; continue; }
      if (this.isOp('&')) { ref = true; this.i++; continue; }
      if (this.isOp('&&')) { ref = true; this.i++; continue; }
      break;
    }
    return { base: canon, tmpl, isConst, ptr, ref, line: start.line };
  }

  /** Похоже ли продолжение на объявление переменной/функции. */
  looksLikeDecl(): boolean {
    if (!this.isTypeStart()) return false;
    const save = this.i;
    try {
      this.parseType();
      if (this.isOp('(') && this.isOp('*', 1)) return true; // указатель на функцию
      return this.cur.k === 'id';
    } catch {
      return false;
    } finally {
      this.i = save;
    }
  }

  // ------------- верхний уровень -------------
  program(): Program {
    const items: TopLevel[] = [];
    while (this.cur.k !== 'eof') {
      if (this.eatOp(';')) continue;
      items.push(...this.topLevel());
    }
    return { items };
  }

  topLevel(): TopLevel[] {
    const x = this.cur;
    if (x.k === 'id') {
      if (x.v === 'using') {
        this.i++;
        if (this.eatId('namespace')) { while (!this.isOp(';') && this.cur.k !== 'eof') this.i++; this.expectOp(';'); return []; }
        const name = this.expectId('типа').v;
        this.expectOp('=');
        const type = this.parseType();
        this.expectOp(';');
        return [{ kind: 'typedef', name, type, line: x.line }];
      }
      if (x.v === 'template') this.err('Шаблоны (template) в симуляторе не поддерживаются', x, 'Напишите отдельные функции для нужных типов');
      if (x.v === 'namespace') this.err('Собственные namespace в симуляторе не поддерживаются', x);
      if (x.v === 'typedef') return [this.typedef()];
      if ((x.v === 'struct' || x.v === 'class' || x.v === 'union') && this.peek().k === 'id' && (this.isOp('{', 2) || this.isOp(':', 2))) {
        const cls = this.classDecl();
        const res: TopLevel[] = [cls];
        if (!this.isOp(';')) {
          // struct Point {...} p1, p2;
          const type: TypeSpec = { base: cls.name, ptr: 0, ref: false, line: cls.line };
          res.push(this.varDeclRest(type, false, x.line));
        } else this.i++;
        return res;
      }
      if (x.v === 'enum' && (this.isOp('{', 1) || this.isOp('{', 2) || this.isOp('{', 3) || this.isOp(':', 2) || this.isOp(':', 3))) {
        const e = this.enumDecl();
        this.eatOp(';');
        return [e];
      }
    }
    let isStatic = false;
    while (this.isId('static') || this.isId('inline') || this.isId('extern')) { if (this.cur.v === 'static') isStatic = true; this.i++; }
    if (this.cur.k === 'id' && !this.isTypeStart()) {
      // Возможно, вызов функции вне функции или опечатка в типе
      const tok = this.cur;
      if (this.isOp('(', 1) || this.isOp('.', 1) || this.isOp('=', 1)) {
        this.err(`Код «${tok.v}…» находится вне функции`, tok, 'Команды должны быть внутри setup() или loop()');
      }
      if (this.peek().k === 'id') this.err(`Неизвестный тип «${tok.v}»`, tok, this.typeHint(tok.v));
      this.err(`Неожиданное ${this.describe(tok)} вне функции`, tok);
    }
    if (this.cur.k !== 'id') this.err(`Неожиданное ${this.describe(this.cur)} вне функции`, this.cur, this.cur.v === '}' ? 'Похоже, лишняя закрывающая скобка }' : undefined);
    const startLine = this.cur.line;
    // конструктор/деструктор вне класса: Led::Led(int p) : pin(p) {}
    if (this.userTypes.has(this.cur.v) && this.isOp('::', 1) && (this.peek(2).v === this.cur.v || this.isOp('~', 2))) {
      const owner = this.next().v;
      this.i++;
      if (this.eatOp('~')) {
        this.i++;
        this.func({ base: 'void', ptr: 0, ref: false, line: startLine }, '~', startLine, owner);
        return [];
      }
      this.i++;
      return [this.func({ base: 'void', ptr: 0, ref: false, line: startLine }, owner, startLine, owner, true)];
    }
    const type = this.parseType();
    // указатель на функцию: void (*cb)(int) = f;
    if (this.isOp('(') && this.isOp('*', 1)) return [this.fnPtrDecl(type, isStatic)];
    const nameTok = this.expectId('переменной или функции');
    let owner: string | undefined;
    let name = nameTok.v;
    if (this.isOp('::')) {
      // void Led::on() {...}
      this.i++;
      owner = name;
      name = this.expectId('метода').v;
    }
    if (this.isOp('(') && (owner || this.isFuncParamList())) {
      return [this.func(type, name, startLine, owner)];
    }
    this.i--;
    if (owner) this.err('Статические поля классов не поддерживаются', nameTok);
    return [this.varDeclRest(type, isStatic, startLine)];
  }

  typeHint(name: string): string | undefined {
    const lower = name.toLowerCase();
    const all = [...Object.keys(PRIMITIVE_WORDS), ...LIB_TYPES];
    const exact = all.find((n) => n.toLowerCase() === lower);
    if (exact) return `Регистр важен: правильно «${exact}»`;
    if (lower === 'integer') return 'В C++ целый тип называется int';
    if (lower === 'str' || lower === 'string') return 'Строковый тип в Arduino — String';
    return 'Возможно, не подключена библиотека (#include) или опечатка в имени типа';
  }

  /** После '(' — список параметров функции, а не аргументы конструктора? */
  isFuncParamList(): boolean {
    if (!this.isOp('(')) return false;
    if (this.isOp(')', 1)) {
      // int f(); — прототип; DHT d(); — тоже прототип в C++
      return true;
    }
    if (this.isId('void', 1) && this.isOp(')', 2)) return true;
    const save = this.i;
    this.i++;
    const res = this.isTypeStart();
    this.i = save;
    return res;
  }

  fnPtrDecl(ret: TypeSpec, isStatic: boolean): VarDecl {
    const line = this.cur.line;
    this.expectOp('(');
    this.expectOp('*');
    const nameTok = this.expectId('указателя на функцию');
    this.expectOp(')');
    this.skipBalanced('(', ')');
    const d: Declarator = { name: nameTok.v, dims: [], line: nameTok.line, col: nameTok.col, ptr: 0, ref: false };
    if (this.eatOp('=')) d.init = this.assignExpr();
    this.expectOp(';');
    return { kind: 'var', type: { base: '__fnptr', ptr: 0, ref: false, line, tmpl: [ret] }, decls: [d], isStatic, line };
  }

  skipBalanced(open: string, close: string): void {
    this.expectOp(open);
    let depth = 1;
    while (depth > 0) {
      if (this.cur.k === 'eof') this.err(`Не закрыта скобка «${open}»`);
      if (this.isOp(open)) depth++;
      if (this.isOp(close)) depth--;
      this.i++;
    }
  }

  typedef(): TypedefDecl | ClassDecl | EnumDecl {
    const line = this.next().line; // typedef
    if ((this.isId('struct') || this.isId('class')) && (this.isOp('{', 1) || this.isOp('{', 2))) {
      // typedef struct [Tag] { ... } Name;
      this.i++;
      if (this.cur.k === 'id') this.i++;
      const cls = this.classBody('', line);
      cls.name = this.expectId('типа').v;
      this.expectOp(';');
      return cls;
    }
    if (this.isId('enum') && (this.isOp('{', 1) || this.isOp('{', 2))) {
      const e = this.enumDecl();
      e.name = this.expectId('типа').v;
      this.expectOp(';');
      return e;
    }
    const type = this.parseType();
    if (this.isOp('(') && this.isOp('*', 1)) {
      this.i += 2;
      const name = this.expectId('типа').v;
      this.expectOp(')');
      this.skipBalanced('(', ')');
      this.expectOp(';');
      return { kind: 'typedef', name, type: { base: '__fnptr', ptr: 0, ref: false, line, tmpl: [type] }, line };
    }
    const name = this.expectId('типа').v;
    while (this.isOp('[')) {
      this.err('typedef массивов не поддерживается', this.cur);
    }
    this.expectOp(';');
    return { kind: 'typedef', name, type, line };
  }

  classDecl(): ClassDecl {
    const line = this.next().line; // struct/class
    const name = this.expectId('класса').v;
    return this.classBody(name, line);
  }

  classBody(name: string, line: number): ClassDecl {
    let base: string | undefined;
    if (this.eatOp(':')) {
      this.eatId('public') || this.eatId('private') || this.eatId('protected');
      base = this.expectId('базового класса').v;
    }
    this.expectOp('{', 'в начале описания класса');
    const cls: ClassDecl = { kind: 'class', name, base, fields: [], methods: [], line };
    while (!this.isOp('}')) {
      if (this.cur.k === 'eof') this.err(`Не закрыто описание класса ${name}: не хватает «}»`);
      if (this.eatOp(';')) continue;
      if ((this.isId('public') || this.isId('private') || this.isId('protected')) && this.isOp(':', 1)) { this.i += 2; continue; }
      if (this.isId('friend')) this.err('friend не поддерживается');
      let isStatic = false;
      while (this.isId('static') || this.isId('virtual') || this.isId('inline') || this.isId('explicit')) { if (this.cur.v === 'static') isStatic = true; this.i++; }
      // конструктор
      if (this.isId(name) && this.isOp('(', 1)) {
        const l = this.next().line;
        cls.methods.push(this.func({ base: 'void', ptr: 0, ref: false, line: l }, name, l, name, true));
        continue;
      }
      // деструктор
      if (this.isOp('~')) {
        this.i += 2;
        this.func({ base: 'void', ptr: 0, ref: false, line: this.cur.line }, '~', this.cur.line, name);
        continue;
      }
      if (this.isId('enum')) { this.err('enum внутри класса не поддерживается — объявите его выше класса'); }
      const type = this.parseType();
      if (this.isId('operator')) this.err('Перегрузка операторов не поддерживается');
      const nameTok = this.expectId('поля или метода');
      if (this.isOp('(')) {
        const f = this.func(type, nameTok.v, nameTok.line, name);
        f.isStatic = isStatic;
        cls.methods.push(f);
        continue;
      }
      this.i--;
      if (isStatic) this.err('Статические поля классов не поддерживаются — используйте глобальную переменную', nameTok);
      cls.fields.push(this.varDeclRest(type, false, nameTok.line));
    }
    this.expectOp('}');
    return cls;
  }

  enumDecl(): EnumDecl {
    const line = this.next().line; // enum
    let scoped = false;
    if (this.isId('class') || this.isId('struct')) { this.i++; scoped = true; }
    let name: string | null = null;
    if (this.cur.k === 'id') name = this.next().v;
    if (this.eatOp(':')) this.parseType();
    this.expectOp('{', 'в начале enum');
    const members: EnumDecl['members'] = [];
    while (!this.isOp('}')) {
      const m = this.expectId('элемента enum');
      let value: Expr | undefined;
      if (this.eatOp('=')) value = this.condExpr();
      members.push({ name: m.v, value, line: m.line });
      if (!this.eatOp(',')) break;
    }
    this.expectOp('}', 'в конце enum');
    return { kind: 'enum', name, scoped, members, line };
  }

  func(ret: TypeSpec, name: string, line: number, owner?: string, isCtor = false): FuncDecl {
    this.expectOp('(');
    const params: Param[] = [];
    if (this.isId('void') && this.isOp(')', 1)) this.i++;
    while (!this.isOp(')')) {
      if (this.isOp('...')) this.err('Функции с переменным числом аргументов не поддерживаются');
      const pt = this.parseType();
      let pname = '';
      if (this.isOp('(') && this.isOp('*', 1)) {
        // параметр — указатель на функцию
        this.i += 2;
        pname = this.expectId('параметра').v;
        this.expectOp(')');
        this.skipBalanced('(', ')');
        params.push({ type: { base: '__fnptr', ptr: 0, ref: false, line: pt.line, tmpl: [pt] }, name: pname, dims: [], line: pt.line });
      } else {
        if (this.cur.k === 'id') pname = this.next().v;
        const dims: (Expr | null)[] = [];
        while (this.eatOp('[')) {
          dims.push(this.isOp(']') ? null : this.condExpr());
          this.expectOp(']');
        }
        let def: Expr | undefined;
        if (this.eatOp('=')) def = this.assignExpr();
        params.push({ type: pt, name: pname || `__unnamed${params.length}`, dims, def, line: pt.line });
      }
      if (!this.eatOp(',')) break;
    }
    this.expectOp(')', 'после параметров функции');
    while (this.isId('const') || this.isId('override') || this.isId('noexcept') || this.isId('final')) this.i++;
    let inits: FuncDecl['inits'];
    if (isCtor && this.eatOp(':')) {
      inits = [];
      do {
        const f = this.expectId('поля');
        const args: Expr[] = [];
        if (this.eatOp('(')) {
          while (!this.isOp(')')) { args.push(this.assignExpr()); if (!this.eatOp(',')) break; }
          this.expectOp(')');
        } else {
          this.expectOp('{');
          while (!this.isOp('}')) { args.push(this.assignExpr()); if (!this.eatOp(',')) break; }
          this.expectOp('}');
        }
        inits.push({ name: f.v, args, line: f.line });
      } while (this.eatOp(','));
    }
    if (this.isOp('=') && (this.peek().v === '0' || this.peek().v === 'default' || this.peek().v === 'delete')) {
      this.i += 2;
      this.expectOp(';');
      return { kind: 'func', name, owner, ret, params, body: null, line, isCtor, inits };
    }
    if (this.eatOp(';')) return { kind: 'func', name, owner, ret, params, body: null, line, isCtor, inits };
    if (!this.isOp('{')) this.err(`Ожидалось тело функции «{», а встретилось ${this.describe(this.cur)}`);
    const body = this.block();
    return { kind: 'func', name, owner, ret, params, body, line, isCtor, inits };
  }

  varDeclRest(type: TypeSpec, isStatic: boolean, line: number): VarDecl {
    const decls: Declarator[] = [];
    do {
      let ptr = 0;
      let ref = false;
      while (this.isOp('*') || this.isOp('&')) { if (this.cur.v === '*') ptr++; else ref = true; this.i++; }
      while (this.isId('const')) this.i++;
      const nameTok = this.cur;
      if (nameTok.k !== 'id') this.err(`Ожидалось имя переменной, а встретилось ${this.describe(nameTok)}`);
      if (this.isTypeName(nameTok.v) && !(this.isOp(';', 1) || this.isOp('=', 1) || this.isOp('[', 1) || this.isOp('(', 1) || this.isOp(',', 1))) {
        this.err(`«${nameTok.v}» — имя типа, его нельзя использовать как имя переменной`, nameTok);
      }
      this.i++;
      const d: Declarator = { name: nameTok.v, dims: [], line: nameTok.line, col: nameTok.col, ptr, ref };
      while (this.eatOp('[')) {
        d.dims.push(this.isOp(']') ? null : this.condExpr());
        this.expectOp(']', 'после размера массива');
      }
      if (this.eatOp('=')) {
        d.init = this.isOp('{') ? this.initList() : this.assignExpr();
      } else if (this.isOp('(')) {
        this.i++;
        const args: Expr[] = [];
        while (!this.isOp(')')) { args.push(this.assignExpr()); if (!this.eatOp(',')) break; }
        this.expectOp(')', 'после аргументов конструктора');
        d.ctorArgs = args;
      } else if (this.isOp('{')) {
        const il = this.initList();
        if (il.kind === 'initlist' && d.dims.length === 0 && type.base !== 'String' && !(type.base in PRIMITIVE_WORDS)) d.ctorArgs = il.items;
        else d.init = il.kind === 'initlist' && d.dims.length === 0 && il.items.length === 1 ? il.items[0] : il;
      }
      decls.push(d);
    } while (this.eatOp(','));
    this.expectOp(';', 'после объявления переменной');
    return { kind: 'var', type, decls, isStatic, line };
  }

  initList(): Expr {
    const s = this.expectOp('{');
    const items: Expr[] = [];
    while (!this.isOp('}')) {
      items.push(this.isOp('{') ? this.initList() : this.assignExpr());
      if (!this.eatOp(',')) break;
    }
    this.expectOp('}', 'в конце списка инициализации');
    return { kind: 'initlist', items, line: s.line, col: s.col };
  }

  // ------------- операторы -------------
  block(): Block {
    const s = this.expectOp('{');
    const body: Stmt[] = [];
    while (!this.isOp('}')) {
      if (this.cur.k === 'eof') {
        throw new CompileError('Не хватает закрывающей фигурной скобки «}»', s.line, s.col,
          `Блок, открытый в строке ${s.line}, не закрыт`);
      }
      body.push(this.stmt());
    }
    const e = this.next();
    return { kind: 'block', body, line: s.line, endLine: e.line };
  }

  stmt(): Stmt {
    const x = this.cur;
    if (x.k === 'op') {
      if (x.v === '{') return this.block();
      if (x.v === ';') { this.i++; return { kind: 'empty', line: x.line }; }
    }
    if (x.k === 'id') {
      switch (x.v) {
        case 'if': {
          this.i++;
          this.expectOp('(', 'после if');
          const cond = this.expr();
          this.expectOp(')', 'после условия if');
          if (this.isOp(';')) {
            // if (x); — классическая ошибка
            throw new CompileError('Лишняя «;» сразу после if (…) — тело условия будет пустым', this.cur.line, this.cur.col);
          }
          const then = this.stmt();
          let els: Stmt | undefined;
          if (this.eatId('else')) els = this.stmt();
          return { kind: 'if', cond, then, else: els, line: x.line };
        }
        case 'else':
          this.err('else без if', x, 'Проверьте фигурные скобки и точку с запятой перед else');
          break;
        case 'while': {
          this.i++;
          this.expectOp('(', 'после while');
          const cond = this.expr();
          this.expectOp(')', 'после условия while');
          const body = this.stmt();
          return { kind: 'while', cond, body, line: x.line };
        }
        case 'do': {
          this.i++;
          const body = this.stmt();
          if (!this.eatId('while')) this.err('После do { … } ожидалось while (…);');
          this.expectOp('(');
          const cond = this.expr();
          this.expectOp(')');
          this.expectOp(';', 'после do … while');
          return { kind: 'do', cond, body, line: x.line };
        }
        case 'for':
          return this.forStmt();
        case 'switch':
          return this.switchStmt();
        case 'break':
        case 'continue':
          this.i++;
          this.expectOp(';', `после ${x.v}`);
          return { kind: x.v, line: x.line };
        case 'return': {
          this.i++;
          if (this.eatOp(';')) return { kind: 'return', line: x.line };
          const value = this.isOp('{') ? this.initList() : this.expr();
          this.expectOp(';', 'после return');
          return { kind: 'return', value, line: x.line };
        }
        case 'case':
        case 'default':
          this.err(`${x.v} вне switch`, x);
          break;
        case 'goto':
          this.err('goto не поддерживается', x);
          break;
        case 'struct':
        case 'class':
          if (this.peek().k === 'id' && this.isOp('{', 2)) {
            const decl = this.classDecl();
            this.expectOp(';');
            return { kind: 'localtype', decl, line: x.line };
          }
          break;
        case 'enum': {
          if (this.isOp('{', 1) || this.isOp('{', 2) || this.isOp('{', 3)) {
            const decl = this.enumDecl();
            this.expectOp(';');
            return { kind: 'localtype', decl, line: x.line };
          }
          break;
        }
        case 'typedef':
          return { kind: 'localtype', decl: this.typedef(), line: x.line };
        case 'static': {
          this.i++;
          const type = this.parseType();
          return this.varDeclRest(type, true, x.line);
        }
        default:
          break;
      }
      if (this.isOp(':', 1) && !this.isOp('::', 1) && !this.isTypeStart()) this.err('Метки (label:) не поддерживаются', x);
      if (this.looksLikeDecl()) {
        const type = this.parseType();
        if (this.isOp('(') && this.isOp('*', 1)) return this.fnPtrDecl(type, false);
        return this.varDeclRest(type, false, x.line);
      }
      // «Неизвестный тип» name; — например, опечатка «Int x;»
      if (this.peek().k === 'id' && (this.isOp(';', 2) || this.isOp('=', 2)) && !this.isTypeStart()) {
        this.err(`Неизвестный тип «${x.v}»`, x, this.typeHint(x.v));
      }
    }
    const expr = this.expr();
    this.expectOp(';');
    return { kind: 'expr', expr, line: x.line };
  }

  forStmt(): Stmt {
    const line = this.next().line;
    this.expectOp('(', 'после for');
    let init: VarDecl | { kind: 'expr'; expr: Expr; line: number } | undefined;
    if (this.looksLikeDecl()) {
      const type = this.parseType();
      // range-for: for (int x : arr)
      if (this.cur.k === 'id' && this.isOp(':', 1)) {
        const name = this.next().v;
        this.i++;
        const iter = this.expr();
        this.expectOp(')');
        const body = this.stmt();
        return { kind: 'forrange', type, name, byRef: type.ref, iter, body, line };
      }
      init = this.varDeclRest(type, false, line);
    } else if (!this.eatOp(';')) {
      const e = this.expr();
      this.expectOp(';', 'в заголовке for');
      init = { kind: 'expr', expr: e, line };
    }
    let cond: Expr | undefined;
    if (!this.isOp(';')) cond = this.expr();
    if (this.isOp(',')) this.err('В заголовке for части разделяются «;», а не «,»');
    this.expectOp(';', 'в заголовке for');
    let update: Expr | undefined;
    if (!this.isOp(')')) update = this.expr();
    this.expectOp(')', 'после заголовка for');
    const body = this.stmt();
    return { kind: 'for', init, cond, update, body, line };
  }

  switchStmt(): Stmt {
    const line = this.next().line;
    this.expectOp('(', 'после switch');
    const disc = this.expr();
    this.expectOp(')');
    this.expectOp('{', 'после switch (…)');
    const cases: { test: Expr | null; body: Stmt[]; line: number }[] = [];
    while (!this.isOp('}')) {
      if (this.cur.k === 'eof') this.err('Не закрыт блок switch');
      if (this.isId('case')) {
        const l = this.next().line;
        const test = this.condExpr();
        if (this.isOp('...')) this.err('Диапазоны case a ... b не поддерживаются');
        this.expectOp(':', 'после case');
        cases.push({ test, body: [], line: l });
        continue;
      }
      if (this.isId('default')) {
        const l = this.next().line;
        this.expectOp(':', 'после default');
        cases.push({ test: null, body: [], line: l });
        continue;
      }
      if (!cases.length) this.err('Внутри switch код должен идти после case …:');
      cases[cases.length - 1].body.push(this.stmt());
    }
    this.i++;
    return { kind: 'switch', disc, cases, line };
  }

  // ------------- выражения -------------
  expr(): Expr {
    const first = this.assignExpr();
    if (!this.isOp(',')) return first;
    const items = [first];
    while (this.eatOp(',')) items.push(this.assignExpr());
    return { kind: 'comma', items, line: first.line, col: first.col };
  }

  assignExpr(): Expr {
    const lhs = this.condExpr();
    const x = this.cur;
    if (x.k === 'op' && ASSIGN_OPS.has(x.v)) {
      this.i++;
      const value = this.isOp('{') ? this.initList() : this.assignExpr();
      return { kind: 'assign', op: x.v, target: lhs, value, line: x.line, col: x.col };
    }
    return lhs;
  }

  condExpr(): Expr {
    const c = this.binary(1);
    if (this.isOp('?')) {
      const q = this.next();
      const a = this.assignExpr();
      this.expectOp(':', 'в тернарном операторе ?:');
      const b = this.assignExpr();
      return { kind: 'cond', c, a, b, line: q.line, col: q.col };
    }
    return c;
  }

  binary(minPrec: number): Expr {
    let left = this.unary();
    for (;;) {
      const x = this.cur;
      if (x.k !== 'op') {
        // and / or / not как альтернативные токены
        if (x.k === 'id' && (x.v === 'and' || x.v === 'or')) {
          const op = x.v === 'and' ? '&&' : '||';
          const prec = BIN_PREC[op];
          if (prec < minPrec) break;
          this.i++;
          const right = this.binary(prec + 1);
          left = { kind: 'binary', op, a: left, b: right, line: x.line, col: x.col };
          continue;
        }
        break;
      }
      const prec = BIN_PREC[x.v];
      if (prec === undefined || prec < minPrec) break;
      this.i++;
      const right = this.binary(prec + 1);
      left = { kind: 'binary', op: x.v, a: left, b: right, line: x.line, col: x.col };
    }
    return left;
  }

  unary(): Expr {
    const x = this.cur;
    if (x.k === 'op') {
      if (x.v === '!' || x.v === '~' || x.v === '-' || x.v === '+' || x.v === '++' || x.v === '--' || x.v === '&' || x.v === '*') {
        this.i++;
        const operand = this.unary();
        return { kind: 'unary', op: x.v, x: operand, postfix: false, line: x.line, col: x.col };
      }
      if (x.v === '(' && this.isTypeStart(1)) {
        // приведение типа (int)x — пробуем
        const save = this.i;
        this.i++;
        try {
          const type = this.parseType();
          if (this.isOp(')')) {
            this.i++;
            const operand = this.unary();
            return { kind: 'cast', type, x: operand, line: x.line, col: x.col };
          }
        } catch { /* не приведение */ }
        this.i = save;
      }
    }
    if (x.k === 'id') {
      if (x.v === 'not') {
        this.i++;
        return { kind: 'unary', op: '!', x: this.unary(), postfix: false, line: x.line, col: x.col };
      }
      if (x.v === 'sizeof') {
        this.i++;
        if (this.isOp('(') && this.isTypeStart(1)) {
          const save = this.i;
          this.i++;
          try {
            const type = this.parseType();
            if (this.eatOp(')')) return { kind: 'sizeof', type, line: x.line, col: x.col };
          } catch { /* выражение */ }
          this.i = save;
        }
        const operand = this.unary();
        return { kind: 'sizeof', x: operand, line: x.line, col: x.col };
      }
      if (x.v === 'new') {
        this.i++;
        const type = this.parseType();
        const args: Expr[] = [];
        if (this.eatOp('(')) {
          while (!this.isOp(')')) { args.push(this.assignExpr()); if (!this.eatOp(',')) break; }
          this.expectOp(')');
        }
        if (this.isOp('[')) this.err('new[] не поддерживается — используйте обычный массив');
        return { kind: 'new', type, args, line: x.line, col: x.col };
      }
      if (x.v === 'delete') this.err('delete не поддерживается (память освобождается автоматически)');
    }
    return this.postfix(this.primary());
  }

  postfix(e: Expr): Expr {
    for (;;) {
      const x = this.cur;
      if (x.k !== 'op') break;
      if (x.v === '(') {
        this.i++;
        const args: Expr[] = [];
        while (!this.isOp(')')) {
          args.push(this.isOp('{') ? this.initList() : this.assignExpr());
          if (!this.eatOp(',')) break;
        }
        this.expectOp(')', 'после аргументов функции');
        e = { kind: 'call', callee: e, args, line: e.line, col: e.col };
        continue;
      }
      if (x.v === '[') {
        this.i++;
        const idx = this.expr();
        this.expectOp(']');
        e = { kind: 'index', obj: e, idx, line: x.line, col: x.col };
        continue;
      }
      if (x.v === '.' || x.v === '->') {
        this.i++;
        const name = this.expectId('поля или метода после «.»');
        // шаблонный метод: doc["x"].as<int>()
        if (this.isOp('<') && TEMPLATE_METHODS.has(name.v)) {
          const save = this.i;
          try {
            this.i++;
            const tmpl: TypeSpec[] = [this.parseType()];
            this.expectOp('>');
            if (this.isOp('(')) {
              this.i++;
              const args: Expr[] = [];
              while (!this.isOp(')')) { args.push(this.assignExpr()); if (!this.eatOp(',')) break; }
              this.expectOp(')');
              e = { kind: 'call', callee: { kind: 'member', obj: e, name: name.v, arrow: x.v === '->', line: name.line, col: name.col }, args, tmpl, line: name.line, col: name.col };
              continue;
            }
          } catch { /* обычное сравнение */ }
          this.i = save;
        }
        e = { kind: 'member', obj: e, name: name.v, arrow: x.v === '->', line: name.line, col: name.col };
        continue;
      }
      if (x.v === '++' || x.v === '--') {
        this.i++;
        e = { kind: 'unary', op: x.v, x: e, postfix: true, line: x.line, col: x.col };
        continue;
      }
      break;
    }
    return e;
  }

  primary(): Expr {
    const x = this.cur;
    switch (x.k) {
      case 'num':
        this.i++;
        return { kind: 'num', v: x.n!, nt: x.nt!, text: x.v, line: x.line, col: x.col };
      case 'str':
        this.i++;
        return { kind: 'str', v: x.v, line: x.line, col: x.col };
      case 'chr':
        this.i++;
        return { kind: 'chr', v: x.n!, line: x.line, col: x.col };
      case 'op':
        if (x.v === '(') {
          this.i++;
          const e = this.expr();
          this.expectOp(')');
          return e;
        }
        if (x.v === '[') return this.lambda();
        if (x.v === '{') return this.initList();
        if (x.v === '::') { this.i++; return this.primary(); }
        this.err(`Ожидалось выражение, а встретилось ${this.describe(x)}`, x,
          x.v === ')' ? 'Возможно, лишняя скобка' : x.v === '}' ? 'Возможно, не хватает выражения или «;»' : undefined);
        break;
      case 'id': {
        if (x.v === 'true' || x.v === 'false') {
          this.i++;
          return { kind: 'bool', v: x.v === 'true', line: x.line, col: x.col };
        }
        if (x.v === 'NULL' || x.v === 'nullptr') { this.i++; return { kind: 'null', line: x.line, col: x.col }; }
        if (x.v === 'this') { this.i++; return { kind: 'this', line: x.line, col: x.col }; }
        // функциональное приведение: String(5), int(x), IPAddress(1,2,3,4)
        if (this.isTypeStart() && !(this.isOp('::', 1) && !(x.v === 'std'))) {
          const save = this.i;
          try {
            const type = this.parseType();
            if (this.isOp('(') || this.isOp('{')) {
              const close = this.isOp('(') ? ')' : '}';
              this.i++;
              const args: Expr[] = [];
              while (!this.isOp(close)) { args.push(this.assignExpr()); if (!this.eatOp(',')) break; }
              this.expectOp(close);
              return { kind: 'fcast', type, args, line: x.line, col: x.col };
            }
          } catch { /* не приведение */ }
          this.i = save;
        }
        this.i++;
        if (this.isOp('::')) {
          this.i++;
          const name = this.expectId('после «::»');
          return { kind: 'scoped', scope: x.v, name: name.v, line: x.line, col: x.col };
        }
        return { kind: 'id', name: x.v, line: x.line, col: x.col };
      }
      default:
        break;
    }
    this.err(x.k === 'eof' ? 'Неожиданный конец файла — не хватает «}» или «;»' : `Ожидалось выражение, а встретилось ${this.describe(x)}`, x);
  }

  lambda(): Expr {
    const s = this.next(); // [
    while (!this.isOp(']')) { if (this.cur.k === 'eof') this.err('Не закрыта «[» лямбды'); this.i++; }
    this.i++;
    const params: Param[] = [];
    if (this.eatOp('(')) {
      while (!this.isOp(')')) {
        const pt = this.parseType();
        const pname = this.cur.k === 'id' ? this.next().v : `__unnamed${params.length}`;
        const dims: (Expr | null)[] = [];
        while (this.eatOp('[')) {
          dims.push(this.isOp(']') ? null : this.condExpr());
          this.expectOp(']');
        }
        let def: Expr | undefined;
        if (this.eatOp('=')) def = this.assignExpr();
        params.push({ type: pt, name: pname, dims, def, line: pt.line });
        if (!this.eatOp(',')) break;
      }
      this.expectOp(')');
    }
    while (this.isId('mutable') || this.isId('noexcept')) this.i++;
    let ret: TypeSpec | undefined;
    if (this.eatOp('->')) ret = this.parseType();
    const body = this.block();
    return { kind: 'lambda', params, ret, body, line: s.line, col: s.col };
  }
}

export type { Block, ClassDecl, EnumDecl, FuncDecl, VarDecl };
