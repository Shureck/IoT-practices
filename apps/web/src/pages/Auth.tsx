import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GraduationCap, User } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../store/app';
import { Button, Field, inputCls } from '../components/ui';
import { Logo } from '../components/Logo';

export default function Auth({ mode }: { mode: 'login' | 'register' }) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const setUser = useApp((s) => s.setUser);
  const [role, setRole] = useState<'student' | 'teacher'>(params.get('teacher') ? 'teacher' : 'student');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [groupCode, setGroupCode] = useState(params.get('group') ?? '');
  const [teacherCode, setTeacherCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const next = params.get('next') ?? '/course';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = mode === 'login'
        ? await api.login(email, password)
        : await api.register({ name, email, password, role, groupCode: groupCode || undefined, teacherCode: role === 'teacher' ? teacherCode : undefined });
      setUser(user);
      nav(user.role === 'teacher' && next === '/course' ? '/teacher' : next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="anim-rise w-full max-w-md rounded-2xl border border-line bg-panel p-7 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <Logo size={36} />
          <div>
            <div className="text-xl font-bold">{mode === 'login' ? 'Вход' : 'Регистрация'}</div>
            <div className="text-[13px] text-muted">{mode === 'login' ? 'Рады снова видеть на станции' : 'Добро пожаловать на «Полярную-5»'}</div>
          </div>
        </div>
        {mode === 'register' && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            {(['student', 'teacher'] as const).map((r) => (
              <button type="button" key={r} onClick={() => setRole(r)}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${role === r ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:border-line-strong'}`}>
                {r === 'student' ? <User size={16} /> : <GraduationCap size={16} />} {r === 'student' ? 'Студент' : 'Преподаватель'}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-3">
          {mode === 'register' && <Field label="Имя и фамилия"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" /></Field>}
          <Field label="Email"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></Field>
          <Field label="Пароль" hint={mode === 'register' ? 'Не короче 6 символов' : undefined}>
            <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </Field>
          {mode === 'register' && role === 'student' && (
            <Field label="Код группы (необязательно)" hint="Его даёт преподаватель. Можно ввести позже в профиле.">
              <input className={`${inputCls} font-mono uppercase`} value={groupCode} onChange={(e) => setGroupCode(e.target.value.toUpperCase())} maxLength={8} />
            </Field>
          )}
          {mode === 'register' && role === 'teacher' && (
            <Field label="Код преподавателя" hint="Выдаётся администратором сайта.">
              <input className={inputCls} value={teacherCode} onChange={(e) => setTeacherCode(e.target.value)} required />
            </Field>
          )}
        </div>
        {error && <div className="mt-3 rounded-lg border border-err/40 bg-err/10 px-3 py-2 text-[13px] text-err">{error}</div>}
        <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" loading={busy}>{mode === 'login' ? 'Войти' : 'Создать аккаунт'}</Button>
        <div className="mt-4 text-center text-[13px] text-muted">
          {mode === 'login' ? <>Нет аккаунта? <Link to={`/register${params.toString() ? `?${params}` : ''}`} className="text-accent hover:underline">Зарегистрироваться</Link></>
            : <>Уже есть аккаунт? <Link to="/login" className="text-accent hover:underline">Войти</Link></>}
        </div>
      </form>
    </div>
  );
}
