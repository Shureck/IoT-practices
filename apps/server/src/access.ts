// Доступ к практикам: преподаватель открывает практики своей группе по одной или модулями.
// Студенту без группы и преподавателю открыто всё.
import { MODULES, PRACTICES } from '@esp32lab/content';
import type { DB } from './db';
import { forbidden } from './errors';

/** Практики в порядке курса. */
export const COURSE_ORDER: string[] = [...PRACTICES]
  .sort((a, b) => MODULES.findIndex((m) => m.id === a.module) - MODULES.findIndex((m) => m.id === b.module) || a.order - b.order)
  .map((p) => p.id);

/** Что открыто новой группе: первые четыре практики курса. */
export const DEFAULT_OPEN = COURSE_ORDER.slice(0, 4);

export function openForGroup(db: DB, groupId: number): string[] {
  const rows = db.prepare('SELECT practice_id FROM group_practices WHERE group_id = ?').all(groupId) as { practice_id: string }[];
  const set = new Set(rows.map((r) => r.practice_id));
  return COURSE_ORDER.filter((id) => set.has(id));
}

export function setOpenForGroup(db: DB, groupId: number, ids: string[]) {
  const valid = ids.filter((id) => COURSE_ORDER.includes(id));
  db.transaction(() => {
    db.prepare('DELETE FROM group_practices WHERE group_id = ?').run(groupId);
    const ins = db.prepare('INSERT INTO group_practices (group_id, practice_id) VALUES (?, ?)');
    for (const id of new Set(valid)) ins.run(groupId, id);
  })();
}

/** Открытые практики пользователя; null — открыто всё. */
export function openForUser(db: DB, user: { role: string; group_id: number | null }): string[] | null {
  if (user.role === 'teacher' || !user.group_id) return null;
  return openForGroup(db, user.group_id);
}

export function assertOpen(db: DB, user: { role: string; group_id: number | null }, practiceId: string) {
  const open = openForUser(db, user);
  if (open && !open.includes(practiceId)) throw forbidden('Эта практика пока закрыта — её откроет преподаватель');
}
