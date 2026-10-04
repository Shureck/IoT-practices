// Точка входа сервера ESP32 Lab.
import { loadConfig } from './config';
import { buildApp } from './app';

const cfg = loadConfig();
const app = await buildApp(cfg);

let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    app.log.info(`${sig}: остановка сервера`);
    try { await app.close(); } finally { process.exit(0); }
  });
}

try {
  await app.listen({ port: cfg.port, host: cfg.host });
  app.log.info(`ESP32 Lab: данные в ${cfg.dataDir}, фронтенд из ${cfg.webDist}, компилятор ${cfg.compilerUrl}, проверок параллельно: ${cfg.checkWorkers}`);
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
