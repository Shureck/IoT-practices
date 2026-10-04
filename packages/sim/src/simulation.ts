// Симуляция целиком: компиляция скетча, виртуальная плата, схема, сеть.
import { compileSketch, type CompileOutput } from './lang/compiler';
import { Machine, RestartSignal, type GenFn, type MachineStatus, type PanicInfo } from './runtime/machine';
import { R, Panic } from './runtime/rt';
import { createCore } from './runtime/core';
import { createLibs } from './runtime/libs';
import { createNetLibs, type WebRequest } from './runtime/netlibs';
import { CircuitSim } from './circuit/sim';
import type { CircuitDoc } from './circuit/defs';
import type { HttpResponse, NetAdapter } from './net/types';
import { MockNet } from './net/mock';

export interface SimCallbacks {
  serial?: (port: number, text: string, baud?: number) => void;
  warn?: (msg: string, hint?: string) => void;
  panic?: (info: PanicInfo) => void;
  status?: (s: MachineStatus) => void;
  reboot?: (reason: string) => void;
}

export interface SimOptions {
  code: string;
  circuit: CircuitDoc;
  net?: NetAdapter;
  callbacks?: SimCallbacks;
  /** начальное значение генератора случайных чисел */
  seed?: number;
  nvs?: Map<string, Map<string, unknown>>;
  /** уже скомпилированный результат (чтобы не компилировать дважды) */
  compiled?: CompileOutput;
}

type Program = { init: GenFn; setup: GenFn | null; loop: GenFn | null };
type Factory = (M: Machine, R: unknown, L: unknown, F: unknown) => Program;

export class Simulation {
  compiled: CompileOutput;
  M!: Machine;
  board: CircuitSim;
  net: NetAdapter;
  nvs: Map<string, Map<string, unknown>>;
  private factory: Factory | null = null;
  boots = 0;
  /** накопленный вывод Serial (для проверок) */
  serialLog = '';
  warnings: { msg: string; hint?: string; t: number }[] = [];

  constructor(public opts: SimOptions) {
    this.compiled = opts.compiled ?? compileSketch(opts.code);
    this.net = opts.net ?? new MockNet();
    this.nvs = opts.nvs ?? new Map();
    this.board = new CircuitSim(opts.circuit);
    if (this.compiled.ok && this.compiled.js) {
      // eslint-disable-next-line no-new-func
      this.factory = new Function('M', 'R', 'L', 'F', this.compiled.js) as Factory;
    }
  }

  get ok() { return this.compiled.ok; }

  /** Включить питание: создать машину и запустить программу. */
  boot(startT = 0): boolean {
    if (!this.factory) return false;
    this.boots++;
    const M = new Machine(this.nvs);
    M.t = startT;
    if (this.opts.seed !== undefined) M.rngState = ((this.opts.seed + this.boots * 7919) >>> 0) || 1;
    else M.rngState = (Math.random() * 0xffffffff) >>> 0 || 1;
    M.bootCount = this.boots;
    M.net = this.net;
    const cb = this.opts.callbacks ?? {};
    M.ev = {
      serial: (port: number, text: string, baud?: number) => {
        if (port === 0) this.serialLog = (this.serialLog + text).slice(-200000);
        cb.serial?.(port, text, baud);
      },
      warn: (msg: string, hint?: string) => { this.warnings.push({ msg, hint, t: M.now() }); cb.warn?.(msg, hint); },
      panic: (info: PanicInfo) => cb.panic?.(info),
      status: (s: MachineStatus) => cb.status?.(s),
    };
    M.lib.restart = function* (): Generator<unknown, void, unknown> {
      yield* [];
      throw new RestartSignal('software');
    };
    M.lib.deepSleep = function* (us?: number): Generator<unknown, void, unknown> {
      yield* [];
      throw new RestartSignal('deepsleep', us ?? -1);
    };
    const F = createCore(M);
    const L = { ...createLibs(M, F), ...createNetLibs(M) };
    this.M = M;
    this.board.attach(M);
    let prog: Program;
    try {
      prog = this.factory(M, R, L, F);
    } catch (e) {
      M.crash(e);
      return false;
    }
    M.load(prog);
    return true;
  }

  /** Перезагрузка после ESP.restart() / пробуждения из deep sleep. */
  private checkRestart(): boolean {
    const req = this.M?.restartReq;
    if (!req) return false;
    if (req.reason === 'deepsleep' && req.delayUs < 0) return false; // спит без таймера пробуждения
    const t = this.M.t + (req.reason === 'deepsleep' ? req.delayUs : 300_000);
    this.opts.callbacks?.reboot?.(req.reason);
    this.boot(t);
    return true;
  }

  /** Шаг в реальном времени: dtUs виртуального времени, не дольше budgetMs. */
  advance(dtUs: number, budgetMs = Infinity): ReturnType<Machine['run']> {
    const M = this.M;
    if (!M) return 'stopped';
    const r = M.run(M.t + dtUs, budgetMs);
    if (r === 'stopped') this.checkRestart();
    return r;
  }

  /** Безголовый прогон до момента ms (от включения) — для автопроверки. */
  async runUntil(ms: number, maxRealMs = 20000): Promise<void> {
    const started = Date.now();
    const target = ms * 1000;
    await Promise.resolve();
    for (;;) {
      const M = this.M;
      if (!M) return;
      if (M.status !== 'running') {
        if (this.checkRestart()) continue;
        return;
      }
      if (M.t >= target) return;
      const r = M.run(target, 250);
      if (r === 'async') {
        if (M.pending.size) await Promise.race([...M.pending]);
        else await new Promise((res) => setTimeout(res, 0));
      } else if (r === 'budget') {
        await new Promise((res) => setTimeout(res, 0));
      }
      if (Date.now() - started > maxRealMs) throw new Panic('Timeout', 'Симуляция заняла слишком много времени');
    }
  }

  /** Отправить текст в Serial (как из монитора порта). */
  serialInput(text: string, port = 0) {
    const s = (this.M?.lib.serials as { receive(b: number[]): void }[] | undefined)?.[port];
    s?.receive(Array.from(new TextEncoder().encode(text)));
  }

  /** Запрос к веб-серверу ESP32 (вкладка «Браузер»). */
  webRequest(method: string, path: string, query: Record<string, string> = {}, body = '', timeoutMs = 8000): Promise<HttpResponse> {
    const M = this.M;
    return new Promise((resolve) => {
      if (!M || !M.lib.webServer) {
        resolve({ status: 0, headers: {}, body: 'Веб-сервер на ESP32 не запущен (server.begin())' });
        return;
      }
      const wifi = M.lib.wifi as { st: number; apOn: boolean } | undefined;
      if (!wifi || (wifi.st !== 3 && !wifi.apOn)) {
        resolve({ status: 0, headers: {}, body: 'ESP32 не подключён к Wi-Fi' });
        return;
      }
      const q = (M.lib.webQueue as WebRequest[] | undefined) ?? [];
      M.lib.webQueue = q;
      M.lib.webClients = 1;
      const req: WebRequest = { method, path, query, body, resolve };
      q.push(req);
      if (timeoutMs > 0) {
        setTimeout(() => {
          const i = q.indexOf(req);
          if (i >= 0) { q.splice(i, 1); resolve({ status: 0, headers: {}, body: 'Тайм-аут: ESP32 не вызывает server.handleClient()' }); }
        }, timeoutMs);
      }
    });
  }

  stop() {
    if (this.M) this.M.setStatus('halted');
  }
}
