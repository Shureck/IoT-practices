import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Copy, Users, Trash2, CalendarPlus, Inbox, Grid3x3, CalendarClock, Download, Lock, Unlock, MessageSquareText } from 'lucide-react';
import { api, type Assignment, type Group, type GroupProgress, type Submission } from '../lib/api';
import { useApp } from '../store/app';
import { Badge, Button, Empty, Field, Modal, Spinner, Tabs, inputCls, inputBase } from '../components/ui';
import { KIND_LABEL } from '../workbench/TaskPanel';

export default function Teacher() {
  const toast = useApp((s) => s.toast);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [gid, setGid] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'matrix' | 'queue' | 'access' | 'deadlines'>('matrix');

  const reload = async () => {
    try {
      const r = await api.groups();
      setGroups(r.groups);
      if (!gid && r.groups.length) setGid(r.groups[0].id);
    } catch (e) { toast({ kind: 'err', title: 'Ошибка', text: (e as Error).message }); setGroups([]); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    const { group } = await api.createGroup(name.trim());
    setName(''); setCreating(false);
    await reload();
    setGid(group.id);
  };

  const group = groups?.find((g) => g.id === gid) ?? null;

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Кабинет преподавателя</h1>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} className="ml-auto" onClick={() => setCreating(true)}>Новая группа</Button>
      </div>
      {!groups ? <Spinner /> : !groups.length ? (
        <Empty icon="👥" title="Создайте первую группу" text="Студенты присоединяются к группе по коду при регистрации или в профиле." action={<Button variant="primary" onClick={() => setCreating(true)}>Создать группу</Button>} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {groups.map((g) => (
              <button key={g.id} onClick={() => setGid(g.id)} className={`rounded-xl border px-3.5 py-2 text-left transition ${g.id === gid ? 'border-accent bg-accent/10' : 'border-line bg-panel hover:border-line-strong'}`}>
                <div className="text-sm font-semibold">{g.name}</div>
                <div className="flex items-center gap-2 text-xs text-muted"><Users size={12} />{g.studentCount} · код <span className="font-mono text-accent">{g.joinCode}</span></div>
              </button>
            ))}
          </div>
          {group && (
            <div className="rounded-2xl border border-line bg-panel">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                <Tabs value={tab} onChange={setTab} tabs={[
                  { id: 'matrix', label: <><Grid3x3 size={14} /> Прогресс</> },
                  { id: 'queue', label: <><Inbox size={14} /> На проверку</> },
                  { id: 'access', label: <><Unlock size={14} /> Доступ</> },
                  { id: 'deadlines', label: <><CalendarClock size={14} /> Дедлайны</> },
                ]} />
                <div className="ml-auto flex items-center gap-2 text-[13px]">
                  <span className="text-muted">Код для студентов:</span>
                  <button className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5 font-mono font-semibold text-accent" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/register?group=${group.joinCode}`); toast({ kind: 'ok', title: 'Ссылка-приглашение скопирована' }); }}>
                    {group.joinCode} <Copy size={12} />
                  </button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={async () => {
                    if (!confirm(`Удалить группу «${group.name}»? Работы студентов сохранятся.`)) return;
                    await api.deleteGroup(group.id); setGid(null); await reload();
                  }} />
                </div>
              </div>
              {tab === 'matrix' && <Matrix group={group} />}
              {tab === 'queue' && <Queue group={group} />}
              {tab === 'access' && <Access group={group} />}
              {tab === 'deadlines' && <Deadlines group={group} />}
            </div>
          )}
        </>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Новая группа" footer={<><Button onClick={() => setCreating(false)}>Отмена</Button><Button variant="primary" onClick={() => void create()}>Создать</Button></>}>
        <Field label="Название"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, ИКБО-01-24" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} /></Field>
      </Modal>
    </div>
  );
}

function Matrix({ group }: { group: Group }) {
  const catalog = useApp((s) => s.catalog);
  const [data, setData] = useState<GroupProgress | null>(null);
  const [mod, setMod] = useState<number>(0);
  const nav = useNavigate();
  useEffect(() => { setData(null); api.groupProgress(group.id).then(setData).catch(() => setData({ group, students: [], cells: {} })); }, [group]);
  const practices = useMemo(() => (catalog?.practices ?? []).filter((p) => !mod || p.module === mod), [catalog, mod]);
  if (!data || !catalog) return <div className="p-6"><Spinner /></div>;
  if (!data.students.length) return <Empty icon="🧑‍🎓" title="В группе пока нет студентов" text={<>Отправьте студентам код <b className="font-mono text-accent">{group.joinCode}</b> — они введут его при регистрации.</>} />;

  const exportCsv = () => {
    const rows = [['Студент', 'Email', 'XP', ...practices.map((p) => p.title)]];
    for (const s of data.students) {
      rows.push([s.name, s.email, String(s.xp), ...practices.map((p) => {
        const c = data.cells[s.id]?.[p.id];
        return c ? `${c.status === 'passed' ? 'сдано' : c.status === 'failed' ? 'не сдано' : 'черновик'}${c.grade ? ` (${c.grade})` : ''}` : '';
      })]);
    }
    const csv = '﻿' + rows.map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${group.name}.csv`;
    a.click();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5">
        <button onClick={() => setMod(0)} className={`rounded-md px-2 py-1 text-xs ${!mod ? 'bg-panel-2 font-semibold' : 'text-muted'}`}>Все</button>
        {catalog.modules.map((m) => <button key={m.id} onClick={() => setMod(m.id)} className={`rounded-md px-2 py-1 text-xs ${mod === m.id ? 'bg-panel-2 font-semibold' : 'text-muted'}`}>{m.icon} {m.title}</button>)}
        <Button size="sm" variant="ghost" className="ml-auto" icon={<Download size={14} />} onClick={exportCsv}>CSV</Button>
      </div>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-y border-line bg-panel-2/60">
              <th className="sticky left-0 z-10 min-w-48 bg-panel-2 px-3 py-2 text-left font-semibold">Студент</th>
              <th className="px-2 py-2 font-semibold">XP</th>
              {practices.map((p) => (
                <th key={p.id} className="min-w-12 px-1 py-2 align-bottom font-medium" title={p.title}>
                  <div className="mx-auto w-5 whitespace-nowrap text-[11px] text-muted [writing-mode:vertical-rl] rotate-180">{p.title}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.id} className="border-b border-line hover:bg-panel-2/40">
                <td className="sticky left-0 bg-panel px-3 py-1.5"><div className="font-medium">{s.name}</div><div className="text-[11px] text-faint">{s.email}</div></td>
                <td className="px-2 text-center font-mono">{s.xp}</td>
                {practices.map((p) => {
                  const c = data.cells[s.id]?.[p.id];
                  const cls = !c ? 'bg-transparent text-faint' : c.status === 'passed' ? 'bg-ok/20 text-ok' : c.status === 'failed' ? 'bg-err/15 text-err' : 'bg-accent/10 text-accent';
                  return (
                    <td key={p.id} className="p-0.5 text-center">
                      <button disabled={!c?.submissionId} onClick={() => c?.submissionId && nav(`/review/${c.submissionId}`)}
                        className={`h-8 w-full rounded-md font-semibold transition ${cls} ${c?.submissionId ? 'hover:ring-2 hover:ring-accent/50' : ''}`}
                        title={c ? `${c.status} · ${Math.round(c.score * 100)}% · попыток: ${c.attempts}` : 'не начато'}>
                        {c ? (c.grade ?? (c.status === 'passed' ? '✓' : c.status === 'failed' ? `${Math.round(c.score * 100)}` : '…')) : '·'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-4 px-4 py-2.5 text-[11.5px] text-muted">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-ok/40" />сдано (цифра — оценка)</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-err/30" />не все проверки (% пройденных)</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-accent/25" />черновик</span>
      </div>
    </div>
  );
}

function Queue({ group }: { group: Group }) {
  const catalog = useApp((s) => s.catalog);
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { setSubs(null); api.teacherSubmissions({ groupId: group.id, unreviewed: !all }).then((r) => setSubs(r.submissions)).catch(() => setSubs([])); }, [group, all]);
  if (!subs) return <div className="p-6"><Spinner /></div>;
  return (
    <div className="p-4">
      <label className="mb-3 flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> показывать и проверенные</label>
      {!subs.length ? <Empty icon="📭" title="Нет работ на проверку" text="Сюда попадают сданные студентами работы без оценки." /> : (
        <div className="space-y-1.5">
          {subs.map((s) => {
            const p = catalog?.practices.find((x) => x.id === s.practiceId);
            return (
              <Link key={s.id} to={`/review/${s.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-[13.5px] transition hover:border-accent/50 hover:bg-panel-2">
                <span className="w-44 truncate font-medium">{s.studentName}</span>
                {p && <Badge tone={KIND_LABEL[p.kind].tone}>{KIND_LABEL[p.kind].label}</Badge>}
                <span className="flex-1 truncate">{p?.title ?? s.practiceId}</span>
                {s.studentComment && <span className="flex max-w-60 items-center gap-1 truncate text-xs text-muted" title={s.studentComment}><MessageSquareText size={13} className="shrink-0 text-accent" />{s.studentComment}</span>}
                <Badge tone={s.status === 'passed' ? 'ok' : 'warn'}>{Math.round(s.score * 100)} %</Badge>
                {s.grade && <Badge tone="violet">{s.grade}</Badge>}
                <span className="text-xs text-faint">{new Date(s.createdAt).toLocaleString('ru-RU')}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Какие практики открыты группе: студенты видят закрытые с замком и не могут их сдавать. */
function Access({ group }: { group: Group }) {
  const catalog = useApp((s) => s.catalog);
  const toast = useApp((s) => s.toast);
  const [open, setOpen] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setOpen(null); api.groupAccess(group.id).then((r) => setOpen(new Set(r.open))).catch(() => setOpen(new Set())); }, [group]);
  const save = async (next: Set<string>) => {
    const prev = open;
    setOpen(next);
    setSaving(true);
    try { setOpen(new Set((await api.setGroupAccess(group.id, [...next])).open)); }
    catch (e) { setOpen(prev); toast({ kind: 'err', title: 'Не удалось сохранить', text: (e as Error).message }); }
    finally { setSaving(false); }
  };
  if (!open || !catalog) return <div className="p-6"><Spinner /></div>;
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(open);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    void save(next);
  };
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        Открыто практик: <b className="text-text">{open.size}</b> из {catalog.practices.length}. Закрытые студенты группы видят с замком и не могут сдавать.
        {saving && <Spinner size={14} />}
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" icon={<Unlock size={14} />} onClick={() => toggle(catalog.practices.map((p) => p.id), true)}>Открыть всё</Button>
          <Button size="sm" variant="ghost" icon={<Lock size={14} />} onClick={() => toggle(catalog.practices.map((p) => p.id), false)}>Закрыть всё</Button>
        </div>
      </div>
      {catalog.modules.map((m) => {
        const list = catalog.practices.filter((p) => p.module === m.id).sort((a, b) => a.order - b.order);
        const all = list.every((p) => open.has(p.id));
        return (
          <div key={m.id} className="rounded-xl border border-line">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <span className="text-lg">{m.icon}</span>
              <span className="font-semibold">{m.title}</span>
              <span className="text-xs text-faint">{list.filter((p) => open.has(p.id)).length}/{list.length}</span>
              <Button size="sm" variant="ghost" className="ml-auto" icon={all ? <Lock size={14} /> : <Unlock size={14} />} onClick={() => toggle(list.map((p) => p.id), !all)}>
                {all ? 'Закрыть модуль' : 'Открыть модуль'}
              </Button>
            </div>
            <div className="divide-y divide-line">
              {list.map((p) => {
                const on = open.has(p.id);
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13.5px] hover:bg-panel-2">
                    <input type="checkbox" checked={on} onChange={(e) => toggle([p.id], e.target.checked)} />
                    <Badge tone={KIND_LABEL[p.kind].tone}>{KIND_LABEL[p.kind].label}</Badge>
                    <span className={`flex-1 ${on ? '' : 'text-muted'}`}>{p.title}</span>
                    {on ? <Unlock size={14} className="text-ok" /> : <Lock size={14} className="text-faint" />}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Deadlines({ group }: { group: Group }) {
  const catalog = useApp((s) => s.catalog);
  const [list, setList] = useState<Assignment[] | null>(null);
  const [pid, setPid] = useState('');
  const [due, setDue] = useState(() => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 16));
  const reload = () => api.assignments(group.id).then((r) => setList(r.assignments)).catch(() => setList([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [group]);
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-panel-2/40 p-3">
        <Field label="Практика">
          <select className={`${inputBase} w-80`} value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">— выберите —</option>
            {catalog?.modules.map((m) => (
              <optgroup key={m.id} label={`${m.icon} ${m.title}`}>
                {catalog.practices.filter((p) => p.module === m.id).map((p) => <option key={p.id} value={p.id}>{KIND_LABEL[p.kind].label}: {p.title}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Срок сдачи"><input type="datetime-local" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Button variant="primary" icon={<CalendarPlus size={15} />} disabled={!pid} onClick={async () => { await api.createAssignment(group.id, pid, new Date(due).toISOString()); setPid(''); void reload(); }}>Назначить</Button>
      </div>
      {!list ? <Spinner /> : !list.length ? <div className="text-sm text-muted">Дедлайнов пока нет. Назначенные работы студенты увидят в курсе с датой.</div> : (
        <div className="space-y-1.5">
          {list.sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map((a) => {
            const p = catalog?.practices.find((x) => x.id === a.practiceId);
            const past = new Date(a.dueAt) < new Date();
            return (
              <div key={a.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-[13.5px]">
                <CalendarClock size={16} className={past ? 'text-faint' : 'text-warn'} />
                <span className="flex-1">{p?.title ?? a.practiceId}</span>
                <span className={past ? 'text-faint' : ''}>{new Date(a.dueAt).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={async () => { await api.deleteAssignment(a.id); void reload(); }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
