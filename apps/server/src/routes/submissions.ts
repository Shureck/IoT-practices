import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CircuitDoc } from '@esp32lab/sim';
import type { Practice } from '@esp32lab/content';
import type { AppCtx } from '../ctx';
import { perUser } from '../ctx';
import { requireUser } from '../auth';
import { HttpError, badRequest, forbidden, notFound, parse } from '../errors';
import { awardAfterSubmission, getPractice, gradeQuiz, xpFor, type ResultItem } from '../grading';
import { CheckTimeout, PoolBusy } from '../pool';
import { CircuitSchema, CodeSchema, IdParam, SUMMARY_COLS, submissionFull, submissionView, type SubmissionRow } from './common';

const CheckBody = z.object({
  practiceId: z.string({ required_error: 'Не указана практика' }).max(100),
  code: CodeSchema.default(''),
  circuit: CircuitSchema.optional(),
});

const SubmitBody = CheckBody.extend({
  hintsUsed: z.number({ invalid_type_error: 'Некорректное число подсказок' }).int().min(0).max(100).default(0),
  quizAnswers: z.array(z.array(z.number().int().min(0).max(100)).max(100)).max(500).optional(),
});

export interface CheckOutput {
  compile: { ok: boolean; diagnostics: unknown[] };
  results: ResultItem[];
}

/** Прогнать автопроверки практики в пуле потоков. */
export async function runChecks(ctx: AppCtx, practice: Practice, code: string, circuit: CircuitDoc): Promise<CheckOutput> {
  try {
    return await ctx.pool.run(practice.id, code, circuit);
  } catch (e) {
    if (e instanceof CheckTimeout) {
      const secs = Math.round(ctx.cfg.checkTimeoutMs / 1000);
      return {
        compile: { ok: true, diagnostics: [] },
        results: practice.checks.map((c) => ({
          id: c.id, title: c.title, ok: false,
          message: `Проверка не уложилась в ${secs} с — возможно, программа зависла (бесконечный цикл без delay?)`,
        })),
      };
    }
    if (e instanceof PoolBusy) throw new HttpError(503, 'Сервер проверки перегружен, попробуйте через минуту');
    throw new HttpError(500, 'Ошибка при проверке решения');
  }
}

function practiceOr404(id: string): Practice {
  const p = getPractice(id);
  if (!p) throw notFound('Практика не найдена');
  return p;
}

export function submissionRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db } = ctx;

  app.post('/api/check', { config: perUser(20) }, async (req) => {
    requireUser(req);
    const b = parse(CheckBody, req.body);
    const practice = practiceOr404(b.practiceId);
    if (practice.kind === 'quiz') throw badRequest('Квиз проверяется только при сдаче');
    const circuit = (b.circuit ?? practice.starterCircuit) as CircuitDoc;
    return runChecks(ctx, practice, b.code, circuit);
  });

  app.post('/api/submissions', { config: perUser(20) }, async (req) => {
    const u = requireUser(req);
    const b = parse(SubmitBody, req.body);
    const practice = practiceOr404(b.practiceId);
    const circuit = (b.circuit ?? practice.starterCircuit) as CircuitDoc;

    let passed: boolean;
    let score: number;
    let results: ResultItem[];
    if (practice.kind === 'quiz') {
      if (!b.quizAnswers) throw badRequest('Нет ответов на вопросы квиза');
      ({ passed, score, results } = gradeQuiz(practice, b.quizAnswers));
    } else {
      const out = await runChecks(ctx, practice, b.code, circuit);
      results = out.results;
      const okCount = results.filter((r) => r.ok).length;
      score = results.length ? okCount / results.length : 0;
      passed = out.compile.ok && results.length > 0 && okCount === results.length;
    }

    const at = new Date();
    const tx = db.transaction(() => {
      const already = db.prepare("SELECT 1 FROM submissions WHERE user_id = ? AND practice_id = ? AND status = 'passed' LIMIT 1").get(u.id, practice.id);
      const xp = passed && !already ? xpFor(practice, b.hintsUsed) : 0;
      const r = db.prepare(`INSERT INTO submissions (user_id, practice_id, status, score, results, hints_used, xp, code, circuit, quiz_answers, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        u.id, practice.id, passed ? 'passed' : 'failed', score, JSON.stringify(results), b.hintsUsed, xp,
        b.code, JSON.stringify(circuit), b.quizAnswers ? JSON.stringify(b.quizAnswers) : null, at.toISOString(),
      );
      const newAchievements = awardAfterSubmission(db, u.id, practice, passed, b.hintsUsed, at);
      const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(r.lastInsertRowid) as SubmissionRow;
      return { submission: submissionView(row), xpGained: xp, newAchievements };
    });
    return tx();
  });

  app.get('/api/submissions', async (req) => {
    const u = requireUser(req);
    const q = parse(z.object({ practiceId: z.string().max(100).optional() }), req.query);
    const rows = (q.practiceId
      ? db.prepare(`SELECT ${SUMMARY_COLS} FROM submissions s WHERE s.user_id = ? AND s.practice_id = ? ORDER BY s.id DESC LIMIT 200`).all(u.id, q.practiceId)
      : db.prepare(`SELECT ${SUMMARY_COLS} FROM submissions s WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 200`).all(u.id)) as SubmissionRow[];
    return { submissions: rows.map(submissionView) };
  });

  app.get('/api/submissions/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(IdParam, req.params);
    const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) as SubmissionRow | undefined;
    if (!row) throw notFound('Сдача не найдена');
    if (row.user_id !== u.id) {
      const ok = u.role === 'teacher' && db.prepare(
        'SELECT 1 FROM users st JOIN groups g ON g.id = st.group_id WHERE st.id = ? AND g.teacher_id = ?',
      ).get(row.user_id, u.id);
      if (!ok) throw forbidden('Нет доступа к этой сдаче');
    }
    return { submission: submissionFull(row) };
  });
}

