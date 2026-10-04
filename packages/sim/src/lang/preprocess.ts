// Простой препроцессор: #include, #define (объектные и функциональные макросы),
// #undef, #ifdef/#ifndef/#if/#elif/#else/#endif, #pragma, #error.
import { CompileError, lex, type Token } from './lexer';

export interface Macro {
  params: string[] | null;
  body: Token[];
}

export interface PreprocessResult {
  tokens: Token[];
  includes: { name: string; line: number }[];
  macros: Map<string, Macro>;
}

/** Предопределённые макросы ядра Arduino-ESP32 (простые числовые). */
const PREDEFINED: Record<string, string> = {
  ESP32: '1',
  ARDUINO: '10819',
  ARDUINO_ARCH_ESP32: '1',
  ESP_ARDUINO_VERSION_MAJOR: '2',
  __cplusplus: '201703',
  F_CPU: '240000000L',
};

export function preprocess(src: string): PreprocessResult {
  const raw = lex(src);
  const macros = new Map<string, Macro>();
  for (const [k, v] of Object.entries(PREDEFINED)) macros.set(k, { params: null, body: lex(v, false).slice(0, -1) });
  const includes: PreprocessResult['includes'] = [];
  const out: Token[] = [];
  // стек условной компиляции
  const cond: { active: boolean; taken: boolean; parentActive: boolean }[] = [];
  const isActive = () => cond.length === 0 || cond[cond.length - 1].active;

  const evalCondition = (expr: string, line: number): boolean => {
    // defined(X) / defined X
    let e = expr.replace(/defined\s*\(\s*([A-Za-z_]\w*)\s*\)/g, (_, m) => (macros.has(m) ? '1' : '0'));
    e = e.replace(/defined\s+([A-Za-z_]\w*)/g, (_, m) => (macros.has(m) ? '1' : '0'));
    // подставляем макросы-числа, остальные идентификаторы -> 0
    for (let guard = 0; guard < 8; guard++) {
      const next = e.replace(/[A-Za-z_]\w*/g, (m) => {
        const mac = macros.get(m);
        if (mac && !mac.params) return mac.body.map((t) => t.v).join(' ') || '0';
        return '0';
      });
      if (next === e) break;
      e = next;
    }
    e = e.replace(/(\d+)[uUlL]+/g, '$1');
    if (!/^[\d\s()+\-*/%<>=!&|^~?:.]*$/.test(e)) throw new CompileError(`Не удалось вычислить условие #if ${expr}`, line);
    try {
      // eslint-disable-next-line no-new-func
      return !!Function(`"use strict"; return (${e || 0});`)();
    } catch {
      throw new CompileError(`Не удалось вычислить условие #if ${expr}`, line);
    }
  };

  for (const t of raw) {
    if (t.k === 'pp') {
      const m = /^(\w+)\s*([\s\S]*)$/.exec(t.v);
      const dir = m?.[1] ?? '';
      const rest = (m?.[2] ?? '').trim();
      switch (dir) {
        case 'ifdef':
        case 'ifndef': {
          const name = rest.split(/\s+/)[0];
          const val = dir === 'ifdef' ? macros.has(name) : !macros.has(name);
          const parentActive = isActive();
          cond.push({ active: parentActive && val, taken: val, parentActive });
          break;
        }
        case 'if': {
          const parentActive = isActive();
          const val = parentActive ? evalCondition(rest, t.line) : false;
          cond.push({ active: parentActive && val, taken: val, parentActive });
          break;
        }
        case 'elif': {
          const top = cond[cond.length - 1];
          if (!top) throw new CompileError('#elif без #if', t.line);
          if (top.taken) top.active = false;
          else {
            const val = top.parentActive ? evalCondition(rest, t.line) : false;
            top.active = top.parentActive && val;
            top.taken = val;
          }
          break;
        }
        case 'else': {
          const top = cond[cond.length - 1];
          if (!top) throw new CompileError('#else без #if', t.line);
          top.active = top.parentActive && !top.taken;
          top.taken = true;
          break;
        }
        case 'endif':
          if (!cond.pop()) throw new CompileError('#endif без #if', t.line);
          break;
        default:
          if (!isActive()) break;
          if (dir === 'include') {
            const inc = /^[<"]([^>"]+)[>"]/.exec(rest);
            if (!inc) throw new CompileError('Неверный #include. Пример: #include <WiFi.h>', t.line);
            includes.push({ name: inc[1].trim(), line: t.line });
          } else if (dir === 'define') {
            const dm = /^([A-Za-z_]\w*)(\(([^)]*)\))?\s*([\s\S]*)$/.exec(rest);
            if (!dm) throw new CompileError('Неверный #define. Пример: #define LED_PIN 2', t.line);
            const name = dm[1];
            const params = dm[2] !== undefined ? dm[3].split(',').map((s) => s.trim()).filter(Boolean) : null;
            let body: Token[];
            try {
              body = lex(dm[4], false).slice(0, -1).map((b) => ({ ...b, line: t.line }));
            } catch (e) {
              if (e instanceof CompileError) throw new CompileError(e.message, t.line);
              throw e;
            }
            // частая ошибка: #define LED = 2; или #define LED 2;
            if (body.length && body[body.length - 1].v === ';' && body[body.length - 1].k === 'op') {
              throw new CompileError(`В #define не нужна точка с запятой: #define ${name} ${body.slice(0, -1).map((b) => b.v).join(' ')}`, t.line);
            }
            if (body.length && body[0].k === 'op' && body[0].v === '=') {
              throw new CompileError(`В #define не нужен знак «=»: #define ${name} ${body.slice(1).map((b) => b.v).join(' ')}`, t.line);
            }
            macros.set(name, { params, body });
          } else if (dir === 'undef') {
            macros.delete(rest.split(/\s+/)[0]);
          } else if (dir === 'error') {
            throw new CompileError(`#error ${rest}`, t.line);
          } else if (dir === 'pragma' || dir === 'warning' || dir === 'line') {
            // игнорируем
          } else {
            throw new CompileError(`Неизвестная директива #${dir}`, t.line);
          }
      }
      continue;
    }
    if (t.k === 'eof') break;
    if (isActive()) out.push(t);
  }
  if (cond.length) throw new CompileError('Не хватает #endif', raw[raw.length - 1].line);

  const expanded = expand(out, macros, new Set());
  expanded.push(raw[raw.length - 1]);
  return { tokens: expanded, includes, macros };
}

