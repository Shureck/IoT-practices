// Задачи из файла: формат, проверка, справочник, примеры. Только для сервера и инструментов
// (в сайт не попадает: подключайте как '@esp32lab/content/spec').
export { CONDS, STEPS, runSteps, evalCond, timeOf, pinOf } from './dsl';
export type { CondDef, StepDef, RT, Res } from './dsl';
export { compileChecks, routesOf } from './runner';
export { buildReference } from './reference';
export { EXAMPLE_TASK, EXAMPLE_QUIZ } from './examples';
export * from './shape';
export {
  TASK_FORMAT, ID_RE, SCAFFOLD, parseTaskText, validateTask, validateTaskText, specToPractice,
  practiceToSpecObject, circuitToSpec, stringifyTask,
} from './task';
export type { TaskSpec, CheckDef, HttpRouteDef, ValidateOpts, Validated, LocatedIssue, Parsed } from './task';
