// Сборка Fastify-приложения (используется и при запуске, и в тестах).
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import httpProxy from '@fastify/http-proxy';
import type { Config } from './config';
import type { AppCtx } from './ctx';
import { openDb } from './db';
import { CheckPool } from './pool';
import { SqliteChat } from './chat';
import { safeFetch } from './net';
import { loadUser } from './auth';
import { HttpError } from './errors';
import { seedDemo } from './seed';
import { authRoutes } from './routes/auth';
import { practiceRoutes } from './routes/practices';
import { submissionRoutes } from './routes/submissions';
import { progressRoutes } from './routes/progress';
import { projectRoutes } from './routes/projects';
import { teacherRoutes } from './routes/teacher';
import { netRoutes } from './routes/net';
import { compileRoutes } from './routes/compile';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppCtx;
  }
}

export interface BuildOptions {
  logger?: boolean;
  fetchExternal?: AppCtx['fetchExternal'];
  compilerFetch?: typeof fetch;
}

const PLACEHOLDER = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ESP32 Lab</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:520px;padding:24px;text-align:center}code{background:#1e293b;padding:2px 6px;border-radius:4px}</style></head>
<body><main><h1>ESP32 Lab</h1><p>Сервер работает, но сборка интерфейса не найдена.</p>
<p>Соберите фронтенд: <code>npm run build -w apps/web</code> или укажите путь в <code>WEB_DIST</code>.</p>
<p><a href="/api/health" style="color:#38bdf8">/api/health</a></p></main></body></html>`;

export async function buildApp(cfg: Config, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: cfg.logLevel },
    trustProxy: cfg.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  const db = openDb(cfg.dataDir);
  const pool = new CheckPool(cfg.checkWorkers, cfg.checkTimeoutMs);
  const ctx: AppCtx = {
    cfg,
    db,
    pool,
    chat: new SqliteChat(db),
    fetchExternal: opts.fetchExternal ?? ((r) => safeFetch(r)),
    compilerFetch: opts.compilerFetch ?? fetch,
  };
  app.decorate('ctx', ctx);
  app.decorateRequest('user', null);
  app.addHook('onClose', async () => {
    await pool.close();
    db.close();
  });

  if (cfg.seedDemo) await seedDemo(db);

  // JSON: пустое тело допустимо (POST без данных)
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const s = String(body ?? '');
    if (!s.trim()) return done(null, undefined);
    try { done(null, JSON.parse(s)); } catch {
      done(new HttpError(400, 'Некорректный JSON в теле запроса'), undefined);
    }
  });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const status = (err as FastifyError).statusCode ?? 500;
    if (status === 429) {
      return reply.code(429).send({ error: 'Слишком много запросов — подождите немного и попробуйте снова' });
    }
    if (status === 413 || (err as FastifyError).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(400).send({ error: 'Слишком большой запрос' });
    }
    if (status === 415) return reply.code(400).send({ error: 'Неподдерживаемый формат данных (нужен JSON)' });
    if (status >= 400 && status < 500) return reply.code(status).send({ error: 'Некорректный запрос' });
    req.log.error(err);
    return reply.code(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  await app.register(cookie);
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/')) req.user = loadUser(req, db, cfg);
  });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    if (req.url.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Слишком много запросов',
      message: `Слишком много запросов — подождите ${Math.ceil(context.ttl / 1000)} с`,
    }),
  });

  practiceRoutes(app);
  authRoutes(app, ctx);
  submissionRoutes(app, ctx);
  progressRoutes(app, ctx);
  projectRoutes(app, ctx);
  teacherRoutes(app, ctx);
  netRoutes(app, ctx);
  compileRoutes(app, ctx);

  app.get('/api/config', async (req) => ({
    mqttWsUrl: '/mqtt',
    mqttTcpHost: cfg.mqttPublicHost ?? req.hostname.replace(/:\d+$/, ''),
    mqttTcpPort: cfg.mqttPublicPort,
    demo: cfg.seedDemo,
  }));

  // WebSocket-прокси MQTT → Mosquitto
  if (cfg.mqttWsUrl) {
    await app.register(async (scope) => {
      // прокси ставит свои парсеры тела — убираем унаследованный JSON-парсер в этом контексте
      scope.removeContentTypeParser('application/json');
      await scope.register(httpProxy, {
        upstream: cfg.mqttWsUrl.replace(/^ws/, 'http'),
        wsUpstream: cfg.mqttWsUrl,
        prefix: '/mqtt',
        rewritePrefix: '/mqtt',
        websocket: true,
        httpMethods: ['GET'],
      });
    });
  }

  // Статика фронтенда + SPA-fallback
  const hasWeb = fs.existsSync(path.join(cfg.webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: cfg.webDist,
      prefix: '/',
      index: 'index.html',
      setHeaders: (res, file) => {
        if (/[\\/]assets[\\/]/.test(file)) res.header('cache-control', 'public, max-age=31536000, immutable');
        else res.header('cache-control', 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url === '/api' || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return reply.code(404).send({ error: 'Не найдено' });
    }
    reply.header('cache-control', 'no-cache');
    if (hasWeb) return reply.sendFile('index.html');
    return reply.type('text/html; charset=utf-8').send(PLACEHOLDER);
  });

  return app;
}
