import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../ctx';
import { requireTeacher, userXp } from '../auth';
import { badRequest, notFound, parse } from '../errors';
import { getPractice } from '../grading';
import { IdParam, SUMMARY_COLS, submissionFull, submissionView, type SubmissionRow } from './common';
import { assignmentView, progressOf } from './progress';
import { nowIso, type DB } from '../db';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newJoinCode(db: DB): string {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    if (!db.prepare('SELECT 1 FROM groups WHERE join_code = ?').get(code)) return code;
  }
}

const GroupBody = z.object({ name: z.string({ required_error: 'Укажите название группы' }).trim().min(1, 'Укажите название группы').max(80, 'Название слишком длинное') });
const ReviewBody = z.object({
  grade: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.null()], { errorMap: () => ({ message: 'Оценка должна быть 2, 3, 4, 5 или null' }) }),
  comment: z.string({ invalid_type_error: 'Комментарий должен быть строкой' }).max(4000, 'Комментарий слишком длинный').default(''),
});
const AssignmentBody = z.object({
  groupId: z.number({ required_error: 'Не указана группа' }).int().positive(),
  practiceId: z.string({ required_error: 'Не указана практика' }).max(100),
  dueAt: z.string({ required_error: 'Укажите срок сдачи' }).refine((s) => !Number.isNaN(Date.parse(s)), 'Некорректная дата срока сдачи'),
});
const SubQuery = z.object({
  groupId: z.coerce.number().int().positive().optional(),
  practiceId: z.string().max(100).optional(),
  studentId: z.coerce.number().int().positive().optional(),
  unreviewed: z.enum(['0', '1', 'true', 'false']).optional(),
});

interface GroupRow { id: number; name: string; join_code: string; teacher_id: number; created_at: string }

