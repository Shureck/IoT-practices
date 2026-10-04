import type { ZodError, ZodTypeAny, z } from 'zod';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = 'Требуется вход в систему') => new HttpError(401, m);
export const forbidden = (m = 'Недостаточно прав') => new HttpError(403, m);
export const notFound = (m = 'Не найдено') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

const FIELD_NAMES: Record<string, string> = {
  name: 'имя', email: 'email', password: 'пароль', oldPassword: 'старый пароль', role: 'роль',
  groupCode: 'код группы', teacherCode: 'код преподавателя', practiceId: 'практика', code: 'код',
  circuit: 'схема', hintsUsed: 'число подсказок', quizAnswers: 'ответы квиза', title: 'название',
  grade: 'оценка', comment: 'комментарий', groupId: 'группа', dueAt: 'срок сдачи', content: 'сообщение',
  url: 'адрес', method: 'метод', headers: 'заголовки', body: 'тело запроса',
};

export function zodMessage(err: ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'Некорректные данные запроса';
  // своё сообщение из схемы (на русском) — отдаём как есть
  if (issue.message && /[а-яё]/i.test(issue.message)) return issue.message;
  const key = issue.path.length ? String(issue.path[0]) : '';
  const field = key ? FIELD_NAMES[key] ?? key : '';
  return field ? `Некорректное поле «${field}»` : 'Некорректные данные запроса';
}

/** Разобрать данные по схеме или бросить 400 с сообщением на русском. */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw badRequest(zodMessage(r.error));
  return r.data;
}
