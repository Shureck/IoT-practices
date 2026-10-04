import type { FastifyInstance } from 'fastify';
import { ACHIEVEMENTS, COURSE_STORY, MODULES, PRACTICES, publicPractice } from '@esp32lab/content';
import { getPractice } from '../grading';
import { notFound } from '../errors';

export function practiceRoutes(app: FastifyInstance) {
  let cached: string | null = null;
  const publicById = new Map(PRACTICES.map((p) => [p.id, publicPractice(p)]));

  app.get('/api/practices', async (_req, reply) => {
    cached ??= JSON.stringify({
      modules: MODULES,
      practices: PRACTICES.map((p) => publicById.get(p.id)),
      achievements: ACHIEVEMENTS,
      story: COURSE_STORY,
    });
    reply.type('application/json; charset=utf-8').header('cache-control', 'no-cache');
    return reply.send(cached);
  });

  app.get<{ Params: { id: string } }>('/api/practices/:id', async (req) => {
    const p = getPractice(req.params.id);
    if (!p) throw notFound('Практика не найдена');
    return { practice: publicById.get(p.id) };
  });
}
