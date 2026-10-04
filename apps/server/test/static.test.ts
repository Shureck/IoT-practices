import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRACTICES } from '@esp32lab/content';
import { Client, makeApp, registered, type TestApp } from './helpers';

let t: TestApp;
const web = fs.mkdtempSync(path.join(os.tmpdir(), 'esp32lab-web-'));

beforeAll(async () => {
  fs.mkdirSync(path.join(web, 'assets'));
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>SPA</title>');
  fs.writeFileSync(path.join(web, 'assets', 'app-123.js'), 'console.log(1)');
  t = await makeApp({ webDist: web });
});
afterAll(async () => { await t?.close(); fs.rmSync(web, { recursive: true, force: true }); });

describe('статика фронтенда', () => {
  it('файлы, SPA-fallback и JSON-404 для API', async () => {
    const c = new Client(t.app);
    const js = await c.get('/assets/app-123.js');
    expect(js.status).toBe(200);
    expect(js.res.headers['cache-control']).toMatch(/immutable/);
    const root = await c.get('/');
    expect(root.body).toContain('<title>SPA</title>');
    const deep = await c.get('/teacher/groups/5');
    expect(deep.status).toBe(200);
    expect(deep.body).toContain('<title>SPA</title>');
    expect((await c.get('/api/unknown')).body).toEqual({ error: 'Не найдено' });
    expect((await c.get('/assets/missing.js')).status).toBe(200); // тоже index.html (SPA)
  });
});

const quiz = PRACTICES.find((p) => p.kind === 'quiz' && p.quiz?.length);
describe.skipIf(!quiz)('квиз через API', () => {
  it('верные ответы → passed, XP; неверные → failed; правильные ответы не утекают', async () => {
    const { c } = await registered(t.app);
    const pub = await c.get(`/api/practices/${quiz!.id}`);
    expect(pub.body.practice.quiz[0].correct).toBeUndefined();
    expect(pub.body.practice.quiz[0].explain).toBeUndefined();
    const wrong = await c.post('/api/submissions', { practiceId: quiz!.id, code: '', hintsUsed: 0, quizAnswers: quiz!.quiz!.map(() => [99]) });
    expect(wrong.body.submission.status).toBe('failed');
    expect(wrong.body.submission.results.length).toBe(quiz!.quiz!.length);
    const right = await c.post('/api/submissions', { practiceId: quiz!.id, code: '', hintsUsed: 0, quizAnswers: quiz!.quiz!.map((q) => q.correct) });
    expect(right.body.submission).toMatchObject({ status: 'passed', score: 1 });
    expect(right.body.xpGained).toBe(quiz!.xp);
    expect(right.body.submission.results[0]).toMatchObject({ id: quiz!.quiz![0].id, title: quiz!.quiz![0].text, ok: true });
  });
});
