// Редактор задач для администраторов: загрузка файла задачи, проверка (формат + прогон эталона),
// публикация, правка существующих (в том числе встроенных — только описание), скрытие, откат.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PRACTICE_BY_ID, type Practice } from '@esp32lab/content';
import {
  EXAMPLE_QUIZ, EXAMPLE_TASK, buildReference, practiceToSpecObject, specToPractice, stringifyTask, validateTaskText,
  type LocatedIssue, type TaskSpec,
} from '@esp32lab/content/spec';
import type { AppCtx } from '../ctx';
import { perUser } from '../ctx';
import { requireAdmin } from '../auth';
import { HttpError, badRequest, conflict, notFound, parse } from '../errors';
import { nowIso } from '../db';
import { workerExtra } from '../practices';
import { CheckTimeout, PoolBusy } from '../pool';
import type { CheckOutcome } from '../check-worker';

const Body = z.object({
  text: z.string({ required_error: 'Нет текста файла' }).min(1, 'Файл пуст').max(600_000, 'Файл слишком большой (больше 600 КБ)'),
  mode: z.enum(['create', 'edit']).default('create'),
  id: z.string().max(60).optional(),
  note: z.string().max(200).optional(),
});

interface DryRun { solution: { id: string; title: string; ok: boolean; message?: string }[]; starter: { id: string; title: string; ok: boolean; message?: string }[] }

interface Analysis {
  issues: LocatedIssue[];
  spec: TaskSpec | null;
  practice: Practice | null;
  dryRun: DryRun | null;
  /** можно публиковать: нет ошибок, эталон проходит все проверки, стартовый код — не все */
  canPublish: boolean;
}

const BUILTIN_HEADER = `Это встроенная задача курса. Здесь можно править описание: тексты, цели, подсказки, баллы, стартовый и эталонный код, схему.
Автопроверки этой задачи написаны кодом и остаются прежними (checks: builtin). Чтобы заменить их своими, опишите checks списком —
формат и все возможности в файле «Справочник». «Вернуть встроенную» в списке задач снимает все правки.`;

const FILES: Record<string, { type: string; text: () => string }> = {
  'example-task.yaml': { type: 'text/yaml; charset=utf-8', text: () => EXAMPLE_TASK },
  'example-quiz.yaml': { type: 'text/yaml; charset=utf-8', text: () => EXAMPLE_QUIZ },
  'reference.md': { type: 'text/markdown; charset=utf-8', text: (() => { let c: string | null = null; return () => (c ??= buildReference()); })() },
};

