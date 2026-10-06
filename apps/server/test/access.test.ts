import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRACTICE_BY_ID } from '@esp32lab/content';
import { migrate } from '../src/db';
import { DEFAULT_OPEN } from '../src/access';
import { Client, makeApp, registered, type TestApp } from './helpers';

const blink = PRACTICE_BY_ID['m1-blink'];
const volt = PRACTICE_BY_ID['m1-voltmeter'];

let t: TestApp;
let teacher: Client;
let student: Client;
let loner: Client;
let groupId: number;

beforeAll(async () => {
  t = await makeApp();
  teacher = (await registered(t.app, { role: 'teacher', teacherCode: 'teach-secret', name: 'Учитель' })).c;
  const g = await teacher.post('/api/teacher/groups', { name: 'ИКБО-02' });
  groupId = g.body.group.id;
  student = (await registered(t.app, { name: 'Студент', groupCode: g.body.group.joinCode })).c;
  loner = (await registered(t.app, { name: 'Без группы' })).c;
});
afterAll(async () => { await t?.close(); });

describe('доступ к практикам', () => {
  it('новой группе открыты первые 4 практики курса', async () => {
    expect(DEFAULT_OPEN).toEqual(['m1-blink', 'm1-button', 'm1-sos', 'm1-traffic']);
    expect((await teacher.get(`/api/teacher/groups/${groupId}/access`)).body.open).toEqual(DEFAULT_OPEN);
    expect((await student.get('/api/progress')).body.open).toEqual(DEFAULT_OPEN);
    expect((await loner.get('/api/progress')).body.open).toBeNull();
    expect((await teacher.get('/api/progress')).body.open).toBeNull();
  });

  it('закрытую практику нельзя проверить и сдать', async () => {
    const body = { practiceId: volt.id, code: volt.starterCode, circuit: volt.starterCircuit };
    expect((await student.post('/api/check', body)).status).toBe(403);
    const r = await student.post('/api/submissions', body);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/откроет преподаватель/);
    expect((await loner.post('/api/check', body)).status).toBe(200);
  });

  it('преподаватель открывает практику, студенту — только своей группы', async () => {
    const r = await teacher.put(`/api/teacher/groups/${groupId}/access`, { open: [...DEFAULT_OPEN, volt.id] });
    expect(r.status).toBe(200);
    expect(r.body.open).toContain(volt.id);
    expect((await student.post('/api/check', { practiceId: volt.id, code: volt.starterCode, circuit: volt.starterCircuit })).status).toBe(200);
    expect((await teacher.put(`/api/teacher/groups/${groupId}/access`, { open: ['nope'] })).status).toBe(400);
    expect((await student.put(`/api/teacher/groups/${groupId}/access`, { open: [] })).status).toBe(403);
  });
});

describe('комментарий студента', () => {
  it('сохраняется со сдачей и виден преподавателю', async () => {
    const r = await student.post('/api/submissions', {
      practiceId: blink.id, code: blink.solution.code, circuit: blink.solution.circuit ?? blink.starterCircuit,
      studentComment: '  Сделала мигание через millis()  ',
    });
    expect(r.status).toBe(200);
    expect(r.body.submission.studentComment).toBe('Сделала мигание через millis()');
    const full = await teacher.get(`/api/teacher/submissions/${r.body.submission.id}`);
    expect(full.body.submission.studentComment).toBe('Сделала мигание через millis()');
    const queue = await teacher.get(`/api/teacher/submissions?groupId=${groupId}`);
    expect(queue.body.submissions[0].studentComment).toBe('Сделала мигание через millis()');
  });
});

describe('миграция 2', () => {
  it('существующим группам открывает первые 4 практики', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esp32lab-mig-'));
    const db = new Database(path.join(dir, 'm.db'));
    // создаём базу, добавляем группу и возвращаем её в состояние «версия 1»
    migrate(db);
    db.prepare("INSERT INTO users (name, email, pass_hash, role, created_at) VALUES ('t', 't@x', 'h', 'teacher', 'now')").run();
    db.prepare("INSERT INTO groups (name, join_code, teacher_id, created_at) VALUES ('g', 'ABCDEF', 1, 'now')").run();
    // откатываем версию и повторяем миграцию 2 на «старой» базе
    db.exec('DROP TABLE group_practices; ALTER TABLE submissions DROP COLUMN student_comment; ALTER TABLE submissions DROP COLUMN ai_feedback;');
    db.pragma('user_version = 1');
    migrate(db);
    const rows = db.prepare('SELECT practice_id FROM group_practices ORDER BY practice_id').all() as { practice_id: string }[];
    expect(rows.map((r) => r.practice_id).sort()).toEqual([...DEFAULT_OPEN].sort());
    db.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
  });
});
