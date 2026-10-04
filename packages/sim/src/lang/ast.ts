// AST подмножества C++.

export interface TypeSpec {
  /** нормализованное базовое имя: int, uint32, float, String, DHT, Point… */
  base: string;
  /** аргументы шаблона: StaticJsonDocument<200>, std::vector<int> */
  tmpl?: (TypeSpec | number)[];
  isConst?: boolean;
  /** количество '*' */
  ptr: number;
  /** ссылка '&' */
  ref: boolean;
  line: number;
}

export interface Declarator {
  name: string;
  /** размеры массива; null — размер выводится из инициализатора */
  dims: (Expr | null)[];
  init?: Expr;
  /** аргументы конструктора: DHT dht(4, DHT22); */
  ctorArgs?: Expr[];
  line: number;
  col: number;
  /** указатель/ссылка на уровне декларатора: int *p, &r */
  ptr: number;
  ref: boolean;
}

export interface VarDecl {
  kind: 'var';
  type: TypeSpec;
  decls: Declarator[];
  isStatic: boolean;
  line: number;
}

export interface Param {
  type: TypeSpec;
  name: string;
  dims: (Expr | null)[];
  def?: Expr;
  line: number;
}

export interface FuncDecl {
  kind: 'func';
  name: string;
  /** Класс для определения вне класса: void Led::on() {} */
  owner?: string;
  ret: TypeSpec;
  params: Param[];
  body: Block | null;
  line: number;
  isCtor?: boolean;
  /** список инициализации конструктора */
  inits?: { name: string; args: Expr[]; line: number }[];
  isStatic?: boolean;
}

export interface ClassDecl {
  kind: 'class';
  name: string;
  base?: string;
  fields: VarDecl[];
  methods: FuncDecl[];
  line: number;
}

export interface EnumDecl {
  kind: 'enum';
  name: string | null;
  scoped: boolean;
  members: { name: string; value?: Expr; line: number }[];
  line: number;
}

export interface TypedefDecl {
  kind: 'typedef';
  name: string;
  type: TypeSpec;
  line: number;
}

export type TopLevel = VarDecl | FuncDecl | ClassDecl | EnumDecl | TypedefDecl;

export interface Program {
  items: TopLevel[];
}

// ---------------- операторы ----------------
export interface Block { kind: 'block'; body: Stmt[]; line: number; endLine: number }
export interface ExprStmt { kind: 'expr'; expr: Expr; line: number }
export interface IfStmt { kind: 'if'; cond: Expr; then: Stmt; else?: Stmt; line: number }
export interface ForStmt { kind: 'for'; init?: VarDecl | ExprStmt; cond?: Expr; update?: Expr; body: Stmt; line: number }
export interface ForRangeStmt { kind: 'forrange'; type: TypeSpec; name: string; byRef: boolean; iter: Expr; body: Stmt; line: number }
export interface WhileStmt { kind: 'while'; cond: Expr; body: Stmt; line: number }
export interface DoStmt { kind: 'do'; cond: Expr; body: Stmt; line: number }
export interface SwitchStmt { kind: 'switch'; disc: Expr; cases: { test: Expr | null; body: Stmt[]; line: number }[]; line: number }
export interface JumpStmt { kind: 'break' | 'continue'; line: number }
export interface ReturnStmt { kind: 'return'; value?: Expr; line: number }
export interface EmptyStmt { kind: 'empty'; line: number }
export interface LocalTypeStmt { kind: 'localtype'; decl: ClassDecl | EnumDecl | TypedefDecl; line: number }

export type Stmt =
  | Block | ExprStmt | VarDecl | IfStmt | ForStmt | ForRangeStmt | WhileStmt | DoStmt
  | SwitchStmt | JumpStmt | ReturnStmt | EmptyStmt | LocalTypeStmt;

// ---------------- выражения ----------------
export type Expr =
  | { kind: 'num'; v: number; nt: NonNullable<import('./lexer').Token['nt']>; text: string; line: number; col: number }
  | { kind: 'str'; v: string; line: number; col: number }
  | { kind: 'chr'; v: number; line: number; col: number }
  | { kind: 'bool'; v: boolean; line: number; col: number }
  | { kind: 'null'; line: number; col: number }
  | { kind: 'id'; name: string; line: number; col: number }
  | { kind: 'scoped'; scope: string; name: string; line: number; col: number }
  | { kind: 'this'; line: number; col: number }
  | { kind: 'unary'; op: string; x: Expr; postfix: boolean; line: number; col: number }
  | { kind: 'binary'; op: string; a: Expr; b: Expr; line: number; col: number }
  | { kind: 'assign'; op: string; target: Expr; value: Expr; line: number; col: number }
  | { kind: 'cond'; c: Expr; a: Expr; b: Expr; line: number; col: number }
  | { kind: 'call'; callee: Expr; args: Expr[]; tmpl?: TypeSpec[]; line: number; col: number }
  | { kind: 'index'; obj: Expr; idx: Expr; line: number; col: number }
  | { kind: 'member'; obj: Expr; name: string; arrow: boolean; line: number; col: number }
  | { kind: 'cast'; type: TypeSpec; x: Expr; line: number; col: number }
  | { kind: 'fcast'; type: TypeSpec; args: Expr[]; line: number; col: number }
  | { kind: 'sizeof'; type?: TypeSpec; x?: Expr; line: number; col: number }
  | { kind: 'lambda'; params: Param[]; ret?: TypeSpec; body: Block; line: number; col: number }
  | { kind: 'initlist'; items: Expr[]; line: number; col: number }
  | { kind: 'comma'; items: Expr[]; line: number; col: number }
  | { kind: 'new'; type: TypeSpec; args: Expr[]; line: number; col: number };
