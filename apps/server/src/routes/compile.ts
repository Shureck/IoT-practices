import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../ctx';
import { perUser } from '../ctx';
import { requireUser } from '../auth';
import { HttpError, badRequest, parse } from '../errors';

const UNAVAILABLE = 'Сервис компиляции недоступен';
const COMPILE_TIMEOUT = 240_000;

export const APP_VERSION = '1.0.0';

export function compileRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { cfg } = ctx;
  const running = new Set<number>();
  let health: { at: number; ok: boolean } | null = null;
  let healthPending: Promise<boolean> | null = null;

  async function compilerAvailable(): Promise<boolean> {
    if (health && Date.now() - health.at < 10_000) return health.ok;
    healthPending ??= (async () => {
      let ok = false;
      try {
        const r = await ctx.compilerFetch(`${cfg.compilerUrl}/health`, { signal: AbortSignal.timeout(2000) });
        ok = r.ok;
      } catch { ok = false; }
      health = { at: Date.now(), ok };
      healthPending = null;
      return ok;
    })();
    return healthPending;
  }

  app.get('/api/health', async () => ({ ok: true, compiler: await compilerAvailable(), ai: !!ctx.llm, version: APP_VERSION }));

  app.post('/api/compile', { config: perUser(10) }, async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({
      code: z.string({ required_error: 'Нет кода' }).min(1, 'Пустой скетч').max(200_000, 'Скетч слишком большой'),
    }), req.body);
    if (running.has(u.id)) throw new HttpError(429, 'Предыдущая сборка ещё не закончилась');
    running.add(u.id);
    try {
      let res: Response;
      try {
        res = await ctx.compilerFetch(`${cfg.compilerUrl}/compile`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: b.code }),
          signal: AbortSignal.timeout(COMPILE_TIMEOUT),
        });
      } catch {
        health = { at: Date.now(), ok: false };
        throw new HttpError(503, UNAVAILABLE);
      }
      let data: { ok?: boolean; log?: string; error?: string; ms?: number; binaries?: unknown[] };
      try { data = await res.json() as typeof data; } catch { throw new HttpError(503, UNAVAILABLE); }
      if (typeof data.ok === 'boolean') return data;
      if (res.status === 413) throw badRequest('Скетч слишком большой');
      if (res.status === 400) throw badRequest('Пустой или некорректный скетч');
      throw new HttpError(503, UNAVAILABLE);
    } finally {
      running.delete(u.id);
    }
  });
}
