import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../ctx';
import { perUser } from '../ctx';
import { requireUser, userXp } from '../auth';
import { badRequest, notFound, parse } from '../errors';
import { CLIENT_ACHIEVEMENTS, getPractice, grant, userAchievements } from '../grading';
import { CircuitSchema, CodeSchema } from './common';
import { nowIso, type DB } from '../db';

const MAX_DRAFT = 256 * 1024;

const DraftBody = z.object({ code: CodeSchema, circuit: CircuitSchema });

export interface ProgressCell {
  status: 'draft' | 'failed' | 'passed';
  bestScore: number;
  attempts: number;
  xp: number;
  grade: number | null;
  comment: string | null;
  lastSubmissionId: number | null;
  submittedAt: string | null;
}

/** Сводка по практикам пользователя: { practiceId → ячейка }. */
export function progressOf(db: DB, userId: number): Map<string, ProgressCell> {
  const out = new Map<string, ProgressCell>();
  const subs = db.prepare(
    'SELECT id, practice_id, status, score, xp, grade, comment, created_at, reviewed_at FROM submissions WHERE user_id = ? ORDER BY id',
  ).all(userId) as { id: number; practice_id: string; status: string; score: number; xp: number; grade: number | null; comment: string | null; created_at: string; reviewed_at: string | null }[];
  for (const s of subs) {
    const c = out.get(s.practice_id) ?? {
      status: 'failed', bestScore: 0, attempts: 0, xp: 0, grade: null, comment: null, lastSubmissionId: null, submittedAt: null,
    } as ProgressCell;
    c.attempts++;
    c.bestScore = Math.max(c.bestScore, s.score);
    c.xp += s.xp;
    if (s.status === 'passed') c.status = 'passed';
    if (s.reviewed_at) { c.grade = s.grade; c.comment = s.comment; }
    c.lastSubmissionId = s.id;
    c.submittedAt = s.created_at;
    out.set(s.practice_id, c);
  }
  const drafts = db.prepare('SELECT practice_id FROM drafts WHERE user_id = ?').all(userId) as { practice_id: string }[];
  for (const d of drafts) {
    if (!out.has(d.practice_id)) {
      out.set(d.practice_id, { status: 'draft', bestScore: 0, attempts: 0, xp: 0, grade: null, comment: null, lastSubmissionId: null, submittedAt: null });
    }
  }
  return out;
}

export function assignmentView(r: { id: number; group_id: number; practice_id: string; due_at: string }) {
  return { id: r.id, groupId: r.group_id, practiceId: r.practice_id, dueAt: r.due_at };
}

export function progressRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db } = ctx;

  app.get<{ Params: { practiceId: string } }>('/api/drafts/:practiceId', async (req) => {
    const u = requireUser(req);
    const r = db.prepare('SELECT code, circuit, updated_at FROM drafts WHERE user_id = ? AND practice_id = ?')
      .get(u.id, req.params.practiceId) as { code: string; circuit: string; updated_at: string } | undefined;
    if (!r) throw notFound('Черновик не найден');
    return { code: r.code, circuit: JSON.parse(r.circuit), updatedAt: r.updated_at };
  });

  app.put<{ Params: { practiceId: string } }>('/api/drafts/:practiceId', { config: perUser(120) }, async (req) => {
    const u = requireUser(req);
    if (!getPractice(req.params.practiceId)) throw notFound('Практика не найдена');
    const b = parse(DraftBody, req.body);
    const circuit = JSON.stringify(b.circuit);
    if (Buffer.byteLength(b.code, 'utf8') + Buffer.byteLength(circuit, 'utf8') > MAX_DRAFT) throw badRequest('Черновик слишком большой (больше 256 КБ)');
    db.prepare(`INSERT INTO drafts (user_id, practice_id, code, circuit, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, practice_id) DO UPDATE SET code = excluded.code, circuit = excluded.circuit, updated_at = excluded.updated_at`)
      .run(u.id, req.params.practiceId, b.code, circuit, nowIso());
    return { ok: true };
  });

  app.get('/api/progress', async (req) => {
    const u = requireUser(req);
    const items = [...progressOf(db, u.id)].map(([practiceId, c]) => ({ practiceId, ...c }));
    const assignments = u.group_id
      ? (db.prepare('SELECT id, group_id, practice_id, due_at FROM assignments WHERE group_id = ? ORDER BY due_at').all(u.group_id) as Parameters<typeof assignmentView>[0][]).map(assignmentView)
      : [];
    return { xp: userXp(db, u.id), achievements: userAchievements(db, u.id), items, assignments };
  });

  app.post<{ Params: { id: string } }>('/api/achievements/:id', { config: perUser(30) }, async (req) => {
    const u = requireUser(req);
    if (!CLIENT_ACHIEVEMENTS.includes(req.params.id)) throw badRequest('Это достижение нельзя получить так');
    const isNew = grant(db, u.id, req.params.id);
    return { ok: true, new: isNew };
  });
}
