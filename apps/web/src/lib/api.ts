// Клиент API сервера (см. docs/API.md).
import type { CheckResult, CircuitDoc, Diag } from '@esp32lab/sim';
import type { Achievement, Module, Practice, QuizQuestion } from '@esp32lab/content/types';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'student' | 'teacher';
  /** доступен редактор задач */
  isAdmin?: boolean;
  groupId: number | null;
  groupName: string | null;
  xp: number;
  createdAt: string;
}

export interface AdminTask {
  id: string;
  title: string;
  module: number;
  order: number;
  kind: Practice['kind'];
  source: 'builtin' | 'custom' | 'edited';
  visible: boolean;
  checks: 'code' | 'file' | 'quiz';
  submissions: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface TaskIssue { path: string; message: string; level: 'error' | 'warning'; line?: number }
export interface TaskResult { id: string; title: string; ok: boolean; message?: string }
export interface TaskAnalysis {
  ok: boolean;
  canPublish: boolean;
  issues: TaskIssue[];
  dryRun: { solution: TaskResult[]; starter: TaskResult[] } | null;
  preview: { id: string; title: string; module: number; order: number; kind: Practice['kind']; xp: number; goals: number; hints: number; checks: { id: string; title: string }[]; checksSource: 'code' | 'file'; questions: number } | null;
}

export type PublicPractice = Omit<Practice, 'solution' | 'checks' | 'quiz'> & {
  checks: { id: string; title: string }[];
  /** multi — у вопроса несколько правильных ответов (флажки вместо переключателя) */
  quiz?: (Omit<QuizQuestion, 'correct' | 'explain'> & { multi?: boolean })[];
};

export interface Catalog {
  modules: Module[];
  practices: PublicPractice[];
  achievements: Achievement[];
  story: string;
}

export interface Submission {
  id: number;
  practiceId: string;
  status: 'passed' | 'failed';
  score: number;
  results: CheckResult[];
  hintsUsed: number;
  grade: number | null;
  comment: string | null;
  /** комментарий студента, оставленный при сдаче */
  studentComment?: string | null;
  /** разбор ошибок от ИИ-помощника (если запрашивался) */
  aiFeedback?: string | null;
  /** кто запросил разбор: student — студент видел его после сдачи; teacher — запросил преподаватель */
  aiFeedbackBy?: 'student' | 'teacher' | null;
  createdAt: string;
  reviewedAt: string | null;
  code?: string;
  circuit?: CircuitDoc;
  studentName?: string;
  studentId?: number;
}

export interface ProgressItem {
  practiceId: string;
  status: 'draft' | 'failed' | 'passed';
  bestScore: number;
  attempts: number;
  xp: number;
  grade: number | null;
  comment: string | null;
  lastSubmissionId: number | null;
  submittedAt: string | null;
}

export interface Assignment { id: number; groupId: number; practiceId: string; dueAt: string }

export interface Progress {
  xp: number;
  achievements: string[];
  items: ProgressItem[];
  assignments: Assignment[];
  /** практики, открытые преподавателем группе; null — открыто всё */
  open: string[] | null;
}

export interface Project {
  id: number;
  title: string;
  code: string;
  circuit: CircuitDoc;
  shareToken: string | null;
  updatedAt: string;
}

export interface Group { id: number; name: string; joinCode: string; studentCount: number }

export interface GroupProgress {
  group: Group;
  students: { id: number; name: string; email: string; xp: number }[];
  cells: Record<string, Record<string, { status: string; score: number; grade: number | null; submissionId: number | null; submittedAt: string | null; attempts: number }>>;
}

export interface CompileResponse {
  ok: boolean;
  log: string;
  ms?: number;
  binaries?: { name: string; offset: number; data: string }[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Сервер недоступен. Проверьте подключение.');
  }
  let data: unknown = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Ошибка ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  health: () => req<{ ok: boolean; compiler: boolean; version?: string }>('GET', '/api/health'),
  config: () => req<{ mqttWsUrl: string; mqttTcpHost?: string; mqttTcpPort?: number; demo?: boolean }>('GET', '/api/config'),
  me: () => req<{ user: User }>('GET', '/api/me'),
  login: (email: string, password: string) => req<{ user: User }>('POST', '/api/auth/login', { email, password }),
  register: (b: { name: string; email: string; password: string; role: 'student' | 'teacher'; groupCode?: string; teacherCode?: string }) =>
    req<{ user: User }>('POST', '/api/auth/register', b),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout'),
  updateMe: (b: { name?: string; password?: string; oldPassword?: string; groupCode?: string }) => req<{ user: User }>('PATCH', '/api/me', b),

