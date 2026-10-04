// Мини-сервис компиляции: POST /compile {code} -> {ok, log, binaries[]}
// Каждая «ячейка» (slot) держит свой каталог сборки, поэтому повторные сборки
// инкрементальные и занимают секунды, а не минуты.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FQBN = process.env.FQBN || 'esp32:esp32:esp32';
const WORK = process.env.WORK_DIR || '/work';
const SLOTS = Number(process.env.SLOTS || 2);
const PORT = Number(process.env.PORT || 8090);
const TIMEOUT_MS = 180_000;
const MAX_CODE = 200_000;

const slots = Array.from({ length: SLOTS }, (_, i) => ({ id: i, busy: false }));
const queue = [];

function slotDirs(id) {
  const root = path.join(WORK, `slot${id}`);
  return {
    sketchDir: path.join(root, 'sketch'),
    buildDir: path.join(root, 'build'),
    cacheDir: path.join(root, 'cache'),
    outDir: path.join(root, 'out'),
  };
}

function acquire() {
  const free = slots.find((s) => !s.busy);
  if (free) { free.busy = true; return Promise.resolve(free); }
  return new Promise((resolve) => queue.push(resolve));
}
function release(slot) {
  const next = queue.shift();
  if (next) next(slot); else slot.busy = false;
}

function run(cmd, args, timeoutMs, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => { p.kill('SIGKILL'); out += '\n[таймаут компиляции]'; }, timeoutMs);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

// Запрещаем #include с абсолютными путями и выходом из каталога скетча:
// иначе текст системных файлов мог бы утечь в лог ошибок.
function unsafeInclude(code) {
  return /#\s*include\s*["<]\s*(\/|\\|[a-zA-Z]:|.*\.\.)/m.test(code);
}

function bootApp0() {
  const base = path.join(process.env.ARDUINO_DIRECTORIES_DATA || '/opt/arduino', 'packages/esp32/hardware/esp32');
  try {
    for (const v of fs.readdirSync(base)) {
      const p = path.join(base, v, 'tools/partitions/boot_app0.bin');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* ignore */ }
  return null;
}

async function compile(code) {
  const slot = await acquire();
  const d = slotDirs(slot.id);
  try {
    fs.mkdirSync(d.sketchDir, { recursive: true });
    fs.rmSync(d.outDir, { recursive: true, force: true });
    fs.mkdirSync(d.outDir, { recursive: true });
    fs.writeFileSync(path.join(d.sketchDir, 'sketch.ino'), code);
    const started = Date.now();
    const r = await run('arduino-cli', [
      'compile', '--fqbn', FQBN, '--build-path', d.buildDir,
      '--output-dir', d.outDir, '--warnings', 'default', d.sketchDir,
    ], TIMEOUT_MS, { ARDUINO_BUILD_CACHE_PATH: d.cacheDir });
    const log = r.out.replace(/\[[0-9;]*m/g, '').split(d.sketchDir + path.sep).join('').split(d.sketchDir + '/').join('');
    if (r.code !== 0) return { ok: false, log, ms: Date.now() - started };
    const binaries = [];
    const merged = path.join(d.outDir, 'sketch.ino.merged.bin');
    if (fs.existsSync(merged)) {
      binaries.push({ name: 'merged', offset: 0x0, data: fs.readFileSync(merged).toString('base64') });
    } else {
      const parts = [
        ['bootloader', 0x1000, 'sketch.ino.bootloader.bin'],
        ['partitions', 0x8000, 'sketch.ino.partitions.bin'],
        ['boot_app0', 0xe000, null],
        ['app', 0x10000, 'sketch.ino.bin'],
      ];
      for (const [name, offset, file] of parts) {
        const p = file ? path.join(d.outDir, file) : bootApp0();
        if (p && fs.existsSync(p)) binaries.push({ name, offset, data: fs.readFileSync(p).toString('base64') });
      }
    }
    return { ok: true, log, ms: Date.now() - started, binaries };
  } finally {
    release(slot);
  }
}

if (process.argv.includes('--warmup')) {
  const code = fs.readFileSync(new URL('./warmup.ino', import.meta.url), 'utf8');
  for (let i = 0; i < SLOTS; i++) {
    const r = await compile(code);
    console.log(`warmup slot ${i}:`, r.ok ? `ok (${r.ms} ms)` : r.log);
    if (!r.ok) process.exit(1);
  }
  process.exit(0);
}

const server = http.createServer(async (req, res) => {
  const send = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, fqbn: FQBN, queue: queue.length });
  if (req.method !== 'POST' || req.url !== '/compile') return send(404, { error: 'not found' });
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > MAX_CODE * 2) req.destroy(); });
  req.on('end', async () => {
    let code;
    try { code = JSON.parse(body).code; } catch { return send(400, { error: 'bad json' }); }
    if (typeof code !== 'string' || !code.trim()) return send(400, { error: 'empty code' });
    if (code.length > MAX_CODE) return send(413, { error: 'code too large' });
    if (unsafeInclude(code)) return send(400, { ok: false, log: 'Запрещён #include с абсолютным путём или "..".' });
    try { send(200, await compile(code)); } catch (e) { send(500, { ok: false, log: String(e) }); }
  });
});
server.listen(PORT, () => console.log(`compiler listening on :${PORT} (${FQBN}, slots=${SLOTS})`));
