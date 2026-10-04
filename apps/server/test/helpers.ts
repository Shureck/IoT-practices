import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp, type BuildOptions } from '../src/app';
import { loadConfig, type Config } from '../src/config';

export interface TestApp {
  app: FastifyInstance;
  dir: string;
  close(): Promise<void>;
}

export async function makeApp(over: Partial<Config> = {}, opts: BuildOptions = {}): Promise<TestApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esp32lab-test-'));
  const cfg = loadConfig({ TEACHER_INVITE: 'teach-secret', COMPILER_URL: 'http://127.0.0.1:1' } as NodeJS.ProcessEnv, {
    dataDir: dir,
    checkWorkers: 1,
    webDist: path.join(dir, 'no-web'),
    mqttWsUrl: '',
    ...over,
  });
  const app = await buildApp(cfg, { logger: false, ...opts });
  await app.ready();
  return {
    app,
    dir,
    async close() {
      await app.close();
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows может держать файл */ }
    },
  };
}

/** Клиент с сохранением cookie. */
export class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}

  async req(method: InjectOptions['method'], url: string, payload?: unknown) {
    const res = await this.app.inject({
      method, url,
      headers: this.cookie ? { cookie: this.cookie } : {},
      ...(payload !== undefined ? { payload: payload as InjectOptions['payload'] } : {}),
    });
    const set = res.headers['set-cookie'];
    for (const c of Array.isArray(set) ? set : set ? [set] : []) {
      const m = /^sid=([^;]*)/.exec(c);
      if (m) this.cookie = m[1] ? `sid=${m[1]}` : '';
    }
    let body: any = null;
    try { body = res.json(); } catch { body = res.body; }
    return { status: res.statusCode, body, res };
  }
  get(url: string) { return this.req('GET', url); }
  post(url: string, payload: unknown = {}) { return this.req('POST', url, payload); }
  put(url: string, payload: unknown) { return this.req('PUT', url, payload); }
  patch(url: string, payload: unknown) { return this.req('PATCH', url, payload); }
  del(url: string) { return this.req('DELETE', url); }
}

let n = 0;
export async function registered(app: FastifyInstance, extra: Record<string, unknown> = {}) {
  const c = new Client(app);
  const email = `user${Date.now()}_${n++}@test.local`;
  const r = await c.post('/api/auth/register', { name: 'Тест', email, password: 'secret1', role: 'student', ...extra });
  if (r.status !== 200) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { c, user: r.body.user, email };
}