export function teacherRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db } = ctx;

  const ownGroup = (teacherId: number, groupId: number): GroupRow => {
    const g = db.prepare('SELECT * FROM groups WHERE id = ? AND teacher_id = ?').get(groupId, teacherId) as GroupRow | undefined;
    if (!g) throw notFound('Группа не найдена');
    return g;
  };
  const groupView = (g: GroupRow) => ({
    id: g.id, name: g.name, joinCode: g.join_code,
    studentCount: (db.prepare("SELECT COUNT(*) AS n FROM users WHERE group_id = ? AND role = 'student'").get(g.id) as { n: number }).n,
  });
  /** Сдача студента из группы этого преподавателя. */
  const ownSubmission = (teacherId: number, id: number) => {
    const r = db.prepare(`SELECT s.*, st.name AS student_name FROM submissions s
      JOIN users st ON st.id = s.user_id JOIN groups g ON g.id = st.group_id
      WHERE s.id = ? AND g.teacher_id = ?`).get(id, teacherId) as (SubmissionRow & { student_name: string }) | undefined;
    if (!r) throw notFound('Сдача не найдена');
    return r;
  };

  app.get('/api/teacher/groups', async (req) => {
    const t = requireTeacher(req);
    const rows = db.prepare('SELECT * FROM groups WHERE teacher_id = ? ORDER BY id').all(t.id) as GroupRow[];
    return { groups: rows.map(groupView) };
  });

  app.post('/api/teacher/groups', async (req) => {
    const t = requireTeacher(req);
    const b = parse(GroupBody, req.body);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM groups WHERE teacher_id = ?').get(t.id) as { n: number }).n;
    if (count >= 100) throw badRequest('Слишком много групп');
    const r = db.prepare('INSERT INTO groups (name, join_code, teacher_id, created_at) VALUES (?, ?, ?, ?)').run(b.name, newJoinCode(db), t.id, nowIso());
    return { group: groupView(ownGroup(t.id, Number(r.lastInsertRowid))) };
  });

  app.delete('/api/teacher/groups/:id', async (req) => {
    const t = requireTeacher(req);
    const { id } = parse(IdParam, req.params);
    ownGroup(t.id, id);
    db.transaction(() => {
      db.prepare('UPDATE users SET group_id = NULL WHERE group_id = ?').run(id);
      db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    })();
    return { ok: true };
  });

  app.get('/api/teacher/groups/:id/progress', async (req) => {
    const t = requireTeacher(req);
    const { id } = parse(IdParam, req.params);
    const g = ownGroup(t.id, id);
    const students = db.prepare("SELECT id, name, email FROM users WHERE group_id = ? AND role = 'student' ORDER BY name COLLATE NOCASE, id")
      .all(g.id) as { id: number; name: string; email: string }[];
    const cells: Record<number, Record<string, unknown>> = {};
    for (const s of students) {
      const row: Record<string, unknown> = {};
      for (const [practiceId, c] of progressOf(db, s.id)) {
        row[practiceId] = { status: c.status, score: c.bestScore, grade: c.grade, submissionId: c.lastSubmissionId, submittedAt: c.submittedAt, attempts: c.attempts };
      }
      cells[s.id] = row;
    }
    return {
      group: groupView(g),
      students: students.map((s) => ({ ...s, xp: userXp(db, s.id) })),
      cells,
    };
  });

  app.get('/api/teacher/submissions', async (req) => {
    const t = requireTeacher(req);
    const q = parse(SubQuery, req.query);
    const where = ['g.teacher_id = ?'];
    const args: (string | number)[] = [t.id];
    if (q.groupId) { where.push('g.id = ?'); args.push(q.groupId); }
    if (q.practiceId) { where.push('s.practice_id = ?'); args.push(q.practiceId); }
    if (q.studentId) { where.push('s.user_id = ?'); args.push(q.studentId); }
    if (q.unreviewed === '1' || q.unreviewed === 'true') where.push('s.reviewed_at IS NULL');
    const rows = db.prepare(`SELECT ${SUMMARY_COLS}, st.name AS student_name, g.id AS group_id FROM submissions s
      JOIN users st ON st.id = s.user_id JOIN groups g ON g.id = st.group_id
      WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 200`).all(...args) as (SubmissionRow & { student_name: string; group_id: number })[];
    return {
      submissions: rows.map((r) => ({ ...submissionView(r), studentName: r.student_name, studentId: r.user_id, groupId: r.group_id })),
    };
  });

  app.get('/api/teacher/submissions/:id', async (req) => {
    const t = requireTeacher(req);
    const { id } = parse(IdParam, req.params);
    const r = ownSubmission(t.id, id);
    return { submission: { ...submissionFull(r), studentName: r.student_name, studentId: r.user_id } };
  });

  app.post('/api/teacher/submissions/:id/review', async (req) => {
    const t = requireTeacher(req);
    const { id } = parse(IdParam, req.params);
    ownSubmission(t.id, id);
    const b = parse(ReviewBody, req.body);
    db.prepare('UPDATE submissions SET grade = ?, comment = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?')
      .run(b.grade, b.comment, t.id, nowIso(), id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/teacher/practices/:id/solution', async (req) => {
    requireTeacher(req);
    const p = getPractice(req.params.id);
    if (!p) throw notFound('Практика не найдена');
    return { code: p.solution.code, circuit: p.solution.circuit ?? p.starterCircuit };
  });

  app.get('/api/teacher/assignments', async (req) => {
    const t = requireTeacher(req);
    const q = parse(z.object({ groupId: z.coerce.number().int().positive().optional() }), req.query);
    if (q.groupId) ownGroup(t.id, q.groupId);
    const rows = (q.groupId
      ? db.prepare('SELECT a.* FROM assignments a WHERE a.group_id = ? ORDER BY a.due_at').all(q.groupId)
      : db.prepare('SELECT a.* FROM assignments a JOIN groups g ON g.id = a.group_id WHERE g.teacher_id = ? ORDER BY a.due_at').all(t.id)
    ) as Parameters<typeof assignmentView>[0][];
    return { assignments: rows.map(assignmentView) };
  });

  app.post('/api/teacher/assignments', async (req) => {
    const t = requireTeacher(req);
    const b = parse(AssignmentBody, req.body);
    ownGroup(t.id, b.groupId);
    if (!getPractice(b.practiceId)) throw notFound('Практика не найдена');
    const due = new Date(b.dueAt).toISOString();
    const r = db.prepare('INSERT INTO assignments (group_id, practice_id, due_at, created_at) VALUES (?, ?, ?, ?)').run(b.groupId, b.practiceId, due, nowIso());
    return { assignment: { id: Number(r.lastInsertRowid), groupId: b.groupId, practiceId: b.practiceId, dueAt: due } };
  });

  app.delete('/api/teacher/assignments/:id', async (req) => {
    const t = requireTeacher(req);
    const { id } = parse(IdParam, req.params);
    const r = db.prepare('DELETE FROM assignments WHERE id = ? AND group_id IN (SELECT id FROM groups WHERE teacher_id = ?)').run(id, t.id);
    if (!r.changes) throw notFound('Задание не найдено');
    return { ok: true };
  });
}
