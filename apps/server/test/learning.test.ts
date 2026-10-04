import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRACTICE_BY_ID } from '@esp32lab/content';
import { Client, makeApp, registered, type TestApp } from './helpers';

const blink = PRACTICE_BY_ID['m1-blink'];
const solution = { practiceId: 'm1-blink', code: blink.solution.code, circuit: blink.solution.circuit ?? blink.starterCircuit };

let t: TestApp;
let teacher: Client;
let student: Client;
let studentId: number;
let groupId: number;
let joinCode: string;

beforeAll(async () => {
  t = await makeApp();
  teacher = (await registered(t.app, { role: 'teacher', teacherCode: 'teach-secret', name: 'Учитель' })).c;
  const g = await teacher.post('/api/teacher/groups', { name: 'ИКБО-01' });
  expect(g.status).toBe(200);
  groupId = g.body.group.id;
  joinCode = g.body.group.joinCode;
  const s = await registered(t.app, { name: 'Студент', groupCode: joinCode.toLowerCase() });
  student = s.c;
  studentId = s.user.id;
  expect(s.user.groupId).toBe(groupId);
});
afterAll(async () => { await t?.close(); });

describe('группы', () => {
  it('код группы — 6 символов, список групп со счётчиком', async () => {
    expect(joinCode).toMatch(/^[A-Z0-9]{6}$/);
    const r = await teacher.get('/api/teacher/groups');
    expect(r.body.groups).toEqual([{ id: groupId, name: 'ИКБО-01', joinCode, studentCount: 1 }]);
    expect((await student.get('/api/teacher/groups')).status).toBe(403);
  });
});

describe('черновики', () => {
  it('сохранение и загрузка', async () => {
    expect((await student.get('/api/drafts/m1-blink')).status).toBe(404);
    const put = await student.put('/api/drafts/m1-blink', { code: 'void setup(){}', circuit: blink.starterCircuit });
    expect(put.body).toEqual({ ok: true });
    const get = await student.get('/api/drafts/m1-blink');
    expect(get.body.code).toBe('void setup(){}');
    expect(get.body.circuit.parts[0].id).toBe('esp');
    expect(typeof get.body.updatedAt).toBe('string');
    const big = await student.put('/api/drafts/m1-blink', { code: 'x'.repeat(190_000), circuit: { parts: [], wires: [], junk: 'y'.repeat(100_000) } });
    expect(big.status).toBe(400);
    expect(big.body.error).toMatch(/256 КБ/);
    expect((await student.put('/api/drafts/no-such', { code: '', circuit: blink.starterCircuit })).status).toBe(404);
    const prog = await student.get('/api/progress');
    expect(prog.body.items).toContainEqual(expect.objectContaining({ practiceId: 'm1-blink', status: 'draft', attempts: 0 }));
  });
});

describe('проверка и сдача', () => {
  it('/api/check требует вход и проверяет эталон', async () => {
    expect((await new Client(t.app).post('/api/check', solution)).status).toBe(401);
    const r = await student.post('/api/check', solution);
    expect(r.status).toBe(200);
    expect(r.body.compile.ok).toBe(true);
    expect(r.body.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, true, true]);
  });

  it('неудачная сдача (заготовка)', async () => {
    const r = await student.post('/api/submissions', { practiceId: 'm1-blink', code: blink.starterCode, circuit: blink.starterCircuit, hintsUsed: 0 });
    expect(r.status).toBe(200);
    expect(r.body.submission.status).toBe('failed');
    expect(r.body.submission.score).toBeLessThan(1);
    expect(r.body.xpGained).toBe(0);
    expect(r.body.newAchievements).toEqual([]);
    expect(r.body.submission.results.some((x: { ok: boolean; message?: string }) => !x.ok && x.message)).toBe(true);
  });

  it('несобирающийся код', async () => {
    const r = await student.post('/api/submissions', { ...solution, code: 'void setup( {', hintsUsed: 0 });
    expect(r.body.submission.status).toBe('failed');
    expect(r.body.submission.score).toBe(0);
  });

  it('успешная сдача эталона: XP с учётом подсказок и достижения', async () => {
    const r = await student.post('/api/submissions', { ...solution, hintsUsed: 2 });
    expect(r.status).toBe(200);
    expect(r.body.submission).toMatchObject({ practiceId: 'm1-blink', status: 'passed', score: 1, hintsUsed: 2, grade: null, comment: null, reviewedAt: null });
    expect(r.body.xpGained).toBe(Math.round(blink.xp * 0.8));
    expect(r.body.newAchievements).toContain('first-check');

    const again = await student.post('/api/submissions', { ...solution, hintsUsed: 0 });
    expect(again.body.submission.status).toBe('passed');
    expect(again.body.xpGained).toBe(0);
    expect(again.body.newAchievements).not.toContain('first-check');

    const me = await student.get('/api/me');
    expect(me.body.user.xp).toBe(Math.round(blink.xp * 0.8));

    const list = await student.get('/api/submissions?practiceId=m1-blink');
    expect(list.body.submissions.length).toBe(4);
    expect(list.body.submissions[0].status).toBe('passed');

    const prog = await student.get('/api/progress');
    expect(prog.body.xp).toBe(Math.round(blink.xp * 0.8));
    expect(prog.body.achievements).toContain('first-check');
    expect(prog.body.items).toContainEqual(expect.objectContaining({ practiceId: 'm1-blink', status: 'passed', bestScore: 1, attempts: 4 }));

    const one = await student.get(`/api/submissions/${list.body.submissions[0].id}`);
    expect(one.body.submission.code).toBe(blink.solution.code);
    const other = (await registered(t.app)).c;
    expect((await other.get(`/api/submissions/${list.body.submissions[0].id}`)).status).toBe(403);
  });

  it('клиентские достижения', async () => {
    expect((await student.post('/api/achievements/first-blink')).body).toEqual({ ok: true, new: true });
    expect((await student.post('/api/achievements/first-blink')).body).toEqual({ ok: true, new: false });
    expect((await student.post('/api/achievements/all-cases')).status).toBe(400);
  });
});

