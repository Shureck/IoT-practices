// Просмотр сданной работы преподавателем: верстак только для чтения + оценка.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Eye, MessageSquare, Bot } from 'lucide-react';
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
