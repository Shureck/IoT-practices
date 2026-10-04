// Виртуальный ESP32: планировщик задач, виртуальное время, GPIO, прерывания.
import { Panic, R, setPanicLine } from './rt';
import type { NetAdapter } from '../net/types';

/** Стоимость одной «операции» (обратного перехода цикла) в мкс. */
export const US_PER_OP = 0.25;
/** Накладные расходы одного вызова loop() в операциях (≈10 мкс). */
const LOOP_OVERHEAD = 40;

export type GenFn = (...args: unknown[]) => Generator<unknown, unknown, unknown>;

export interface Task {
  id: number;
  name: string;
  gen: Generator<unknown, unknown, unknown>;
  prio: number;
  wake: number;
  state: 'ready' | 'sleep' | 'wait' | 'done' | 'suspended';
  result?: unknown;
  error?: unknown;
  handle: TaskHandle;
  notify: number;
}

export class TaskHandle {
  constructor(public task: Task | null) {}
}

export interface TimedEvent {
  t: number;
  fn: () => void;
  id: number;
}

export interface PwmState {
  freq: number;
  /** доля заполнения 0..1 */
  duty: number;
  /** тон (для пищалок) */
  tone?: boolean;
}

export interface GpioState {
  mode: number;
  out: number;
  pwm: PwmState | null;
  /** «аналоговый» выход ЦАП (В) */
  dac: number | null;
  isr: { fn: GenFn; mode: number; arg?: unknown } | null;
  /** последнее прочитанное схемой значение (для фронтов) */
  lastLevel: number;
}

export interface MachineEvents {
  serial?: (port: number, text: string, baud?: number) => void;
  warn?: (msg: string, hint?: string) => void;
  panic?: (info: PanicInfo) => void;
  status?: (s: MachineStatus) => void;
  restart?: () => void;
}

export interface PanicInfo {
  kind: string;
  message: string;
  hint?: string;
  line: number;
  time: number;
}

export type MachineStatus = 'idle' | 'running' | 'crashed' | 'halted' | 'sleeping';

/** Интерфейс к схеме (реализуется CircuitSim). */
export interface Board {
  /** изменилось состояние выводов микроконтроллера */
  gpioChanged(pin: number): void;
  readDigital(pin: number): number;
  readVoltage(pin: number): number;
  isFloating(pin: number): boolean;
  /** найти модель устройства, подключённую к GPIO через указанный вывод */
  deviceAt<T>(type: string | string[], pinName: string, gpio: number): T | null;
  /** устройства I²C на шине (по выводам SDA/SCL) */
  i2cDevices(sda: number, scl: number): Map<number, I2CDevice>;
  /** вызов после каждого кванта выполнения */
  tick(t: number): void;
  /** запись «осциллограммы» вывода для логического анализатора */
  logBits(gpio: number, events: [number, number][]): void;
  /** UART: байты, переданные ESP32 по выводу TX */
  uartTx(txPin: number, bytes: number[], baud: number): void;
  hasAnalyzer: boolean;
}

export interface I2CDevice {
  address: number;
  write(bytes: number[]): void;
  read(n: number): number[];
  model: unknown;
}

let taskIdSeq = 1;
let eventSeq = 1;

export class Machine {
  t = 0;
  ops = 0;
  L = 0;
  tasks: Task[] = [];
  cur: Task | null = null;
  inIsr = false;
  events: TimedEvent[] = [];
  gpio: GpioState[] = Array.from({ length: 40 }, () => ({ mode: 0, out: 0, pwm: null, dac: null, isr: null, lastLevel: -1 }));
  pendingIsr: { fn: GenFn; arg?: unknown }[] = [];
  interruptsEnabled = true;
  status: MachineStatus = 'idle';
  panicInfo: PanicInfo | null = null;
  board: Board | null = null;
  net: NetAdapter | null = null;
  ev: MachineEvents = {};
  warned = new Set<string>();
  /** энергонезависимая память Preferences (переживает перезагрузку) */
  nvs: Map<string, Map<string, unknown>>;
  /** состояние для библиотек */
  lib: Record<string, unknown> = {};
  rngState = 0x2545f491;
  bootCount = 0;
  /** время последнего вызова loop (для статистики) */
  loopCount = 0;
  private rr = 0;
  wifiOn = false;
  /** незавершённые сетевые операции (для безголового прогона) */
  pending = new Set<Promise<unknown>>();
  /** запрошена перезагрузка (ESP.restart, deep sleep) */
  restartReq: RestartSignal | null = null;

  constructor(nvs?: Map<string, Map<string, unknown>>) {
    this.nvs = nvs ?? new Map();
  }

  // ---------- время ----------
  /** текущее время с учётом выполненных операций, мкс */
  now(): number { return this.t + this.ops * US_PER_OP; }