describe('преподаватель', () => {
  it('матрица прогресса, список сдач и рецензия', async () => {
    const m = await teacher.get(`/api/teacher/groups/${groupId}/progress`);
    expect(m.status).toBe(200);
    expect(m.body.group.id).toBe(groupId);
    expect(m.body.students).toEqual([expect.objectContaining({ id: studentId, name: 'Студент', xp: Math.round(blink.xp * 0.8) })]);
    const cell = m.body.cells[studentId]['m1-blink'];
    expect(cell).toMatchObject({ status: 'passed', score: 1, attempts: 4, grade: null });

    const subs = await teacher.get(`/api/teacher/submissions?groupId=${groupId}&practiceId=m1-blink&unreviewed=1`);
    expect(subs.body.submissions.length).toBe(4);
    expect(subs.body.submissions[0].studentName).toBe('Студент');

    const id = cell.submissionId;
    const full = await teacher.get(`/api/teacher/submissions/${id}`);
    expect(full.body.submission).toMatchObject({ id, studentId, studentName: 'Студент', code: blink.solution.code });

    expect((await teacher.post(`/api/teacher/submissions/${id}/review`, { grade: 6, comment: '' })).status).toBe(400);
    const rev = await teacher.post(`/api/teacher/submissions/${id}/review`, { grade: 5, comment: 'Отлично!' });
    expect(rev.body).toEqual({ ok: true });

    const after = await teacher.get(`/api/teacher/submissions?groupId=${groupId}&unreviewed=1`);
    expect(after.body.submissions.length).toBe(3);
    const mine = await student.get(`/api/submissions/${id}`);
    expect(mine.body.submission).toMatchObject({ grade: 5, comment: 'Отлично!' });
    expect(mine.body.submission.reviewedAt).toBeTruthy();
    const prog = await student.get('/api/progress');
    expect(prog.body.items).toContainEqual(expect.objectContaining({ practiceId: 'm1-blink', grade: 5, comment: 'Отлично!' }));

    // чужой преподаватель не видит
    const t2 = (await registered(t.app, { role: 'teacher', teacherCode: 'teach-secret' })).c;
    expect((await t2.get(`/api/teacher/submissions/${id}`)).status).toBe(404);
    expect((await t2.get(`/api/teacher/groups/${groupId}/progress`)).status).toBe(404);
    expect((await student.post(`/api/teacher/submissions/${id}/review`, { grade: 5, comment: '' })).status).toBe(403);
  });

  it('эталонное решение и задания', async () => {
    const sol = await teacher.get('/api/teacher/practices/m1-blink/solution');
    expect(sol.body.code).toBe(blink.solution.code);
    expect(sol.body.circuit.parts.length).toBeGreaterThan(0);
    expect((await student.get('/api/teacher/practices/m1-blink/solution')).status).toBe(403);

    const a = await teacher.post('/api/teacher/assignments', { groupId, practiceId: 'm1-button', dueAt: '2030-01-15T18:00:00Z' });
    expect(a.body.assignment).toMatchObject({ groupId, practiceId: 'm1-button', dueAt: '2030-01-15T18:00:00.000Z' });
    expect((await teacher.get(`/api/teacher/assignments?groupId=${groupId}`)).body.assignments.length).toBe(1);
    expect((await student.get('/api/progress')).body.assignments).toEqual([a.body.assignment]);
    expect((await teacher.post('/api/teacher/assignments', { groupId, practiceId: 'nope', dueAt: '2030-01-15' })).status).toBe(404);
    expect((await teacher.del(`/api/teacher/assignments/${a.body.assignment.id}`)).body).toEqual({ ok: true });
    expect((await teacher.get('/api/teacher/assignments')).body.assignments).toEqual([]);
  });

  it('удаление группы освобождает студентов', async () => {
    const g = await teacher.post('/api/teacher/groups', { name: 'Временная' });
    const s = await registered(t.app, { groupCode: g.body.group.joinCode });
    expect(s.user.groupName).toBe('Временная');
    expect((await teacher.del(`/api/teacher/groups/${g.body.group.id}`)).body).toEqual({ ok: true });
    expect((await s.c.get('/api/me')).body.user.groupId).toBeNull();
  });
});
