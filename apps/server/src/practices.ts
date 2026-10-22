// Реестр практик: встроенные (код пакета content) + задачи из файлов, загруженные администраторами.
// Встроенные практики не меняются: поверх них применяются только сохранённые правки, а любая
// некорректная запись в базе пропускается — сайт от этого не ломается.
import { MODULES, PRACTICES, PRACTICE_BY_ID, publicPractice, type Practice } from '@esp32lab/content';
import { specToPractice, validateTaskText } from '@esp32lab/content/spec';
import type { DB } from './db';

export type TaskSource = 'builtin' | 'custom' | 'edited';

export interface TaskRow {
  id: string;
  kind: 'custom' | 'override';
  spec: string;
  enabled: number;
  updated_at: string;
  updated_by: number | null;
}

export class PracticeStore {
  /** растёт при каждой перезагрузке — по нему сбрасывается кэш каталога */
  version = 0;
  /** записи в базе, которые не удалось загрузить: id → причина */
  loadErrors: { id: string; message: string }[] = [];
  private visible: Practice[] = [];
  private everything: Practice[] = [];
  private byId = new Map<string, Practice>();
  private hidden = new Set<string>();
  private edited = new Set<string>();
  private custom = new Set<string>();
  private publicCache = new Map<string, ReturnType<typeof publicPractice>>();

  constructor(private db: DB, private log?: (msg: string) => void) {
    this.reload();
  }

  reload() {
    const rows = this.db.prepare('SELECT * FROM tasks').all() as TaskRow[];
    const byId = new Map<string, Practice>(PRACTICES.map((p) => [p.id, p]));
    const hidden = new Set<string>();
    const edited = new Set<string>();
    const custom = new Set<string>();
    const errors: { id: string; message: string }[] = [];
    const allIds = new Set<string>([...byId.keys(), ...rows.map((r) => r.id)]);
    for (const r of rows) {
      try {
        const override = r.kind === 'override';
        const base = override ? PRACTICE_BY_ID[r.id] : undefined;
        if (override && !base) throw new Error('встроенной практики с таким id больше нет');
        if (!override && PRACTICE_BY_ID[r.id]) throw new Error('id совпадает со встроенной практикой');
        const v = validateTaskText(r.spec, { mode: 'edit', existingIds: allIds, expectId: r.id, builtin: override });
        if (!v.spec) throw new Error(v.issues.find((i) => i.level === 'error')?.message ?? 'файл не разобран');
        byId.set(r.id, specToPractice(v.spec, base));
        if (override) edited.add(r.id); else { custom.add(r.id); if (!r.enabled) hidden.add(r.id); }
      } catch (e) {
        const message = (e as Error).message;
        errors.push({ id: r.id, message });
        this.log?.(`задача «${r.id}» из базы пропущена: ${message}`);
      }
    }
    const moduleIdx = (m: number) => { const i = MODULES.findIndex((x) => x.id === m); return i < 0 ? 999 : i; };
    const all = [...byId.values()].sort((a, b) => moduleIdx(a.module) - moduleIdx(b.module) || a.order - b.order || a.id.localeCompare(b.id));
    this.byId = byId;
    this.hidden = hidden;
    this.edited = edited;
    this.custom = custom;
    this.everything = all;
    this.visible = all.filter((p) => !hidden.has(p.id));
    this.loadErrors = errors;
    this.publicCache.clear();
    this.version++;
  }

  /** Практики каталога в порядке курса (скрытые не входят). */
  list(): Practice[] { return this.visible; }

  /** Все практики, в том числе скрытые (для редактора задач). */
  listAll(): Practice[] { return this.everything; }

  /** Практика по id, в том числе скрытая (чтобы история сдач оставалась читаемой). */
  get(id: string): Practice | undefined {
    return this.byId.get(id);
  }

  isVisible(id: string): boolean { return this.byId.has(id) && !this.hidden.has(id); }
  /** Это своя задача или встроенная с правками — проверки нужно передавать потоку проверки. */
  isModified(id: string): boolean { return this.custom.has(id) || this.edited.has(id); }
  source(id: string): TaskSource { return this.custom.has(id) ? 'custom' : this.edited.has(id) ? 'edited' : 'builtin'; }
  /** id всех практик, включая скрытые. */
  allIds(): Set<string> { return new Set(this.byId.keys()); }

  /** Порядок курса: id видимых практик. */
  order(): string[] { return this.visible.map((p) => p.id); }

  publicOf(p: Practice) {
    let v = this.publicCache.get(p.id);
    if (!v) { v = publicPractice(p); this.publicCache.set(p.id, v); }
    return v;
  }
}

/** Что нужно потоку проверки, чтобы проверить свою или правленую задачу, которой нет в его встроенном списке. */
export interface WorkerExtra {
  checksSpec?: Record<string, unknown>[];
  httpRoutes?: Record<string, unknown>[];
  /** схемы-образцы: положение «ручек» датчиков перед проверкой — как в них */
  baseline: (import('@esp32lab/sim').CircuitDoc | null)[];
}

export function workerExtra(p: Practice): WorkerExtra {
  return {
    ...(p.checksSpec ? { checksSpec: p.checksSpec } : {}),
    ...(p.httpRoutes ? { httpRoutes: p.httpRoutes } : {}),
    baseline: [p.solution.circuit ?? null, p.starterCircuit],
  };
}
