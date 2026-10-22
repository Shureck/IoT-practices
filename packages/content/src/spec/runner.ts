// Компиляция описания проверок (шаги и условия из файла) в обычные CheckSpec.
import type { CheckSpec, HttpRequest, HttpResponse } from '@esp32lab/sim';
import { runSteps, type RT } from './dsl';
import type { HttpRouteDef } from './task';

/** Описание одной проверки в файле. */
export interface CheckDefLike { id: string; title: string; timeoutMs?: number; steps: Record<string, unknown>[] }

export function compileChecks(defs: CheckDefLike[]): CheckSpec[] {
  return defs.map((d) => ({
    id: d.id,
    title: d.title,
    ...(d.timeoutMs ? { timeoutMs: d.timeoutMs } : {}),
    run: async (h) => {
      const rt: RT = { h, marks: new Map() };
      await runSteps(rt, d.steps);
    },
  }));
}

/** Описание HTTP-маршрутов из файла → обработчики для MockNet. */
export function routesOf(defs: HttpRouteDef[]): ((req: HttpRequest) => HttpResponse | null)[] {
  return defs.map((d) => (req) => {
    if (d.method && req.method.toUpperCase() !== d.method.toUpperCase()) return null;
    if (d.urlContains !== undefined && !req.url.toLowerCase().includes(d.urlContains.toLowerCase())) return null;
    if (d.urlMatches !== undefined && !new RegExp(d.urlMatches, 'i').test(req.url)) return null;
    const isJson = typeof d.body !== 'string';
    return { status: d.status ?? 200, headers: { 'content-type': d.contentType ?? (isJson ? 'application/json' : 'text/plain') }, body: isJson ? JSON.stringify(d.body) : (d.body as string) };
  });
}
