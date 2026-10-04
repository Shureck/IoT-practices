// Автопроверка практик: прогон скетча в безголовом режиме и проверки.
import { Simulation } from './simulation';
import type { CircuitDoc, Part } from './circuit/defs';
import { propValue } from './circuit/defs';
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
}

/** Контекст одной проверки. Все времена — в миллисекундах виртуального времени. */
export class CheckContext {
  sim: Simulation;
  net: MockNet;
  private hist = new Map<number, Transition[]>();

  constructor(public code: string, public circuit: CircuitDoc, compiled: CompileOutput, opts: HarnessOptions) {
    this.net = new MockNet({ ...opts.net, now: () => new Date(Date.UTC(2025, 9, 15, 9, 0, 0) + (this.sim?.M?.now() ?? 0) / 1000) });
    this.sim = new Simulation({ code, circuit: structuredClone(circuit), net: this.net, compiled, seed: opts.seed ?? 12345 });
    const board = this.sim.board;
    const orig = board.gpioChanged.bind(board);
    board.gpioChanged = (pin: number) => {
      orig(pin);
      this.record(pin);
    };
    this.sim.boot();
    for (let p = 0; p < 40; p++) this.hist.set(p, [{ t: 0, v: 0 }]);
  }

  private level(pin: number): number {
    const g = this.sim.M.gpio[pin];
    if (g.mode !== 3 && g.mode !== 19) return 0;
    if (g.pwm) return g.pwm.duty > 0 ? (g.pwm.duty >= 0.999 ? 1 : 0.5) : 0;
    return g.out;
  }

  private record(pin: number) {
    const arr = this.hist.get(pin)!;
    const v = this.level(pin);
    const t = this.sim.M.now() / 1000;
    if (arr[arr.length - 1].v !== v) arr.push({ t, v });
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
  mark(): number { return this.sim.serialLog.length; }
  serialSince(mark: number): string { return this.sim.serialLog.slice(mark); }
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
    return (this.hist.get(pin) ?? []).filter((x) => x.t >= from && x.t <= to);
  }
  /** Число переключений за интервал. */
  toggles(pin: number, from: number, to: number): number {
    return this.history(pin, from, to).length - (this.history(pin, from, to)[0]?.t === 0 ? 1 : 0);
  }
  /** Средний период мигания (мс) по фронтам 0→1 в интервале. */
  period(pin: number, from: number, to: number): number | null {
    const rises = this.history(pin, from, to).filter((x, i, arr) => x.v > 0 && (i === 0 ? false : arr[i - 1].v === 0)).map((x) => x.t);
    if (rises.length < 2) return null;
    return (rises[rises.length - 1] - rises[0]) / (rises.length - 1);
  }
  /** Доля времени во включённом состоянии в интервале. */
  dutyOver(pin: number, from: number, to: number): number {
    const all = this.hist.get(pin) ?? [];
    let on = 0;
    let lastT = from;
    let lastV = 0;
    for (const x of all) {
      if (x.t <= from) { lastV = x.v; continue; }
      if (x.t >= to) break;
      on += lastV * (x.t - lastT);
      lastT = x.t;
      lastV = x.v;
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
    for (const c of checks) {
      let ctx: CheckContext | null = null;
      try {
        ctx = new CheckContext(code, circuit, compile, opts);
        const limit = c.timeoutMs ?? 20000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          c.run(ctx),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new CheckFail('Проверка заняла слишком много времени')), limit); }),
        ]).finally(() => clearTimeout(timer));
        ctx.assertAlive();
        results.push({ id: c.id, title: c.title, ok: true });
      } catch (e) {
        let message = e instanceof CheckFail ? e.message : `Ошибка проверки: ${(e as Error)?.message ?? e}`;
        const panic = ctx?.sim.M?.panicInfo;
        if (!(e instanceof CheckFail) && panic) message = `Программа аварийно остановилась: ${panic.message} (строка ${panic.line})`;
        results.push({ id: c.id, title: c.title, ok: false, message });
      }
    }
    return { compile, results };
  }
}

export type { HttpResponse };
