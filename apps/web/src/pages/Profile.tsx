import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../store/app';
import { Button, Field, Progress, inputCls } from '../components/ui';
import { levelOf } from './Course';

export default function Profile() {
  const user = useApp((s) => s.user)!;
  const progress = useApp((s) => s.progress);
  const catalog = useApp((s) => s.catalog);
  const setUser = useApp((s) => s.setUser);
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState(user.name);
  const [code, setCode] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [pw, setPw] = useState('');
  const xp = progress?.xp ?? 0;
  const lvl = levelOf(xp);
  const got = new Set(progress?.achievements ?? []);

  const update = async (b: Parameters<typeof api.updateMe>[0], msg: string) => {
    try {
      const { user: u } = await api.updateMe(b);
      setUser(u);
      toast({ kind: 'ok', title: msg });
      setCode(''); setOldPw(''); setPw('');
    } catch (e) { toast({ kind: 'err', title: 'Ошибка', text: (e as Error).message }); }
  };

  const passed = progress?.items.filter((i) => i.status === 'passed') ?? [];

  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-5 py-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-2 text-2xl font-bold text-white">{user.name.slice(0, 1)}</div>
          <div className="flex-1">
            <div className="text-xl font-bold">{user.name}</div>
            <div className="text-sm text-muted">{user.email} · {user.role === 'teacher' ? 'преподаватель' : user.groupName ? `группа ${user.groupName}` : 'без группы'}</div>
            {user.role === 'student' && <><div className="mt-2 text-xs text-muted">Уровень {lvl.level} — {lvl.title} · {xp} XP</div><Progress value={lvl.progress} className="mt-1" /></>}
          </div>
        </div>
        {user.role === 'student' && (
          <div className="rounded-2xl border border-line bg-panel p-5">
            <div className="mb-3 font-semibold">Достижения</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {catalog?.achievements.map((a) => (
                <div key={a.id} className={`flex items-center gap-3 rounded-xl border p-2.5 ${got.has(a.id) ? 'border-warn/40 bg-warn/8' : 'border-line opacity-55 grayscale'}`}>
                  <span className="text-2xl">{a.icon}</span>
                  <div><div className="text-sm font-semibold">{a.title}</div><div className="text-xs text-muted">{a.description}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}
        {user.role === 'student' && (
          <div className="rounded-2xl border border-line bg-panel p-5">
            <div className="mb-3 font-semibold">Сданные работы ({passed.length})</div>
            {!passed.length ? <div className="text-sm text-muted">Пока ничего — начните с <Link className="text-accent" to="/p/m1-blink">первой практики</Link>.</div> : (
              <div className="space-y-1">
                {passed.map((i) => {
                  const p = catalog?.practices.find((x) => x.id === i.practiceId);
                  return (
                    <Link key={i.practiceId} to={`/p/${i.practiceId}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-panel-2">
                      <span className="flex-1">{p?.title ?? i.practiceId}</span>
                      <span className="font-mono text-xs text-accent">+{i.xp} XP</span>
                      {i.grade && <span className="rounded bg-accent-2/15 px-1.5 text-xs font-semibold text-accent-2">{i.grade}</span>}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="space-y-5">
        <div className="space-y-3 rounded-2xl border border-line bg-panel p-5">
          <div className="font-semibold">Профиль</div>
          <Field label="Имя"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Button size="sm" disabled={name === user.name || name.length < 2} onClick={() => void update({ name }, 'Имя изменено')}>Сохранить имя</Button>
          {user.role === 'student' && (
            <>
              <Field label={user.groupId ? 'Сменить группу (код)' : 'Код группы'}><input className={`${inputCls} font-mono uppercase`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
              <Button size="sm" disabled={!code} onClick={() => void update({ groupCode: code }, 'Вы в группе!')}>Присоединиться</Button>
            </>
          )}
        </div>
        <div className="space-y-3 rounded-2xl border border-line bg-panel p-5">
          <div className="font-semibold">Пароль</div>
          <Field label="Текущий пароль"><input type="password" className={inputCls} value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="Новый пароль"><input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          <Button size="sm" disabled={pw.length < 6 || !oldPw} onClick={() => void update({ password: pw, oldPassword: oldPw }, 'Пароль изменён')}>Сменить пароль</Button>
        </div>
      </div>
    </div>
  );
}
