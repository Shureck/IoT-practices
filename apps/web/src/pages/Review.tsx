// Просмотр сданной работы преподавателем: верстак только для чтения + оценка.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Eye, MessageSquare, Bot, FilePen, History } from 'lucide-react';
import { Md } from '../lib/markdown';
import { api, type Submission } from '../lib/api';
import { useApp } from '../store/app';
import { useWB } from '../workbench/store';
import { Workbench } from '../workbench/Workbench';
import { stopSim } from '../workbench/simController';
import { Badge, Button, Modal, Spinner } from '../components/ui';

export default function Review() {
  const { id } = useParams();
  const catalog = useApp((s) => s.catalog);
  const toast = useApp((s) => s.toast);
  const [sub, setSub] = useState<Submission | null>(null);
  const [grade, setGrade] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempts, setAttempts] = useState<Submission[] | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const nav = useNavigate();
  const [ai, setAi] = useState<{ loading: boolean; text: string | null; open: boolean }>({ loading: false, text: null, open: false });

  useEffect(() => {
    void api.teacherSubmission(Number(id)).then(({ submission }) => {
      setSub(submission);
      setGrade(submission.grade);
      setComment(submission.comment ?? '');
      setAi({ loading: false, text: submission.aiFeedback ?? null, open: false });
      const practice = useApp.getState().catalog?.practices.find((p) => p.id === submission.practiceId) ?? null;
      stopSim();
      useWB.getState().init({
        mode: 'review', practice, readOnly: true, title: `${submission.studentName} — ${practice?.title ?? ''}`,
        code: submission.code ?? '', circuit: submission.circuit ?? { parts: [], wires: [] }, checkResults: submission.results,
      });
    }).catch((e) => toast({ kind: 'err', title: 'Не удалось открыть работу', text: (e as Error).message }));
  }, [id, catalog, toast]);

  // все попытки этого студента по этой практике (новые сверху)
  useEffect(() => {
    if (!sub?.studentId) return;
    setAttempts(null);
    api.teacherSubmissions({ studentId: sub.studentId, practiceId: sub.practiceId }).then((r) => setAttempts(r.submissions)).catch(() => setAttempts([]));
  }, [sub?.studentId, sub?.practiceId, sub?.id, sub?.grade]);

  if (!sub) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const practice = catalog?.practices.find((p) => p.id === sub.practiceId);
  const passed = sub.results.filter((r) => r.ok).length;

  const save = async () => {
    setSaving(true);
    try {
      await api.review(sub.id, grade, comment);
      toast({ kind: 'ok', title: 'Оценка сохранена' });
      setOpen(false);
      setSub({ ...sub, grade, comment });
    } catch (e) { toast({ kind: 'err', title: 'Ошибка', text: (e as Error).message }); } finally { setSaving(false); }
  };

  const askAi = async () => {
    if (ai.text) { setAi({ ...ai, open: !ai.open }); return; }
    setAi({ ...ai, loading: true, open: true });
    try {
      const { text } = await api.explain(sub.id);
      setAi({ loading: false, text, open: true });
    } catch (e) {
      setAi({ loading: false, text: null, open: false });
      toast({ kind: 'err', title: 'Разбор недоступен', text: (e as Error).message });
    }
  };

  const showSolution = async () => {
    try {
      const s = await api.solution(sub.practiceId);
      useWB.getState().set({ code: s.code, ...(s.circuit ? { circuit: s.circuit } : {}) });
      toast({ kind: 'info', title: 'Загружено эталонное решение', text: 'Чтобы вернуть работу студента, обновите страницу.' });
    } catch (e) { toast({ kind: 'err', title: 'Ошибка', text: (e as Error).message }); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2/60 px-3 py-2 text-[13px]">
        <Link to="/teacher" className="flex items-center gap-1 text-muted hover:text-text"><ArrowLeft size={14} /> Кабинет</Link>
        <span className="font-semibold">{sub.studentName}</span>
        <span className="text-muted">{practice?.title}</span>
        <Badge tone={sub.status === 'passed' ? 'ok' : 'warn'}>{passed}/{sub.results.length} проверок</Badge>
        {sub.hintsUsed > 0 && <Badge>подсказок: {sub.hintsUsed}</Badge>}
        <span className="text-xs text-faint">{new Date(sub.createdAt).toLocaleString('ru-RU')}</span>
        <div className="ml-auto flex gap-1.5">
          {sub.status === 'failed' && (
            <Button size="sm" variant="ghost" icon={<Bot size={14} />} loading={ai.loading} onClick={() => void askAi()}>
              {ai.text ? (ai.open ? 'Скрыть разбор ИИ' : 'Разбор ИИ') : 'Разбор ИИ'}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<History size={14} />} onClick={() => setHistOpen(true)}>Попытки{attempts ? ` (${attempts.length})` : ''}</Button>
          {sub.studentId && <Link to={`/review/draft/${sub.studentId}/${sub.practiceId}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-panel-2 hover:text-text" title="Что сейчас в редакторе у студента (может быть новее этой сдачи)"><FilePen size={14} />Текущий черновик</Link>}
          <Button size="sm" variant="ghost" icon={<Eye size={14} />} onClick={() => void showSolution()}>Эталон</Button>
          <Button size="sm" variant="primary" icon={<MessageSquare size={14} />} onClick={() => setOpen(true)}>{sub.grade ? `Оценка: ${sub.grade}` : 'Оценить'}</Button>
        </div>
      </div>
      {ai.open && ai.text && (
        <div className="max-h-64 overflow-y-auto border-b border-line bg-accent/5 px-3 py-2 text-[13px]">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent"><Bot size={13} /> Разбор ИИ-помощника</div>
          <Md text={ai.text} className="md text-[13px]" />
        </div>
      )}
      {sub.studentComment && (
        <div className="flex items-start gap-2 border-b border-line bg-accent/5 px-3 py-2 text-[13px]">
          <span className="shrink-0 font-medium text-accent">Комментарий студента:</span>
          <span className="whitespace-pre-wrap">{sub.studentComment}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-1.5">
        {sub.results.map((r) => (
          <span key={r.id} title={r.message} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] ${r.ok ? 'bg-ok/10 text-ok' : 'bg-err/10 text-err'}`}>
            {r.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}{r.title}
          </span>
        ))}
      </div>
      <div className="min-h-0 flex-1"><Workbench /></div>
      <Modal open={histOpen} onClose={() => setHistOpen(false)} title={`История попыток — ${sub.studentName ?? ''}, «${practice?.title ?? sub.practiceId}»`} wide>
        {!attempts ? <Spinner /> : !attempts.length ? <div className="py-6 text-center text-sm text-muted">Попыток нет.</div> : (
          <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
            {attempts.map((a, i) => {
              const ok = a.results.filter((r) => r.ok).length;
              const current = a.id === sub.id;
              return (
                <div key={a.id} className={`rounded-xl border p-3 text-[13px] ${current ? 'border-accent/60 bg-accent/5' : 'border-line'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">Попытка {attempts.length - i}</span>
                    {a.status === 'passed' ? <CheckCircle2 size={16} className="text-ok" /> : <XCircle size={16} className="text-err" />}
                    <Badge tone={a.status === 'passed' ? 'ok' : 'warn'}>{a.results.length ? `${ok}/${a.results.length} проверок` : `${Math.round(a.score * 100)} %`}</Badge>
                    {a.grade && <Badge tone="violet">оценка {a.grade}</Badge>}
                    {a.hintsUsed > 0 && <Badge>подсказок: {a.hintsUsed}</Badge>}
                    <span className="text-xs text-faint">{new Date(a.createdAt).toLocaleString('ru-RU')}</span>
                    {current ? <span className="ml-auto text-xs font-medium text-accent">открыта сейчас</span>
                      : <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setHistOpen(false); nav(`/review/${a.id}`); }}>Открыть</Button>}
                  </div>
                  {a.results.some((r) => !r.ok) && (
                    <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-muted">
                      {a.results.filter((r) => !r.ok).map((r) => <li key={r.id}>✗ {r.title}{r.message ? ` — ${r.message}` : ''}</li>)}
                    </ul>
                  )}
                  {a.studentComment && <div className="mt-2 whitespace-pre-wrap rounded-lg bg-accent/6 px-2.5 py-1.5"><b className="text-accent">Студент:</b> {a.studentComment}</div>}
                  {a.comment && <div className="mt-2 whitespace-pre-wrap rounded-lg bg-accent-2/8 px-2.5 py-1.5"><b className="text-accent-2">Преподаватель:</b> {a.comment}</div>}
                  {a.aiFeedback && (
                    <details className="mt-2 rounded-lg border border-line px-2.5 py-1.5">
                      <summary className="cursor-pointer text-[12.5px] text-muted"><Bot size={13} className="mr-1 inline" />Разбор ИИ-помощника</summary>
                      <Md text={a.aiFeedback} className="md mt-1 text-[13px]" />
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>
      <Modal open={open} onClose={() => setOpen(false)} title="Оценка работы" footer={<><Button onClick={() => setOpen(false)}>Отмена</Button><Button variant="primary" loading={saving} onClick={() => void save()}>Сохранить</Button></>}>
        <div className="mb-3 flex gap-2">
          {[2, 3, 4, 5].map((g) => (
            <button key={g} onClick={() => setGrade(grade === g ? null : g)} className={`h-12 w-12 rounded-xl border text-lg font-bold transition ${grade === g ? 'border-accent bg-accent/15 text-accent' : 'border-line hover:border-line-strong'}`}>{g}</button>
          ))}
        </div>
        <textarea className="focus-ring h-32 w-full rounded-lg border border-line bg-bg-2 p-3 text-sm outline-none" placeholder="Комментарий студенту…" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Modal>
    </div>
  );
}

/** Черновик студента (работа ещё не сдана): просмотр кода и схемы, запуск симуляции. */
export function DraftReview() {
  const { studentId, practiceId } = useParams();
  const catalog = useApp((s) => s.catalog);
  const [info, setInfo] = useState<{ studentName: string; updatedAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const practice = catalog?.practices.find((p) => p.id === practiceId) ?? null;

  useEffect(() => {
    if (!catalog) return;
    setInfo(null); setError(null);
    void api.studentDraft(Number(studentId), practiceId ?? '').then((d) => {
      setInfo({ studentName: d.studentName, updatedAt: d.updatedAt });
      stopSim();
      useWB.getState().init({ mode: 'review', practice, readOnly: true, title: `${d.studentName} — ${practice?.title ?? ''} (черновик)`, code: d.code, circuit: d.circuit });
    }).catch((e) => setError((e as Error).message));
  }, [studentId, practiceId, catalog, practice]);

  if (error) return <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">{error}<Link to="/teacher" className="text-accent hover:underline">В кабинет</Link></div>;
  if (!info) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2/60 px-3 py-2 text-[13px]">
        <Link to="/teacher" className="flex items-center gap-1 text-muted hover:text-text"><ArrowLeft size={14} /> Кабинет</Link>
        <span className="font-semibold">{info.studentName}</span>
        <span className="text-muted">{practice?.title}</span>
        <Badge tone="accent">черновик — ещё не сдан</Badge>
        <span className="text-xs text-faint">изменён {new Date(info.updatedAt).toLocaleString('ru-RU')}</span>
      </div>
      <div className="min-h-0 flex-1"><Workbench /></div>
    </div>
  );
}
