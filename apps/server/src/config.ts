import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  jwtSecret: string;
  teacherInvite: string;
  compilerUrl: string;
  mqttWsUrl: string;
  mqttPublicHost: string | null;
  mqttPublicPort: number;
  webDist: string;
  seedDemo: boolean;
  cookieSecure: boolean;
  trustProxy: boolean;
  checkWorkers: number;
  checkTimeoutMs: number;
  logLevel: string;
}

const truthy = (v: string | undefined) => !!v && ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

/** Каталог, в котором лежит этот модуль (src/ в dev, dist/ после сборки). */
function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function loadSecret(dataDir: string, fromEnv: string | undefined): string {
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  const file = path.join(dataDir, 'secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch { /* нет файла — создадим */ }
  const s = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  // пустые значения (например, `VAR=` в docker-compose) считаем незаданными
  const env: Record<string, string | undefined> = Object.fromEntries(Object.entries(rawEnv).filter(([, v]) => v !== undefined && v !== ''));
  const dataDir = path.resolve(overrides.dataDir ?? env.DATA_DIR ?? './data');
  fs.mkdirSync(dataDir, { recursive: true });
  const cpus = os.cpus().length || 2;
  const cfg: Config = {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    jwtSecret: overrides.jwtSecret ?? loadSecret(dataDir, env.JWT_SECRET),
    teacherInvite: env.TEACHER_INVITE ?? 'teacher2025',
    compilerUrl: (env.COMPILER_URL ?? 'http://localhost:8090').replace(/\/+$/, ''),
    mqttWsUrl: env.MQTT_WS_URL ?? 'ws://mosquitto:9001',
    mqttPublicHost: env.MQTT_PUBLIC_HOST || null,
    mqttPublicPort: Number(env.MQTT_PUBLIC_PORT ?? 1883),
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : path.resolve(moduleDir(), '../../web/dist'),
    seedDemo: truthy(env.SEED_DEMO),
    cookieSecure: truthy(env.COOKIE_SECURE),
    trustProxy: truthy(env.TRUST_PROXY),
    checkWorkers: Number(env.CHECK_WORKERS ?? Math.max(1, Math.min(4, cpus - 1))),
    checkTimeoutMs: Number(env.CHECK_TIMEOUT_MS ?? 60_000),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
  return { ...cfg, ...overrides };
}
