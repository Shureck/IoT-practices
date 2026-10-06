import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Sparkles, CircleDashed, XCircle, CalendarClock, Trophy, Lock } from 'lucide-react';
import { useApp } from '../store/app';
import { Badge, Empty, Progress, Spinner } from '../components/ui';
import { Md } from '../lib/markdown';
import { KIND_LABEL } from '../workbench/TaskPanel';
import type { PublicPractice } from '../lib/api';

export function levelOf(xp: number) {
  const level = Math.floor(Math.sqrt(xp / 60)) + 1;
  const cur = 60 * (level - 1) ** 2;
  const next = 60 * level ** 2;
  const titles = ['Стажёр', 'Младший инженер', 'Инженер', 'Старший инженер', 'Ведущий инженер', 'Главный инженер', 'Начальник станции'];
  return { level, progress: (xp - cur) / (next - cur), toNext: next - xp, title: titles[Math.min(titles.length - 1, level - 1)] };
}

const DIFF = ['', '●○○', '●●○', '●●●'];

function PracticeCard({ p }: { p: PublicPractice }) {
  const progress = useApp((s) => s.progress);
  const item = progress?.items.find((i) => i.practiceId === p.id);
  const due = progress?.assignments.find((a) => a.practiceId === p.id);
  const status = item?.status;
  const overdue = due && new Date(due.dueAt) < new Date() && status !== 'passed';
  const locked = useApp((s) => s.isLocked(p.id));
  if (locked) {
    return (
      <div className="relative flex flex-col rounded-xl border border-dashed border-line bg-panel/50 p-3.5 opacity-70" title="Практику откроет преподаватель">
        <div className="mb-2 flex items-center gap-1.5">
          <Badge tone={KIND_LABEL[p.kind].tone}>{KIND_LABEL[p.kind].label}</Badge>
          <span className="font-mono text-[10px] tracking-widest text-faint">{DIFF[p.difficulty]}</span>
          <Lock size={15} className="ml-auto text-faint" />
        </div>
        <div className="font-semibold leading-snug text-muted">{p.title}</div>
        <div className="mt-0.5 line-clamp-2 text-[12.5px] text-faint">{p.subtitle}</div>
        <div className="mt-auto pt-3 text-[11.5px] text-faint">Откроет преподаватель</div>
      </div>
    );
  }
  return (
    <Link to={`/p/${p.id}`} className={`focus-ring group relative flex flex-col rounded-xl border bg-panel p-3.5 transition hover:-translate-y-0.5 hover:shadow-lg ${status === 'passed' ? 'border-ok/35' : 'border-line hover:border-line-strong'}`}>
      <div className="mb-2 flex items-center gap-1.5">
        <Badge tone={KIND_LABEL[p.kind].tone}>{KIND_LABEL[p.kind].label}</Badge>
        <span className="font-mono text-[10px] tracking-widest text-faint" title="Сложность">{DIFF[p.difficulty]}</span>
        <span className="ml-auto">
          {status === 'passed' ? <CheckCircle2 size={17} className="text-ok" /> : status === 'failed' ? <XCircle size={17} className="text-warn" /> : status === 'draft' ? <CircleDashed size={17} className="text-accent" /> : null}
        </span>
      </div>
      <div className="font-semibold leading-snug group-hover:text-accent">{p.title}</div>
      <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{p.subtitle}</div>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-[11.5px] text-faint">
        <span className="flex items-center gap-1"><Clock size={12} />{p.minutes} мин</span>
        <span className="flex items-center gap-1"><Sparkles size={12} />{p.xp} XP</span>
        {item?.grade ? <Badge tone="violet">оценка {item.grade}</Badge> : null}
        {due && <span className={`flex items-center gap-1 ${overdue ? 'text-err' : 'text-warn'}`}><CalendarClock size={12} />до {new Date(due.dueAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>}
      </div>
    </Link>
  );
}

export default function Course() {
  const catalog = useApp((s) => s.catalog);
  const error = useApp((s) => s.catalogError);
  const user = useApp((s) => s.user);
  const progress = useApp((s) => s.progress);
  if (error) return <Empty icon="📡" title="Нет связи с сервером" text={error} />;
  if (!catalog) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const passed = new Set(progress?.items.filter((i) => i.status === 'passed').map((i) => i.practiceId));
  const xp = progress?.xp ?? 0;
  const lvl = levelOf(xp);
  const total = catalog.practices.length;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-line bg-gradient-to-br from-accent/10 via-panel to-accent-2/10 p-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent">Курс «Интернет вещей»</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Станция «Полярная-5»</h1>
          <Md text={catalog.story} className="mt-2 max-w-2xl text-[14.5px] text-muted" />
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          {user ? (
            <>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-2 text-lg font-bold text-white">{lvl.level}</div>
                <div>
                  <div className="font-semibold">{lvl.title}</div>
                  <div className="text-xs text-muted">{xp} XP · до уровня {lvl.level + 1}: {lvl.toNext}</div>
                </div>
              </div>
              <Progress value={lvl.progress} className="mt-3" />
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted">Пройдено практик</span>
                <span className="font-semibold">{passed.size} / {total}</span>
              </div>
              <Progress value={passed.size / Math.max(1, total)} tone="ok" className="mt-1.5" />
              <Link to="/profile" className="mt-4 flex items-center gap-2 text-[13px] text-accent hover:underline"><Trophy size={14} /> Достижения: {progress?.achievements.length ?? 0} из {catalog.achievements.length}</Link>
              {!user.groupId && user.role === 'student' && <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">Вы не в группе — преподаватель не увидит ваши работы. Введите код группы в <Link to="/profile" className="underline">профиле</Link>.</div>}
            </>
          ) : (
            <div className="text-sm">
              <div className="font-semibold">Войдите, чтобы сохранять прогресс</div>
              <p className="mt-1 text-muted">Без входа можно читать задания и пробовать симулятор, но проверка и сдача работ доступны после регистрации.</p>
              <div className="mt-3 flex gap-2">
                <Link to="/register" className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink">Регистрация</Link>
                <Link to="/login" className="rounded-lg border border-line px-3 py-1.5 text-[13px]">Вход</Link>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 space-y-10">
        {catalog.modules.map((m) => {
          const list = catalog.practices.filter((p) => p.module === m.id);
          if (!list.length) return null;
          const done = list.filter((p) => passed.has(p.id)).length;
          return (
            <section key={m.id}>
              <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-1">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl" style={{ background: `${m.color}22` }}>{m.icon}</span>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: m.color }}>{m.lecture ? `Модуль ${m.id} · Лекция ${m.lecture}` : 'Итоговый проект'}</div>
                    <h2 className="text-lg font-bold leading-tight">{m.title}</h2>
                  </div>
                </div>
                <div className="pb-0.5 text-[13px] text-muted">{m.subtitle}</div>
                <div className="ml-auto pb-0.5 text-xs text-faint">{done}/{list.length} сдано</div>
              </div>
              <p className="mb-3 max-w-3xl text-[13.5px] text-muted">{m.story}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {list.map((p) => <PracticeCard key={p.id} p={p} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
