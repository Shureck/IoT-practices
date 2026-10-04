import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, makeApp, registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await makeApp({ seedDemo: true }); });
afterAll(async () => { await t?.close(); });

describe('аутентификация', () => {
  it('регистрация → /me → выход → вход', async () => {
    const c = new Client(t.app);
    const reg = await c.post('/api/auth/register', { name: 'Аня', email: 'Anya@Example.com', password: 'qwerty1', role: 'student' });
    expect(reg.status).toBe(200);
    expect(reg.body.user).toMatchObject({ name: 'Аня', email: 'anya@example.com', role: 'student', groupId: null, groupName: null, xp: 0 });
    expect(reg.res.headers['set-cookie']).toMatch(/sid=.*HttpOnly.*SameSite=Lax/i);

    const me = await c.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('anya@example.com');

    expect((await c.post('/api/auth/logout')).body).toEqual({ ok: true });
    const anon = await c.get('/api/me');
    expect(anon.status).toBe(401);
    expect(anon.body.error).toMatch(/вход/i);

    const bad = await c.post('/api/auth/login', { email: 'anya@example.com', password: 'nope123' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('Неверный email или пароль');

    const ok = await c.post('/api/auth/login', { email: 'ANYA@example.com', password: 'qwerty1' });
    expect(ok.status).toBe(200);
    expect((await c.get('/api/me')).status).toBe(200);
  });

  it('валидация и конфликты', async () => {
    const c = new Client(t.app);
    const short = await c.post('/api/auth/register', { name: 'X', email: 'x@test.local', password: '123', role: 'student' });
    expect(short.status).toBe(400);
    expect(short.body.error).toBe('Пароль должен быть не короче 6 символов');

    const badEmail = await c.post('/api/auth/register', { name: 'X', email: 'not-an-email', password: '123456', role: 'student' });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe('Некорректный email');

    const dup = await c.post('/api/auth/register', { name: 'X', email: 'student@demo.local', password: '123456', role: 'student' });
    expect(dup.status).toBe(409);

    const teacherNoCode = await c.post('/api/auth/register', { name: 'T', email: 't1@test.local', password: '123456', role: 'teacher' });
    expect(teacherNoCode.status).toBe(400);
    expect(teacherNoCode.body.error).toMatch(/код преподавателя/);

    const teacher = await c.post('/api/auth/register', { name: 'T', email: 't1@test.local', password: '123456', role: 'teacher', teacherCode: 'teach-secret' });
    expect(teacher.status).toBe(200);
    expect(teacher.body.user.role).toBe('teacher');

    const badGroup = await new Client(t.app).post('/api/auth/register', { name: 'S', email: 's9@test.local', password: '123456', role: 'student', groupCode: 'ZZZZZZ' });
    expect(badGroup.status).toBe(400);
    expect(badGroup.body.error).toMatch(/Группа/);
  });

  it('демо-аккаунты и вступление в группу', async () => {
    const s = new Client(t.app);
    const login = await s.post('/api/auth/login', { email: 'student@demo.local', password: 'student123' });
    expect(login.status).toBe(200);
    expect(login.body.user.groupName).toBe('Демо-группа');

    const { c } = await registered(t.app);
    const join = await c.patch('/api/me', { groupCode: 'demo25' });
    expect(join.status).toBe(200);
    expect(join.body.user.groupName).toBe('Демо-группа');

    const wrong = await c.patch('/api/me', { groupCode: 'QQQQQQ' });
    expect(wrong.status).toBe(400);

    const reg = await new Client(t.app).post('/api/auth/register', { name: 'Б', email: 'b@test.local', password: '123456', role: 'student', groupCode: 'Demo25' });
    expect(reg.body.user.groupName).toBe('Демо-группа');

    const cfg = await s.get('/api/config');
    expect(cfg.body).toMatchObject({ mqttWsUrl: '/mqtt', mqttTcpPort: 1883, demo: true });
  });

  it('смена имени и пароля', async () => {
    const { c, email } = await registered(t.app);
    expect((await c.patch('/api/me', { name: 'Новое имя' })).body.user.name).toBe('Новое имя');
    const noOld = await c.patch('/api/me', { password: 'newpass1' });
    expect(noOld.status).toBe(400);
    const changed = await c.patch('/api/me', { password: 'newpass1', oldPassword: 'secret1' });
    expect(changed.status).toBe(200);
    expect((await c.get('/api/me')).status).toBe(200); // новая cookie выдана
    const login = await new Client(t.app).post('/api/auth/login', { email, password: 'newpass1' });
    expect(login.status).toBe(200);
  });

  it('публичные практики без решений', async () => {
    const c = new Client(t.app);
    const r = await c.get('/api/practices');
    expect(r.status).toBe(200);
    expect(r.body.modules.length).toBeGreaterThan(0);
    expect(r.body.achievements.length).toBeGreaterThan(0);
    expect(typeof r.body.story).toBe('string');
    const blink = r.body.practices.find((p: { id: string }) => p.id === 'm1-blink');
    expect(blink).toBeTruthy();
    expect(blink.solution).toBeUndefined();
    expect(blink.checks[0]).toEqual({ id: 'mode', title: expect.any(String) });
    expect((await c.get('/api/practices/m1-blink')).body.practice.id).toBe('m1-blink');
    expect((await c.get('/api/practices/constructor')).status).toBe(404);
  });

  it('404 для API и SPA-заглушка для остальных путей', async () => {
    const c = new Client(t.app);
    const api = await c.get('/api/nope');
    expect(api.status).toBe(404);
    expect(api.body).toEqual({ error: 'Не найдено' });
    const page = await c.get('/practice/m1-blink');
    expect(page.status).toBe(200);
    expect(page.res.headers['content-type']).toMatch(/text\/html/);
  });
});
