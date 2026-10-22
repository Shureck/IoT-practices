// Редактор задач: права, проверка и публикация файла, работа студента с новой задачей,
// правка встроенных (и возврат), скрытие, удаление, история, устойчивость к битым записям.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRACTICE_BY_ID } from '@esp32lab/content';
import { EXAMPLE_QUIZ, EXAMPLE_TASK, parseTaskText, specToPractice, validateTaskText } from '@esp32lab/content/spec';
import { PracticeStore } from '../src/practices';
import { Client, makeApp, registered, type TestApp } from './helpers';

let t: TestApp;
let teacher: Client;
let student: Client;
let loner: Client;
let groupId: number;
const blink = PRACTICE_BY_ID['m1-blink'];
const ID = 'example-button-call';

const solution = () => {
  const p = specToPractice(validateTaskText(EXAMPLE_TASK, { mode: 'create', existingIds: new Set() }).spec!);
  return { code: p.solution.code, circuit: p.solution.circuit! };
};

beforeAll(async () => {
  t = await makeApp();
  teacher = (await registered(t.app, { role: 'teacher', teacherCode: 'teach-secret', name: 'Админ' })).c;
  const g = await teacher.post('/api/teacher/groups', { name: 'Группа' });
  groupId = g.body.group.id;
  student = (await registered(t.app, { name: 'Студент', groupCode: g.body.group.joinCode })).c;
  loner = (await registered(t.app, { name: 'Без группы' })).c;
});
afterAll(async () => { await t?.close(); });

describe('права', () => {
  it('студенту редактор задач недоступен, преподавателю — доступен', async () => {
    expect((await student.get('/api/admin/tasks')).status).toBe(403);
    expect((await student.post('/api/admin/tasks/validate', { text: EXAMPLE_TASK })).status).toBe(403);
    expect((await new Client(t.app).get('/api/admin/tasks')).status).toBe(401);
    expect((await teacher.get('/api/me')).body.user.isAdmin).toBe(true);
    expect((await student.get('/api/me')).body.user.isAdmin).toBe(false);
    expect((await teacher.get('/api/admin/tasks')).status).toBe(200);
  });
  it('ADMIN_EMAILS ограничивает круг администраторов', async () => {
    const t2 = await makeApp({ adminEmails: ['boss@test.local'] });
    try {
      const other = (await registered(t2.app, { role: 'teacher', teacherCode: 'teach-secret', name: 'Другой' })).c;
      expect((await other.get('/api/admin/tasks')).status).toBe(403);
      const c = new Client(t2.app);
      await c.post('/api/auth/register', { name: 'Босс', email: 'Boss@Test.local', password: 'secret1', role: 'teacher', teacherCode: 'teach-secret' });
      expect((await c.get('/api/admin/tasks')).status).toBe(200);
    } finally { await t2.close(); }
  });
});

describe('файлы-основы', () => {
  it('пример, пример теста и справочник скачиваются', async () => {
    for (const name of ['example-task.yaml', 'example-quiz.yaml', 'reference.md']) {
      const r = await teacher.get(`/api/admin/task-files/${name}`);
      expect(r.status, name).toBe(200);
      expect(String(r.res.headers['content-disposition'])).toContain(name);
      expect(String(r.body).length).toBeGreaterThan(500);
    }
    expect((await teacher.get('/api/admin/task-files/passwd')).status).toBe(404);
    expect((await teacher.get('/api/admin/task-files/constructor')).status).toBe(404);
    expect((await student.get('/api/admin/task-files/reference.md')).status).toBe(403);
  });
  it('в списке есть встроенные задачи', async () => {
    const r = await teacher.get('/api/admin/tasks');
    expect(r.body.tasks.length).toBeGreaterThan(30);
    expect(r.body.tasks.find((x: { id: string }) => x.id === 'm1-blink')).toMatchObject({ source: 'builtin', visible: true, checks: 'code' });
    expect(r.body.tasks.find((x: { id: string }) => x.id === 'm1-quiz')).toMatchObject({ checks: 'quiz' });
  });
});

