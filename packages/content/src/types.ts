// Формат учебного контента: модули (по лекциям) и практики.
import type { CheckSpec, CircuitDoc, MockNetOptions } from '@esp32lab/sim';

export type PracticeKind = 'lab' | 'homework' | 'case' | 'quiz';

export interface QuizQuestion {
  id: string;
  /** текст вопроса (markdown) */
  text: string;
  options: string[];
  /** индексы правильных вариантов */
  correct: number[];
  /** пояснение после ответа (markdown) */
  explain: string;
  /** код или «осциллограмма» к вопросу (необязательно) */
  code?: string;
}

export interface Practice {
  /** уникальный id, например 'm1-blink' */
  id: string;
  /** номер модуля 1–6 */
  module: number;
  /** порядок внутри модуля */
  order: number;
  kind: PracticeKind;
  title: string;
  /** одна строка под заголовком */
  subtitle: string;
  difficulty: 1 | 2 | 3;
  xp: number;
  /** примерное время, мин */
  minutes: number;
  /** темы: GPIO, ШИМ, MQTT… */
  tags: string[];
  /** сюжетное вступление (markdown) */
  story: string;
  /** цели — то, что студент видит как чек-лист (markdown-строки) */
  goals: string[];
  /** теория с примерами кода (markdown) */
  theory?: string;
  /** подсказки, открываются по одной */
  hints: string[];
  starterCode: string;
  starterCircuit: CircuitDoc;
  /** эталонное решение (видит только преподаватель) */
  solution: { code: string; circuit?: CircuitDoc };
  /** автопроверки */
  checks: CheckSpec[];
  /** какие компоненты доступны в палитре (по умолчанию — все) */
  palette?: string[];
  /** схему менять нельзя — только код */
  circuitLocked?: boolean;
  /** настройки сети для проверок (свои HTTP-маршруты и т.п.) */
  net?: MockNetOptions;
  /** вопросы для kind === 'quiz' */
  quiz?: QuizQuestion[];
  /** минимальная доля верных ответов в квизе */
  passScore?: number;
}

export interface Module {
  id: number;
  title: string;
  subtitle: string;
  /** номер лекции, на которой основан модуль */
  lecture: number | null;
  /** сюжетное вступление модуля (markdown) */
  story: string;
  /** эмодзи-иконка */
  icon: string;
  /** акцентный цвет (hex) */
  color: string;
  topics: string[];
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
}