  flushOps(): void {
    if (this.ops) {
      this.t += this.ops * US_PER_OP;
      this.ops = 0;
    }
  }

  /** Запланировать событие на виртуальное время t (мкс). */
  schedule(t: number, fn: () => void): number {
    const id = eventSeq++;
    const ev = { t, fn, id };
    // вставка с сохранением порядка
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].t > t) i--;
    this.events.splice(i, 0, ev);
    return id;
  }

  cancel(id: number): void {
    const i = this.events.findIndex((e) => e.id === id);
    if (i >= 0) this.events.splice(i, 1);
  }

  // ---------- случайные числа ----------
  rand(): number {
    // xorshift32
    let x = this.rngState;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.rngState = x;
    return x / 4294967296;
  }

  // ---------- задачи ----------
  spawn(name: string, gen: Generator<unknown, unknown, unknown>, prio = 1): Task {
    const handle = new TaskHandle(null);
    const task: Task = { id: taskIdSeq++, name, gen, prio, wake: this.now(), state: 'ready', handle, notify: 0 };
    handle.task = task;
    this.tasks.push(task);
    return task;
  }

  /** Блокирующее ожидание: delay() и т.п. — вызывать через yield*. */
  *sleep(us: number): Generator<unknown, void, unknown> {
    if (this.inIsr) {
      this.warnOnce('isr-delay', 'delay() внутри обработчика прерывания не работает', 'В прерывании нельзя ждать — установите флаг и обработайте его в loop()');
      return;
    }
    this.flushOps();
    const task = this.cur!;
    task.wake = this.t + Math.max(0, us);
    task.state = 'sleep';
    yield 1;
  }

  /** Ожидание промиса (сеть) — вызывать через yield*. */
  *await<T>(p: Promise<T>): Generator<unknown, T, unknown> {
    if (this.inIsr) throw new Panic('IllegalInstruction', 'Сетевые операции нельзя выполнять в прерывании');
    const task = this.cur!;
    task.state = 'wait';
    const tracked = p.then(() => undefined, () => undefined);
    this.pending.add(tracked);
    tracked.then(() => this.pending.delete(tracked));
    p.then(
      (v) => { task.result = v; if (task.state === 'wait') { task.state = 'ready'; task.wake = this.t; } },
      (e) => { task.error = e; if (task.state === 'wait') { task.state = 'ready'; task.wake = this.t; } },
    );
    yield 2;
    if (task.error) {
      const e = task.error;
      task.error = undefined;
      throw e;
    }
    return task.result as T;
  }

  /** Передать управление другим задачам (без задержки). */
  *yieldNow(): Generator<unknown, void, unknown> {
    if (this.inIsr) return;
    this.flushOps();
    yield 0;
  }

  // ---------- прерывания ----------
  raiseIsr(fn: GenFn, arg?: unknown): void {
    this.pendingIsr.push({ fn, arg });
  }

  runIsrs(): void {
    if (!this.interruptsEnabled || this.inIsr) return;
    let guard = 0;
    while (this.pendingIsr.length && guard++ < 1000) {
      const { fn, arg } = this.pendingIsr.shift()!;
      this.runSync(fn, arg === undefined ? [] : [arg], 'прерывание');
    }
  }

  /** Выполнить генератор синхронно до конца (обработчики прерываний, таймеров). */
  runSync(fn: GenFn, args: unknown[], what: string): void {
    const saved = this.cur;
    const savedL = this.L;
    this.inIsr = true;
    const startOps = this.ops;
    try {
      const g = fn(...args);
      for (let i = 0; ; i++) {
        const r = g.next();
        if (r.done) break;
        if (this.ops - startOps > 4_000_000 || i > 100000) {
          throw new Panic('Interrupt wdt timeout on CPU1', `Обработчик (${what}) выполняется слишком долго`, 'Обработчик прерывания должен быть очень коротким');
        }
      }
    } finally {
      this.inIsr = false;
      this.cur = saved;
      if (saved) this.L = savedL;
    }
  }

  // ---------- запуск программы ----------
  load(program: { init: GenFn; setup: GenFn | null; loop: GenFn | null }): void {
    const self = this;
    const main = function* (): Generator<unknown, unknown, unknown> {
      yield* program.init();
      if (program.setup) yield* program.setup();
      if (!program.loop) return;
      for (;;) {
        yield* program.loop();
        self.loopCount++;
        self.ops += LOOP_OVERHEAD;
        if (self.ops > 4096) yield 0;
      }
    };
    this.spawn('loopTask', main(), 1);
    this.setStatus('running');
  }

  setStatus(s: MachineStatus): void {
    this.status = s;
    this.ev.status?.(s);
  }

  /**
   * Выполнять до виртуального времени `until` (мкс) или пока не истечёт
   * бюджет реального времени. Возвращает причину остановки.
   */
  run(until: number, budgetMs = Infinity): 'until' | 'budget' | 'async' | 'stopped' {
    if (this.status !== 'running') return 'stopped';
    const deadline = budgetMs === Infinity ? Infinity : performance.now() + budgetMs;
    let iter = 0;
    try {
      for (;;) {
        // события по времени (таймеры, эхо дальномера, дребезг…)
        while (this.events.length && this.events[0].t <= this.t) {
          const ev = this.events.shift()!;
          ev.fn();
          if (this.status !== 'running') return 'stopped';
        }
        this.runIsrs();
        if (this.status !== 'running') return 'stopped';
        const task = this.pick();
        if (!task) {
          // все спят или ждут сеть
          let next = Infinity;
          for (const tk of this.tasks) if (tk.state === 'sleep' && tk.wake < next) next = tk.wake;
          if (this.events.length && this.events[0].t < next) next = this.events[0].t;
          const waiting = this.tasks.some((tk) => tk.state === 'wait');
          if (next === Infinity) {
            if (waiting) return 'async';
            if (!this.tasks.some((tk) => tk.state !== 'done')) { this.t = Math.max(this.t, until); return 'until'; }
            // только приостановленные задачи
            this.t = Math.max(this.t, until);
            return 'until';
          }
          if (next > until) {
            if (waiting && budgetMs === Infinity) return 'async';
            this.t = Math.max(this.t, until);
            this.board?.tick(this.t);
            return 'until';
          }
          this.t = Math.max(this.t, next);
          for (const tk of this.tasks) if (tk.state === 'sleep' && tk.wake <= this.t) tk.state = 'ready';
          continue;
        }
        if (this.t >= until) {
          this.board?.tick(this.t);
          return 'until';
        }
        this.cur = task;
        const r = task.gen.next();
        this.flushOps();
        this.cur = null;
        if (r.done) {
          task.state = 'done';
          if (task.name === 'loopTask') {
            // setup() без loop()
          }
        } else if (r.value === 0 && task.state === 'ready') {
          task.wake = this.t;
        }
        this.board?.tick(this.t);
        if ((++iter & 63) === 0 && performance.now() > deadline) return 'budget';
      }
    } catch (e) {
      this.crash(e);
      return 'stopped';
    }
  }

  private pick(): Task | null {
    let best: Task | null = null;
    const n = this.tasks.length;
    for (let k = 0; k < n; k++) {
      const tk = this.tasks[(this.rr + k) % n];
      if (tk.state === 'sleep' && tk.wake <= this.t) tk.state = 'ready';
      if (tk.state !== 'ready') continue;
      if (!best || tk.prio > best.prio) best = tk;
    }
    if (best) this.rr = (this.tasks.indexOf(best) + 1) % Math.max(1, n);
    return best;
  }

  // ---------- аварии ----------
  crash(e: unknown): void {
    let info: PanicInfo;
    if (e instanceof RestartSignal) {
      this.restartReq = e;
      this.ev.serial?.(0, e.reason === 'deepsleep' ? '\r\nENTERING DEEP SLEEP\r\n' : '\r\nRebooting...\r\n');
      this.setStatus('halted');
      return;
    }
    if (e instanceof Panic) {
      info = { kind: e.kind, message: e.message, hint: e.hint, line: this.L, time: this.t };
    } else if (e instanceof RangeError && /call stack/i.test(e.message)) {
      info = { kind: 'Stack overflow', message: 'Переполнение стека — вероятно, бесконечная рекурсия', hint: 'Функция вызывает сама себя без условия выхода', line: this.L, time: this.t };
    } else if (e instanceof TypeError) {
      info = { kind: 'LoadProhibited', message: 'Обращение к несуществующему объекту (нулевой указатель)', hint: e.message, line: this.L, time: this.t };
    } else if (e instanceof HaltSignal) {
      this.setStatus('halted');
      return;
    } else {
      info = { kind: 'Error', message: String((e as Error)?.message ?? e), line: this.L, time: this.t };
    }
    setPanicLine(this.L);
    this.panicInfo = info;
    const text = `\r\nGuru Meditation Error: Core  1 panic'ed (${info.kind}). Exception was unhandled.\r\n` +
      `  → ${info.message} (строка ${info.line})\r\n\r\nRebooting...\r\n`;
    this.ev.serial?.(0, text);
    this.setStatus('crashed');
    this.ev.panic?.(info);
  }

  warnOnce(key: string, msg: string, hint?: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.ev.warn?.(msg, hint);
  }

  halt(): void {
    this.setStatus('halted');
  }
}

/** Сигнал перезагрузки платы. delayUs — через сколько включиться (deep sleep). */
export class RestartSignal extends Error {
  constructor(public reason: 'software' | 'deepsleep', public delayUs = 0) { super(reason); }
}

/** Сигнал «остановить программу» (ESP.restart в тестах, deep sleep без пробуждения). */
export class HaltSignal extends Error {}

export { R };
