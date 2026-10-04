// Поддельный поток проверки: код «hang» зависает навсегда, остальное — успешный ответ.
import { parentPort } from 'node:worker_threads';

parentPort.on('message', (task) => {
  if (task.code === 'hang') for (;;) { /* бесконечный синхронный цикл */ }
  parentPort.postMessage({ id: task.id, ok: true, outcome: { compile: { ok: true, diagnostics: [] }, results: [{ id: 'x', title: 'x', ok: true }] } });
});