  catalog: () => req<Catalog>('GET', '/api/practices'),
  check: (practiceId: string, code: string, circuit: CircuitDoc) =>
    req<{ compile: { ok: boolean; diagnostics: Diag[] }; results: CheckResult[] }>('POST', '/api/check', { practiceId, code, circuit }),
  submit: (b: { practiceId: string; code: string; circuit: CircuitDoc; hintsUsed: number; quizAnswers?: number[][]; studentComment?: string }) =>
    req<{ submission: Submission; xpGained: number; newAchievements: string[] }>('POST', '/api/submissions', b),
  submissions: (practiceId?: string) => req<{ submissions: Submission[] }>('GET', `/api/submissions${practiceId ? `?practiceId=${encodeURIComponent(practiceId)}` : ''}`),
  submission: (id: number) => req<{ submission: Submission }>('GET', `/api/submissions/${id}`),
  explain: (id: number) => req<{ text: string; by: 'student' | 'teacher' | null }>('POST', `/api/submissions/${id}/explain`),
  draft: (practiceId: string) => req<{ code: string; circuit: CircuitDoc; updatedAt: string }>('GET', `/api/drafts/${encodeURIComponent(practiceId)}`),
  saveDraft: (practiceId: string, code: string, circuit: CircuitDoc) => req<{ ok: true }>('PUT', `/api/drafts/${encodeURIComponent(practiceId)}`, { code, circuit }),
  progress: () => req<Progress>('GET', '/api/progress'),
  awardAchievement: (id: string) => req<{ ok: boolean; new: boolean }>('POST', `/api/achievements/${id}`),

  projects: () => req<{ projects: Pick<Project, 'id' | 'title' | 'updatedAt' | 'shareToken'>[] }>('GET', '/api/projects'),
  project: (id: number) => req<{ project: Project }>('GET', `/api/projects/${id}`),
  createProject: (b: { title: string; code: string; circuit: CircuitDoc }) => req<{ project: Project }>('POST', '/api/projects', b),
  updateProject: (id: number, b: { title?: string; code?: string; circuit?: CircuitDoc }) => req<{ project: Project }>('PUT', `/api/projects/${id}`, b),
  deleteProject: (id: number) => req<{ ok: true }>('DELETE', `/api/projects/${id}`),
  shareProject: (id: number) => req<{ shareToken: string }>('POST', `/api/projects/${id}/share`),
  shared: (token: string) => req<{ project: { title: string; code: string; circuit: CircuitDoc; author: string } }>('GET', `/api/shared/${encodeURIComponent(token)}`),

