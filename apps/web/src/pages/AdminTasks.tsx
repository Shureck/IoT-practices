// Редактор задач (администраторы): загрузить файл задачи, проверить, опубликовать; править существующие.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import {
  AlertTriangle, BookOpen, CheckCircle2, Download, Eye, EyeOff, FilePlus2, FileText, History, RotateCcw, Rocket, Search, ShieldCheck, Trash2, Upload, XCircle,
} from 'lucide-react';
import { api, type AdminTask, type TaskAnalysis, type TaskIssue } from '../lib/api';
import { useApp } from '../store/app';
import { Md } from '../lib/markdown';
import { Badge, Button, Modal, Spinner, inputBase } from '../components/ui';
import { KIND_LABEL } from '../workbench/TaskPanel';

const DRAFT_KEY = 'esp32lab:admin-task-draft';
const SOURCE: Record<AdminTask['source'], { label: string; tone: 'muted' | 'accent' | 'violet' }> = {
  builtin: { label: 'встроенная', tone: 'muted' },
  custom: { label: 'своя', tone: 'accent' },
  edited: { label: 'правлена', tone: 'violet' },
};
const CHECKS_LABEL: Record<AdminTask['checks'], string> = { code: 'проверки в коде', file: 'проверки из файла', quiz: 'тест' };

const idIn = (text: string): string | null =>
  /^id:\s*["']?([a-z0-9-]+)/m.exec(text)?.[1] ?? /"id"\s*:\s*"([a-z0-9-]+)"/.exec(text)?.[1] ?? null;

const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--code-bg)', color: 'var(--text)', height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--faint)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--err)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn)', textUnderlineOffset: '3px' },
}, { dark: true });

