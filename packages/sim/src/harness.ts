// Автопроверка практик: прогон скетча в безголовом режиме и проверки.
import { Simulation } from './simulation';
import type { CircuitDoc, Part } from './circuit/defs';
import { DEFS, propValue } from './circuit/defs';
import type { Model } from './circuit/sim';
import { MockNet, type MockNetOptions } from './net/mock';
import { compileSketch, type CompileOutput } from './lang/compiler';
import type { HttpRequest, HttpResponse } from './net/types';
import { topicMatches } from './net/broker';

export class CheckFail extends Error {}

export interface CheckSpec {
  id: string;
  /** что проверяем — видно студенту */
  title: string;
  run: (h: CheckContext) => Promise<void>;
  /** ограничение реального времени на проверку, мс */
  timeoutMs?: number;
}

export interface CheckResult {
  id: string;
  title: string;
  ok: boolean;
  message?: string;
}

export interface Transition { t: number; v: number }

export interface HarnessOptions {
  net?: MockNetOptions;
  seed?: number;
  /** общий бюджет реального времени на все проверки, мс (сервер обрывает проверку целиком позже) */
  budgetMs?: number;
  /**
   * Схемы-образцы (эталон, стартовая): перед каждой проверкой «живые» ручки датчиков
   * (освещённость, потенциометр, температура…) ставятся как в них — а не там, где студент
   * оставил их, пока отлаживал. Детали, которых в образцах нет, — в значение по умолчанию.
   */
  baseline?: (CircuitDoc | null | undefined)[];
}

/** «Чёрные ящики»: их настройки — загадка задания, а не выбор студента. */
export const TASK_DEVICES = ['uartbox', 'i2cbox'];

/**
 * Вернуть входы схемы в исходное положение (см. HarnessOptions.baseline): «живые» ручки датчиков,
 * а у «чёрных ящиков» из задания — все настройки.
 */
export function resetLiveProps(circuit: CircuitDoc, baseline: (CircuitDoc | null | undefined)[]): CircuitDoc {
  const out = structuredClone(circuit);
  for (const p of out.parts) {
    const ref = baseline.map((b) => b?.parts.find((x) => x.id === p.id && x.type === p.type)).find(Boolean);
    const live = (DEFS[p.type]?.props ?? []).filter((d) => d.live || (ref && TASK_DEVICES.includes(p.type)));
    if (!live.length) continue;
    for (const d of live) {
      const v = ref ? propValue(ref, d.key) : d.default;
      if (v === undefined || v === d.default) delete p.props[d.key]; else p.props[d.key] = v;
    }
  }
  return out;
}