describe('проверка файла', () => {
  it('пример: можно публиковать, эталон проходит всё, заготовка — ничего', async () => {
    const r = await teacher.post('/api/admin/tasks/validate', { text: EXAMPLE_TASK });
    expect(r.status).toBe(200);
    expect(r.body.issues.filter((i: { level: string }) => i.level === 'error')).toEqual([]);
    expect(r.body.canPublish).toBe(true);
    expect(r.body.dryRun.solution.every((x: { ok: boolean }) => x.ok)).toBe(true);
    expect(r.body.dryRun.starter.some((x: { ok: boolean }) => !x.ok)).toBe(true);
    expect(r.body.preview).toMatchObject({ id: ID, kind: 'lab', checksSource: 'file' });
    expect(r.body.preview.checks).toHaveLength(3);
  });
  it('ошибки приходят с номерами строк; публиковать нельзя', async () => {
    const text = EXAMPLE_TASK.replace('esp:D14 btn:1 yellow', 'esp:D99 btn:1 yellow');
    const r = await teacher.post('/api/admin/tasks/validate', { text });
    expect(r.body.canPublish).toBe(false);
    const e = r.body.issues.find((i: { level: string }) => i.level === 'error');
    expect(e.message).toMatch(/нет вывода «D99»/);
    expect(e.line).toBeGreaterThan(0);
    expect((await teacher.post('/api/admin/tasks', { text })).status).toBe(422);
  });
  it('эталон, который не проходит проверки, публиковать нельзя', async () => {
    const text = EXAMPLE_TASK.replace('digitalWrite(LED_PIN, now);', '');
    const r = await teacher.post('/api/admin/tasks/validate', { text });
    expect(r.body.canPublish).toBe(false);
    expect(r.body.issues.some((i: { message: string }) => /Эталонное решение не проходит проверку/.test(i.message))).toBe(true);
  });
  it('заготовка, которая уже решает задачу, — ошибка', async () => {
    const parsed = parseTaskText(EXAMPLE_TASK).value as { solution: { code: string; circuit: unknown }; starterCircuit: unknown };
    const text = EXAMPLE_TASK.replace(/starterCode: \|[\s\S]*?\n\n# Стартовая схема/, `starterCode: |\n${parsed.solution.code.split('\n').map((l) => `  ${l}`).join('\n')}\n# Стартовая схема`)
      .replace(/starterCircuit:\n  parts:/, 'starterCircuit:\n  wires:\n    - esp:D25 r1:1 green\n    - r1:2 led1:A green\n    - led1:C esp:GND.1 black\n    - esp:D14 btn:1 yellow\n    - btn:2 esp:3V3 red\n  parts:')
      .replace('  wires: []                    # студент соберёт провода сам\n', '');
    const r = await teacher.post('/api/admin/tasks/validate', { text });
    expect(r.body.issues.find((i: { level: string; path: string }) => i.level === 'error')?.message ?? JSON.stringify(r.body.issues)).toMatch(/уже проходит все проверки/);
  });
});

describe('новая задача', () => {
  it('публикуется, попадает в каталог и не открыта группам по умолчанию', async () => {
    const r = await teacher.post('/api/admin/tasks', { text: EXAMPLE_TASK, note: 'первая версия' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const cat = (await new Client(t.app).get('/api/practices')).body;
    const p = cat.practices.find((x: { id: string }) => x.id === ID);
    expect(p.title).toBe('Кнопка вызова (пример)');
    expect(p.solution).toBeUndefined();
    expect(p.checks).toEqual([{ id: 'wiring', title: expect.any(String) }, { id: 'follow', title: expect.any(String) }, { id: 'once', title: expect.any(String) }]);
    // повторно тот же id — нельзя
    expect((await teacher.post('/api/admin/tasks', { text: EXAMPLE_TASK })).status).toBe(422);
    // студент группы: задача закрыта, пока её не откроют
    const sol = solution();
    expect((await student.post('/api/check', { practiceId: ID, code: sol.code, circuit: sol.circuit })).status).toBe(403);
    expect((await student.get('/api/progress')).body.open).not.toContain(ID);
    const open = (await teacher.get(`/api/teacher/groups/${groupId}/access`)).body.open as string[];
    expect((await teacher.put(`/api/teacher/groups/${groupId}/access`, { open: [...open, ID] })).body.open).toContain(ID);
    expect((await student.get('/api/progress')).body.open).toContain(ID);
  });

  it('студент проходит проверки по файлу: верное решение зачтено, неверное — нет', async () => {
    const sol = solution();
    const ok = await student.post('/api/check', { practiceId: ID, code: sol.code, circuit: sol.circuit });
    expect(ok.status).toBe(200);
    expect(ok.body.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, true, true]);
    const bad = await student.post('/api/check', { practiceId: ID, code: sol.code.replace('digitalWrite(LED_PIN, now);', ''), circuit: sol.circuit });
    expect(bad.body.results.find((x: { id: string }) => x.id === 'follow')).toMatchObject({ ok: false, message: expect.stringMatching(/не загорелся/) });
    const sub = await student.post('/api/submissions', { practiceId: ID, code: sol.code, circuit: sol.circuit });
    expect(sub.body.submission.status).toBe('passed');
    expect(sub.body.xpGained).toBe(70);
    // без группы — открыто всё
    expect((await loner.post('/api/check', { practiceId: ID, code: sol.code, circuit: sol.circuit })).body.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
  }, 60000);

  it('история правок, редактирование и номер строки в файле', async () => {
    const f = await teacher.get(`/api/admin/tasks/${ID}/file`);
    expect(f.body).toMatchObject({ source: 'custom', stored: true });
    const text2 = f.body.text.replace('Кнопка вызова (пример)', 'Кнопка вызова v2');
    expect((await teacher.put(`/api/admin/tasks/${ID}`, { text: text2, note: 'новое название' })).status).toBe(200);
    expect((await new Client(t.app).get('/api/practices')).body.practices.find((x: { id: string }) => x.id === ID).title).toBe('Кнопка вызова v2');
    const revs = (await teacher.get(`/api/admin/tasks/${ID}/revisions`)).body.revisions;
    expect(revs.map((r: { note: string }) => r.note)).toEqual(['новое название', 'первая версия']);
    const old = await teacher.get(`/api/admin/tasks/${ID}/revisions/${revs[1].id}`);
    expect(old.body.text).toContain('Кнопка вызова (пример)');
    // менять id при правке нельзя
    expect((await teacher.put(`/api/admin/tasks/${ID}`, { text: text2.replace(`id: ${ID}`, 'id: other-task') })).status).toBe(422);
    expect((await teacher.put('/api/admin/tasks/not-exists', { text: text2 })).status).toBe(404);
  }, 60000);

  it('скрытая задача пропадает из каталога и недоступна студенту, а история сдач читается', async () => {
    expect((await teacher.post(`/api/admin/tasks/${ID}/visibility`, { visible: false })).body.visible).toBe(false);
    expect((await new Client(t.app).get('/api/practices')).body.practices.some((x: { id: string }) => x.id === ID)).toBe(false);
    const sol = solution();
    expect((await student.post('/api/check', { practiceId: ID, code: sol.code, circuit: sol.circuit })).status).toBe(404);
    const subs = await teacher.get(`/api/teacher/submissions?groupId=${groupId}`);
    expect(subs.body.submissions.some((s: { practiceId: string }) => s.practiceId === ID)).toBe(true);
    // удалить задачу со сдачами нельзя
    const del = await teacher.del(`/api/admin/tasks/${ID}`);
    expect(del.status).toBe(409);
    expect(del.body.error).toMatch(/Скройте задачу/);
    expect((await teacher.post(`/api/admin/tasks/${ID}/visibility`, { visible: true })).body.visible).toBe(true);
    expect((await teacher.post('/api/admin/tasks/m1-blink/visibility', { visible: false })).status).toBe(400);
  }, 60000);

  it('задача без сдач удаляется; тест (quiz) работает', async () => {
    const quizText = EXAMPLE_QUIZ;
    const v = await teacher.post('/api/admin/tasks/validate', { text: quizText });
    expect(v.body.canPublish).toBe(true);
    expect(v.body.dryRun).toBeNull();
    expect((await teacher.post('/api/admin/tasks', { text: quizText })).status).toBe(200);
    const sub = await loner.post('/api/submissions', { practiceId: 'example-quiz', code: '', quizAnswers: [[1], [0, 1, 3], [1]] });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.submission.status).toBe('passed');
    expect((await teacher.del('/api/admin/tasks/example-quiz')).status).toBe(409);
    // а новую, ничем не использованную — можно
    const tmp = EXAMPLE_QUIZ.replace('id: example-quiz', 'id: temp-quiz');
    expect((await teacher.post('/api/admin/tasks', { text: tmp })).status).toBe(200);
    expect((await teacher.del('/api/admin/tasks/temp-quiz')).status).toBe(200);
    expect((await new Client(t.app).get('/api/practices')).body.practices.some((x: { id: string }) => x.id === 'temp-quiz')).toBe(false);
  }, 60000);
});

describe('правка встроенных задач', () => {
  it('выгрузка содержит checks: builtin; правка описания не ломает проверки; возврат восстанавливает', async () => {
    const f = await teacher.get('/api/admin/tasks/m1-blink/file');
    expect(f.body).toMatchObject({ source: 'builtin', stored: false });
    expect(f.body.text).toContain('checks: builtin');
    const text = f.body.text.replace(`title: ${blink.title}`, 'title: Первый вдох (правка)').replace(/xp: \d+/, 'xp: 99');
    const v = await teacher.post('/api/admin/tasks/validate', { text, mode: 'edit', id: 'm1-blink' });
    expect(v.body.canPublish, JSON.stringify(v.body.issues)).toBe(true);
    expect((await teacher.put('/api/admin/tasks/m1-blink', { text, note: 'правка' })).status).toBe(200);
    const p = (await new Client(t.app).get('/api/practices')).body.practices.find((x: { id: string }) => x.id === 'm1-blink');
    expect(p.title).toBe('Первый вдох (правка)');
    expect(p.xp).toBe(99);
    expect((await teacher.get('/api/admin/tasks')).body.tasks.find((x: { id: string }) => x.id === 'm1-blink')).toMatchObject({ source: 'edited', checks: 'code' });
    // автопроверки остались прежними и работают
    const ok = await loner.post('/api/check', { practiceId: 'm1-blink', code: blink.solution.code, circuit: blink.solution.circuit ?? blink.starterCircuit });
    expect(ok.body.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
    const bad = await loner.post('/api/check', { practiceId: 'm1-blink', code: blink.starterCode, circuit: blink.starterCircuit });
    expect(bad.body.results.some((x: { ok: boolean }) => !x.ok)).toBe(true);
    // вернуть встроенную
    expect((await teacher.del('/api/admin/tasks/m1-blink')).status).toBe(200);
    expect((await new Client(t.app).get('/api/practices')).body.practices.find((x: { id: string }) => x.id === 'm1-blink').title).toBe(blink.title);
    expect((await teacher.del('/api/admin/tasks/m1-blink')).status).toBe(400);
  }, 90000);

  it('сломать встроенную правкой нельзя: эталон обязан проходить, а заготовка — нет', async () => {
    const f = await teacher.get('/api/admin/tasks/m1-blink/file');
    const at = f.body.text.indexOf('\nsolution:');
    const broken = f.body.text.slice(0, at) + f.body.text.slice(at).replace('delay(1000);', '');
    const r = await teacher.put('/api/admin/tasks/m1-blink', { text: broken });
    expect(r.status).toBe(422);
    const v = await teacher.post('/api/admin/tasks/validate', { text: broken, mode: 'edit', id: 'm1-blink' });
    expect(v.body.issues.some((i: { message: string }) => /Эталонное решение не проходит проверку/.test(i.message))).toBe(true);
    expect((await new Client(t.app).get('/api/practices')).body.practices.find((x: { id: string }) => x.id === 'm1-blink').title).toBe(blink.title);
  }, 60000);
});

describe('устойчивость', () => {
  it('битая запись в базе пропускается, остальное работает', async () => {
    const db = t.app.ctx.db;
    db.prepare("INSERT INTO tasks (id, kind, spec, enabled, updated_at) VALUES ('broken-one', 'custom', 'это не задача: [', 1, 'now')").run();
    db.prepare("INSERT INTO tasks (id, kind, spec, enabled, updated_at) VALUES ('m1-blink', 'custom', 'id: m1-blink', 1, 'now')").run();
    const store = new PracticeStore(db);
    expect(store.loadErrors.map((e) => e.id).sort()).toEqual(['broken-one', 'm1-blink']);
    expect(store.get('m1-blink')?.title).toBe(blink.title);
    expect(store.get(ID)?.title).toBe('Кнопка вызова v2');
    db.prepare("DELETE FROM tasks WHERE id IN ('broken-one', 'm1-blink')").run();
    t.app.ctx.practices.reload();
  });
  it('после перезагрузки сервера (новый реестр) задачи на месте', () => {
    const store = new PracticeStore(t.app.ctx.db);
    expect(store.get(ID)?.checksSpec).toHaveLength(3);
    expect(store.source(ID)).toBe('custom');
    expect(store.order()).toContain(ID);
  });
});
