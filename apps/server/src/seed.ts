// Демо-данные (SEED_DEMO=1): преподаватель, студент и группа. Повторный запуск ничего не дублирует.
import { hashPassword } from './auth';
import { nowIso, type DB } from './db';

export const DEMO = {
  teacher: { email: 'teacher@demo.local', password: 'teacher123', name: 'Демо Преподаватель' },
  student: { email: 'student@demo.local', password: 'student123', name: 'Демо Студент' },
  group: { name: 'Демо-группа', code: 'DEMO25' },
};

export async function seedDemo(db: DB) {
  const ensureUser = async (u: { email: string; password: string; name: string }, role: 'teacher' | 'student') => {
    const row = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email) as { id: number } | undefined;
    if (row) return row.id;
    const hash = await hashPassword(u.password);
    return Number(db.prepare('INSERT INTO users (name, email, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(u.name, u.email, hash, role, nowIso()).lastInsertRowid);
  };
  const teacherId = await ensureUser(DEMO.teacher, 'teacher');
  const studentId = await ensureUser(DEMO.student, 'student');
  let group = db.prepare('SELECT id FROM groups WHERE join_code = ?').get(DEMO.group.code) as { id: number } | undefined;
  if (!group) {
    const id = Number(db.prepare('INSERT INTO groups (name, join_code, teacher_id, created_at) VALUES (?, ?, ?, ?)')
      .run(DEMO.group.name, DEMO.group.code, teacherId, nowIso()).lastInsertRowid);
    group = { id };
    db.prepare('UPDATE users SET group_id = ? WHERE id = ? AND group_id IS NULL').run(id, studentId);
  }
}
