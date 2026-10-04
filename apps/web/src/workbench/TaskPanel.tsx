// Левая панель практики: сюжет, цели, теория, подсказки, результаты проверок.
import { useState } from 'react';
import { CheckCircle2, Circle, XCircle, Lightbulb, BookOpen, Target, Clock, Sparkles } from 'lucide-react';
import { useWB } from './store';
import { Md, MdInline } from '../lib/markdown';
import { Badge, Button, Tabs } from '../components/ui';
import { useApp } from '../store/app';

export const KIND_LABEL: Record<string, { label: string; tone: 'accent' | 'violet' | 'warn' | 'ok' }> = {
  lab: { label: 'Лабораторная', tone: 'accent' },
  homework: { label: 'Домашняя', tone: 'violet' },
  case: { label: 'Кейс', tone: 'warn' },
  quiz: { label: 'Тест', tone: 'ok' },
};

export function TaskPanel() {
  const p = useWB((s) => s.practice);
  const results = useWB((s) => s.checkResults);
  const checking = useWB((s) => s.checking);
  const hintsUsed = useWB((s) => s.hintsUsed);
  const progress = useApp((s) => s.progress);
  const [tab, setTab] = useState<'task' | 'theory' | 'hints'>('task');
  if (!p) return null;
  const item = progress?.items.find((i) => i.practiceId === p.id);
  const resultOf = (id: string) => results?.find((r) => r.id === id);
  const passed = results ? results.filter((r) => r.ok).length : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 pb-2 pt-3">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={KIND_LABEL[p.kind].tone}>{KIND_LABEL[p.kind].label}</Badge>
          <Badge><Clock size={11} /> {p.minutes} мин</Badge>
          <Badge tone="accent"><Sparkles size={11} /> {p.xp} XP</Badge>
          {item?.status === 'passed' && <Badge tone="ok">сдано{item.grade ? ` · ${item.grade}` : ''}</Badge>}
        </div>
        <h1 className="text-lg font-semibold leading-tight">{p.title}</h1>
        <div className="text-[13px] text-muted">{p.subtitle}</div>
        <Tabs
          className="-mb-2 mt-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'task', label: <><Target size={13} /> Задание</> },
            { id: 'theory', label: <><BookOpen size={13} /> Теория</>, hidden: !p.theory },
            { id: 'hints', label: <><Lightbulb size={13} /> Подсказки</>, badge: <span className="text-[10.5px] text-faint">{hintsUsed}/{p.hints.length}</span> },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === 'task' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-gradient-to-br from-accent/8 to-accent-2/8 p-3 text-[13.5px] leading-relaxed">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-accent">Станция «Полярная-5»</div>
              <Md text={p.story} />
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Цели</div>
              <ul className="space-y-2">
                {p.goals.map((g, i) => (
                  <li key={i} className="flex gap-2 text-[13.5px] leading-snug">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel-2 text-[11px] font-semibold text-muted">{i + 1}</span>
                    <MdInline text={g} />
                  </li>
                ))}
              </ul>
            </div>
            {p.kind !== 'quiz' && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Автопроверка</span>
                  {results && <span className={`text-xs font-semibold ${passed === results.length ? 'text-ok' : 'text-warn'}`}>{passed} из {results.length}</span>}
                </div>
                <ul className="space-y-1.5">
                  {p.checks.map((c) => {
                    const r = resultOf(c.id);
                    return (
                      <li key={c.id} className={`rounded-lg border px-2.5 py-2 text-[13px] ${r ? (r.ok ? 'border-ok/30 bg-ok/6' : 'border-err/30 bg-err/6') : 'border-line'}`}>
                        <div className="flex items-start gap-2">
                          {checking ? <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                            : r ? (r.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-err" />)
                              : <Circle size={16} className="mt-0.5 shrink-0 text-faint" />}
                          <span>{c.title}</span>
                        </div>
                        {r && !r.ok && r.message && <div className="ml-6 mt-1 text-[12.5px] text-muted">{r.message}</div>}
                      </li>
                    );
                  })}
                </ul>
                {item?.comment && (
                  <div className="mt-3 rounded-lg border border-accent-2/40 bg-accent-2/8 p-2.5 text-[13px]">
                    <div className="mb-0.5 text-[11px] font-semibold text-accent-2">Комментарий преподавателя{item.grade ? ` · оценка ${item.grade}` : ''}</div>
                    <div className="whitespace-pre-wrap">{item.comment}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {tab === 'theory' && p.theory && <Md text={p.theory} />}
        {tab === 'hints' && (
          <div className="space-y-2.5">
            {p.hints.slice(0, hintsUsed).map((h, i) => (
              <div key={i} className="anim-rise rounded-lg border border-warn/30 bg-warn/8 p-2.5 text-[13.5px]">
                <div className="mb-0.5 text-[11px] font-semibold text-warn">Подсказка {i + 1}</div>
                <Md text={h} />
              </div>
            ))}
            {hintsUsed < p.hints.length ? (
              <div className="rounded-lg border border-dashed border-line p-3 text-center">
                <div className="mb-2 text-xs text-muted">Каждая подсказка уменьшает награду на 10 % (но не ниже половины).</div>
                <Button size="sm" icon={<Lightbulb size={14} />} onClick={() => useWB.getState().set({ hintsUsed: hintsUsed + 1 })}>
                  Открыть подсказку {hintsUsed + 1} из {p.hints.length}
                </Button>
              </div>
            ) : <div className="text-center text-xs text-faint">Все подсказки открыты.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
