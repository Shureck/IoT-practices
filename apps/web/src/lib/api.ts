// Клиент API сервера (см. docs/API.md).
import type { CheckResult, CircuitDoc, Diag } from '@esp32lab/sim';
import type { Achievement, Module, Practice, QuizQuestion } from '@esp32lab/content/types';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'student' | 'teacher';
  groupId: number | null;
  groupName: string | null;
  xp: number;
  createdAt: string;
}

export type PublicPractice = Omit<Practice, 'solution' | 'checks' | 'quiz'> & {
  checks: { id: string; title: string }[];
  quiz?: Omit<QuizQuestion, 'correct' | 'explain'>[];
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
  submit: (b: { practiceId: string; code: string; circuit: CircuitDoc; hintsUsed: number; quizAnswers?: number[][] }) =>
    req<{ submission: Submission; xpGained: number; newAchievements: string[] }>('POST', '/api/submissions', b),
  submissions: (practiceId?: string) => req<{ submissions: Submission[] }>('GET', `/api/submissions${practiceId ? `?practiceId=${encodeURIComponent(practiceId)}` : ''}`),
  submission: (id: number) => req<{ submission: Submission }>('GET', `/api/submissions/${id}`),
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
