import type { FastifyInstance } from 'fastify';
import { ACHIEVEMENTS, COURSE_STORY, MODULES } from '@esp32lab/content';
import { notFound } from '../errors';

export function practiceRoutes(app: FastifyInstance) {
  const store = () => app.ctx.practices;
  let cached: string | null = null;
  let cachedVersion = -1;

  app.get('/api/practices', async (_req, reply) => {
    // каталог пересобирается, когда администратор добавил или изменил задачу
    if (cachedVersion !== store().version) {
      cached = JSON.stringify({
        modules: MODULES,
        practices: store().list().map((p) => store().publicOf(p)),
        achievements: ACHIEVEMENTS,
        story: COURSE_STORY,
      });
      cachedVersion = store().version;
    }
    reply.type('application/json; charset=utf-8').header('cache-control', 'no-cache');
    return reply.send(cached);
  });

  app.get<{ Params: { id: string } }>('/api/practices/:id', async (req) => {
    const p = store().get(req.params.id);
    if (!p || !store().isVisible(p.id)) throw notFound('Практика не найдена');
    return { practice: store().publicOf(p) };
  });
}
