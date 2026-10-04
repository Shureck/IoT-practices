import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, FolderOpen, Share2, Sparkles, FilePlus2, Trash2, Copy, Check } from 'lucide-react';
import { emptyCircuit, type CircuitDoc } from '@esp32lab/sim';
import { Workbench } from '../workbench/Workbench';
import { useWB } from '../workbench/store';
import { stopSim } from '../workbench/simController';
import { api, type Project } from '../lib/api';
import { storage, useApp } from '../store/app';
import { Button, Modal, Spinner, inputCls, Empty } from '../components/ui';
import { EMPTY_SKETCH, EXAMPLES } from '../lib/examples';

const LOCAL = 'sandbox:local';

export default function Sandbox() {
  const { projectId, token } = useParams();
  const user = useApp((s) => s.user);
  const toast = useApp((s) => s.toast);
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [project, setProject] = useState<Pick<Project, 'id' | 'title' | 'shareToken'> | null>(null);
  const [title, setTitle] = useState('Мой проект');
  const [readOnlyShared, setReadOnlyShared] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = (code: string, circuit: CircuitDoc, t: string) => {
    stopSim();
    useWB.getState().init({ mode: 'sandbox', code, circuit, title: t });
    setTitle(t);
    setReady(true);
  };

  useEffect(() => {
    setReady(false);
    (async () => {
      try {
        if (token) {
          const { project: p } = await api.shared(token);
          setReadOnlyShared(p.author);
          setProject(null);
          load(p.code, p.circuit, p.title);
          return;
        }
        if (projectId) {
          const { project: p } = await api.project(Number(projectId));
          setProject(p);
          setReadOnlyShared(null);
          load(p.code, p.circuit, p.title);
          return;
        }
      } catch (e) {
        toast({ kind: 'err', title: 'Не удалось открыть проект', text: (e as Error).message });
      }
      setProject(null);
      setReadOnlyShared(null);
      const local = storage.get<{ code: string; circuit: CircuitDoc; title: string } | null>(LOCAL, null);
      if (local) load(local.code, local.circuit, local.title);
      else load(EMPTY_SKETCH, emptyCircuit(), 'Мой проект');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, token]);

  // локальное автосохранение (без проекта на сервере)
  const code = useWB((s) => s.code);
  const circuit = useWB((s) => s.circuit);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!ready || project || token) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => storage.set(LOCAL, { code, circuit, title }), 800);
  }, [code, circuit, title, ready, project, token]);

  const save = async () => {
    if (!user) { toast({ kind: 'info', title: 'Проект сохранён в браузере', text: 'Войдите, чтобы хранить проекты на сервере и делиться ими.' }); storage.set(LOCAL, { code, circuit, title }); return; }
    setSaving(true);
    try {
      const s = useWB.getState();
      if (project) {
        await api.updateProject(project.id, { title, code: s.code, circuit: s.circuit });
        toast({ kind: 'ok', title: 'Сохранено' });
      } else {
        const { project: p } = await api.createProject({ title, code: s.code, circuit: s.circuit });
        setProject(p);
        nav(`/sandbox/${p.id}`, { replace: true });
        toast({ kind: 'ok', title: 'Проект создан' });
      }
      useWB.getState().set({ dirty: false });
    } catch (e) {
      toast({ kind: 'err', title: 'Ошибка сохранения', text: (e as Error).message });
    } finally { setSaving(false); }
  };

  useEffect(() => {
    const h = () => void save();
    window.addEventListener('esp32lab:save', h);
    return () => window.removeEventListener('esp32lab:save', h);
  });

  const share = async () => {
    if (!project) { await save(); return; }
    try {
      const { shareToken } = await api.shareProject(project.id);
      setShareUrl(`${location.origin}/shared/${shareToken}`);
    } catch (e) { toast({ kind: 'err', title: 'Не удалось поделиться', text: (e as Error).message }); }
  };

  if (!ready) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  return (
    <>
      <Workbench
        toolbarLeft={(
          <div className="flex items-center gap-1.5">
            <input className="h-8 w-48 rounded-lg border border-transparent bg-transparent px-2 text-[13.5px] font-semibold outline-none hover:border-line focus:border-accent/50 max-md:w-32" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Название проекта" />
            {readOnlyShared && <span className="text-xs text-faint max-md:hidden">автор: {readOnlyShared}</span>}
          </div>
        )}
        toolbarRight={(
          <>
            <Button variant="ghost" size="sm" icon={<Sparkles size={14} />} onClick={() => setExamplesOpen(true)}>Примеры</Button>
            {user && <Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={() => setListOpen(true)} className="max-md:hidden">Проекты</Button>}
            {user && <Button variant="ghost" size="sm" icon={<Share2 size={14} />} onClick={() => void share()} className="max-md:hidden">Поделиться</Button>}
            <Button variant="primary" size="sm" icon={<Save size={14} />} loading={saving} onClick={() => void save()}>{readOnlyShared ? 'Сохранить копию' : 'Сохранить'}</Button>
          </>
        )}
      />
      <ProjectsModal open={listOpen} onClose={() => setListOpen(false)} />
      <Modal open={examplesOpen} onClose={() => setExamplesOpen(false)} title="Примеры" wide>
        <div className="grid gap-2 sm:grid-cols-2">
          {EXAMPLES.map((ex) => (
            <button key={ex.id} className="rounded-xl border border-line p-3 text-left transition hover:border-accent/60 hover:bg-panel-2"
              onClick={() => { setProject(null); nav('/sandbox'); load(ex.code, ex.circuit, ex.title); setExamplesOpen(false); }}>
              <div className="font-semibold">{ex.title}</div>
              <div className="text-[13px] text-muted">{ex.description}</div>
            </button>
          ))}
          <button className="flex items-center gap-2 rounded-xl border border-dashed border-line p-3 text-left text-muted hover:border-accent/60"
            onClick={() => { setProject(null); nav('/sandbox'); load(EMPTY_SKETCH, emptyCircuit(), 'Новый проект'); setExamplesOpen(false); }}>
            <FilePlus2 size={18} /> Пустой проект
          </button>
        </div>
      </Modal>
      <Modal open={!!shareUrl} onClose={() => setShareUrl(null)} title="Ссылка на проект">
        <p className="mb-2 text-sm text-muted">Любой, у кого есть ссылка, сможет открыть копию проекта.</p>
        <ShareBox url={shareUrl ?? ''} />
      </Modal>
    </>
  );
}

function ShareBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input className={`${inputCls} font-mono text-xs`} readOnly value={url} onFocus={(e) => e.target.select()} />
      <Button icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => { void navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Скопировано' : 'Копировать'}</Button>
    </div>
  );
}

function ProjectsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [list, setList] = useState<{ id: number; title: string; updatedAt: string }[] | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    if (!open) return;
    setList(null);
    api.projects().then((r) => setList(r.projects)).catch(() => setList([]));
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Мои проекты" wide>
      {!list ? <div className="flex justify-center py-6"><Spinner /></div> : !list.length ? (
        <Empty icon="📁" title="Пока нет проектов" text="Нажмите «Сохранить», чтобы создать первый." />
      ) : (
        <div className="space-y-1.5">
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
              <button className="flex-1 text-left" onClick={() => { nav(`/sandbox/${p.id}`); onClose(); }}>
                <div className="font-medium">{p.title}</div>
                <div className="text-xs text-faint">изменён {new Date(p.updatedAt).toLocaleString('ru-RU')}</div>
              </button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={async () => {
                if (!confirm(`Удалить «${p.title}»?`)) return;
                await api.deleteProject(p.id);
                setList((l) => l?.filter((x) => x.id !== p.id) ?? null);
              }} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
