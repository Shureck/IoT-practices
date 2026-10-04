import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../ctx';
import { perUser } from '../ctx';
import { requireUser } from '../auth';
import { badRequest, notFound, parse } from '../errors';
import { CircuitSchema, CodeSchema, IdParam } from './common';
import { nowIso } from '../db';

const MAX_PROJECTS = 200;
const MAX_SIZE = 256 * 1024;

const Title = z.string({ required_error: 'Укажите название' }).trim().min(1, 'Укажите название').max(100, 'Название слишком длинное');
const CreateBody = z.object({ title: Title, code: CodeSchema, circuit: CircuitSchema });
const UpdateBody = z.object({ title: Title.optional(), code: CodeSchema.optional(), circuit: CircuitSchema.optional() });

interface ProjectRow { id: number; user_id: number; title: string; code: string; circuit: string; share_token: string | null; updated_at: string }

const view = (r: ProjectRow) => ({ id: r.id, title: r.title, code: r.code, circuit: JSON.parse(r.circuit), shareToken: r.share_token, updatedAt: r.updated_at });

function checkSize(code: string, circuit: string) {
  if (Buffer.byteLength(code, 'utf8') + Buffer.byteLength(circuit, 'utf8') > MAX_SIZE) throw badRequest('Проект слишком большой (больше 256 КБ)');
}

export function projectRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db } = ctx;

  const own = (userId: number, id: number) => {
    const r = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as ProjectRow | undefined;
    if (!r) throw notFound('Проект не найден');
    return r;
  };

  app.get('/api/projects', async (req) => {
    const u = requireUser(req);
    const rows = db.prepare('SELECT id, title, updated_at, share_token FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(u.id) as ProjectRow[];
    return { projects: rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at, shareToken: r.share_token })) };
  });

  app.post('/api/projects', { config: perUser(60) }, async (req) => {
    const u = requireUser(req);
    const b = parse(CreateBody, req.body);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').get(u.id) as { n: number }).n;
    if (count >= MAX_PROJECTS) throw badRequest(`Слишком много проектов (максимум ${MAX_PROJECTS}) — удалите ненужные`);
    const circuit = JSON.stringify(b.circuit);
    checkSize(b.code, circuit);
    const t = nowIso();
    const r = db.prepare('INSERT INTO projects (user_id, title, code, circuit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(u.id, b.title, b.code, circuit, t, t);
    return { project: view(own(u.id, Number(r.lastInsertRowid))) };
  });

  app.get('/api/projects/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(IdParam, req.params);
    return { project: view(own(u.id, id)) };
  });

  app.put('/api/projects/:id', { config: perUser(120) }, async (req) => {
    const u = requireUser(req);
    const { id } = parse(IdParam, req.params);
    const cur = own(u.id, id);
    const b = parse(UpdateBody, req.body);
    const title = b.title ?? cur.title;
    const code = b.code ?? cur.code;
    const circuit = b.circuit ? JSON.stringify(b.circuit) : cur.circuit;
    checkSize(code, circuit);
    db.prepare('UPDATE projects SET title = ?, code = ?, circuit = ?, updated_at = ? WHERE id = ?').run(title, code, circuit, nowIso(), id);
    return { project: view(own(u.id, id)) };
  });

  app.delete('/api/projects/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(IdParam, req.params);
    own(u.id, id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return { ok: true };
  });

  app.post('/api/projects/:id/share', async (req) => {
    const u = requireUser(req);
    const { id } = parse(IdParam, req.params);
    const cur = own(u.id, id);
    if (cur.share_token) return { shareToken: cur.share_token };
    const token = crypto.randomBytes(12).toString('base64url');
    db.prepare('UPDATE projects SET share_token = ? WHERE id = ?').run(token, id);
    return { shareToken: token };
  });

  app.get<{ Params: { token: string } }>('/api/shared/:token', async (req) => {
    const token = req.params.token;
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) throw notFound('Проект не найден');
    const r = db.prepare('SELECT p.title, p.code, p.circuit, u.name AS author FROM projects p JOIN users u ON u.id = p.user_id WHERE p.share_token = ?')
      .get(token) as { title: string; code: string; circuit: string; author: string } | undefined;
    if (!r) throw notFound('Проект не найден');
    return { project: { title: r.title, code: r.code, circuit: JSON.parse(r.circuit), author: r.author } };
  });
}
