import { PRACTICES_A } from './practices/part-a';
import { PRACTICES_B } from './practices/part-b';
import { PRACTICES_C } from './practices/part-c';
import type { Practice } from './types';

export * from './types';
export * from './modules';
export * as helpers from './helpers';

export const PRACTICES: Practice[] = [...PRACTICES_A, ...PRACTICES_B, ...PRACTICES_C].sort((a, b) => a.module - b.module || a.order - b.order);

export const PRACTICE_BY_ID: Record<string, Practice> = Object.fromEntries(PRACTICES.map((p) => [p.id, p]));

/** Публичная часть практики (без решения и кода проверок) — для клиента без прав преподавателя. */
export function publicPractice(p: Practice) {
  const { solution: _s, checks, quiz, ...rest } = p;
  return {
    ...rest,
    checks: checks.map((c) => ({ id: c.id, title: c.title })),
    quiz: quiz?.map(({ correct: _c, explain: _e, ...q }) => q),
  };
}