  groups: () => req<{ groups: Group[] }>('GET', '/api/teacher/groups'),
  createGroup: (name: string) => req<{ group: Group }>('POST', '/api/teacher/groups', { name }),
  deleteGroup: (id: number) => req<{ ok: true }>('DELETE', `/api/teacher/groups/${id}`),
  groupAccess: (id: number) => req<{ open: string[] }>('GET', `/api/teacher/groups/${id}/access`),
  setGroupAccess: (id: number, open: string[]) => req<{ open: string[] }>('PUT', `/api/teacher/groups/${id}/access`, { open }),
  groupProgress: (id: number) => req<GroupProgress>('GET', `/api/teacher/groups/${id}/progress`),
  teacherSubmissions: (q: { groupId?: number; practiceId?: string; studentId?: number; unreviewed?: boolean }) => {
    const p = new URLSearchParams();
    if (q.groupId) p.set('groupId', String(q.groupId));
    if (q.practiceId) p.set('practiceId', q.practiceId);
    if (q.studentId) p.set('studentId', String(q.studentId));
    if (q.unreviewed) p.set('unreviewed', '1');
    return req<{ submissions: Submission[] }>('GET', `/api/teacher/submissions?${p}`);
  },
  teacherSubmission: (id: number) => req<{ submission: Submission }>('GET', `/api/teacher/submissions/${id}`),
  review: (id: number, grade: number | null, comment: string) => req<{ ok: true }>('POST', `/api/teacher/submissions/${id}/review`, { grade, comment }),
  // ---- редактор задач (администраторы) ----
  adminTasks: () => req<{ tasks: AdminTask[]; loadErrors: { id: string; message: string }[] }>('GET', '/api/admin/tasks'),
  adminTaskFile: (id: string) => req<{ id: string; source: AdminTask['source']; visible: boolean; text: string; stored: boolean; updatedAt: string | null }>('GET', `/api/admin/tasks/${encodeURIComponent(id)}/file`),
  adminValidate: (b: { text: string; mode: 'create' | 'edit'; id?: string }) => req<TaskAnalysis>('POST', '/api/admin/tasks/validate', b),
  adminCreate: (text: string, note?: string) => req<{ ok: true; id: string; warnings: number }>('POST', '/api/admin/tasks', { text, note }),
  adminUpdate: (id: string, text: string, note?: string) => req<{ ok: true; id: string; warnings: number }>('PUT', `/api/admin/tasks/${encodeURIComponent(id)}`, { text, note, mode: 'edit', id }),
  adminVisibility: (id: string, visible: boolean) => req<{ ok: true; visible: boolean }>('POST', `/api/admin/tasks/${encodeURIComponent(id)}/visibility`, { visible }),
  adminDelete: (id: string) => req<{ ok: true }>('DELETE', `/api/admin/tasks/${encodeURIComponent(id)}`),
  adminRevisions: (id: string) => req<{ revisions: { id: number; note: string | null; createdAt: string; author: string | null }[] }>('GET', `/api/admin/tasks/${encodeURIComponent(id)}/revisions`),
  adminRevision: (id: string, rid: number) => req<{ id: number; text: string; createdAt: string }>('GET', `/api/admin/tasks/${encodeURIComponent(id)}/revisions/${rid}`),
  /** текст файла-основы: example-task.yaml, example-quiz.yaml, reference.md */
  adminFileText: async (name: string): Promise<string> => {
    const res = await fetch(`/api/admin/task-files/${name}`, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, `Не удалось загрузить файл (${res.status})`);
    return res.text();
  },
  studentDraft: (studentId: number, practiceId: string) =>
    req<{ studentId: number; studentName: string; practiceId: string; code: string; circuit: CircuitDoc; updatedAt: string }>('GET', `/api/teacher/students/${studentId}/drafts/${encodeURIComponent(practiceId)}`),
  /** автопроверка черновика (и разбор ИИ) — для несданной работы, студент результат не видит */
  draftCheck: (studentId: number, practiceId: string, ai: boolean) =>
    req<{ compile: { ok: boolean }; results: CheckResult[]; aiText: string | null; code: string; circuit: CircuitDoc; updatedAt: string }>(
      'POST', `/api/teacher/students/${studentId}/drafts/${encodeURIComponent(practiceId)}/check`, { ai }),
  solution: (practiceId: string) => req<{ code: string; circuit: CircuitDoc }>('GET', `/api/teacher/practices/${encodeURIComponent(practiceId)}/solution`),
  assignments: (groupId: number) => req<{ assignments: Assignment[] }>('GET', `/api/teacher/assignments?groupId=${groupId}`),
  createAssignment: (groupId: number, practiceId: string, dueAt: string) => req<{ assignment: Assignment }>('POST', '/api/teacher/assignments', { groupId, practiceId, dueAt }),
  deleteAssignment: (id: number) => req<{ ok: true }>('DELETE', `/api/teacher/assignments/${id}`),

  netHttp: (r: { method: string; url: string; headers: Record<string, string>; body?: string }) =>
    req<{ status: number; headers: Record<string, string>; body: string }>('POST', '/api/net/http', r),
  chat: (room: string, after = 0) => req<{ messages: { id: number; sender: string; content: string; time: string }[] }>('GET', `/api/chat/${encodeURIComponent(room)}?after=${after}`),
  chatSend: (room: string, content: string) => req<unknown>('POST', `/api/chat/${encodeURIComponent(room)}`, { content }),
  compile: (code: string) => req<CompileResponse>('POST', '/api/compile', { code }),
};
