import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../ctx';
import { perIp } from '../ctx';
import { checkPassword, clearCookie, hashPassword, issueCookie, requireUser, userView, type UserRow } from '../auth';
import { badRequest, conflict, parse, unauthorized } from '../errors';
import { nowIso } from '../db';

const name = z.string({ required_error: 'Укажите имя' }).trim().min(1, 'Укажите имя').max(80, 'Имя слишком длинное');
const email = z.string({ required_error: 'Укажите email' }).trim().toLowerCase().email('Некорректный email').max(200, 'Email слишком длинный');
const password = z.string({ required_error: 'Укажите пароль' }).min(6, 'Пароль должен быть не короче 6 символов').max(200, 'Пароль слишком длинный');
const groupCode = z.string().trim().max(20, 'Неверный код группы').nullish();

const RegisterBody = z.object({
  name,
  email,
  password,
  role: z.enum(['student', 'teacher'], { errorMap: () => ({ message: 'Роль должна быть student или teacher' }) }).default('student'),
  groupCode,
  teacherCode: z.string().max(200).nullish(),
});

const LoginBody = z.object({
  email: z.string({ required_error: 'Укажите email' }).trim().toLowerCase().max(200),
  password: z.string({ required_error: 'Укажите пароль' }).max(200),
});

const PatchMe = z.object({
  name: name.optional(),
  password: password.optional(),
  oldPassword: z.string().max(200).optional(),
  groupCode,
});

export function findGroupByCode(ctx: AppCtx, code: string): { id: number; name: string } | undefined {
  return ctx.db.prepare('SELECT id, name FROM groups WHERE join_code = ?').get(code.trim().toUpperCase()) as { id: number; name: string } | undefined;
}

export function authRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db, cfg } = ctx;

  app.post('/api/auth/register', { config: perIp(20) }, async (req, reply) => {
    const b = parse(RegisterBody, req.body);
    if (b.role === 'teacher') {
      if (!cfg.teacherInvite || b.teacherCode !== cfg.teacherInvite) throw badRequest('Неверный код преподавателя');
    }
    let groupId: number | null = null;
    if (b.role === 'student' && b.groupCode) {
      const g = findGroupByCode(ctx, b.groupCode);
      if (!g) throw badRequest('Группа с таким кодом не найдена');
      groupId = g.id;
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email)) throw conflict('Пользователь с таким email уже зарегистрирован');
    const hash = await hashPassword(b.password);
    let user: UserRow;
    try {
      const r = db.prepare('INSERT INTO users (name, email, pass_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(b.name, b.email, hash, b.role, groupId, nowIso());
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid) as UserRow;
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw conflict('Пользователь с таким email уже зарегистрирован');
      throw e;
    }
    issueCookie(reply, cfg, user);
    return { user: userView(db, user) };
  });

  app.post('/api/auth/login', { config: perIp(20) }, async (req, reply) => {
    const b = parse(LoginBody, req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(b.email) as UserRow | undefined;
    if (!user || !(await checkPassword(b.password, user.pass_hash))) throw unauthorized('Неверный email или пароль');
    issueCookie(reply, cfg, user);
    return { user: userView(db, user) };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    clearCookie(reply, cfg);
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const u = requireUser(req);
    return { user: userView(db, u) };
  });

  app.patch('/api/me', { config: perIp(30) }, async (req, reply) => {
    const u = requireUser(req);
    const b = parse(PatchMe, req.body);
    if (b.name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(b.name, u.id);
    if (b.groupCode !== undefined) {
      if (u.role !== 'student') throw badRequest('Преподаватель не может вступить в группу');
      if (b.groupCode === null || b.groupCode === '') {
        db.prepare('UPDATE users SET group_id = NULL WHERE id = ?').run(u.id);
      } else {
        const g = findGroupByCode(ctx, b.groupCode);
        if (!g) throw badRequest('Группа с таким кодом не найдена');
        db.prepare('UPDATE users SET group_id = ? WHERE id = ?').run(g.id, u.id);
      }
    }
    if (b.password !== undefined) {
      if (!b.oldPassword || !(await checkPassword(b.oldPassword, u.pass_hash))) throw badRequest('Неверный текущий пароль');
      const hash = await hashPassword(b.password);
      db.prepare('UPDATE users SET pass_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hash, u.id);
    }
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id) as UserRow;
    if (b.password !== undefined) issueCookie(reply, cfg, fresh);
    return { user: userView(db, fresh) };
  });
}
