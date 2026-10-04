import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRACTICES, type Practice } from '@esp32lab/content';
import { Client, makeApp, registered, type TestApp } from './helpers';
import { isPublicAddress, safeFetch, validateTarget } from '../src/net';
import { gradeQuiz, isMoscowNight, xpFor } from '../src/grading';

const circuit = { parts: [{ id: 'esp', type: 'esp32', x: 0, y: 0, rot: 0, props: {}, locked: true }], wires: [] };

let t: TestApp;
let a: Client;
let b: Client;
const compilerCalls: string[] = [];
let compilerUp = false;

beforeAll(async () => {
  t = await makeApp({}, {
    compilerFetch: (async (url: string | URL | Request, init?: RequestInit) => {
      compilerCalls.push(String(url));
      if (!compilerUp) throw new TypeError('fetch failed');
      if (String(url).endsWith('/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      const { code } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, log: 'ok', ms: 5, binaries: [{ name: 'app', offset: 65536, data: Buffer.from(code).toString('base64') }] }), { status: 200 });
    }) as typeof fetch,
  });
  a = (await registered(t.app, { name: 'Автор' })).c;
  b = (await registered(t.app)).c;
});
afterAll(async () => { await t?.close(); });

describe('проекты', () => {
  it('CRUD и публикация', async () => {
    const created = await a.post('/api/projects', { title: 'Мой маяк', code: 'void setup(){}', circuit });
    expect(created.status).toBe(200);
    const p = created.body.project;
    expect(p).toMatchObject({ title: 'Мой маяк', code: 'void setup(){}', shareToken: null });
    expect(p.circuit.parts[0].id).toBe('esp');

    const list = await a.get('/api/projects');
    expect(list.body.projects).toEqual([{ id: p.id, title: 'Мой маяк', updatedAt: p.updatedAt, shareToken: null }]);

    const upd = await a.put(`/api/projects/${p.id}`, { title: 'Маяк 2' });
    expect(upd.body.project).toMatchObject({ title: 'Маяк 2', code: 'void setup(){}' });
    expect((await a.get(`/api/projects/${p.id}`)).body.project.title).toBe('Маяк 2');

    expect((await b.get(`/api/projects/${p.id}`)).status).toBe(404);
    expect((await b.put(`/api/projects/${p.id}`, { title: 'взлом' })).status).toBe(404);
    expect((await a.post('/api/projects', { title: '', code: '', circuit })).status).toBe(400);

    const share = await a.post(`/api/projects/${p.id}/share`);
    expect(share.body.shareToken).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect((await a.post(`/api/projects/${p.id}/share`)).body.shareToken).toBe(share.body.shareToken);
    const pub = await new Client(t.app).get(`/api/shared/${share.body.shareToken}`);
    expect(pub.body.project).toEqual({ title: 'Маяк 2', code: 'void setup(){}', circuit: p.circuit, author: 'Автор' });
    expect((await new Client(t.app).get('/api/shared/AAAAAAAAAAAAAAAA')).status).toBe(404);

    expect((await a.del(`/api/projects/${p.id}`)).body).toEqual({ ok: true });
    expect((await a.get(`/api/projects/${p.id}`)).status).toBe(404);
    expect((await new Client(t.app).get(`/api/shared/${share.body.shareToken}`)).status).toBe(404);
  });
});

describe('сеть симулятора', () => {
  it('виртуальный chat.iot: отправка и чтение', async () => {
    const send = await a.post('/api/net/http', { method: 'GET', url: 'http://chat.iot/send_message?chat_name=lab&sender=esp32&content=hello', headers: {} });
    expect(send.status).toBe(200);
    expect(send.body.status).toBe(200);
    expect(JSON.parse(send.body.body)).toMatchObject({ status: 'ok' });

    const get = await b.post('/api/net/http', { method: 'GET', url: 'http://chat.iot/get_messages?chat_name=lab&after_id=0', headers: {} });
    const data = JSON.parse(get.body.body);
    expect(data.messages).toEqual([expect.objectContaining({ sender: 'esp32', content: 'hello' })]);

    const post = await b.post('/api/chat/lab', { content: 'привет' });
    expect(post.body).toMatchObject({ sender: expect.any(String), content: 'привет' });
    const room = await new Client(t.app).get('/api/chat/lab?after=0');
    expect(room.body.messages.map((m: { content: string }) => m.content)).toEqual(['hello', 'привет']);
    const after = await a.get(`/api/chat/lab?after=${data.messages[0].id}`);
    expect(after.body.messages.length).toBe(1);

    const weather = await a.post('/api/net/http', { method: 'GET', url: 'http://weather.iot/api?city=Moscow', headers: {} });
    expect(JSON.parse(weather.body.body).city).toBe('Moscow');

    const tele = await a.post('/api/net/http', { method: 'POST', url: 'http://station.iot/telemetry', headers: { 'content-type': 'application/json' }, body: '{"temperature":-12.5}' });
    expect(JSON.parse(tele.body.body).accepted).toBe(true);

    expect((await new Client(t.app).post('/api/net/http', { method: 'GET', url: 'http://chat.iot/', headers: {} })).status).toBe(401);
  });

  it('SSRF: внутренние адреса запрещены', async () => {
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://10.0.0.1:8080/', 'http://localhost/', 'http://[::ffff:127.0.0.1]/']) {
      const r = await a.post('/api/net/http', { method: 'GET', url, headers: {} });
      expect(r.status, url).toBe(200);
      expect(r.body.status, url).toBe(-1);
      expect(r.body.reason, url).toBeTruthy();
    }
    const port = await a.post('/api/net/http', { method: 'GET', url: 'http://example.com:22/', headers: {} });
    expect(port.body.status).toBe(-1);
    expect(port.body.reason).toMatch(/Порт/);
    const ftp = await a.post('/api/net/http', { method: 'GET', url: 'ftp://example.com/', headers: {} });
    expect(ftp.body.status).toBe(-1);
  });

  it('SSRF: проверка адресов после DNS', async () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
      '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a00:1']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    // DNS-имя, указывающее на внутренний адрес (DNS rebinding)
    await expect(validateTarget('http://evil.example/', async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]))
      .rejects.toThrow(/внутренним/);
    const r = await safeFetch({ method: 'GET', url: 'http://rebind.example/', headers: {} }, async () => [{ address: '169.254.169.254', family: 4 }]);
    expect(r.status).toBe(-1);
  });
});

