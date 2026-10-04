// Загрузчик потока проверок в режиме разработки/тестов: исходник на TypeScript
// подключается через tsx (в продакшене используется собранный dist/check-worker.mjs).
import { tsImport } from 'tsx/esm/api';

await tsImport('./check-worker.ts', import.meta.url);
