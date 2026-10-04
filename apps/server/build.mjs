// Сборка сервера: два ESM-бандла (сервер и поток проверок).
// Пакеты рабочего пространства (@esp32lab/sim, @esp32lab/content) — TypeScript,
// поэтому они встраиваются в бандл; нативные и прочие npm-зависимости остаются внешними.
import { build } from 'esbuild';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@esp32lab/'));

fs.rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external,
  sourcemap: true,
  logLevel: 'info',
  // для CJS-зависимостей, если какая-то попадёт в бандл
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
};

await build({ ...common, entryPoints: { server: 'src/index.ts' }, outdir: 'dist', outExtension: { '.js': '.mjs' } });
await build({ ...common, entryPoints: { 'check-worker': 'src/check-worker.ts' }, outdir: 'dist', outExtension: { '.js': '.mjs' } });