describe('компиляция и здоровье', () => {
  it('сервис недоступен → 503, затем доступен', async () => {
    const h = await a.get('/api/health');
    expect(h.body).toEqual({ ok: true, compiler: false, version: expect.any(String) });
    const r = await a.post('/api/compile', { code: 'void setup(){} void loop(){}' });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: 'Сервис компиляции недоступен' });
    compilerUp = true;
    const ok = await a.post('/api/compile', { code: 'void setup(){} void loop(){}' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, log: 'ok', binaries: [expect.objectContaining({ name: 'app', offset: 65536 })] });
    expect((await new Client(t.app).post('/api/compile', { code: 'x' })).status).toBe(401);
  });
});

describe('оценивание', () => {
  const quiz: Practice = {
    ...PRACTICES[0],
    id: 'q-test',
    kind: 'quiz',
    xp: 100,
    quiz: [
      { id: 'q1', text: 'Сколько ядер у ESP32?', options: ['1', '2', '4'], correct: [1], explain: 'Два ядра Xtensa LX6' },
      { id: 'q2', text: 'Какие выводы только на вход?', options: ['34', '35', '2', '25'], correct: [0, 1], explain: 'GPIO34–39' },
      { id: 'q3', text: 'Разрядность АЦП?', options: ['8', '10', '12'], correct: [2], explain: '12 бит' },
    ],
  };

  it('квиз: доля верных и порог', () => {
    const all = gradeQuiz(quiz, [[1], [1, 0], [2]]);
    expect(all.score).toBe(1);
    expect(all.passed).toBe(true);
    expect(all.results[1]).toEqual({ id: 'q2', title: 'Какие выводы только на вход?', ok: true, message: 'GPIO34–39' });

    const two = gradeQuiz(quiz, [[1], [0], [2]]);
    expect(two.score).toBeCloseTo(2 / 3);
    expect(two.passed).toBe(false); // 0.667 < 0.7
    expect(gradeQuiz({ ...quiz, passScore: 0.6 }, [[1], [0], [2]]).passed).toBe(true);
    expect(gradeQuiz(quiz, []).score).toBe(0);
  });

  it('XP и ночная сова', () => {
    expect(xpFor(quiz, 0)).toBe(100);
    expect(xpFor(quiz, 3)).toBe(70);
    expect(xpFor(quiz, 9)).toBe(50);
    expect(isMoscowNight(new Date('2025-10-15T21:30:00Z'))).toBe(true); // 00:30 МСК
    expect(isMoscowNight(new Date('2025-10-15T02:00:00Z'))).toBe(false); // 05:00 МСК
    expect(isMoscowNight(new Date('2025-10-15T12:00:00Z'))).toBe(false);
  });
});
