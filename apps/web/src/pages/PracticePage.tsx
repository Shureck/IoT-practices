import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, CheckCheck, Send, History, RotateCcw, ChevronLeft, ChevronRight, CheckCircle2, XCircle } from 'lucide-react';
import type { CircuitDoc } from '@esp32lab/sim';
import { useApp, storage } from '../store/app';
import { api, type PublicPractice, type Submission } from '../lib/api';
import { useWB } from '../workbench/store';
import { Workbench } from '../workbench/Workbench';
import { stopSim } from '../workbench/simController';
import { Badge, Button, Empty, Modal, Spinner } from '../components/ui';
import { Md } from '../lib/markdown';
import { KIND_LABEL } from '../workbench/TaskPanel';

const draftKey = (id: string) => `draft:${id}`;

export default function PracticePage() {
  const { id = '' } = useParams();
  const catalog = useApp((s) => s.catalog);
  const user = useApp((s) => s.user);
  const userId = user?.id ?? null;
  const userLoaded = useApp((s) => s.userLoaded);
  const practice = catalog?.practices.find((p) => p.id === id);
  const locked = useApp((s) => s.isLocked(id));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!practice || !userLoaded) return;
    setReady(false);
    let cancelled = false;
    (async () => {
      let code = practice.starterCode;
      let circuit: CircuitDoc = practice.starterCircuit;
      const local = storage.get<{ code: string; circuit: CircuitDoc; at: number } | null>(draftKey(practice.id), null);
      if (local) { code = local.code; circuit = local.circuit; }
      if (userId) {
        try {
          const d = await api.draft(practice.id);
          if (!local || new Date(d.updatedAt).getTime() > local.at) { code = d.code; circuit = d.circuit; }
        } catch { /* черновика нет */ }
      }
      if (cancelled) return;
      stopSim();
      const base = {
        mode: 'practice' as const, practice, title: practice.title,
        circuitLocked: !!practice.circuitLocked, palette: practice.palette ?? null,
        hintsUsed: storage.get(`hints:${practice.id}`, 0),
      };
      try {
        useWB.getState().init({ ...base, code, circuit });
      } catch (e) {
        // черновик повреждён — открываем заготовку, а черновик оставляем как есть (его можно вернуть через «Попытки»)
        console.error('draft load failed', e);
        useWB.getState().init({ ...base, code: practice.starterCode, circuit: practice.starterCircuit });
        useApp.getState().toast({ kind: 'err', title: 'Черновик не открылся', text: 'Загружена исходная заготовка задания.' });
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [practice, userId, userLoaded]);

  // автосохранение черновика
  const code = useWB((s) => s.code);
  const circuit = useWB((s) => s.circuit);
  const dirty = useWB((s) => s.dirty);
  const hintsUsed = useWB((s) => s.hintsUsed);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<{ id: string; code: string; circuit: CircuitDoc } | null>(null);
  useEffect(() => {
    if (!ready || !practice) return;
    storage.set(`hints:${practice.id}`, hintsUsed);
  }, [hintsUsed, ready, practice]);
  useEffect(() => {
    // Сохраняем то, что сейчас лежит в редакторе, а не значения из этого рендера: при переходе
    // на другую практику рендер ещё несёт код прошлой, а редактор уже загружен новой.
    const wb = useWB.getState();
    if (!ready || !practice || !wb.dirty || wb.practice?.id !== practice.id) return;
    storage.set(draftKey(practice.id), { code: wb.code, circuit: wb.circuit, at: Date.now() });
    clearTimeout(timer.current);
    if (!user) return;
    const draft = { id: practice.id, code: wb.code, circuit: wb.circuit };
    pending.current = draft;
    timer.current = setTimeout(() => {
      pending.current = null;
      void api.saveDraft(draft.id, draft.code, draft.circuit).catch(() => undefined);
    }, 2500);
  }, [code, circuit, dirty, ready, practice, user]);
  // уходим с практики — недосохранённый черновик отправляем сразу, под её собственным id
  useEffect(() => () => {
    clearTimeout(timer.current);
    const d = pending.current;
    pending.current = null;
    if (d) void api.saveDraft(d.id, d.code, d.circuit).catch(() => undefined);
  }, [practice?.id]);

  if (!catalog) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!practice) return <Empty icon="🧭" title="Практика не найдена" action={<Link className="text-accent hover:underline" to="/course">К курсу</Link>} />;
  if (locked) {
    return (
      <Empty icon="🔒" title="Практика пока закрыта" text="Её откроет преподаватель. А пока можно повторить открытые практики или поэкспериментировать в песочнице."
        action={<Link className="text-accent hover:underline" to="/course">К курсу</Link>} />
    );
  }
  if (practice.kind === 'quiz') return <QuizView practice={practice} />;
  if (!ready) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  return <PracticeWorkbench practice={practice} />;
}