function expand(tokens: Token[], macros: Map<string, Macro>, hide: Set<string>): Token[] {
  const res: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.k !== 'id' || hide.has(t.v) || !macros.has(t.v)) { res.push(t); i++; continue; }
    const mac = macros.get(t.v)!;
    if (!mac.params) {
      const body = mac.body.map((b) => ({ ...b, line: t.line, col: t.col, macro: t.v }));
      const inner = new Set(hide); inner.add(t.v);
      res.push(...expand(body, macros, inner));
      i++;
      continue;
    }
    // функциональный макрос: нужен '('
    if (!(tokens[i + 1]?.k === 'op' && tokens[i + 1].v === '(')) { res.push(t); i++; continue; }
    let j = i + 2;
    let depth = 0;
    const args: Token[][] = [[]];
    for (; j < tokens.length; j++) {
      const a = tokens[j];
      if (a.k === 'op' && (a.v === '(' || a.v === '[' || a.v === '{')) depth++;
      if (a.k === 'op' && (a.v === ')' || a.v === ']' || a.v === '}')) {
        if (depth === 0 && a.v === ')') break;
        depth--;
      }
      if (a.k === 'op' && a.v === ',' && depth === 0) { args.push([]); continue; }
      args[args.length - 1].push(a);
    }
    if (j >= tokens.length) throw new CompileError(`Не закрыта скобка в вызове макроса ${t.v}(…)`, t.line);
    if (args.length === 1 && args[0].length === 0 && mac.params.length === 0) args.length = 0;
    const body: Token[] = [];
    for (let b = 0; b < mac.body.length; b++) {
      const bt = mac.body[b];
      // строкификация #x
      if (bt.k === 'op' && bt.v === '#' && mac.body[b + 1]?.k === 'id') {
        const pi = mac.params.indexOf(mac.body[b + 1].v);
        if (pi >= 0) {
          body.push({ k: 'str', v: (args[pi] ?? []).map((a) => (a.k === 'str' ? JSON.stringify(a.v) : a.v)).join(' '), line: t.line, col: t.col, macro: t.v });
          b++;
          continue;
        }
      }
      const pi = bt.k === 'id' ? mac.params.indexOf(bt.v) : -1;
      if (pi >= 0) body.push(...(args[pi] ?? []).map((a) => ({ ...a, line: t.line, col: t.col })));
      else body.push({ ...bt, line: t.line, col: t.col, macro: t.v });
    }
    const inner = new Set(hide); inner.add(t.v);
    res.push(...expand(body, macros, inner));
    i = j + 1;
  }
  return res;
}
