import type { Config } from './config';
import type { DB } from './db';
import type { CheckPool } from './pool';
import type { SqliteChat } from './chat';
import type { NetRequest, NetResponse } from './net';
import type { Llm } from './ai';

export interface AppCtx {
  cfg: Config;
  db: DB;
  pool: CheckPool;
  chat: SqliteChat;
  /** реальный HTTP-запрос (подменяется в тестах) */
  fetchExternal: (req: NetRequest) => Promise<NetResponse>;
  /** запрос к сервису компиляции (подменяется в тестах) */
  compilerFetch: typeof fetch;
  /** языковая модель для разбора ошибок; null — не настроена */
  llm: Llm | null;
}

/** Ограничение частоты по пользователю (или по IP, если не вошёл). */
export function perUser(max: number, timeWindow = 60_000) {
  return {
    rateLimit: {
      max,
      timeWindow,
      keyGenerator: (req: { user: { id: number } | null; ip: string }) => (req.user ? `u${req.user.id}` : `ip${req.ip}`),
    },
  };
}

export function perIp(max: number, timeWindow = 60_000) {
  return { rateLimit: { max, timeWindow } };
}