function Nav({ practice }: { practice: PublicPractice }) {
  const catalog = useApp((s) => s.catalog)!;
  const list = catalog.practices;
  const i = list.findIndex((p) => p.id === practice.id);
  const prev = list[i - 1];
  const next = list[i + 1];
  return (
    <div className="flex items-center gap-0.5">
      <Link to="/course" className="focus-ring flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-muted hover:bg-panel-2 hover:text-text" title="К списку практик"><ArrowLeft size={15} /><span className="max-lg:hidden">Курс</span></Link>
      {prev && <Link to={`/p/${prev.id}`} title={prev.title} className="focus-ring rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-text"><ChevronLeft size={15} /></Link>}
      <span className="max-w-56 truncate px-1 text-[13px] font-semibold max-md:hidden">{practice.title}</span>
      {next && <Link to={`/p/${next.id}`} title={next.title} className="focus-ring rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-text"><ChevronRight size={15} /></Link>}
    </div>
  );
}

function PracticeWorkbench({ practice }: { practice: PublicPractice }) {
  const user = useApp((s) => s.user);
  const toast = useApp((s) => s.toast);
  const nav = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<Submission[] | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [studentComment, setStudentComment] = useState('');
  const checking = useWB((s) => s.checking);

  const needLogin = () => {
    toast({ kind: 'info', title: 'Нужен вход', text: 'Проверка и сдача работ доступны после входа.' });
    nav(`/login?next=/p/${practice.id}`);
  };

  const check = useCallback(async () => {
    if (!user) return needLogin();
    const s = useWB.getState();
    s.set({ checking: true, checkResults: null });
    try {
      const r = await api.check(practice.id, s.code, s.circuit);
      if (!r.compile.ok) {
        s.set({ diagnostics: r.compile.diagnostics, bottomTab: 'problems', bottomOpen: true });
        toast({ kind: 'err', title: 'Скетч не компилируется', text: 'Исправьте ошибки (вкладка «Проблемы»).' });
      }
      s.set({ checkResults: r.results });
      const ok = r.results.filter((x) => x.ok).length;
      if (ok === r.results.length) toast({ kind: 'ok', title: 'Все проверки пройдены!', text: 'Можно сдавать работу.' });
    } catch (e) {
      toast({ kind: 'err', title: 'Проверка не удалась', text: (e as Error).message });
    } finally {
      useWB.getState().set({ checking: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, practice.id]);

  const submit = async () => {
    if (!user) return needLogin();
    const s = useWB.getState();
    setSubmitting(true);
    s.set({ checking: true });
    try {
      const r = await api.submit({ practiceId: practice.id, code: s.code, circuit: s.circuit, hintsUsed: s.hintsUsed, studentComment: studentComment.trim() || undefined });
      setSubmitOpen(false);
      setStudentComment('');
      s.set({ checkResults: r.submission.results });
      if (r.submission.status === 'passed') {
        toast({ kind: 'ok', title: 'Работа сдана! 🎉', text: r.xpGained ? `+${r.xpGained} XP` : 'Засчитано (опыт уже был получен ранее).' });
      } else {
        toast({ kind: 'err', title: 'Не все проверки пройдены', text: `Пройдено ${Math.round(r.submission.score * 100)} %. Попытка сохранена.` });
      }
      const cat = useApp.getState().catalog;
      for (const a of r.newAchievements) {
        const ach = cat?.achievements.find((x) => x.id === a);
        toast({ kind: 'achievement', title: `${ach?.icon ?? '🏅'} ${ach?.title ?? a}`, text: ach?.description });
      }
      void useApp.getState().loadProgress();
      void useApp.getState().loadUser();
    } catch (e) {
      toast({ kind: 'err', title: 'Не удалось сдать', text: (e as Error).message });
    } finally {
      setSubmitting(false);
      useWB.getState().set({ checking: false });
    }
  };

  const openHistory = async () => {
    setHistory([]);
    try { setHistory((await api.submissions(practice.id)).submissions); } catch { setHistory([]); }
  };

  const reset = () => {
    stopSim();
    storage.del(draftKey(practice.id));
    useWB.getState().init({ mode: 'practice', practice, title: practice.title, code: practice.starterCode, circuit: practice.starterCircuit, circuitLocked: !!practice.circuitLocked, palette: practice.palette ?? null });
    useWB.getState().set({ dirty: true });
    setConfirmReset(false);
  };

  return (
    <>
      <Workbench
        toolbarLeft={<Nav practice={practice} />}
        toolbarRight={(
          <>
            <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={() => setConfirmReset(true)} className="max-lg:hidden">Сначала</Button>
            {user && <Button variant="ghost" size="sm" icon={<History size={14} />} onClick={() => void openHistory()} className="max-lg:hidden">Попытки</Button>}
            <Button icon={<CheckCheck size={15} />} loading={checking && !submitting} onClick={() => void check()}>Проверить</Button>
            <Button variant="ok" icon={<Send size={14} />} loading={submitting} onClick={() => (user ? setSubmitOpen(true) : needLogin())}>Сдать</Button>
          </>
        )}
      />
      <Modal open={submitOpen} onClose={() => !submitting && setSubmitOpen(false)} title="Сдать работу"
        footer={<><Button onClick={() => setSubmitOpen(false)} disabled={submitting}>Отмена</Button><Button variant="ok" icon={<Send size={14} />} loading={submitting} onClick={() => void submit()}>Сдать</Button></>}>
        <div className="space-y-2 text-sm">
          <p className="text-muted">Код и схема будут проверены автоматически и попадут преподавателю.</p>
          <label className="block text-[13px] font-medium" htmlFor="student-comment">Комментарий преподавателю <span className="font-normal text-faint">(необязательно)</span></label>
          <textarea id="student-comment" value={studentComment} onChange={(e) => setStudentComment(e.target.value)} maxLength={2000} rows={4}
            placeholder="Например: что получилось, что не удалось, какой вопрос остался…"
            className="w-full resize-y rounded-lg border border-line bg-bg-2 p-2.5 text-sm outline-none focus:border-accent" />
        </div>
      </Modal>
      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Начать заново?" footer={<><Button onClick={() => setConfirmReset(false)}>Отмена</Button><Button variant="danger" onClick={reset}>Сбросить</Button></>}>
        Код и схема вернутся к исходным. Сданные попытки сохранятся.
      </Modal>
      <Modal open={history !== null} onClose={() => setHistory(null)} title="Мои попытки" wide>
        {!history?.length ? <div className="py-6 text-center text-sm text-muted">Попыток пока нет.</div> : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-3 rounded-lg border border-line p-2.5 text-sm">
                {h.status === 'passed' ? <CheckCircle2 size={18} className="text-ok" /> : <XCircle size={18} className="text-err" />}
                <span className="text-muted">{new Date(h.createdAt).toLocaleString('ru-RU')}</span>
                <Badge tone={h.status === 'passed' ? 'ok' : 'warn'}>{Math.round(h.score * 100)} %</Badge>
                {h.grade && <Badge tone="violet">оценка {h.grade}</Badge>}
                {h.studentComment && <span className="truncate text-xs text-faint" title={h.studentComment}>✎ {h.studentComment}</span>}
                {h.comment && <span className="truncate text-xs text-muted" title={h.comment}>💬 {h.comment}</span>}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={async () => {
                  const full = (await api.submission(h.id)).submission;
                  if (full.code) { useWB.getState().setCode(full.code); if (full.circuit) useWB.getState().setCircuit(full.circuit); }
                  setHistory(null);
                }}>Загрузить код</Button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

function QuizView({ practice }: { practice: PublicPractice }) {
  const user = useApp((s) => s.user);
  const toast = useApp((s) => s.toast);
  const [answers, setAnswers] = useState<number[][]>(() => (practice.quiz ?? []).map(() => []));
  const [result, setResult] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const questions = practice.quiz ?? [];
  const toggle = (qi: number, oi: number, multi: boolean) => {
    setAnswers((a) => a.map((x, i) => (i !== qi ? x : multi ? (x.includes(oi) ? x.filter((y) => y !== oi) : [...x, oi]) : [oi])));
  };
  const submit = async () => {
    if (!user) { toast({ kind: 'info', title: 'Войдите, чтобы пройти тест' }); return; }
    setBusy(true);
    try {
      const r = await api.submit({ practiceId: practice.id, code: '', circuit: { parts: [], wires: [] }, hintsUsed: 0, quizAnswers: answers });
      setResult(r.submission);
      if (r.submission.status === 'passed') toast({ kind: 'ok', title: 'Тест пройден!', text: r.xpGained ? `+${r.xpGained} XP` : undefined });
      void useApp.getState().loadProgress();
    } catch (e) {
      toast({ kind: 'err', title: 'Ошибка', text: (e as Error).message });
    } finally { setBusy(false); }
  };
  return (
    // страницы /p/* целиком не прокручиваются (там редактор), поэтому у теста своя прокрутка
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-3xl px-5 py-8">
      <Link to="/course" className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted hover:text-text"><ArrowLeft size={14} /> К курсу</Link>
      <div className="mb-1 flex gap-1.5"><Badge tone={KIND_LABEL.quiz.tone}>Тест</Badge><Badge>{questions.length} вопросов</Badge><Badge tone="accent">{practice.xp} XP</Badge></div>
      <h1 className="text-2xl font-bold">{practice.title}</h1>
      <Md text={practice.story} className="mt-2 text-muted" />
      <div className="mt-6 space-y-4">
        {questions.map((q, qi) => {
          const r = result?.results[qi];
          return (
            <div key={q.id} className={`rounded-2xl border bg-panel p-5 ${r ? (r.ok ? 'border-ok/40' : 'border-err/40') : 'border-line'}`}>
              <div className="mb-2 flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">{qi + 1}</span>
                <Md text={q.text} className="flex-1" />
              </div>
              {q.multi && <div className="-mt-1 mb-2 pl-8 text-xs text-faint">Выберите все верные варианты</div>}
              {q.code && <pre className="mb-3 overflow-x-auto rounded-lg border border-line bg-[var(--code-bg)] p-3 font-mono text-[12.5px]">{q.code}</pre>}
              <div className="space-y-1.5">
                {q.options.map((o, oi) => {
                  const chosen = answers[qi]?.includes(oi);
                  return (
                    <button key={oi} disabled={!!result} onClick={() => toggle(qi, oi, !!q.multi)} role={q.multi ? 'checkbox' : 'radio'} aria-checked={!!chosen}
                      className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left text-[14px] transition ${chosen ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}>
                      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border-2 ${q.multi ? 'rounded' : 'rounded-full'} ${chosen ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong'}`}>{q.multi && chosen && <Check size={11} strokeWidth={3} />}</span>
                      <Md text={o} />
                    </button>
                  );
                })}
              </div>
              {r && <div className={`mt-3 rounded-lg p-2.5 text-[13.5px] ${r.ok ? 'bg-ok/10' : 'bg-err/10'}`}><b>{r.ok ? 'Верно.' : 'Неверно.'}</b> {r.message && <Md text={r.message} />}</div>}
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex items-center gap-3">
        {!result ? (
          <Button variant="primary" size="lg" loading={busy} disabled={answers.some((a) => !a.length)} onClick={() => void submit()}>Отправить ответы</Button>
        ) : (
          <>
            <Badge tone={result.status === 'passed' ? 'ok' : 'err'} className="text-sm">Результат: {Math.round(result.score * 100)} %</Badge>
            <Button onClick={() => { setResult(null); setAnswers(questions.map(() => [])); }}>Пройти ещё раз</Button>
          </>
        )}
        {answers.some((a) => !a.length) && !result && <span className="text-xs text-faint">Ответьте на все вопросы</span>}
      </div>
    </div>
    </div>
  );
}
