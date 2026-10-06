import { z } from 'zod';

export const MAX_CODE = 200_000;

export const CodeSchema = z.string({ required_error: 'Нет кода', invalid_type_error: 'Код должен быть строкой' })
  .max(MAX_CODE, 'Код слишком длинный (больше 200 000 символов)');

/** Схема CircuitDoc: проверяем только общую форму, детали — дело симулятора. */
export const CircuitSchema = z.object({
  parts: z.array(z.object({ id: z.string(), type: z.string() }).passthrough()).max(200, 'Слишком много компонентов на схеме'),
  wires: z.array(z.object({}).passthrough()).max(1000, 'Слишком много проводов на схеме'),
}, { invalid_type_error: 'Некорректная схема', required_error: 'Нет схемы' }).passthrough();

export const IdParam = z.object({ id: z.coerce.number().int().positive('Некорректный id') });

export interface SubmissionRow {
  id: number;
  user_id: number;
  practice_id: string;
  status: 'passed' | 'failed';
  score: number;
  results: string;
  hints_used: number;
  xp: number;
  code: string;
  circuit: string;
  quiz_answers: string | null;
  grade: number | null;
  comment: string | null;
  /** комментарий студента при сдаче */
  student_comment: string | null;
  /** ИИ-разбор ошибок (если запрашивался) */
  ai_feedback?: string | null;
  reviewer_id: number | null;
  created_at: string;
  reviewed_at: string | null;
}

export function submissionView(r: SubmissionRow) {
  return {
    id: r.id,
    practiceId: r.practice_id,
    status: r.status,
    score: r.score,
    results: JSON.parse(r.results),
    hintsUsed: r.hints_used,
    xp: r.xp,
    grade: r.grade,
    comment: r.comment,
    studentComment: r.student_comment ?? null,
    aiFeedback: r.ai_feedback ?? null,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
  };
}

export function submissionFull(r: SubmissionRow) {
  return {
    ...submissionView(r),
    code: r.code,
    circuit: JSON.parse(r.circuit),
    quizAnswers: r.quiz_answers ? JSON.parse(r.quiz_answers) : null,
  };
}

/** Столбцы без кода и схемы — для списков. */
export const SUMMARY_COLS = 's.id, s.user_id, s.practice_id, s.status, s.score, s.results, s.hints_used, s.xp, s.grade, s.comment, s.student_comment, s.ai_feedback, s.reviewer_id, s.created_at, s.reviewed_at';
