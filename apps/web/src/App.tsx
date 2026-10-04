import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Moon, Sun, LogOut, GraduationCap, User as UserIcon, X } from 'lucide-react';
import { useApp } from './store/app';
import { IconButton, Spinner } from './components/ui';
import { Logo } from './components/Logo';

const Landing = lazy(() => import('./pages/Landing'));
const Auth = lazy(() => import('./pages/Auth'));
const Course = lazy(() => import('./pages/Course'));
const PracticePage = lazy(() => import('./pages/PracticePage'));
const Sandbox = lazy(() => import('./pages/Sandbox'));
const Teacher = lazy(() => import('./pages/Teacher'));
const Review = lazy(() => import('./pages/Review'));
const Reference = lazy(() => import('./pages/Reference'));
const Profile = lazy(() => import('./pages/Profile'));

function Header() {
  const user = useApp((s) => s.user);
  const theme = useApp((s) => s.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const logout = useApp((s) => s.logout);
  const progress = useApp((s) => s.progress);
  const nav = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition ${isActive ? 'bg-panel-2 text-text' : 'text-muted hover:text-text'}`;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel/95 px-3 backdrop-blur">
      <Link to={user ? '/course' : '/'} className="focus-ring mr-2 flex items-center gap-2 rounded-lg">
        <Logo size={26} />
        <span className="text-[15px] font-bold tracking-tight max-sm:hidden">ESP32 <span className="text-accent">Lab</span></span>
      </Link>
      <nav className="flex items-center gap-0.5 overflow-x-auto">
        <NavLink to="/course" className={link}>Курс</NavLink>
        <NavLink to="/sandbox" className={link}>Песочница</NavLink>
        <NavLink to="/reference" className={link}>Справочник</NavLink>
        {user?.role === 'teacher' && <NavLink to="/teacher" className={link}>Преподавателю</NavLink>}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        {user && progress && user.role === 'student' && (
          <Link to="/profile" className="hidden items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs sm:flex" title="Опыт">
            <span className="font-semibold text-accent">{progress.xp}</span><span className="text-faint">XP</span>
          </Link>
        )}
        <IconButton title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</IconButton>
        {user ? (
          <>
            <Link to="/profile" className="focus-ring flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-panel-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-xs font-bold text-white">{user.name.slice(0, 1).toUpperCase()}</span>
              <span className="max-w-32 truncate text-[13px] max-md:hidden">{user.name}</span>
              {user.role === 'teacher' && <GraduationCap size={14} className="text-accent-2" />}
            </Link>
            <IconButton title="Выйти" onClick={async () => { await logout(); nav('/'); }}><LogOut size={16} /></IconButton>
          </>
        ) : (
          <Link to="/login" className="focus-ring flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink"><UserIcon size={14} />Войти</Link>
        )}
      </div>
    </header>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={`anim-rise pointer-events-auto rounded-xl border p-3 shadow-xl backdrop-blur ${
          t.kind === 'err' ? 'border-err/40 bg-panel' : t.kind === 'achievement' ? 'border-warn/50 bg-gradient-to-br from-warn/15 to-panel' : t.kind === 'ok' ? 'border-ok/40 bg-panel' : 'border-line bg-panel'}`}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {t.kind === 'achievement' && <div className="text-[10.5px] font-semibold uppercase tracking-wider text-warn">Новое достижение</div>}
              <div className={`text-sm font-semibold ${t.kind === 'err' ? 'text-err' : ''}`}>{t.title}</div>
              {t.text && <div className="mt-0.5 text-[12.5px] text-muted">{t.text}</div>}
            </div>
            <button className="text-faint hover:text-text" onClick={() => dismiss(t.id)} aria-label="Закрыть"><X size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Loading() {
  return <div className="flex h-full items-center justify-center"><Spinner size={26} /></div>;
}

function RequireAuth({ children, teacher }: { children: ReactNode; teacher?: boolean }) {
  const user = useApp((s) => s.user);
  const loaded = useApp((s) => s.userLoaded);
  const loc = useLocation();
  if (!loaded) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (teacher && user.role !== 'teacher') return <Navigate to="/course" replace />;
  return <>{children}</>;
}

function Shell() {
  const loc = useLocation();
  const full = /^\/(p|sandbox|review|shared)\b/.test(loc.pathname);
  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className={`min-h-0 flex-1 ${full ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Auth mode="login" />} />
            <Route path="/register" element={<Auth mode="register" />} />
            <Route path="/course" element={<Course />} />
            <Route path="/p/:id" element={<PracticePage />} />
            <Route path="/sandbox" element={<Sandbox />} />
            <Route path="/sandbox/:projectId" element={<Sandbox />} />
            <Route path="/shared/:token" element={<Sandbox />} />
            <Route path="/reference" element={<Reference />} />
            <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
            <Route path="/teacher" element={<RequireAuth teacher><Teacher /></RequireAuth>} />
            <Route path="/review/:id" element={<RequireAuth teacher><Review /></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <Toasts />
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="font-mono text-6xl font-bold text-accent">404</div>
      <div className="text-muted">Такой страницы на станции нет.</div>
      <Link to="/" className="text-accent hover:underline">На главную</Link>
    </div>
  );
}

export default function App() {
  const loadUser = useApp((s) => s.loadUser);
  const loadCatalog = useApp((s) => s.loadCatalog);
  const loadProgress = useApp((s) => s.loadProgress);
  useEffect(() => {
    void loadUser().then(() => loadProgress());
    void loadCatalog();
  }, [loadUser, loadCatalog, loadProgress]);
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
