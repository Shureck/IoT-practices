// Глобальное состояние: пользователь, каталог практик, прогресс, тема, уведомления.
import { create } from 'zustand';
import { api, type Catalog, type Progress, type User } from '../lib/api';

export interface Toast {
  id: number;
  kind: 'ok' | 'err' | 'info' | 'achievement';
  title: string;
  text?: string;
}

interface AppState {
  user: User | null;
  userLoaded: boolean;
  catalog: Catalog | null;
  catalogError: string | null;
  progress: Progress | null;
  theme: 'dark' | 'light';
  toasts: Toast[];
  loadUser(): Promise<void>;
  setUser(u: User | null): void;
  loadCatalog(): Promise<void>;
  loadProgress(): Promise<void>;
  logout(): Promise<void>;
  toggleTheme(): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
  /** практика закрыта преподавателем для этого студента */
  isLocked(practiceId: string): boolean;
}

let toastId = 1;

export const useApp = create<AppState>((set, get) => ({
  user: null,
  userLoaded: false,
  catalog: null,
  catalogError: null,
  progress: null,
  theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  toasts: [],
  isLocked(practiceId) {
    const { user, progress } = get();
    return !!(user?.role === 'student' && progress?.open && !progress.open.includes(practiceId));
  },
  async loadUser() {
    try {
      const { user } = await api.me();
      set({ user, userLoaded: true });
    } catch {
      set({ user: null, userLoaded: true });
    }
  },
  setUser(u) { set({ user: u, userLoaded: true }); if (u) void get().loadProgress(); else set({ progress: null }); },
  async loadCatalog() {
    if (get().catalog) return;
    try {
      set({ catalog: await api.catalog(), catalogError: null });
    } catch (e) {
      set({ catalogError: (e as Error).message });
    }
  },
  async loadProgress() {
    if (!get().user) return;
    try { set({ progress: await api.progress() }); } catch { /* офлайн */ }
  },
  async logout() {
    try { await api.logout(); } catch { /* всё равно выходим */ }
    set({ user: null, progress: null });
  },
  toggleTheme() {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    if (theme === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('theme', theme); } catch { /* приватный режим */ }
    set({ theme });
  },
  toast(t) {
    const id = toastId++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.kind === 'err' ? 7000 : 4500);
  },
  dismiss(id) { set({ toasts: get().toasts.filter((x) => x.id !== id) }); },
}));

/** Безопасная работа с localStorage. */
export const storage = {
  get<T>(key: string, def: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : def;
    } catch { return def; }
  },
  set(key: string, v: unknown) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* переполнение/приватный режим */ }
  },
  del(key: string) {
    try { localStorage.removeItem(key); } catch { /* ничего */ }
  },
};