/** История переключений одного вывода: время (мс) и уровень ×2 (0, 1 — ШИМ, 2). */
class PinLog {
  t = new Float64Array(64);
  v = new Uint8Array(64);
  n = 0;
  /** всего переключений (с отброшенными) */
  total = 0;
  push(t: number, v: number) {
    if (this.n === this.t.length) {
      if (this.n >= PINLOG_MAX) {
        // «шторм» переключений: старая половина истории проверкам уже не нужна
        const half = this.n >> 1;
        this.t.copyWithin(0, half);
        this.v.copyWithin(0, half);
        this.n -= half;
      } else {
        const t2 = new Float64Array(this.n * 2); t2.set(this.t); this.t = t2;
        const v2 = new Uint8Array(this.n * 2); v2.set(this.v); this.v = v2;
      }
    }
    this.t[this.n] = t;
    this.v[this.n] = Math.round(v * 2);
    this.n++;
    this.total++;
  }
  lastV(): number { return this.v[this.n - 1] / 2; }
  /** первый индекс с t ≥ x (strict: t > x) */
  lower(x: number, strict = false): number {
    let lo = 0;
    let hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (strict ? this.t[mid] <= x : this.t[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
}
const PINLOG_MAX = 1 << 21;

/** Контекст одной проверки. Все времена — в миллисекундах виртуального времени. */
export class CheckContext {
  sim: Simulation;
  net: MockNet;
  private hist = new Map<number, PinLog>();

  constructor(public code: string, public circuit: CircuitDoc, compiled: CompileOutput, opts: HarnessOptions) {
    this.net = new MockNet({ ...opts.net, now: () => new Date(Date.UTC(2025, 9, 15, 9, 0, 0) + (this.sim?.M?.now() ?? 0) / 1000) });
    const doc = opts.baseline ? resetLiveProps(circuit, opts.baseline) : structuredClone(circuit);
    this.sim = new Simulation({ code, circuit: doc, net: this.net, compiled, seed: opts.seed ?? 12345 });
    const board = this.sim.board;
    const orig = board.gpioChanged.bind(board);
    board.gpioChanged = (pin: number) => {
      orig(pin);
      this.record(pin);
    };
    this.sim.boot();
    for (let p = 0; p < 40; p++) { const l = new PinLog(); l.push(0, 0); l.total = 0; this.hist.set(p, l); }
  }

  private level(pin: number): number {
    const g = this.sim.M.gpio[pin];
    if (g.mode !== 3 && g.mode !== 19) return 0;
    if (g.pwm) return g.pwm.duty > 0 ? (g.pwm.duty >= 0.999 ? 1 : 0.5) : 0;
    return g.out;
  }

  private record(pin: number) {
    const log = this.hist.get(pin)!;
    const v = this.level(pin);
    if (log.lastV() !== v) log.push(this.sim.M.now() / 1000, v);
  }

  /** Вывод, который переключается чаще всех: [gpio, переключений в секунду виртуального времени]. */
  busiestPin(): [number, number] | null {
    let best: [number, number] | null = null;
    const secs = Math.max(0.001, this.now / 1000);
    for (const [pin, log] of this.hist) {
      const rate = log.total / secs;
      if (!best || rate > best[1]) best = [pin, rate];
    }
    return best;
  }

  // ---------- время ----------
  get now(): number { return this.sim.M.now() / 1000; }

  /** Прогнать симуляцию ещё на ms миллисекунд. */
  async wait(ms: number): Promise<void> {
    await this.sim.runUntil(this.now + ms);
    this.assertAlive();
  }

  /** Прогнать до абсолютного момента ms. */
  async until(ms: number): Promise<void> {
    if (ms > this.now) await this.sim.runUntil(ms);
    this.assertAlive();
  }

  /** Ждать условия (проверяя каждые step мс), не дольше limit мс. */
  async waitFor(cond: () => boolean, limit: number, step = 10): Promise<boolean> {
    const end = this.now + limit;
    while (this.now < end) {
      if (cond()) return true;
      await this.wait(step);
    }
    return cond();
  }

  assertAlive() {
    const M = this.sim.M;
    if (M.status === 'crashed' && M.panicInfo) {
      throw new CheckFail(`Программа аварийно остановилась: ${M.panicInfo.message} (строка ${M.panicInfo.line})`);
    }
  }

  // ---------- Serial ----------
  get serial(): string { return this.sim.serialLog; }
  serialLines(): string[] { return this.sim.serialLog.split(/\r?\n/).map((s) => s.trim()).filter(Boolean); }
  /** Вывод после момента — удобно: const mark = h.mark(); … h.serialSince(mark) */
  mark(): number { return this.sim.serialDropped + this.sim.serialLog.length; }
  serialSince(mark: number): string { return this.sim.serialLog.slice(Math.max(0, mark - this.sim.serialDropped)); }
  send(text: string) { this.sim.serialInput(text); }
  /** Числа, напечатанные в Serial (все подряд). */
  numbers(text = this.serial): number[] {
    return (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  }

  // ---------- выводы ----------
  gpio(pin: number) {
    const g = this.sim.M.gpio[pin];
    return {
      mode: g.mode,
      out: g.out,
      isOutput: g.mode === 3 || g.mode === 19,
      pwm: g.pwm,
      level: this.level(pin),
      voltage: this.sim.board.readVoltage(pin),
    };
  }
  /** История переключений выхода GPIO: [{t (мс), v}] */
  history(pin: number, from = 0, to = Infinity): Transition[] {
    const log = this.hist.get(pin);
    if (!log) return [];
    const out: Transition[] = [];
    for (let i = log.lower(from), end = log.lower(to, true); i < end; i++) out.push({ t: log.t[i], v: log.v[i] / 2 });
    return out;
  }
  /** Число переключений за интервал. */
  toggles(pin: number, from: number, to: number): number {
    const log = this.hist.get(pin);
    if (!log) return 0;
    const i = log.lower(from);
    const n = log.lower(to, true) - i;
    return n > 0 && log.t[i] === 0 ? n - 1 : n;
  }
  /** Средний период мигания (мс) по фронтам 0→1 в интервале. */
  period(pin: number, from: number, to: number): number | null {
    const rises = this.history(pin, from, to).filter((x, i, arr) => x.v > 0 && (i === 0 ? false : arr[i - 1].v === 0)).map((x) => x.t);
    if (rises.length < 2) return null;
    return (rises[rises.length - 1] - rises[0]) / (rises.length - 1);
  }
  /** Доля времени во включённом состоянии в интервале. */
  dutyOver(pin: number, from: number, to: number): number {
    const log = this.hist.get(pin);
    if (!log) return 0;
    let on = 0;
    let lastT = from;
    let i = log.lower(from, true);
    let lastV = i > 0 ? log.v[i - 1] / 2 : 0;
    for (; i < log.n && log.t[i] < to; i++) {
      on += lastV * (log.t[i] - lastT);
      lastT = log.t[i];
      lastV = log.v[i] / 2;
    }
    on += lastV * (to - lastT);
    return on / (to - from);
  }

  // ---------- компоненты ----------
  part(id: string): Part {
    const p = this.sim.board.doc.parts.find((x) => x.id === id);
    if (!p) throw new CheckFail(`На схеме нет компонента «${id}»`);
    return p;
  }
  model<T = Model>(id: string): T {
    const m = this.sim.board.models.get(id);
    if (!m) throw new CheckFail(`На схеме нет компонента «${id}»`);
    return m as unknown as T;
  }
  find(type: string, filter: Record<string, unknown> = {}): Part[] {
    return this.sim.board.doc.parts.filter((p) => p.type === type && Object.entries(filter).every(([k, v]) => propValue(p, k) === v));
  }
  findOne(type: string, filter: Record<string, unknown> = {}, what?: string): Part {
    const list = this.find(type, filter);
    if (!list.length) throw new CheckFail(`На схеме не найден компонент: ${what ?? type}`);
    return list[0];
  }
  /** GPIO, подключённые к выводу компонента напрямую. */
  gpioAt(partId: string, pin: string): number[] { return this.sim.board.gpiosAt(partId, pin); }
  /** GPIO, подключённые напрямую или через один резистор. */
  gpioNear(partId: string, pin: string): number[] { return this.sim.board.gpiosNear(partId, pin); }
  /** Вывод компонента соединён с GND платы? */
  onGnd(partId: string, pin: string, viaResistor = false): boolean {
    const b = this.sim.board;
    const n = b.netOf(partId, pin);
    if (n === b.gnd) return true;
    return viaResistor && (b.neighbors.get(n) ?? []).includes(b.gnd);
  }
  onNet(partId: string, pin: string, target: '3V3' | 'VIN' | 'GND'): boolean {
    const b = this.sim.board;
    const n = b.netOf(partId, pin);
    return n >= 0 && n === (target === '3V3' ? b.v33 : target === 'VIN' ? b.vin : b.gnd);
  }

  /** Яркость светодиода сейчас (0…1). */
  led(id: string): number {
    const m = this.model<{ bright: { value: number }; burnt: boolean }>(id);
    return m.burnt ? 0 : m.bright.value;
  }
  ledOn(id: string): boolean { return this.led(id) > 0.05; }
  rgb(id: string): [number, number, number] {
    const m = this.model<{ br: { value: number }[] }>(id);
    return [m.br[0].value, m.br[1].value, m.br[2].value];
  }

  async press(id: string, holdMs = 200): Promise<void> {
    const m = this.model<{ press(on: boolean): void }>(id);
    m.press(true);
    await this.wait(holdMs);
    m.press(false);
  }
  hold(id: string, on: boolean) { this.model<{ press(on: boolean): void }>(id).press(on); }
  set(id: string, prop: string, value: string | number | boolean) {
    this.model<{ setProp(k: string, v: string | number | boolean): void }>(id).setProp(prop, value);
  }
  motion(id: string) { this.model<{ trigger(): void }>(id).trigger(); }

  servoAngle(id: string): number { return this.model<{ angle: number; target: number }>(id).target; }
  relayOn(id: string): boolean { return this.model<{ on: boolean }>(id).on; }
  lcd(id: string): string[] { return this.model<{ lines(): string[] }>(id).lines().map((l) => l.replace(/\s+$/, '')); }
  lcdText(id: string): string { return this.lcd(id).join('\n'); }
  buzzerFreq(id: string): number { return this.model<{ freq: number }>(id).freq; }
  loadLevel(id: string): number { return this.model<{ level: { value: number } }>(id).level.value; }
  neo(id: string): number[] { return this.model<{ colors: number[] }>(id).colors; }
  oledPixels(id: string): number { return this.model<{ buf: Uint8Array }>(id).buf.reduce((a, b) => a + b, 0); }

  // ---------- сеть ----------
  get requests(): HttpRequest[] { return this.net.requests; }
  chatSay(room: string, sender: string, text: string) { this.net.chat.send(room, sender, text); }
  chatMessages(room: string) { return this.net.chat.list(room, 0, 200); }
  mqttPublish(topic: string, payload: string, retain = false) {
    this.net.broker.publish(topic, new TextEncoder().encode(payload), retain, 'checker');
  }
  mqttLog(filter = '#') { return this.net.broker.log.filter((m) => m.from !== 'checker' && topicMatches(filter, m.topic)); }
  mqttConnected(): string[] { return [...this.net.broker.clients.keys()]; }
  get retained() { return this.net.broker.retained; }

  /** Запрос к веб-серверу ESP32, пока симуляция идёт. */
  async web(path: string, method = 'GET', query: Record<string, string> = {}, body = ''): Promise<HttpResponse> {
    let done = false;
    let res: HttpResponse = { status: 0, headers: {}, body: '' };
    const p = this.sim.webRequest(method, path, query, body, 0).then((r) => { done = true; res = r; });
    const end = this.now + 5000;
    while (!done && this.now < end) {
      await this.wait(20);
      await Promise.resolve();
    }
    await Promise.race([p, Promise.resolve()]);
    if (!done) return { status: 0, headers: {}, body: 'timeout' };
    return res;
  }

  warnings(): string[] { return this.sim.warnings.map((w) => w.msg); }

  // ---------- утверждения ----------
  expect(cond: unknown, message: string): void {
    if (!cond) throw new CheckFail(message);
  }
  fail(message: string): never { throw new CheckFail(message); }
  near(actual: number, expected: number, tol: number) { return Math.abs(actual - expected) <= tol; }
}

export class Harness {
  static async run(code: string, circuit: CircuitDoc, checks: CheckSpec[], opts: HarnessOptions = {}): Promise<{ compile: CompileOutput; results: CheckResult[] }> {
    const compile = compileSketch(code);
    if (!compile.ok) {
      return { compile, results: checks.map((c) => ({ id: c.id, title: c.title, ok: false, message: 'Скетч не компилируется' })) };
    }
    const results: CheckResult[] = [];
    const started = Date.now();
    const budget = opts.budgetMs ?? Infinity;
    for (let k = 0; k < checks.length; k++) {
      const c = checks[k];
      // следующим проверкам оставляем по MIN_CHECK_MS (но не больше, чем им досталось бы поровну)
      const left = budget - (Date.now() - started);
      const later = checks.length - k - 1;
      const own = c.timeoutMs ?? 20000;
      const limit = Math.min(own, Math.max(left / (later + 1), left - later * MIN_CHECK_MS));
      if (limit < Math.min(own, 1000)) {
        results.push({ id: c.id, title: c.title, ok: false, message: 'Не проверено: предыдущие проверки исчерпали время. Сначала разберитесь с ними — скорее всего, программа слишком «тяжёлая» для симулятора' });
        continue;
      }
      let ctx: CheckContext | null = null;
      try {
        ctx = new CheckContext(code, circuit, compile, opts);
        const cx = ctx;
        // срок проверяется внутри симуляции (runUntil), таймер — запасной вариант для зависших проверок
        cx.sim.deadline = Date.now() + limit;
        cx.sim.deadlineError = () => new CheckFail(slowMessage(cx));
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          c.run(cx),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new CheckFail(slowMessage(cx))), limit + 1000); }),
        ]).finally(() => clearTimeout(timer));
        ctx.assertAlive();
        results.push({ id: c.id, title: c.title, ok: true });
      } catch (e) {
        let message = e instanceof CheckFail ? e.message : `Ошибка проверки: ${(e as Error)?.message ?? e}`;
        const panic = ctx?.sim.M?.panicInfo;
        if (!(e instanceof CheckFail) && panic) message = `Программа аварийно остановилась: ${panic.message} (строка ${panic.line})`;
        results.push({ id: c.id, title: c.title, ok: false, message });
      } finally {
        // если проверка ещё «доедает» время в фоне — остановить её
        if (ctx) { ctx.sim.deadline = 0; ctx.sim.stop(); }
      }
    }
    return { compile, results };
  }
}

