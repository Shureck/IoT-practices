// Поток автопроверки: прогоняет скетч через Harness из @esp32lab/sim.
import { parentPort } from 'node:worker_threads';
import { Harness, type CircuitDoc } from '@esp32lab/sim';
import { PRACTICE_BY_ID } from '@esp32lab/content';

export interface CheckTask {
  id: number;
  practiceId: string;
  code: string;
  circuit: CircuitDoc;
}

export interface CheckOutcome {
  compile: { ok: boolean; diagnostics: unknown[] };
  results: { id: string; title: string; ok: boolean; message?: string }[];
}

export type WorkerReply = { id: number; ok: true; outcome: CheckOutcome } | { id: number; ok: false; error: string };

parentPort?.on('message', async (task: CheckTask) => {
  try {
    const practice = PRACTICE_BY_ID[task.practiceId];
    if (!practice) throw new Error(`Практика ${task.practiceId} не найдена`);
    const r = await Harness.run(task.code, task.circuit, practice.checks, { net: practice.net });
    const outcome: CheckOutcome = {
      compile: { ok: r.compile.ok, diagnostics: r.compile.diagnostics ?? [] },
      results: r.results.map((x) => ({ id: x.id, title: x.title, ok: x.ok, ...(x.message ? { message: x.message } : {}) })),
    };
    parentPort!.postMessage({ id: task.id, ok: true, outcome } satisfies WorkerReply);
  } catch (e) {
    parentPort!.postMessage({ id: task.id, ok: false, error: String((e as Error)?.message ?? e) } satisfies WorkerReply);
  }
});

