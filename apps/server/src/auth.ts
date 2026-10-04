// Аутентификация: JWT в httpOnly-cookie `sid`.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from './db';
import type { Config } from './config';
import { forbidden, unauthorized } from './errors';

export const COOKIE = 'sid';
const TTL_SEC = 30 * 24 * 3600;

export interface UserRow {
  id: number;
  name: string;
  email: string;
  pass_hash: string;
  role: 'student' | 'teacher';
  group_id: number | null;
  token_version: number;
  created_at: string;
}

export interface UserView {
  id: number;
  name: string;
  email: string;
  role: 'student' | 'teacher';
  groupId: number | null;
  groupName: string | null;
  xp: number;
  createdAt: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function userXp(db: DB, userId: number): number {
  const r = db.prepare('SELECT COALESCE(SUM(xp), 0) AS xp FROM submissions WHERE user_id = ?').get(userId) as { xp: number };
  return r.xp;
}

export function userView(db: DB, u: UserRow): UserView {
  const g = u.group_id ? (db.prepare('SELECT name FROM groups WHERE id = ?').get(u.group_id) as { name: string } | undefined) : undefined;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    groupId: g ? u.group_id : null,
    groupName: g?.name ?? null,
    xp: userXp(db, u.id),
    createdAt: u.created_at,
  };
}

export function issueCookie(reply: FastifyReply, cfg: Config, u: UserRow) {
  const token = jwt.sign({ sub: String(u.id), tv: u.token_version }, cfg.jwtSecret, { expiresIn: TTL_SEC, algorithm: 'HS256' });
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.cookieSecure,
    maxAge: TTL_SEC,
  });
}

export function clearCookie(reply: FastifyReply, cfg: Config) {
  reply.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure });
}

/** id пользователя из cookie (без обращения к БД) — для ключей лимитов. */
export function tokenUserId(req: FastifyRequest, cfg: Config): number | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const p = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'] }) as { sub?: string };
    const id = Number(p.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function loadUser(req: FastifyRequest, db: DB, cfg: Config): UserRow | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const p = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'] }) as { sub?: string; tv?: number };
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(p.sub)) as UserRow | undefined;
    if (!u || (p.tv ?? 0) !== u.token_version) return null;
    return u;
  } catch {
    return null;
  }
}

export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireTeacher(req: FastifyRequest): UserRow {
  const u = requireUser(req);
  if (u.role !== 'teacher') throw forbidden('Доступно только преподавателю');
  return u;
}