export function adminRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db, cfg } = ctx;
  const admin = (req: Parameters<typeof requireAdmin>[0]) => requireAdmin(req, cfg);

  // ---------- анализ файла ----------

  async function runBoth(practice: Practice): Promise<{ sol: CheckOutcome; start: CheckOutcome }> {
    const extra = workerExtra(practice);
    const run = (code: string, circuit: NonNullable<Practice['solution']['circuit']>) => ctx.pool.run(practice.id, code, circuit, extra);
    try {
      const [sol, start] = await Promise.all([
        run(practice.solution.code, practice.solution.circuit ?? practice.starterCircuit),
        run(practice.starterCode, practice.starterCircuit),
      ]);
      return { sol, start };
    } catch (e) {
      if (e instanceof CheckTimeout) throw new HttpError(422, 'Проверки не уложились во время при прогоне эталона: слишком тяжёлый сценарий или зависший код. Сократите время ожидания в проверках.');
      if (e instanceof PoolBusy) throw new HttpError(503, 'Сервер проверки перегружен, попробуйте через минуту');
      throw new HttpError(500, 'Не удалось прогнать проверки');
    }
  }

  async function analyze(text: string, mode: 'create' | 'edit', id: string | undefined): Promise<Analysis> {
    if (mode === 'edit') {
      if (!id || !ctx.practices.get(id)) throw notFound('Задача не найдена');
    }
    const builtinBase = mode === 'edit' && id ? PRACTICE_BY_ID[id] : undefined;
    const v = validateTaskText(text, { mode, existingIds: ctx.practices.allIds(), expectId: id, builtin: !!builtinBase });
    const issues: LocatedIssue[] = [...v.issues];
    if (!v.spec) return { issues, spec: null, practice: null, dryRun: null, canPublish: false };
    const practice = specToPractice(v.spec, builtinBase);
    if (practice.kind === 'quiz') return { issues, spec: v.spec, practice, dryRun: null, canPublish: true };

    const { sol, start } = await runBoth(practice);
    const checkIdx = (cid: string) => v.spec!.checks?.findIndex((c) => c.id === cid) ?? -1;
    const bad = sol.results.filter((r) => !r.ok);
    for (const r of bad) {
      const i = checkIdx(r.id);
      issues.push({
        path: i >= 0 ? `checks[${i}]` : 'checks', level: 'error',
        message: `Эталонное решение не проходит проверку «${r.title}»${r.message ? `: ${r.message}` : ''}`,
      });
    }
    if (!bad.length && start.results.length && start.results.every((r) => r.ok)) {
      issues.push({ path: 'starterCode', level: 'error', message: 'Стартовый код уже проходит все проверки — задача решена «из коробки». Уберите из заготовки то, что должен написать студент, или ужесточите проверки' });
    }
    const dryRun: DryRun = { solution: sol.results.map((r) => ({ ...r })), starter: start.results.map((r) => ({ ...r })) };
    return { issues, spec: v.spec, practice, dryRun, canPublish: !issues.some((i) => i.level === 'error') };
  }

  const view = (a: Analysis) => ({
    ok: a.canPublish,
    canPublish: a.canPublish,
    issues: a.issues,
    dryRun: a.dryRun,
    preview: a.spec && a.practice ? {
      id: a.spec.id, title: a.spec.title, module: a.spec.module, order: a.spec.order, kind: a.spec.kind,
      xp: a.spec.xp, goals: a.spec.goals.length, hints: a.spec.hints.length,
      checks: (a.spec.checks ?? []).map((c) => ({ id: c.id, title: c.title })),
      checksSource: a.spec.checks === null ? 'code' : 'file',
      questions: a.spec.quiz?.length ?? 0,
    } : null,
  });

  // ---------- список и файлы ----------

  app.get('/api/admin/tasks', async (req) => {
    admin(req);
    const subs = new Map((db.prepare('SELECT practice_id, COUNT(*) AS n FROM submissions GROUP BY practice_id').all() as { practice_id: string; n: number }[]).map((r) => [r.practice_id, r.n]));
    const rows = new Map((db.prepare(`SELECT t.id, t.updated_at, u.name AS author FROM tasks t LEFT JOIN users u ON u.id = t.updated_by`).all() as { id: string; updated_at: string; author: string | null }[]).map((r) => [r.id, r]));
    return {
      tasks: ctx.practices.listAll().map((p) => ({
        id: p.id, title: p.title, module: p.module, order: p.order, kind: p.kind,
        source: ctx.practices.source(p.id),
        visible: ctx.practices.isVisible(p.id),
        checks: p.checksSpec ? 'file' : p.kind === 'quiz' ? 'quiz' : 'code',
        submissions: subs.get(p.id) ?? 0,
        updatedAt: rows.get(p.id)?.updated_at ?? null,
        updatedBy: rows.get(p.id)?.author ?? null,
      })),
      loadErrors: ctx.practices.loadErrors,
      modules: undefined,
    };
  });

  app.get<{ Params: { name: string } }>('/api/admin/task-files/:name', async (req, reply) => {
    admin(req);
    const f = Object.prototype.hasOwnProperty.call(FILES, req.params.name) ? FILES[req.params.name] : undefined;
    if (!f) throw notFound('Файл не найден');
    reply.type(f.type).header('content-disposition', `attachment; filename="${req.params.name}"`).header('cache-control', 'no-store');
    return reply.send(f.text());
  });

  app.get<{ Params: { id: string } }>('/api/admin/tasks/:id/file', async (req) => {
    admin(req);
    const p = ctx.practices.get(req.params.id);
    if (!p) throw notFound('Задача не найдена');
    const row = db.prepare('SELECT spec, updated_at FROM tasks WHERE id = ?').get(p.id) as { spec: string; updated_at: string } | undefined;
    const text = row?.spec ?? stringifyTask(practiceToSpecObject(PRACTICE_BY_ID[p.id] ?? p), BUILTIN_HEADER);
    return { id: p.id, source: ctx.practices.source(p.id), visible: ctx.practices.isVisible(p.id), text, stored: !!row, updatedAt: row?.updated_at ?? null };
  });

  // ---------- проверка и публикация ----------

  app.post('/api/admin/tasks/validate', { config: perUser(20) }, async (req) => {
    admin(req);
    const b = parse(Body, req.body);
    return view(await analyze(b.text, b.mode, b.id));
  });

  function publish(userId: number, kind: 'custom' | 'override', a: Analysis, text: string, note?: string) {
    const id = a.spec!.id;
    const at = nowIso();
    db.transaction(() => {
      db.prepare(`INSERT INTO tasks (id, kind, spec, enabled, updated_at, updated_by) VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT (id) DO UPDATE SET spec = excluded.spec, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(id, kind, text, at, userId);
      db.prepare('INSERT INTO task_revisions (task_id, spec, note, created_at, author_id) VALUES (?, ?, ?, ?, ?)').run(id, text, note ?? null, at, userId);
      db.prepare('DELETE FROM task_revisions WHERE task_id = ? AND id NOT IN (SELECT id FROM task_revisions WHERE task_id = ? ORDER BY id DESC LIMIT 30)').run(id, id);
    })();
    ctx.practices.reload();
    if (ctx.practices.loadErrors.some((e) => e.id === id)) {
      // не должно случиться (мы только что проверили), но если запись не загрузилась — откатываем, чтобы не оставить битую
      throw new HttpError(500, 'Задача сохранена, но не загрузилась — обратитесь к разработчику');
    }
  }

  app.post('/api/admin/tasks', { config: perUser(20) }, async (req) => {
    const u = admin(req);
    const b = parse(Body, req.body);
    const a = await analyze(b.text, 'create', undefined);
    if (!a.canPublish) throw new HttpError(422, 'В файле есть ошибки — исправьте их и проверьте ещё раз');
    publish(u.id, 'custom', a, b.text, b.note);
    return { ok: true, id: a.spec!.id, warnings: a.issues.filter((i) => i.level === 'warning').length };
  });

  app.put<{ Params: { id: string } }>('/api/admin/tasks/:id', { config: perUser(20) }, async (req) => {
    const u = admin(req);
    const b = parse(Body, req.body);
    const id = req.params.id;
    const existing = ctx.practices.get(id);
    if (!existing) throw notFound('Задача не найдена');
    const a = await analyze(b.text, 'edit', id);
    if (!a.canPublish) throw new HttpError(422, 'В файле есть ошибки — исправьте их и проверьте ещё раз');
    publish(u.id, PRACTICE_BY_ID[id] ? 'override' : 'custom', a, b.text, b.note);
    return { ok: true, id, warnings: a.issues.filter((i) => i.level === 'warning').length };
  });

  // ---------- скрыть / удалить / вернуть встроенную ----------

  app.post<{ Params: { id: string } }>('/api/admin/tasks/:id/visibility', async (req) => {
    admin(req);
    const { visible } = parse(z.object({ visible: z.boolean() }), req.body);
    if (ctx.practices.source(req.params.id) !== 'custom') throw badRequest('Скрывать можно только свои задачи (встроенные — нельзя)');
    db.prepare('UPDATE tasks SET enabled = ? WHERE id = ?').run(visible ? 1 : 0, req.params.id);
    ctx.practices.reload();
    return { ok: true, visible: ctx.practices.isVisible(req.params.id) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/tasks/:id', async (req) => {
    admin(req);
    const id = req.params.id;
    const src = ctx.practices.source(id);
    if (src === 'builtin') throw badRequest('Встроенную задачу удалить нельзя. Если она не нужна группе — не открывайте её во вкладке «Доступ»');
    if (src === 'custom') {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE practice_id = ?').get(id) as { n: number }).n;
      if (n > 0) throw conflict(`У задачи есть сдачи студентов (${n}) — их историю нельзя потерять. Скройте задачу вместо удаления`);
      db.transaction(() => {
        for (const sql of ['DELETE FROM drafts WHERE practice_id = ?', 'DELETE FROM group_practices WHERE practice_id = ?', 'DELETE FROM assignments WHERE practice_id = ?', 'DELETE FROM task_revisions WHERE task_id = ?', 'DELETE FROM tasks WHERE id = ?']) db.prepare(sql).run(id);
      })();
    } else {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id); // вернуть встроенную; история правок остаётся
    }
    ctx.practices.reload();
    return { ok: true };
  });

  // ---------- история правок ----------

  app.get<{ Params: { id: string } }>('/api/admin/tasks/:id/revisions', async (req) => {
    admin(req);
    const rows = db.prepare(`SELECT r.id, r.note, r.created_at, u.name AS author FROM task_revisions r LEFT JOIN users u ON u.id = r.author_id
      WHERE r.task_id = ? ORDER BY r.id DESC LIMIT 30`).all(req.params.id) as { id: number; note: string | null; created_at: string; author: string | null }[];
    return { revisions: rows.map((r) => ({ id: r.id, note: r.note, createdAt: r.created_at, author: r.author })) };
  });

  app.get<{ Params: { id: string; rid: string } }>('/api/admin/tasks/:id/revisions/:rid', async (req) => {
    admin(req);
    const r = db.prepare('SELECT id, spec, created_at FROM task_revisions WHERE id = ? AND task_id = ?').get(Number(req.params.rid), req.params.id) as { id: number; spec: string; created_at: string } | undefined;
    if (!r) throw notFound('Версия не найдена');
    return { id: r.id, text: r.spec, createdAt: r.created_at };
  });
}
