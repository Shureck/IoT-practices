// Поток автопроверки: прогоняет скетч через Harness из @esp32lab/sim.
import { parentPort } from 'node:worker_threads';
import { Harness, type CircuitDoc } from '@esp32lab/sim';
import { PRACTICE_BY_ID, checkOptions } from '@esp32lab/content';
import { compileChecks, routesOf, type CheckDef, type HttpRouteDef } from '@esp32lab/content/spec';

export interface CheckTask {
  id: number;
  practiceId: string;
  code: string;
  circuit: CircuitDoc;
  /** общий бюджет реального времени на все проверки практики, мс */
  budgetMs?: number;
  /** свои и правленые задачи: проверки из файла, HTTP-маршруты и схемы-образцы (см. practices.ts) */
  checksSpec?: Record<string, unknown>[];
  httpRoutes?: Record<string, unknown>[];
  baseline?: (CircuitDoc | null)[];
}

export interface CheckOutcome {
  compile: { ok: boolean; diagnostics: unknown[] };
  results: { id: string; title: string; ok: boolean; message?: string }[];
}

export type WorkerReply = { id: number; ok: true; outcome: CheckOutcome } | { id: number; ok: false; error: string };

parentPort?.on('message', async (task: CheckTask) => {
  try {
    let checks;
    let options;
    if (task.checksSpec) {
      checks = compileChecks(task.checksSpec as unknown as CheckDef[]);
      options = {
        ...(task.httpRoutes?.length ? { net: { routes: routesOf(task.httpRoutes as unknown as HttpRouteDef[]) } } : {}),
        ...(task.baseline ? { baseline: task.baseline } : {}),
      };
    } else {
      const practice = PRACTICE_BY_ID[task.practiceId];
      if (!practice) throw new Error(`Практика ${task.practiceId} не найдена`);
      checks = practice.checks;
      options = { ...checkOptions(practice), ...(task.baseline ? { baseline: task.baseline } : {}) };
    }
    const r = await Harness.run(task.code, task.circuit, checks, { ...options, budgetMs: task.budgetMs });
    const outcome: CheckOutcome = {
      compile: { ok: r.compile.ok, diagnostics: r.compile.diagnostics ?? [] },
      results: r.results.map((x) => ({ id: x.id, title: x.title, ok: x.ok, ...(x.message ? { message: x.message } : {}) })),
    };
    parentPort!.postMessage({ id: task.id, ok: true, outcome } satisfies WorkerReply);
  } catch (e) {
    parentPort!.postMessage({ id: task.id, ok: false, error: String((e as Error)?.message ?? e) } satisfies WorkerReply);
  }
});