export default function AdminTasks() {
  const toast = useApp((s) => s.toast);
  const catalog = useApp((s) => s.catalog);
  const loadCatalog = useApp((s) => s.loadCatalog);
  const [tasks, setTasks] = useState<AdminTask[] | null>(null);
  const [loadErrors, setLoadErrors] = useState<{ id: string; message: string }[]>([]);
  const [q, setQ] = useState('');
  const [text, setText] = useState(() => { try { return sessionStorage.getItem(DRAFT_KEY) ?? ''; } catch { return ''; } });
  const [saved, setSaved] = useState('');
  const [target, setTarget] = useState<{ id: string | null; task?: AdminTask }>({ id: null });
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<{ text: string; data: TaskAnalysis } | null>(null);
  const [busy, setBusy] = useState<'validate' | 'publish' | 'load' | null>(null);
  const [history, setHistory] = useState<{ open: boolean; list: { id: number; note: string | null; createdAt: string; author: string | null }[] | null }>({ open: false, list: null });
  const [ref, setRef] = useState<{ open: boolean; text: string | null }>({ open: false, text: null });
  const [note, setNote] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const cm = useRef<ReactCodeMirrorRef>(null);

  const reload = useCallback(async () => {
    try { const r = await api.adminTasks(); setTasks(r.tasks); setLoadErrors(r.loadErrors); }
    catch (e) { toast({ kind: 'err', title: 'Не удалось загрузить список задач', text: (e as Error).message }); setTasks([]); }
  }, [toast]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { try { sessionStorage.setItem(DRAFT_KEY, text); } catch { /* нет хранилища */ } }, [text]);

  const dirty = text !== saved;
  const textId = useMemo(() => idIn(text), [text]);
  const existing = tasks?.find((t) => t.id === (target.id ?? textId)) ?? null;
  const editId = target.id ?? (existing ? existing.id : null);
  const mode: 'create' | 'edit' = editId ? 'edit' : 'create';
  const fresh = analysis && analysis.text === text ? analysis.data : null;

  // подсветка ошибок и предупреждений в самом тексте
  useEffect(() => {
    const view = cm.current?.view;
    if (!view) return;
    const diags: Diagnostic[] = [];
    for (const i of fresh?.issues ?? []) {
      if (!i.line || i.line < 1 || i.line > view.state.doc.lines) continue;
      const line = view.state.doc.line(i.line);
      diags.push({ from: line.from, to: Math.max(line.from, line.to), severity: i.level, message: i.message });
    }
    view.dispatch(setDiagnostics(view.state, diags));
  }, [fresh, text]);

  const confirmDiscard = () => !dirty || confirm('В редакторе есть несохранённые изменения — они пропадут. Продолжить?');

  const loadText = (t: string, name: string, tg: { id: string | null; task?: AdminTask }) => {
    setText(t); setSaved(tg.id ? t : ''); setFileName(name); setTarget(tg); setAnalysis(null); setNote('');
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 600_000) { toast({ kind: 'err', title: 'Файл слишком большой', text: 'Больше 600 КБ — это не файл задачи.' }); return; }
    if (!confirmDiscard()) return;
    const t = (await f.text()).replace(/^﻿/, '');
    loadText(t, f.name, { id: null });
    setSaved('');
    toast({ kind: 'info', title: `Загружен файл «${f.name}»`, text: 'Нажмите «Проверить» — сайт прогонит эталонное решение через проверки.' });
  };

  const fromTemplate = async (name: 'example-task.yaml' | 'example-quiz.yaml') => {
    if (!confirmDiscard()) return;
    try { loadText(await api.adminFileText(name), name, { id: null }); setSaved(''); }
    catch (e) { toast({ kind: 'err', title: 'Не удалось загрузить пример', text: (e as Error).message }); }
  };

  const openTask = async (t: AdminTask) => {
    if (!confirmDiscard()) return;
    setBusy('load');
    try {
      const f = await api.adminTaskFile(t.id);
      loadText(f.text, `${t.id}.yaml`, { id: t.id, task: t });
    } catch (e) { toast({ kind: 'err', title: 'Не удалось открыть задачу', text: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const validate = async (): Promise<TaskAnalysis | null> => {
    setBusy('validate');
    try {
      const data = await api.adminValidate({ text, mode, id: editId ?? undefined });
      setAnalysis({ text, data });
      return data;
    } catch (e) { toast({ kind: 'err', title: 'Проверка не удалась', text: (e as Error).message }); return null; }
    finally { setBusy(null); }
  };

  const publish = async () => {
    const data = fresh ?? await validate();
    if (!data) return;
    if (!data.canPublish) { toast({ kind: 'err', title: 'Публиковать нельзя', text: 'Сначала исправьте ошибки — они показаны под редактором.' }); return; }
    const title = data.preview?.title ?? '';
    const what = mode === 'edit' ? `Сохранить изменения в задаче «${title}»? Студенты сразу увидят новую версию (старая останется в истории).` : `Опубликовать новую задачу «${title}»? Она появится в курсе; группам её нужно открыть во вкладке «Доступ».`;
    if (!confirm(what)) return;
    setBusy('publish');
    try {
      const r = mode === 'edit' ? await api.adminUpdate(editId!, text, note.trim() || undefined) : await api.adminCreate(text, note.trim() || undefined);
      toast({ kind: 'ok', title: mode === 'edit' ? 'Изменения сохранены' : 'Задача опубликована', text: r.id });
      setSaved(text);
      await Promise.all([reload(), loadCatalog()]);
      const t = (await api.adminTasks()).tasks.find((x) => x.id === r.id);
      setTarget({ id: r.id, task: t });
      setNote('');
    } catch (e) { toast({ kind: 'err', title: 'Не удалось опубликовать', text: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const toggleVisible = async (t: AdminTask) => {
    try { await api.adminVisibility(t.id, !t.visible); await Promise.all([reload(), loadCatalog()]); toast({ kind: 'ok', title: t.visible ? 'Задача скрыта от студентов' : 'Задача снова видна' }); }
    catch (e) { toast({ kind: 'err', title: 'Не удалось', text: (e as Error).message }); }
  };

  const remove = async (t: AdminTask) => {
    const msg = t.source === 'edited' ? `Вернуть встроенную версию «${t.title}»? Все правки будут сняты (в истории останутся).` : `Удалить задачу «${t.title}»? Это нельзя отменить.`;
    if (!confirm(msg)) return;
    try {
      await api.adminDelete(t.id);
      await Promise.all([reload(), loadCatalog()]);
      toast({ kind: 'ok', title: t.source === 'edited' ? 'Возвращена встроенная версия' : 'Задача удалена' });
      if (target.id === t.id) loadText('', '', { id: null });
    } catch (e) { toast({ kind: 'err', title: 'Не удалось', text: (e as Error).message }); }
  };

  const openHistory = async () => {
    if (!editId) return;
    setHistory({ open: true, list: null });
    try { setHistory({ open: true, list: (await api.adminRevisions(editId)).revisions }); }
    catch (e) { toast({ kind: 'err', title: 'Нет истории', text: (e as Error).message }); setHistory({ open: false, list: null }); }
  };
  const restore = async (rid: number) => {
    if (!editId || !confirmDiscard()) return;
    try {
      const r = await api.adminRevision(editId, rid);
      setText(r.text); setAnalysis(null); setHistory({ open: false, list: null });
      toast({ kind: 'info', title: 'Версия загружена в редактор', text: 'Проверьте и опубликуйте, чтобы вернуть её.' });
    } catch (e) { toast({ kind: 'err', title: 'Не удалось', text: (e as Error).message }); }
  };

  const openReference = async () => {
    setRef({ open: true, text: null });
    try { setRef({ open: true, text: await api.adminFileText('reference.md') }); }
    catch (e) { toast({ kind: 'err', title: 'Не удалось загрузить справочник', text: (e as Error).message }); setRef({ open: false, text: null }); }
  };

  const jump = (line?: number) => {
    const view = cm.current?.view;
    if (!view || !line || line > view.state.doc.lines) return;
    const l = view.state.doc.line(line);
    view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
    view.focus();
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (tasks ?? []).filter((t) => !s || t.title.toLowerCase().includes(s) || t.id.toLowerCase().includes(s));
  }, [tasks, q]);
  const errors = fresh?.issues.filter((i) => i.level === 'error') ?? [];
  const warns = fresh?.issues.filter((i) => i.level === 'warning') ?? [];

  return (
    <div className="mx-auto max-w-[1500px] px-5 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-bold tracking-tight">Редактор задач</h1>
        <Button size="sm" variant="primary" icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>Загрузить файл задачи</Button>
        <input ref={fileInput} type="file" accept=".yaml,.yml,.json,.txt,text/*,application/json" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <Button size="sm" icon={<FilePlus2 size={14} />} onClick={() => void fromTemplate('example-task.yaml')}>Новая из примера</Button>
        <Button size="sm" variant="ghost" icon={<FileText size={14} />} onClick={() => void fromTemplate('example-quiz.yaml')}>Пример теста</Button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Основа для авторов:</span>
          <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] hover:bg-panel-2" href="/api/admin/task-files/example-task.yaml"><Download size={14} />Пример задачи</a>
          <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] hover:bg-panel-2" href="/api/admin/task-files/example-quiz.yaml"><Download size={14} />Пример теста</a>
          <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] hover:bg-panel-2" href="/api/admin/task-files/reference.md"><Download size={14} />Справочник (.md)</a>
          <Button size="sm" variant="ghost" icon={<BookOpen size={14} />} onClick={() => void openReference()}>Читать справочник</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[330px_minmax(0,1fr)]">
        {/* список задач */}
        <aside className="rounded-2xl border border-line bg-panel">
          <div className="border-b border-line p-2.5">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-faint" />
              <input className={`${inputBase} w-full pl-8`} placeholder="Найти задачу…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="max-h-[72vh] overflow-y-auto">
            {!tasks ? <div className="p-6"><Spinner /></div> : (
              (catalog?.modules ?? []).map((m) => {
                const list = filtered.filter((t) => t.module === m.id);
                if (!list.length) return null;
                return (
                  <div key={m.id}>
                    <div className="sticky top-0 border-b border-line bg-panel-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{m.icon} {m.title}</div>
                    {list.map((t) => (
                      <div key={t.id} className={`group border-b border-line/60 px-3 py-2 text-[13px] ${target.id === t.id ? 'bg-accent/10' : 'hover:bg-panel-2'} ${t.visible ? '' : 'opacity-60'}`}>
                        <button className="block w-full text-left" onClick={() => void openTask(t)}>
                          <div className="flex items-center gap-1.5 font-medium">
                            {!t.visible && <EyeOff size={12} className="shrink-0 text-warn" />}
                            <span className="truncate">{t.title}</span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-faint">
                            <span className="font-mono">{t.id}</span>
                            <Badge tone={SOURCE[t.source].tone}>{SOURCE[t.source].label}</Badge>
                            <Badge tone={KIND_LABEL[t.kind].tone}>{KIND_LABEL[t.kind].label}</Badge>
                            <span>{CHECKS_LABEL[t.checks]}</span>
                            {t.submissions > 0 && <span>· сдач: {t.submissions}</span>}
                          </div>
                        </button>
                        {(t.source !== 'builtin') && (
                          <div className="mt-1 flex gap-1 opacity-70 group-hover:opacity-100">
                            {t.source === 'custom' && (
                              <button className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-panel hover:text-text" onClick={() => void toggleVisible(t)}>
                                {t.visible ? <><EyeOff size={12} /> Скрыть</> : <><Eye size={12} /> Показать</>}
                              </button>
                            )}
                            <button className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-panel hover:text-err" onClick={() => void remove(t)}>
                              {t.source === 'edited' ? <><RotateCcw size={12} /> Вернуть встроенную</> : <><Trash2 size={12} /> Удалить</>}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })
            )}
            {tasks && !filtered.length && <div className="p-4 text-sm text-muted">Ничего не найдено.</div>}
          </div>
          {loadErrors.length > 0 && (
            <div className="border-t border-line p-3 text-xs text-err">
              <b>Не загрузились записи базы:</b>
              {loadErrors.map((e) => <div key={e.id}><span className="font-mono">{e.id}</span> — {e.message}</div>)}
            </div>
          )}
        </aside>

        {/* редактор */}
        <section className="min-w-0 rounded-2xl border border-line bg-panel">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {mode === 'edit' ? <>Правка задачи <span className="font-mono text-accent">{editId}</span></> : 'Новая задача'}
                {dirty && <span className="ml-2 text-xs font-normal text-warn">● есть несохранённые изменения</span>}
              </div>
              <div className="truncate text-xs text-faint">
                {fileName || 'Загрузите файл, откройте задачу из списка или начните с примера'}
                {!target.id && existing && ` · задача с таким id уже есть — публикация заменит её (старая версия останется в истории)`}
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {editId && <Button size="sm" variant="ghost" icon={<History size={14} />} onClick={() => void openHistory()}>История</Button>}
              <Button size="sm" icon={<ShieldCheck size={14} />} loading={busy === 'validate'} disabled={!text.trim() || !!busy} onClick={() => void validate()} title="Проверить формат и прогнать эталонное решение через автопроверки">Проверить</Button>
              <Button size="sm" variant="primary" icon={<Rocket size={14} />} loading={busy === 'publish'} disabled={!text.trim() || !!busy} onClick={() => void publish()}>{mode === 'edit' ? 'Сохранить' : 'Опубликовать'}</Button>
            </div>
          </div>
          <div className="h-[52vh] min-h-[320px]">
            <CodeMirror
              ref={cm}
              value={text}
              height="100%"
              theme="none"
              basicSetup={{ foldGutter: false, highlightActiveLine: true, autocompletion: false, bracketMatching: false, closeBrackets: false, tabSize: 2 }}
              extensions={[editorTheme, lintGutter(), EditorView.lineWrapping]}
              onChange={(v) => setText(v)}
              placeholder="Вставьте или загрузите файл задачи (YAML или JSON)…"
              className="h-full"
            />
          </div>

          {/* результат проверки */}
          <div className="border-t border-line p-3 text-[13px]">
            {busy === 'validate' && <div className="flex items-center gap-2 text-muted"><Spinner size={14} /> Проверяем файл и прогоняем эталон через проверки…</div>}
            {!busy && !fresh && <div className="text-muted">Нажмите «Проверить»: сайт разберёт файл, найдёт ошибки (с номерами строк) и прогонит эталонное решение и заготовку через автопроверки. Публикация возможна, только если эталон проходит все проверки.</div>}
            {fresh && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {fresh.canPublish
                    ? <Badge tone="ok"><CheckCircle2 size={12} className="mr-1 inline" />Можно публиковать</Badge>
                    : <Badge tone="err"><XCircle size={12} className="mr-1 inline" />Есть ошибки — публиковать нельзя</Badge>}
                  {errors.length > 0 && <span className="text-err">ошибок: {errors.length}</span>}
                  {warns.length > 0 && <span className="text-warn">предупреждений: {warns.length}</span>}
                  {fresh.preview && (
                    <span className="text-muted">
                      «{fresh.preview.title}» · модуль {fresh.preview.module} · {KIND_LABEL[fresh.preview.kind].label} · {fresh.preview.xp} XP ·{' '}
                      {fresh.preview.kind === 'quiz' ? `вопросов: ${fresh.preview.questions}` : `проверок: ${fresh.preview.checks.length}${fresh.preview.checksSource === 'code' ? ' (встроенные)' : ''}`}
                    </span>
                  )}
                </div>
                {fresh.issues.length > 0 && (
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {fresh.issues.map((i, k) => <IssueRow key={k} issue={i} onJump={jump} />)}
                  </ul>
                )}
                {fresh.dryRun && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <DryList title="Эталонное решение — должно пройти всё" rows={fresh.dryRun.solution} want />
                    <DryList title="Стартовый код — должно пройти не всё" rows={fresh.dryRun.starter} />
                  </div>
                )}
              </div>
            )}
            {mode === 'edit' && (
              <div className="mt-3 flex items-center gap-2">
                <span className="shrink-0 text-xs text-muted">Комментарий к версии:</span>
                <input className={`${inputBase} h-8 flex-1`} placeholder="Что изменили (необязательно, попадёт в историю)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
          </div>
        </section>
      </div>

      <Modal open={history.open} onClose={() => setHistory({ open: false, list: null })} title={`История версий — ${editId ?? ''}`}>
        {!history.list ? <Spinner /> : !history.list.length ? <div className="py-4 text-sm text-muted">Версий пока нет: встроенная задача ещё не правилась.</div> : (
          <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto">
            {history.list.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                <div className="min-w-0 flex-1">
                  <div>{new Date(r.createdAt).toLocaleString('ru-RU')} <span className="text-muted">· {r.author ?? 'неизвестно'}</span></div>
                  {r.note && <div className="truncate text-xs text-faint">{r.note}</div>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => void restore(r.id)}>Загрузить</Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal open={ref.open} onClose={() => setRef({ open: false, text: null })} title="Справочник по файлу задачи" wide>
        {ref.text === null ? <Spinner /> : <div className="max-h-[72vh] overflow-y-auto pr-2"><Md text={ref.text} className="md text-[13.5px]" /></div>}
      </Modal>
    </div>
  );
}

function IssueRow({ issue, onJump }: { issue: TaskIssue; onJump: (line?: number) => void }) {
  const err = issue.level === 'error';
  return (
    <li className={`flex items-start gap-2 rounded-lg px-2 py-1 ${err ? 'bg-err/8' : 'bg-warn/8'}`}>
      {err ? <XCircle size={14} className="mt-0.5 shrink-0 text-err" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />}
      <div className="min-w-0 flex-1">
        <div>{issue.message}</div>
        <div className="text-[11.5px] text-faint">
          {issue.path && <span className="font-mono">{issue.path}</span>}
          {issue.line ? <button className="ml-2 text-accent hover:underline" onClick={() => onJump(issue.line)}>строка {issue.line}</button> : null}
        </div>
      </div>
    </li>
  );
}

function DryList({ title, rows, want }: { title: string; rows: { id: string; title: string; ok: boolean; message?: string }[]; want?: boolean }) {
  return (
    <div className="rounded-xl border border-line p-2.5">
      <div className="mb-1.5 text-xs font-semibold text-muted">{title}</div>
      <ul className="space-y-1">
        {rows.map((r) => {
          const good = want ? r.ok : !r.ok;
          return (
            <li key={r.id} className="flex items-start gap-1.5 text-[12.5px]">
              {r.ok ? <CheckCircle2 size={13} className={`mt-0.5 shrink-0 ${good ? 'text-ok' : 'text-warn'}`} /> : <XCircle size={13} className={`mt-0.5 shrink-0 ${good ? 'text-muted' : 'text-err'}`} />}
              <span><span>{r.title}</span>{!r.ok && r.message && <span className="block text-[11.5px] text-faint">{r.message}</span>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