/** Минимум реального времени, оставляемый на каждую проверку при общем бюджете, мс. */
const MIN_CHECK_MS = 3000;

/** Почему проверка не уложилась во время: самые частые причины — понятным языком. */
export function slowMessage(cx: CheckContext): string {
  const head = 'Проверка не уложилась во время';
  const secs = Math.max(0.001, cx.now / 1000);
  const busy = cx.busiestPin();
  if (busy && busy[1] > 2000) {
    return `${head}: вывод GPIO${busy[0]} переключается ${Math.round(busy[1]).toLocaleString('ru-RU')} раз в секунду. ` +
      'Похоже, за один проход loop() на него записываются разные значения (пропущен break в switch, два условия срабатывают одновременно, ' +
      'digitalWrite(…, HIGH) и сразу digitalWrite(…, LOW)). Каждый сигнал должен включаться в одном месте программы';
  }
  const chars = cx.sim.serialDropped + cx.sim.serialLog.length;
  if (chars / secs > 3000) {
    return `${head}: программа без остановки печатает в Serial (${Math.round(chars / secs).toLocaleString('ru-RU')} символов в секунду). ` +
      'Печатайте только при событии (например, когда значение изменилось) или не чаще нескольких раз в секунду';
  }
  return `${head}: симуляция идёт слишком медленно. Частая причина — loop() крутится без паузы и каждый раз делает лишнюю работу; ` +
    'добавьте в конец loop() небольшую паузу, например delay(10)';
}

export type { HttpResponse };
