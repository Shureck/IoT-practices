// SQLite: схема и миграции (PRAGMA user_version).
import path from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_OPEN } from './access';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  // 1 — начальная схема
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student', 'teacher')),
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    join_code TEXT NOT NULL UNIQUE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_users_group ON users(group_id);
  CREATE INDEX idx_groups_teacher ON groups(teacher_id);

  CREATE TABLE submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    practice_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
    score REAL NOT NULL,
    results TEXT NOT NULL,
    hints_used INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    code TEXT NOT NULL,
    circuit TEXT NOT NULL,
    quiz_answers TEXT,
    grade INTEGER,
    comment TEXT,
    reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  );
  CREATE INDEX idx_sub_user_practice ON submissions(user_id, practice_id);
  CREATE INDEX idx_sub_practice ON submissions(practice_id);

  CREATE TABLE drafts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    practice_id TEXT NOT NULL,
    code TEXT NOT NULL,
    circuit TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, practice_id)
  );

  CREATE TABLE achievements (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    code TEXT NOT NULL,
    circuit TEXT NOT NULL,
    share_token TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_projects_user ON projects(user_id);

  CREATE TABLE assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    practice_id TEXT NOT NULL,
    due_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_assign_group ON assignments(group_id);

  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    sender TEXT NOT NULL,
    content TEXT NOT NULL,
    time TEXT NOT NULL
  );
  CREATE INDEX idx_chat_room ON chat_messages(room, id);

  CREATE TABLE telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    data TEXT NOT NULL,
    time TEXT NOT NULL
  );
  CREATE INDEX idx_telemetry_room ON telemetry(room, id);
  `,
  // 2 — комментарий студента к сдаче; доступ к практикам по группам (существующим группам — первые 4 практики)
  `
  ALTER TABLE submissions ADD COLUMN student_comment TEXT;
  CREATE TABLE group_practices (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    practice_id TEXT NOT NULL,
    PRIMARY KEY (group_id, practice_id)
  );
  ${DEFAULT_OPEN.map((id) => `INSERT INTO group_practices (group_id, practice_id) SELECT id, '${id}' FROM groups;`).join('\n  ')}
  `,
  // 3 — ИИ-разбор неудачной сдачи (кэш ответа модели)
  'ALTER TABLE submissions ADD COLUMN ai_feedback TEXT;',
];

export function openDb(dataDir: string): DB {
  const db = new Database(path.join(dataDir, 'esp32lab.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export const nowIso = () => new Date().toISOString();
