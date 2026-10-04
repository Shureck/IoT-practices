// Редактор кода (CodeMirror 6): C++, автодополнение API Arduino, ошибки компиляции.
import { useEffect, useMemo, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { EditorView, keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { CLASSES, CONSTS, FUNCS, GLOBAL_OBJECTS, compileSketch, type Diag } from '@esp32lab/sim';
import { useWB } from './store';
import { useApp } from '../store/app';
import { API_DOCS } from '../lib/apiDocs';

const darkTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--code-bg)', color: 'var(--text)', height: '100%' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '10px 0' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--faint)', border: 'none', paddingLeft: '6px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', outline: 'none' },
  '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--faint)', fontStyle: 'normal', marginLeft: '8px' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--err)' },
  '.cm-diagnostic-warning': { borderLeft: '3px solid var(--warn)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--err)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn)', textUnderlineOffset: '3px' },
  '.cm-foldGutter': { width: '12px' },
}, { dark: true });

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.modifier, t.operatorKeyword], color: 'var(--hl-kw, #c792ea)' },
  { tag: [t.typeName, t.standard(t.typeName)], color: 'var(--hl-ty, #82aaff)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--hl-fn, #ffcb6b)' },
  { tag: [t.string, t.character], color: 'var(--hl-str, #c3e88d)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--hl-num, #f78c6c)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--hl-com, #6b7a99)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.macroName], color: 'var(--hl-pp, #89ddff)' },
  { tag: t.propertyName, color: 'var(--hl-prop, #a6accd)' },
  { tag: t.constant(t.variableName), color: '#f78c6c' },
]);

function buildCompletions(): Completion[] {
  const out: Completion[] = [];
  for (const [name, meta] of Object.entries(FUNCS)) {
    const doc = API_DOCS[name];
    out.push({ label: name, type: 'function', detail: doc?.sig ?? meta.replace(/[*~]/g, ''), info: doc?.text, apply: `${name}(`, boost: doc ? 2 : 0 });
  }
  for (const name of ['min', 'max', 'abs', 'constrain', 'map', 'sqrt', 'pow', 'sprintf', 'snprintf', 'strcpy', 'strcat', 'serializeJson', 'bitRead', 'bitWrite', 'F']) {
    const doc = API_DOCS[name];
    out.push({ label: name, type: 'function', detail: doc?.sig, info: doc?.text, apply: `${name}(` });
  }
  for (const name of Object.keys(CONSTS)) if (!/^(BIT\d|GPIO_NUM_)/.test(name)) out.push({ label: name, type: 'constant' });
  for (const [name, g] of Object.entries(GLOBAL_OBJECTS)) out.push({ label: name, type: 'variable', detail: g.cls });
  for (const kw of ['void', 'int', 'float', 'double', 'bool', 'char', 'byte', 'long', 'unsigned', 'String', 'const', 'static', 'volatile',
    'uint8_t', 'uint16_t', 'uint32_t', 'int16_t', 'size_t', 'struct', 'class', 'enum', 'return', 'break', 'continue', 'while', 'for', 'if',
    'else', 'switch', 'case', 'default', 'true', 'false', 'NULL', 'auto']) out.push({ label: kw, type: 'keyword' });
  for (const cls of Object.keys(CLASSES)) if (/^[A-Z]/.test(cls) && !/Regs|Reg1|Class$/.test(cls)) out.push({ label: cls, type: 'class' });
  out.push(
    { label: 'setup/loop', type: 'text', detail: 'шаблон скетча', apply: 'void setup() {\n  \n}\n\nvoid loop() {\n  \n}\n' },
    { label: '#include <WiFi.h>', type: 'text', apply: '#include <WiFi.h>\n' },
  );
  return out;
}

const ALL = buildCompletions();

