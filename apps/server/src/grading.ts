// Оценивание: квизы, опыт (XP), достижения.
import { ACHIEVEMENTS, PRACTICES, PRACTICE_BY_ID, type Practice } from '@esp32lab/content';
import type { DB } from './db';
import { nowIso } from './db';

export interface ResultItem { id: string; title: string; ok: boolean; message?: string }

/** Оценка квиза: доля верных ответов; вопрос верен, если множество выбранных вариантов совпадает с правильным. */
export function gradeQuiz(practice: Practice, answers: number[][] | undefined) {
  const questions = practice.quiz ?? [];
  const results: ResultItem[] = questions.map((q, i) => {
    const given = new Set((answers?.[i] ?? []).filter((x) => Number.isInteger(x)));
    const correct = new Set(q.correct);
    const ok = given.size === correct.size && [...correct].every((x) => given.has(x));
    return { id: q.id, title: q.text, ok, message: q.explain };
  });
  const score = questions.length ? results.filter((r) => r.ok).length / questions.length : 0;
  const passed = questions.length > 0 && score >= (practice.passScore ?? 0.7) - 1e-9;
  return { score, passed, results };
}

/** XP за первую успешную сдачу: −10 % за каждую подсказку, но не меньше 50 %. */
export function xpFor(practice: Practice, hintsUsed: number): number {
  const k = Math.max(0.5, 1 - 0.1 * Math.max(0, hintsUsed));
  return Math.round(practice.xp * k);
}

/** 00:00–05:00 по Москве (UTC+3, без перехода на летнее время). */
export function isMoscowNight(d: Date): boolean {
  return (d.getUTCHours() + 3) % 24 < 5;
}

export const CLIENT_ACHIEVEMENTS = ['first-blink', 'burnt-led', 'real-board'];
const KNOWN = new Set(ACHIEVEMENTS.map((a) => a.id));

/** Выдать достижение; true — если выдано впервые. */
export function grant(db: DB, userId: number, id: string): boolean {
  if (!KNOWN.has(id)) return false;
  const r = db.prepare('INSERT OR IGNORE INTO achievements (user_id, achievement_id, created_at) VALUES (?, ?, ?)').run(userId, id, nowIso());
  return r.changes > 0;
}

export function userAchievements(db: DB, userId: number): string[] {
  return (db.prepare('SELECT achievement_id FROM achievements WHERE user_id = ? ORDER BY created_at, achievement_id').all(userId) as { achievement_id: string }[])
    .map((r) => r.achievement_id);
}

/** Достижения, которые сервер проверяет после сдачи. */
export function awardAfterSubmission(db: DB, userId: number, practice: Practice, passed: boolean, hintsUsed: number, at: Date): string[] {
  const out: string[] = [];
  const give = (id: string) => { if (grant(db, userId, id)) out.push(id); };
  if (!passed) return out;
  give('first-check');
  const done = new Set((db.prepare("SELECT DISTINCT practice_id FROM submissions WHERE user_id = ? AND status = 'passed'").all(userId) as { practice_id: string }[])
    .map((r) => r.practice_id));
  const modulePractices = PRACTICES.filter((p) => p.module === practice.module);
  if (modulePractices.length && modulePractices.every((p) => done.has(p.id))) give(`module-${practice.module}`);
  const cases = PRACTICES.filter((p) => p.kind === 'case');
  if (practice.kind === 'case') {
    if (cases.every((p) => done.has(p.id))) give('all-cases');
    if (hintsUsed === 0) give('no-hints');
  }
  if (isMoscowNight(at)) give('night-owl');
  return out;
}

/** Практика по id (безопасно к «constructor», «__proto__» и т.п.). */
export function getPractice(id: string): Practice | undefined {
  return Object.prototype.hasOwnProperty.call(PRACTICE_BY_ID, id) ? PRACTICE_BY_ID[id] : undefined;
}
