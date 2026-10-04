import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { virtualHttp } from '@esp32lab/sim';
import type { AppCtx } from '../ctx';
import { perUser } from '../ctx';
import { requireUser } from '../auth';
import { parse } from '../errors';
import { nowIso } from '../db';

const NetBody = z.object({
  method: z.string({ required_error: 'Не указан метод' }).toUpperCase()
    .refine((m) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(m), 'Неподдерживаемый HTTP-метод'),
  url: z.string({ required_error: 'Не указан адрес' }).min(1, 'Не указан адрес').max(2048, 'Слишком длинный адрес'),
  headers: z.record(z.string().max(4096)).default({}).refine((h) => Object.keys(h).length <= 50, 'Слишком много заголовков'),
  body: z.string().max(64 * 1024, 'Тело запроса больше 64 КБ').optional(),
});

const Room = z.string().min(1, 'Не указана комната').max(64, 'Слишком длинное имя комнаты');

export function netRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db, chat } = ctx;
  let telemetryCount = 0;
  const telemetry = (room: string, data: unknown) => {
    db.prepare('INSERT INTO telemetry (room, data, time) VALUES (?, ?, ?)').run(String(room).slice(0, 64), JSON.stringify(data).slice(0, 16_384), nowIso());
    if (++telemetryCount % 100 === 0) {
      db.prepare('DELETE FROM telemetry WHERE id <= (SELECT id FROM telemetry ORDER BY id DESC LIMIT 1 OFFSET 5000)').run();
    }
  };

  app.post('/api/net/http', { config: perUser(60) }, async (req) => {
    requireUser(req);
    const b = parse(NetBody, req.body);
    const virt = virtualHttp({ method: b.method, url: b.url, headers: b.headers, body: b.body }, { chat, now: () => new Date(), telemetry });
    if (virt) return virt;
    return ctx.fetchExternal({ method: b.method, url: b.url, headers: b.headers, body: b.body });
  });

  app.get<{ Params: { room: string } }>('/api/chat/:room', async (req) => {
    const room = parse(Room, req.params.room);
    const q = parse(z.object({ after: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    return { messages: chat.list(room, q.after, q.limit) };
  });

  app.post<{ Params: { room: string } }>('/api/chat/:room', { config: perUser(30) }, async (req) => {
    const u = requireUser(req);
    const room = parse(Room, req.params.room);
    const b = parse(z.object({ content: z.string({ required_error: 'Пустое сообщение' }).trim().min(1, 'Пустое сообщение').max(1000, 'Сообщение слишком длинное') }), req.body);
    const m = chat.send(room, u.name, b.content);
    return { ...m, message: m };
  });
}