/** Методы объекта по имени переменной (простая эвристика по объявлениям в коде). */
function memberCompletions(code: string, obj: string): Completion[] {
  let cls = GLOBAL_OBJECTS[obj]?.cls;
  if (!cls) {
    const m = new RegExp(`\\b([A-Z][A-Za-z0-9_]*)\\s*[*&]?\\s*${obj}\\b`).exec(code);
    if (m) cls = m[1];
  }
  if (cls === 'String' || (!cls && new RegExp(`\\bString\\s+${obj}\\b`).test(code))) {
    return ['length', 'indexOf', 'substring', 'toInt', 'toFloat', 'trim', 'toUpperCase', 'toLowerCase', 'startsWith', 'endsWith', 'equals', 'replace', 'charAt', 'c_str', 'isEmpty', 'remove', 'concat']
      .map((m) => ({ label: m, type: 'method', apply: `${m}(` }));
  }
  const meta = cls ? CLASSES[cls === 'DynamicJsonDocument' || cls === 'JsonDocument' ? '' : cls] : undefined;
  if (!meta) return [];
  return Object.entries(meta.methods).map(([m, r]) => ({ label: m, type: 'method', detail: r.replace(/[*~]/g, ''), info: API_DOCS[`${cls}.${m}`]?.text, apply: `${m}(` }));
}

function complete(ctx: CompletionContext) {
  const member = ctx.matchBefore(/[A-Za-z_]\w*\.\w*/);
  if (member) {
    const [obj, part] = member.text.split('.');
    const list = memberCompletions(ctx.state.doc.toString(), obj);
    if (list.length) return { from: member.from + obj.length + 1, options: list, validFor: /^\w*$/ };
    void part;
  }
  const word = ctx.matchBefore(/[#A-Za-z_]\w*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return { from: word.from, options: ALL, validFor: /^[#\w]*$/ };
}

function toCmDiagnostics(doc: { line(n: number): { from: number; to: number; length: number }; lines: number }, diags: Diag[]): Diagnostic[] {
  return diags.map((d) => {
    const ln = Math.min(Math.max(1, d.line), doc.lines);
    const line = doc.line(ln);
    const from = Math.min(line.from + Math.max(0, d.col - 1), line.to);
    const to = from < line.to ? Math.min(line.to, from + Math.max(1, wordLen(line, from, doc))) : line.to;
    return { from: from === to && from > line.from ? from - 1 : from, to: Math.max(to, from), severity: d.severity, message: d.hint ? `${d.message}\n💡 ${d.hint}` : d.message };
  });
}
function wordLen(_line: unknown, _from: number, _doc: unknown) { return 1; }

export function CodeEditor() {
  const code = useWB((s) => s.code);
  const readOnly = useWB((s) => s.readOnly);
  const theme = useApp((s) => s.theme);
  const ref = useRef<ReactCodeMirrorRef>(null);

  const extensions = useMemo(() => [
    cpp(),
    indentUnit.of('  '),
    syntaxHighlighting(highlight),
    darkTheme,
    autocompletion({ override: [complete], icons: true, activateOnTyping: true }),
    lintGutter(),
    linter((view) => {
      const res = compileSketch(view.state.doc.toString());
      useWB.getState().set({ diagnostics: res.diagnostics, compileOk: res.ok });
      return toCmDiagnostics(view.state.doc, res.diagnostics);
    }, { delay: 450 }),
    keymap.of([{ key: 'Mod-s', run: () => { window.dispatchEvent(new Event('esp32lab:save')); return true; } }]),
    EditorView.lineWrapping,
  ], []);

  // переход к строке ошибки из панели «Проблемы»
  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent<number>).detail;
      const view = ref.current?.view;
      if (!view) return;
      const ln = Math.min(Math.max(1, line), view.state.doc.lines);
      const pos = view.state.doc.line(ln).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    };
    window.addEventListener('esp32lab:goto-line', handler);
    return () => window.removeEventListener('esp32lab:goto-line', handler);
  }, []);

  return (
    <div className={`h-full ${theme === 'light' ? 'cm-light' : ''}`}>
      <CodeMirror
        ref={ref}
        value={code}
        height="100%"
        theme="none"
        editable={!readOnly}
        basicSetup={{ foldGutter: true, highlightActiveLine: true, bracketMatching: true, closeBrackets: true, autocompletion: false, tabSize: 2 }}
        extensions={extensions}
        onChange={(v) => useWB.getState().setCode(v)}
        className="h-full"
      />
    </div>
  );
}
