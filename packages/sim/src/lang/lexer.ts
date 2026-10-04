// Лексер подмножества C++ для скетчей Arduino.
export type TokKind = 'id' | 'num' | 'str' | 'chr' | 'op' | 'pp' | 'eof';

export interface Token {
  k: TokKind;
  v: string;
  line: number;
  col: number;
  /** числовое значение для num/chr */
  n?: number;
  /** суффикс/вид числового литерала */
  nt?: 'int' | 'uint' | 'long' | 'ulong' | 'llong' | 'ullong' | 'double' | 'float';
  /** токен получен раскрытием макроса */
  macro?: string;
}

export class CompileError extends Error {
  constructor(message: string, public line: number, public col = 1, public hint?: string) {
    super(message);
  }
}

const OPS = [
  '<<=', '>>=', '...', '->*',
  '::', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.',
  '(', ')', '[', ']', '{', '}', '#',
];

const ESC: Record<string, number> = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63 };

export function lex(src: string, allowPP = true): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let atLineStart = true;
  const n = src.length;

  const err = (msg: string): never => {
    throw new CompileError(msg, line, i - lineStart + 1);
  };

  const readEscape = (): number => {
    // src[i] === '\\'
    i++;
    const c = src[i];
    if (c === 'x') {
      let j = i + 1;
      let h = '';
      while (j < n && /[0-9a-fA-F]/.test(src[j]) && h.length < 2) h += src[j++];
      i = j;
      return parseInt(h || '0', 16);
    }
    if (/[0-7]/.test(c) && c !== '0' || (c === '0' && /[0-7]/.test(src[i + 1] ?? ''))) {
      let j = i;
      let o = '';
      while (j < n && /[0-7]/.test(src[j]) && o.length < 3) o += src[j++];
      i = j;
      return parseInt(o, 8);
    }
    i++;
    if (c in ESC) return ESC[c];
    return c.charCodeAt(0);
  };

  while (i < n) {
    const c = src[i];
    // переводы строк
    if (c === '\n') { line++; i++; lineStart = i; atLineStart = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
    // комментарии
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const startLine = line;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') { line++; lineStart = i + 1; }
        i++;
      }
      if (i >= n) throw new CompileError('Незакрытый комментарий /* … */', startLine);
      i += 2;
      continue;
    }
    // директивы препроцессора — целой строкой (с учётом переноса через \)
    if (c === '#' && atLineStart && allowPP) {
      const startLine = line;
      const col = i - lineStart + 1;
      let text = '';
      i++;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) {
          i += src[i + 1] === '\r' ? 3 : 2;
          line++; lineStart = i;
          text += ' ';
          continue;
        }
        if (src[i] === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; break; }
        if (src[i] === '/' && src[i + 1] === '*') {
          i += 2;
          while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { line++; lineStart = i + 1; } i++; }
          i += 2;
          text += ' ';
          continue;
        }
        text += src[i++];
      }
      toks.push({ k: 'pp', v: text.trim(), line: startLine, col });
      continue;
    }
    atLineStart = false;
    const col = i - lineStart + 1;
    // идентификаторы
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      // строковые префиксы u8"..", L".." и т.п.
      if ((word === 'u8' || word === 'L' || word === 'u' || word === 'U' || word === 'R') && src[j] === '"') {
        i = j;
        continue;
      }
      toks.push({ k: 'id', v: word, line, col });
      i = j;
      continue;
    }
    // числа
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      let val: number;
      let isFloat = false;
      if (c === '0' && /[xX]/.test(src[i + 1] ?? '')) {
        j = i + 2;
        while (j < n && /[0-9a-fA-F']/.test(src[j])) j++;
        val = parseInt(src.slice(i + 2, j).replace(/'/g, ''), 16);
      } else if (c === '0' && /[bB]/.test(src[i + 1] ?? '')) {
        j = i + 2;
        while (j < n && /[01']/.test(src[j])) j++;
        val = parseInt(src.slice(i + 2, j).replace(/'/g, ''), 2);
      } else {
        while (j < n && /[0-9']/.test(src[j])) j++;
        if (src[j] === '.' && src[j + 1] !== '.') { isFloat = true; j++; while (j < n && /[0-9]/.test(src[j])) j++; }
        if (/[eE]/.test(src[j] ?? '') && /[0-9+-]/.test(src[j + 1] ?? '')) {
          isFloat = true; j++;
          if (src[j] === '+' || src[j] === '-') j++;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
        const text = src.slice(i, j).replace(/'/g, '');
        if (!isFloat && text.length > 1 && text[0] === '0') val = parseInt(text, 8);
        else val = isFloat ? parseFloat(text) : parseInt(text, 10);
      }
      // суффиксы
      let suf = '';
      while (j < n && /[uUlLfF]/.test(src[j])) suf += src[j++].toLowerCase();
      if (/[A-Za-z_]/.test(src[j] ?? '')) err(`Некорректное число «${src.slice(i, j + 1)}»`);
      let nt: Token['nt'];
      if (isFloat) nt = suf.includes('f') ? 'float' : 'double';
      else if (suf === 'f') nt = 'float';
      else if (suf.includes('ll')) nt = suf.includes('u') ? 'ullong' : 'llong';
      else if (suf.includes('l')) nt = suf.includes('u') ? 'ulong' : 'long';
      else if (suf.includes('u')) nt = 'uint';
      else nt = val > 2147483647 ? (val > 4294967295 ? 'llong' : 'uint') : 'int';
      toks.push({ k: 'num', v: src.slice(i, j), n: val, nt, line, col });
      i = j;
      continue;
    }
    // строки
    if (c === '"') {
      let s = '';
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\n') err('Незакрытая строка: не хватает закрывающей кавычки "');
        if (src[i] === '\\') {
          if (src[i + 1] === '\n') { i += 2; line++; lineStart = i; continue; }
          s += String.fromCharCode(readEscape());
        } else s += src[i++];
      }
      if (i >= n) err('Незакрытая строка: не хватает закрывающей кавычки "');
      i++;
      // склейка соседних литералов "a" "b"
      const prev = toks[toks.length - 1];
      if (prev && prev.k === 'str' && !prev.macro) { prev.v += s; continue; }
      toks.push({ k: 'str', v: s, line, col });
      continue;
    }
    // символы
    if (c === "'") {
      i++;
      let code: number;
      if (src[i] === '\\') code = readEscape();
      else {
        const cp = src.codePointAt(i)!;
        code = cp;
        i += cp > 0xffff ? 2 : 1;
      }
      if (src[i] !== "'") err("Символьный литерал должен содержать один символ, например 'A'. Для строк используйте двойные кавычки");
      i++;
      toks.push({ k: 'chr', v: String.fromCharCode(code), n: code, line, col });
      continue;
    }
    // операторы
    let matched = '';
    for (const op of OPS) {
      if (src.startsWith(op, i)) { matched = op; break; }
    }
    if (!matched) {
      if (c === '“' || c === '”' || c === '«' || c === '»') err('Типографские кавычки не подходят для кода — используйте обычные "');
      if (c.charCodeAt(0) > 127) err(`Недопустимый символ «${c}» в коде (возможно, русская буква вне строки?)`);
      err(`Неожиданный символ «${c}»`);
    }
    toks.push({ k: 'op', v: matched, line, col });
    i += matched.length;
  }
  toks.push({ k: 'eof', v: '', line, col: 1 });
  return toks;
}
