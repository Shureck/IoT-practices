// Встроенные функции Arduino-ESP32 (объект F).
import { Machine, TaskHandle, type GenFn, type Task } from './machine';
import { Panic, R, Ref, cs } from './rt';
import { CONSTS } from '../lang/api';

const C = (name: string) => CONSTS[name][0] as number;
const OUTPUT = 3;
const INPUT_PULLUP = 5;
const INPUT_PULLDOWN = 9;

/** Выводы, которые есть на DevKit V1 и могут быть GPIO. */
export const VALID_GPIO = new Set([0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39]);
export const INPUT_ONLY = new Set([34, 35, 36, 39]);
export const ADC1 = new Set([32, 33, 34, 35, 36, 39]);
export const ADC2 = new Set([0, 2, 4, 12, 13, 14, 15, 25, 26, 27]);
export const FLASH_PINS = new Set([6, 7, 8, 9, 10, 11]);

export interface LedcChannel {
  freq: number;
  res: number;
  duty: number;
  pins: Set<number>;
  tone: boolean;
}

export interface HwTimer {
  num: number;
  /** мкс на один тик */
  tickUs: number;
  up: boolean;
  startT: number;
  offset: number;
  running: boolean;
  alarm: number | null;
  autoreload: boolean;
  isr: GenFn | null;
  event: number | null;
  enabled: boolean;
}

export interface Semaphore { count: number; max: number; mutex: boolean }
export interface Queue { items: unknown[]; len: number }

/** Сохранить значение по «указателю» (Ref, объект структуры, массив). */
export function storeOut(dst: unknown, v: unknown): void {
  if (dst instanceof Ref) { dst.v = R.clone(v); return; }
  if (Array.isArray(dst)) {
    const src = Array.isArray(v) ? v : [v];
    for (let i = 0; i < dst.length && i < src.length; i++) dst[i] = R.clone(src[i]);
    return;
  }
  if (dst && typeof dst === 'object' && v && typeof v === 'object') {
    Object.assign(dst, R.clone(v) as object);
  }
}

export function loadIn(src: unknown): unknown {
  if (src instanceof Ref) return R.clone(src.v);
  return R.clone(src);
}

export function createCore(M: Machine) {
  const st = {
    adcBits: 12,
    ledc: new Map<number, LedcChannel>(),
    /** API ядра 3.x: ledcWrite(pin, …) */
    ledcPinApi: new Set<number>(),
    timers: [] as HwTimer[],
    pwmBits: 8,
    pwmFreq: 1000,
    tz: 0,
  };
  M.lib.core = st;

  const checkPin = (pin: number, fn: string): boolean => {
    if (!Number.isInteger(pin) || pin < 0 || pin > 39) {
      M.warnOnce(`badpin-${fn}-${pin}`, `${fn}(${pin}): у ESP32 нет вывода ${pin}`, 'Номера GPIO: 0–39 (на плате DevKit — подписи D2, D4, …)');
      return false;
    }
    if (FLASH_PINS.has(pin)) {
      throw new Panic('IllegalInstruction', `GPIO${pin} подключён к flash-памяти — его нельзя использовать`, 'Выводы 6–11 заняты flash-памятью, плата зависнет');
    }
    return true;
  };

  const changed = (pin: number) => M.board?.gpioChanged(pin);

  const setPwm = (pin: number, freq: number, duty: number, tone = false) => {
    const g = M.gpio[pin];
    g.pwm = freq > 0 ? { freq, duty: Math.max(0, Math.min(1, duty)), tone } : { freq: 0, duty: 0, tone };
    changed(pin);
  };

  const updateChannel = (ch: LedcChannel) => {
    for (const pin of ch.pins) setPwm(pin, ch.freq, ch.tone ? (ch.freq > 0 ? 0.5 : 0) : ch.duty / 2 ** ch.res, ch.tone);
  };

  const levelOf = (pin: number): number => (M.board ? M.board.readDigital(pin) : M.gpio[pin].mode === OUTPUT ? M.gpio[pin].out : 0);

  /** Обработка нового логического уровня (вызывается схемой). */
  M.lib.onLevel = (pin: number, level: number) => {
    const g = M.gpio[pin];
    const prev = g.lastLevel;
    g.lastLevel = level;
    if (!g.isr || prev === -1 || prev === level) return;
    const m = g.isr.mode;
    const rising = level === 1;
    if (m === 3 || (m === 1 && rising) || (m === 2 && !rising) || (m === 5 && rising) || (m === 4 && !rising)) {
      M.raiseIsr(g.isr.fn, g.isr.arg);
    }
  };

  const timerNow = (tm: HwTimer): number => {
    if (!tm.running) return tm.offset;
    const ticks = (M.now() - tm.startT) / tm.tickUs;
    return Math.floor(tm.offset + (tm.up ? ticks : -ticks));
  };

  const armTimer = (tm: HwTimer) => {
    if (tm.event !== null) M.cancel(tm.event);
    tm.event = null;
    if (!tm.enabled || tm.alarm === null || !tm.running || !tm.isr) return;
    const cur = timerNow(tm);
    let remain = tm.alarm - cur;
    if (remain <= 0) remain = tm.alarm;
    const at = M.now() + Math.max(1, remain * tm.tickUs);
    tm.event = M.schedule(at, () => {
      tm.event = null;
      if (tm.isr) M.raiseIsr(tm.isr);
      if (tm.autoreload) { tm.offset = 0; tm.startT = M.t; armTimer(tm); } else tm.enabled = false;
    });
  };

  const findTimer = (t: unknown): HwTimer => {
    if (!t || typeof t !== 'object' || !('tickUs' in t)) throw new Panic('LoadProhibited', 'Таймер не создан (NULL) — сначала вызовите timerBegin()');
    return t as HwTimer;
  };

  const semOf = (s: unknown): Semaphore => {
    if (!s) throw new Panic('LoadProhibited', 'Семафор не создан (NULL)', 'Вызовите xSemaphoreCreateMutex() в setup()');
    return s as Semaphore;
  };
  const queueOf = (q: unknown): Queue => {
    if (!q) throw new Panic('LoadProhibited', 'Очередь не создана (NULL)', 'Вызовите xQueueCreate() в setup()');
    return q as Queue;
  };

  function* waitUntil(cond: () => boolean, ticks: number): Generator<unknown, boolean, unknown> {
    if (cond()) return true;
    if (ticks === 0 || M.inIsr) return false;
    const deadline = ticks >= 0xffffffff ? Infinity : M.now() + ticks * 1000;
    while (!cond()) {
      if (M.now() >= deadline) return false;
      yield* M.sleep(Math.min(1000, deadline - M.now()));
    }
    return true;
  }

  const spawnTask = (fn: unknown, name: unknown, param: unknown, prio: number, handleOut: unknown): number => {
    if (typeof fn !== 'function') throw new Panic('IllegalInstruction', 'xTaskCreate: первым аргументом должна быть функция задачи');
    const taskName = cs(name) || 'task';
    const holder: { task?: Task } = {};
    const gen = (function* () {
      yield* (fn as GenFn)(param);
      throw new Panic('abort()', `Задача FreeRTOS «${taskName}» завершилась (вышла из функции)`, 'Функция задачи должна крутиться в бесконечном цикле или вызывать vTaskDelete(NULL) в конце');
    })();
    const task = M.spawn(taskName, gen, Math.max(0, Number(prio) || 0));
    holder.task = task;
    if (handleOut) storeOut(handleOut, task.handle);
    return 1;
  };

  const regWrite = (addr: number, val: number) => {
    const v = val >>> 0;
    const each = (mask: number, base: number, fn: (pin: number) => void) => {
      for (let b = 0; b < 32; b++) if (mask & (1 << b)) { const p = base + b; if (p < 40) fn(p); }
    };
    switch (addr >>> 0) {
      case C('GPIO_OUT_W1TS_REG'): each(v, 0, (p) => F.__setOut(p, 1)); break;
      case C('GPIO_OUT_W1TC_REG'): each(v, 0, (p) => F.__setOut(p, 0)); break;
      case C('GPIO_OUT_REG'): for (let p = 0; p < 32; p++) if (VALID_GPIO.has(p)) F.__setOut(p, (v >>> p) & 1); break;
      case C('GPIO_OUT1_W1TS_REG'): each(v, 32, (p) => F.__setOut(p, 1)); break;
      case C('GPIO_OUT1_W1TC_REG'): each(v, 32, (p) => F.__setOut(p, 0)); break;
      case C('GPIO_ENABLE_W1TS_REG'): each(v, 0, (p) => F.__setMode(p, OUTPUT)); break;
      case C('GPIO_ENABLE_W1TC_REG'): each(v, 0, (p) => F.__setMode(p, 1)); break;
      case C('GPIO_ENABLE_REG'): for (let p = 0; p < 32; p++) if (VALID_GPIO.has(p)) F.__setMode(p, (v >>> p) & 1 ? OUTPUT : 1); break;
      default:
        M.warnOnce(`reg-${addr}`, `Запись в регистр 0x${(addr >>> 0).toString(16)} не поддерживается симулятором`);
    }
    M.ops += 1;
  };

  const regRead = (addr: number): number => {
    let v = 0;
    switch (addr >>> 0) {
      case C('GPIO_IN_REG'): for (let p = 0; p < 32; p++) if (VALID_GPIO.has(p) && levelOf(p)) v |= 1 << p; break;
      case C('GPIO_IN1_REG'): for (let p = 32; p < 40; p++) if (VALID_GPIO.has(p) && levelOf(p)) v |= 1 << (p - 32); break;
      case C('GPIO_OUT_REG'): for (let p = 0; p < 32; p++) if (M.gpio[p].out) v |= 1 << p; break;
      case C('GPIO_ENABLE_REG'): for (let p = 0; p < 32; p++) if (M.gpio[p].mode === OUTPUT) v |= 1 << p; break;
      default: M.warnOnce(`regr-${addr}`, `Чтение регистра 0x${(addr >>> 0).toString(16)} не поддерживается`);
    }
    M.ops += 1;
    return v >>> 0;
  };

  const F = {
    // служебные (для регистров)
    __setOut(pin: number, v: number) {
      const g = M.gpio[pin];
      if (g.out !== v) { g.out = v; if (g.mode === OUTPUT || g.mode === 19) changed(pin); }
    },
    __setMode(pin: number, mode: number) {
      const g = M.gpio[pin];
      if (g.mode !== mode) { g.mode = mode; changed(pin); }
    },
    __regWrite: regWrite,
    __regRead: regRead,

    // ---------- выводы ----------
    pinMode(pin: number, mode: number) {
      if (!checkPin(pin, 'pinMode')) return;
      if (INPUT_ONLY.has(pin) && (mode === OUTPUT || mode === 19)) {
        M.warnOnce(`inonly-${pin}`, `GPIO${pin} работает только на вход — OUTPUT для него невозможен`, 'Выводы 34, 35, 36 (VP) и 39 (VN) — только входы. Выберите другой вывод');
        return;
      }
      if (INPUT_ONLY.has(pin) && (mode === INPUT_PULLUP || mode === INPUT_PULLDOWN)) {
        M.warnOnce(`inonly-pull-${pin}`, `У GPIO${pin} нет встроенных подтягивающих резисторов`, 'Для выводов 34–39 поставьте внешний резистор 10 кОм');
        mode = 1;
      }
      const g = M.gpio[pin];
      if (g.pwm && mode !== OUTPUT) g.pwm = null;
      g.mode = mode;
      M.ops += 2;
      changed(pin);
    },
    digitalWrite(pin: number, val: number) {
      if (!checkPin(pin, 'digitalWrite')) return;
      const g = M.gpio[pin];
      const v = val ? 1 : 0;
      M.ops += 1;
      if (g.mode !== OUTPUT && g.mode !== 19) {
        if (g.pwm) {
          M.warnOnce(`dw-pwm-${pin}`, `GPIO${pin} подключён к ШИМ (LEDC) — digitalWrite на него не действует`, 'Используйте ledcWrite(…, 0) или ledcDetachPin()');
        } else {
          M.warnOnce(`dw-mode-${pin}`, `digitalWrite(${pin}, …): вывод не настроен как OUTPUT`, `Добавьте в setup(): pinMode(${pin}, OUTPUT);`);
        }
        g.out = v;
        return;
      }
      if (g.out !== v) {
        g.out = v;
        changed(pin);
      }
    },
    digitalRead(pin: number): number {
      if (!checkPin(pin, 'digitalRead')) return 0;
      M.ops += 1;
      const g = M.gpio[pin];
      if (g.mode === 0 && !M.warned.has(`dr-mode-${pin}`)) {
        M.warnOnce(`dr-mode-${pin}`, `digitalRead(${pin}): режим вывода не задан`, `Добавьте pinMode(${pin}, INPUT) (или INPUT_PULLUP) в setup()`);
      }
      return levelOf(pin);
    },
    analogRead(pin: number): number {
      if (!checkPin(pin, 'analogRead')) return 0;
      M.ops += 40; // ~10 мкс на преобразование
      if (!ADC1.has(pin) && !ADC2.has(pin)) {
        M.warnOnce(`adc-${pin}`, `GPIO${pin} не подключён к АЦП — analogRead вернёт 0`, 'Аналоговые входы: 32–39 (АЦП1) и 0, 2, 4, 12–15, 25–27 (АЦП2)');
        return 0;
      }
      if (ADC2.has(pin) && M.wifiOn) {
        M.warnOnce(`adc2-${pin}`, `АЦП2 (GPIO${pin}) не работает одновременно с Wi-Fi`, 'Подключите датчик к выводам АЦП1: 32, 33, 34, 35, 36 или 39');
        return 0;
      }
      const v = M.board ? M.board.readVoltage(pin) : 0;
      const floating = M.board?.isFloating(pin);
      let raw: number;
      if (floating) {
        M.warnOnce(`adcfloat-${pin}`, `Вход GPIO${pin} ни к чему не подключён — analogRead показывает случайный шум`, 'Подключите датчик или делитель напряжения к этому выводу');
        raw = Math.floor(M.rand() * 4096);
      } else {
        raw = Math.round((Math.max(0, Math.min(3.3, v)) / 3.3) * 4095);
        // небольшой шум АЦП ±2 единицы
        raw = Math.max(0, Math.min(4095, raw + Math.round((M.rand() - 0.5) * 4)));
      }
      const bits = st.adcBits;
      return bits === 12 ? raw : Math.round((raw * (2 ** bits - 1)) / 4095);
    },
    analogReadMilliVolts(pin: number): number {
      const raw = F.analogRead(pin);
      return Math.round((raw / (2 ** st.adcBits - 1)) * 3300);
    },
    analogReadResolution(bits: number) { st.adcBits = Math.max(9, Math.min(12, bits)); },
    analogSetAttenuation() { /* 11 дБ по умолчанию */ },
    analogSetPinAttenuation() { /* ничего */ },
    analogSetWidth(bits: number) { st.adcBits = Math.max(9, Math.min(12, bits)); },
    analogWrite(pin: number, val: number) {
      if (!checkPin(pin, 'analogWrite')) return;
      const g = M.gpio[pin];
      if (g.mode !== OUTPUT) g.mode = OUTPUT;
      const max = 2 ** st.pwmBits - 1;
      setPwm(pin, st.pwmFreq, Math.max(0, Math.min(max, val)) / max);
      M.ops += 4;
    },
    analogWriteResolution(bits: number) { st.pwmBits = bits; },
    analogWriteFrequency(f: number) { st.pwmFreq = f; },
    dacWrite(pin: number, val: number) {
      if (pin !== 25 && pin !== 26) {
        M.warnOnce(`dac-${pin}`, `ЦАП есть только на GPIO25 и GPIO26`);
        return;
      }
      const g = M.gpio[pin];
      g.dac = (Math.max(0, Math.min(255, val)) / 255) * 3.3;
      g.mode = 192;
      changed(pin);
    },
    touchRead(pin: number): number {
      const touched = M.board ? M.board.readDigital(pin) === 0 && !M.board.isFloating(pin) : false;
      return touched ? 12 : 72;
    },
    hallRead: () => Math.round((M.rand() - 0.5) * 20),
    neopixelWrite(pin: number, r: number, g: number, b: number) {
      const dev = M.board?.deviceAt<{ show(c: number[]): void }>('neopixel', 'DIN', pin);
      if (dev) dev.show([((r & 255) << 16) | ((g & 255) << 8) | (b & 255)]);
    },
    rgbLedWrite(pin: number, r: number, g: number, b: number) { F.neopixelWrite(pin, r, g, b); },

    // ---------- время ----------
    *delay(ms: number) {
      const v = Math.trunc(ms) >>> 0;
      if (v > 3_600_000) M.warnOnce('bigdelay', `delay(${ms}) — это ${Math.round(v / 60000)} мин. Возможно, отрицательное число?`);
      yield* M.sleep(v * 1000);
    },
    *delayMicroseconds(us: number) {
      // активное ожидание без переключения задач
      M.ops += Math.max(0, Math.trunc(us) >>> 0) / 0.25;
    },
    millis: () => Math.floor(M.now() / 1000) >>> 0,
    micros: () => Math.floor(M.now()) >>> 0,
    *yield() { yield* M.yieldNow(); },
    *pulseIn(pin: number, state: number, timeout = 1_000_000) {
      return yield* pulse(pin, state, timeout);
    },
    *pulseInLong(pin: number, state: number, timeout = 1_000_000) {
      return yield* pulse(pin, state, timeout);
    },
    tone(pin: number, freq: number, duration?: number) {
      if (!checkPin(pin, 'tone')) return;
      M.gpio[pin].mode = OUTPUT;
      setPwm(pin, freq, freq > 0 ? 0.5 : 0, true);
      const key = `tone-${pin}`;
      const prev = M.lib[key] as number | undefined;
      if (prev) M.cancel(prev);
      if (duration && duration > 0) M.lib[key] = M.schedule(M.now() + duration * 1000, () => F.noTone(pin));
    },
    noTone(pin: number) {
      if (!checkPin(pin, 'noTone')) return;
      M.gpio[pin].pwm = null;
      changed(pin);
    },
    *shiftOut(data: number, clock: number, order: number, val: number) {
      for (let i = 0; i < 8; i++) {
        const bit = order === 0 ? (val >> i) & 1 : (val >> (7 - i)) & 1;
        F.digitalWrite(data, bit);
        F.digitalWrite(clock, 1);
        M.ops += 4;
        F.digitalWrite(clock, 0);
      }
    },
    *shiftIn(data: number, clock: number, order: number) {
      let v = 0;
      for (let i = 0; i < 8; i++) {
        F.digitalWrite(clock, 1);
        const bit = F.digitalRead(data);
        v |= order === 0 ? bit << i : bit << (7 - i);
        F.digitalWrite(clock, 0);
      }
      return v;
    },

    // ---------- случайные числа ----------
    random(a: number, b?: number): number {
      let lo = 0;
      let hi = a;
      if (b !== undefined) { lo = a; hi = b; }
      if (hi <= lo) return lo;
      return lo + Math.floor(M.rand() * (hi - lo));
    },
    randomSeed(seed: number) { if (seed) M.rngState = (Math.trunc(seed) >>> 0) || 1; },
    esp_random: () => Math.floor(M.rand() * 4294967296) >>> 0,

    // ---------- прерывания ----------
    attachInterrupt(pin: number, fn: GenFn, mode: number) {
      if (!checkPin(pin, 'attachInterrupt')) return;
      if (typeof fn !== 'function') throw new Panic('IllegalInstruction', 'attachInterrupt: второй аргумент должен быть функцией');
      M.gpio[pin].isr = { fn, mode };
      M.gpio[pin].lastLevel = levelOf(pin);
    },
    attachInterruptArg(pin: number, fn: GenFn, arg: unknown, mode: number) {
      F.attachInterrupt(pin, fn, mode);
      M.gpio[pin].isr!.arg = arg;
    },
    detachInterrupt(pin: number) { if (M.gpio[pin]) M.gpio[pin].isr = null; },
    digitalPinToInterrupt: (pin: number) => pin,
    interrupts() { M.interruptsEnabled = true; },
    noInterrupts() { M.interruptsEnabled = false; },

    // ---------- LEDC ----------
    ledcSetup(ch: number, freq: number, res: number): number {
      if (ch < 0 || ch > 15) { M.warnOnce(`ledc-ch-${ch}`, `У ESP32 16 каналов LEDC (0–15), канала ${ch} нет`); return 0; }
      if (res < 1 || res > 20) { M.warnOnce(`ledc-res-${res}`, `Разрешение ШИМ ${res} бит недопустимо (1–20)`); return 0; }
      if (freq * 2 ** res > 80_000_000) {
        M.warnOnce(`ledc-freq-${ch}`, `ledcSetup: частота ${freq} Гц при ${res} битах недостижима (нужно ${(freq * 2 ** res / 1e6).toFixed(0)} МГц > 80 МГц)`, 'Уменьшите разрешение или частоту');
        return 0;
      }
      const prev = st.ledc.get(ch);
      st.ledc.set(ch, { freq, res, duty: prev?.duty ?? 0, pins: prev?.pins ?? new Set(), tone: false });
      if (prev) updateChannel(st.ledc.get(ch)!);
      return freq;
    },
    ledcAttachPin(pin: number, ch: number) {
      if (!checkPin(pin, 'ledcAttachPin')) return;
      const c = st.ledc.get(ch);
      if (!c) {
        M.warnOnce(`ledc-attach-${ch}`, `Канал LEDC ${ch} не настроен — сначала вызовите ledcSetup(${ch}, частота, разрешение)`);
        return;
      }
      c.pins.add(pin);
      M.gpio[pin].mode = OUTPUT;
      updateChannel(c);
    },
    ledcDetachPin(pin: number) {
      for (const c of st.ledc.values()) c.pins.delete(pin);
      M.gpio[pin].pwm = null;
      changed(pin);
    },
    ledcWrite(chOrPin: number, duty: number) {
      M.ops += 2;
      if (st.ledcPinApi.has(chOrPin) && st.ledc.has(1000 + chOrPin)) {
        const c = st.ledc.get(1000 + chOrPin)!;
        c.duty = Math.max(0, duty);
        c.tone = false;
        updateChannel(c);
        return;
      }
      const c = st.ledc.get(chOrPin);
      if (!c) {
        M.warnOnce(`ledc-w-${chOrPin}`, `ledcWrite(${chOrPin}, …): канал не настроен`, 'Ядро 2.x: ledcSetup + ledcAttachPin; ядро 3.x: ledcAttach(pin, freq, bits)');
        return;
      }
      c.duty = Math.max(0, duty);
      c.tone = false;
      updateChannel(c);
    },
    ledcRead(chOrPin: number): number {
      const c = st.ledc.get(st.ledcPinApi.has(chOrPin) ? 1000 + chOrPin : chOrPin);
      return c ? c.duty : 0;
    },
    ledcReadFreq(chOrPin: number): number {
      const c = st.ledc.get(st.ledcPinApi.has(chOrPin) ? 1000 + chOrPin : chOrPin);
      return c ? c.freq : 0;
    },
    ledcWriteTone(chOrPin: number, freq: number): number {
      const key = st.ledcPinApi.has(chOrPin) ? 1000 + chOrPin : chOrPin;
      const c = st.ledc.get(key);
      if (!c) { M.warnOnce(`ledc-tone-${chOrPin}`, `ledcWriteTone: канал ${chOrPin} не настроен`); return 0; }
      c.freq = freq;
      c.tone = true;
      updateChannel(c);
      return freq;
    },
    ledcWriteNote(chOrPin: number, note: number, octave: number): number {
      const freqs = [4186.01, 4434.92, 4698.63, 4978.03, 5274.04, 5587.65, 5919.91, 6271.93, 6644.88, 7040, 7458.62, 7902.13];
      const f = freqs[note % 12] / 2 ** (8 - octave);
      return F.ledcWriteTone(chOrPin, f);
    },
    ledcAttach(pin: number, freq: number, res: number): boolean {
      if (!checkPin(pin, 'ledcAttach')) return false;
      if (freq * 2 ** res > 80_000_000) {
        M.warnOnce(`ledc3-${pin}`, `ledcAttach: частота ${freq} Гц при ${res} битах недостижима`);
        return false;
      }
      st.ledcPinApi.add(pin);
      st.ledc.set(1000 + pin, { freq, res, duty: 0, pins: new Set([pin]), tone: false });
      M.gpio[pin].mode = OUTPUT;
      updateChannel(st.ledc.get(1000 + pin)!);
      return true;
    },
    ledcAttachChannel(pin: number, freq: number, res: number, ch: number): boolean {
      st.ledc.set(ch, { freq, res, duty: 0, pins: new Set([pin]), tone: false });
      st.ledcPinApi.add(pin);
      st.ledc.set(1000 + pin, st.ledc.get(ch)!);
      M.gpio[pin].mode = OUTPUT;
      updateChannel(st.ledc.get(ch)!);
      return true;
    },
    ledcDetach(pin: number): boolean { st.ledcPinApi.delete(pin); st.ledc.delete(1000 + pin); F.ledcDetachPin(pin); return true; },
    ledcChangeFrequency(chOrPin: number, freq: number, res: number): number {
      const c = st.ledc.get(st.ledcPinApi.has(chOrPin) ? 1000 + chOrPin : chOrPin);
      if (!c) return 0;
      c.freq = freq; c.res = res;
      updateChannel(c);
      return freq;
    },
    ledcFade(pin: number, start: number, end: number, ms: number): boolean {
      const c = st.ledc.get(1000 + pin);
      if (!c) return false;
      const steps = 20;
      for (let i = 0; i <= steps; i++) {
        M.schedule(M.now() + (ms * 1000 * i) / steps, () => { c.duty = start + ((end - start) * i) / steps; updateChannel(c); });
      }
      return true;
    },

    // ---------- аппаратные таймеры ----------
    timerBegin(a: number, divider?: number, countUp = true): HwTimer {
      let tm: HwTimer;
      if (divider === undefined) {
        // ядро 3.x: timerBegin(частота)
        tm = { num: st.timers.length, tickUs: 1e6 / a, up: true, startT: M.now(), offset: 0, running: true, alarm: null, autoreload: false, isr: null, event: null, enabled: false };
      } else {
        if (a < 0 || a > 3) M.warnOnce('timer-num', `У ESP32 четыре аппаратных таймера (0–3), таймера ${a} нет`);
        if (divider < 2 || divider > 65536) M.warnOnce('timer-div', `Делитель таймера должен быть 2…65536, а не ${divider}`);
        tm = { num: a, tickUs: divider / 80, up: countUp, startT: M.now(), offset: 0, running: true, alarm: null, autoreload: false, isr: null, event: null, enabled: false };
      }
      st.timers.push(tm);
      return tm;
    },
    timerAttachInterrupt(t: unknown, fn: GenFn) {
      const tm = findTimer(t);
      tm.isr = fn;
      if (tm.alarm !== null && tm.enabled) armTimer(tm);
    },
    timerDetachInterrupt(t: unknown) { const tm = findTimer(t); tm.isr = null; armTimer(tm); },
    timerAlarmWrite(t: unknown, ticks: number, autoreload: boolean) {
      const tm = findTimer(t);
      tm.alarm = ticks;
      tm.autoreload = !!autoreload;
      if (tm.enabled) armTimer(tm);
    },
    timerAlarmEnable(t: unknown) { const tm = findTimer(t); tm.enabled = true; armTimer(tm); },
    timerAlarmDisable(t: unknown) { const tm = findTimer(t); tm.enabled = false; armTimer(tm); },
    timerAlarm(t: unknown, ticks: number, autoreload: boolean) {
      const tm = findTimer(t);
      tm.alarm = ticks;
      tm.autoreload = !!autoreload;
      tm.enabled = true;
      armTimer(tm);
    },
    timerStart(t: unknown) { const tm = findTimer(t); if (!tm.running) { tm.running = true; tm.startT = M.now(); armTimer(tm); } },
    timerStop(t: unknown) { const tm = findTimer(t); tm.offset = timerNow(tm); tm.running = false; armTimer(tm); },
    timerEnd(t: unknown) { const tm = findTimer(t); tm.enabled = false; tm.running = false; armTimer(tm); },
    timerRead: (t: unknown) => timerNow(findTimer(t)),
    timerReadMillis: (t: unknown) => Math.floor((timerNow(findTimer(t)) * findTimer(t).tickUs) / 1000),
    timerReadMicros: (t: unknown) => Math.floor(timerNow(findTimer(t)) * findTimer(t).tickUs),
    timerReadSeconds: (t: unknown) => (timerNow(findTimer(t)) * findTimer(t).tickUs) / 1e6,
    timerWrite(t: unknown, v: number) { const tm = findTimer(t); tm.offset = v; tm.startT = M.now(); armTimer(tm); },
    timerRestart(t: unknown) { const tm = findTimer(t); tm.offset = 0; tm.startT = M.now(); armTimer(tm); },
    timerSetAutoReload(t: unknown, a: boolean) { findTimer(t).autoreload = !!a; },

    // ---------- FreeRTOS ----------
    xTaskCreate(fn: unknown, name: unknown, _stack: number, param: unknown, prio: number, handle: unknown) {
      return spawnTask(fn, name, param, prio, handle);
    },
    xTaskCreatePinnedToCore(fn: unknown, name: unknown, _stack: number, param: unknown, prio: number, handle: unknown, _core: number) {
      return spawnTask(fn, name, param, prio, handle);
    },
    *vTaskDelay(ticks: number) { yield* M.sleep((Math.trunc(ticks) >>> 0) * 1000); },
    *vTaskDelayUntil(last: unknown, ticks: number) {
      const prev = Number(last instanceof Ref ? last.v : 0);
      const wake = prev + ticks;
      if (last instanceof Ref) last.v = wake;
      const nowMs = M.now() / 1000;
      if (wake > nowMs) yield* M.sleep((wake - nowMs) * 1000);
    },
    *vTaskDelete(h: unknown) {
      const task = h instanceof TaskHandle ? h.task : null;
      if (!task || task === M.cur) {
        if (M.cur) {
          M.cur.state = 'done';
          yield 1;
        }
        return;
      }
      task.state = 'done';
    },
    xTaskGetTickCount: () => Math.floor(M.now() / 1000) >>> 0,
    xTaskGetTickCountFromISR: () => Math.floor(M.now() / 1000) >>> 0,
    pdMS_TO_TICKS: (ms: number) => Math.trunc(ms) >>> 0,
    *vTaskSuspend(h: unknown) {
      const task = h instanceof TaskHandle ? h.task : M.cur;
      if (!task) return;
      task.state = 'suspended';
      if (task === M.cur) yield 1;
    },
    vTaskResume(h: unknown) {
      const task = h instanceof TaskHandle ? h.task : null;
      if (task && task.state === 'suspended') { task.state = 'ready'; task.wake = M.now(); }
    },
    uxTaskGetStackHighWaterMark: () => 1200 + Math.floor(M.rand() * 400),
    xPortGetCoreID: () => 1,
    *taskYIELD() { yield* M.yieldNow(); },
    *vPortYield() { yield* M.yieldNow(); },
    uxTaskPriorityGet: (h: unknown) => (h instanceof TaskHandle ? h.task?.prio ?? 0 : M.cur?.prio ?? 0),
    vTaskPrioritySet(h: unknown, p: number) { const t = h instanceof TaskHandle ? h.task : M.cur; if (t) t.prio = p; },
    pcTaskGetName: (h: unknown) => (h instanceof TaskHandle ? h.task?.name : M.cur?.name) ?? '',
    xTaskGetCurrentTaskHandle: () => M.cur?.handle ?? null,
    xSemaphoreCreateMutex: (): Semaphore => ({ count: 1, max: 1, mutex: true }),
    xSemaphoreCreateBinary: (): Semaphore => ({ count: 0, max: 1, mutex: false }),
    xSemaphoreCreateCounting: (max: number, init: number): Semaphore => ({ count: init, max, mutex: false }),
    *xSemaphoreTake(s: unknown, ticks: number) {
      const sem = semOf(s);
      const ok = yield* waitUntil(() => sem.count > 0, ticks);
      if (ok) sem.count--;
      return ok ? 1 : 0;
    },
    xSemaphoreTakeFromISR(s: unknown) { const sem = semOf(s); if (sem.count > 0) { sem.count--; return 1; } return 0; },
    xSemaphoreGive(s: unknown) { const sem = semOf(s); if (sem.count >= sem.max) return 0; sem.count++; return 1; },
    xSemaphoreGiveFromISR(s: unknown, woken?: unknown) { if (woken instanceof Ref) woken.v = 0; return F.xSemaphoreGive(s); },
    uxSemaphoreGetCount: (s: unknown) => semOf(s).count,
    xQueueCreate: (len: number): Queue => ({ items: [], len: Math.max(1, len) }),
    *xQueueSend(q: unknown, item: unknown, ticks: number) {
      const qu = queueOf(q);
      const ok = yield* waitUntil(() => qu.items.length < qu.len, ticks);
      if (!ok) return 0;
      qu.items.push(loadIn(item));
      return 1;
    },
    *xQueueSendToBack(q: unknown, item: unknown, ticks: number) { return yield* F.xQueueSend(q, item, ticks); },
    *xQueueSendToFront(q: unknown, item: unknown, ticks: number) {
      const qu = queueOf(q);
      const ok = yield* waitUntil(() => qu.items.length < qu.len, ticks);
      if (!ok) return 0;
      qu.items.unshift(loadIn(item));
      return 1;
    },
    xQueueSendFromISR(q: unknown, item: unknown, woken?: unknown) {
      const qu = queueOf(q);
      if (woken instanceof Ref) woken.v = 0;
      if (qu.items.length >= qu.len) return 0;
      qu.items.push(loadIn(item));
      return 1;
    },
    xQueueOverwrite(q: unknown, item: unknown) { const qu = queueOf(q); qu.items = [loadIn(item)]; return 1; },
    *xQueueReceive(q: unknown, out: unknown, ticks: number) {
      const qu = queueOf(q);
      const ok = yield* waitUntil(() => qu.items.length > 0, ticks);
      if (!ok) return 0;
      storeOut(out, qu.items.shift());
      return 1;
    },
    xQueueReceiveFromISR(q: unknown, out: unknown) {
      const qu = queueOf(q);
      if (!qu.items.length) return 0;
      storeOut(out, qu.items.shift());
      return 1;
    },
    *xQueuePeek(q: unknown, out: unknown, ticks: number) {
      const qu = queueOf(q);
      const ok = yield* waitUntil(() => qu.items.length > 0, ticks);
      if (!ok) return 0;
      storeOut(out, qu.items[0]);
      return 1;
    },
    xQueueReset(q: unknown) { queueOf(q).items = []; return 1; },
    uxQueueMessagesWaiting: (q: unknown) => queueOf(q).items.length,
    uxQueueSpacesAvailable: (q: unknown) => queueOf(q).len - queueOf(q).items.length,
    portENTER_CRITICAL() { M.interruptsEnabled = false; },
    portEXIT_CRITICAL() { M.interruptsEnabled = true; },
    portENTER_CRITICAL_ISR() { /* уже в прерывании */ },
    portEXIT_CRITICAL_ISR() { /* уже в прерывании */ },
    portYIELD_FROM_ISR() { /* ничего */ },
    xTaskNotifyGive(h: unknown) { const t = h instanceof TaskHandle ? h.task : null; if (t) t.notify++; return 1; },
    vTaskNotifyGiveFromISR(h: unknown) { F.xTaskNotifyGive(h); },
    xTaskNotify(h: unknown, v: number) { const t = h instanceof TaskHandle ? h.task : null; if (t) t.notify = v; return 1; },
    *ulTaskNotifyTake(clear: number, ticks: number) {
      const task = M.cur!;
      const ok = yield* waitUntil(() => task.notify > 0, ticks);
      if (!ok) return 0;
      const v = task.notify;
      task.notify = clear ? 0 : v - 1;
      return v;
    },

    // ---------- строки C ----------
    strcmp: (a: unknown, b: unknown) => { const x = cs(a); const y = cs(b); return x < y ? -1 : x > y ? 1 : 0; },
    strncmp: (a: unknown, b: unknown, n: number) => { const x = cs(a).slice(0, n); const y = cs(b).slice(0, n); return x < y ? -1 : x > y ? 1 : 0; },
    strcasecmp: (a: unknown, b: unknown) => { const x = cs(a).toLowerCase(); const y = cs(b).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; },
    strlen: (a: unknown) => cs(a).length,
    strstr: (a: unknown, b: unknown) => { const x = cs(a); const i = x.indexOf(cs(b)); return i < 0 ? null : x.slice(i); },
    strchr: (a: unknown, c: number) => { const x = cs(a); const i = x.indexOf(String.fromCharCode(c)); return i < 0 ? null : x.slice(i); },
    strrchr: (a: unknown, c: number) => { const x = cs(a); const i = x.lastIndexOf(String.fromCharCode(c)); return i < 0 ? null : x.slice(i); },
    atoi: (a: unknown) => R.S.toInt(cs(a)),
    atol: (a: unknown) => R.S.toInt(cs(a)),
    atof: (a: unknown) => R.S.toFloat(cs(a)),
    strtol: (a: unknown, _end: unknown, base: number) => (parseInt(cs(a), base || 10) | 0) || 0,
    strtoul: (a: unknown, _end: unknown, base: number) => (parseInt(cs(a), base || 10) >>> 0) || 0,
    strtof: (a: unknown) => R.S.toFloat(cs(a)),
    strtod: (a: unknown) => R.S.toFloat(cs(a)),
    toupper: (c: number) => (c >= 97 && c <= 122 ? c - 32 : c),
    tolower: (c: number) => (c >= 65 && c <= 90 ? c + 32 : c),
    toUpperCase: (c: number) => (c >= 97 && c <= 122 ? c - 32 : c),
    toLowerCase: (c: number) => (c >= 65 && c <= 90 ? c + 32 : c),
    isdigit: (c: number) => c >= 48 && c <= 57,
    isalpha: (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
    isalnum: (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
    isspace: (c: number) => c === 32 || (c >= 9 && c <= 13),
    isupper: (c: number) => c >= 65 && c <= 90,
    islower: (c: number) => c >= 97 && c <= 122,
    ispunct: (c: number) => c > 32 && c < 127 && !((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)),
    isxdigit: (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102),
    isDigit: (c: number) => c >= 48 && c <= 57,
    isAlpha: (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
    isAlphaNumeric: (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
    isSpace: (c: number) => c === 32 || (c >= 9 && c <= 13),
    isWhitespace: (c: number) => c === 32 || c === 9,
    isUpperCase: (c: number) => c >= 65 && c <= 90,
    isLowerCase: (c: number) => c >= 97 && c <= 122,
    isPunct: (c: number) => c > 32 && c < 127 && !((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)),
    isHexadecimalDigit: (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102),
    isPrintable: (c: number) => c >= 32 && c < 127,
    isControl: (c: number) => c < 32 || c === 127,
    isAscii: (c: number) => c >= 0 && c < 128,
    isGraph: (c: number) => c > 32 && c < 127,
    memcmp(a: unknown, b: unknown, n: number) {
      const x = typeof a === 'string' ? Array.from(a, (c) => c.charCodeAt(0)) : (a as number[]);
      const y = typeof b === 'string' ? Array.from(b, (c) => c.charCodeAt(0)) : (b as number[]);
      for (let i = 0; i < n; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    },

    // ---------- JSON ----------
    deserializeJson(doc: unknown, input: unknown, len?: number) {
      M.ops += 200;
      return R.parseJsonInto(doc as never, input, len);
    },
    measureJson: (doc: unknown) => R.jser(doc, false).length,
    measureJsonPretty: (doc: unknown) => R.jser(doc, true).length,

    // ---------- разное ----------
    *esp_restart() { yield* (M.lib.restart as () => Generator<unknown, void, unknown>)(); },
    *ESP_restart() { yield* (M.lib.restart as () => Generator<unknown, void, unknown>)(); },
    esp_get_free_heap_size: () => 290000 - Math.floor(M.rand() * 2000),
    temperatureRead: () => 48 + M.rand() * 4,
    REG_WRITE: regWrite,
    REG_READ: regRead,
    WRITE_PERI_REG: regWrite,
    READ_PERI_REG: regRead,
    REG_SET_BIT(addr: number, bits: number) {
      if (addr === C('GPIO_OUT_REG')) regWrite(C('GPIO_OUT_W1TS_REG'), bits);
      else if (addr === C('GPIO_ENABLE_REG')) regWrite(C('GPIO_ENABLE_W1TS_REG'), bits);
      else regWrite(addr, regRead(addr) | bits);
    },
    REG_CLR_BIT(addr: number, bits: number) {
      if (addr === C('GPIO_OUT_REG')) regWrite(C('GPIO_OUT_W1TC_REG'), bits);
      else if (addr === C('GPIO_ENABLE_REG')) regWrite(C('GPIO_ENABLE_W1TC_REG'), bits);
      else regWrite(addr, regRead(addr) & ~bits);
    },
    SET_PERI_REG_MASK(addr: number, bits: number) { F.REG_SET_BIT(addr, bits); },
    CLEAR_PERI_REG_MASK(addr: number, bits: number) { F.REG_CLR_BIT(addr, bits); },
    gpio_set_level(pin: number, v: number) { F.__setOut(pin, v ? 1 : 0); return 0; },
    gpio_get_level: (pin: number) => levelOf(pin),
    gpio_set_direction(pin: number, mode: number) { F.__setMode(pin, mode === 2 || mode === 3 ? OUTPUT : 1); return 0; },
    gpio_pad_select_gpio() { /* ничего */ },
    gpio_reset_pin(pin: number) { F.__setMode(pin, 0); return 0; },
    gpio_set_pull_mode(pin: number, mode: number) { F.__setMode(pin, mode === 0 ? INPUT_PULLUP : mode === 1 ? INPUT_PULLDOWN : 1); return 0; },
    setCpuFrequencyMhz: () => true,
    getCpuFrequencyMhz: () => 240,
    getXtalFrequencyMhz: () => 40,
    getApbFrequency: () => 80_000_000,
    configTime(gmtOffset: number) { st.tz = gmtOffset; },
    esp_sleep_enable_timer_wakeup(us: number) { M.lib.wakeUs = us; return 0; },
    *esp_deep_sleep_start() { yield* (M.lib.deepSleep as (us?: number) => Generator<unknown, void, unknown>)(M.lib.wakeUs as number | undefined); },
    *esp_deep_sleep(us: number) { yield* (M.lib.deepSleep as (us?: number) => Generator<unknown, void, unknown>)(us); },
    *esp_light_sleep_start() { yield* M.sleep((M.lib.wakeUs as number) ?? 0); return 0; },
    esp_timer_get_time: () => Math.floor(M.now()),
    disableCore0WDT() { /* ничего */ },
    disableCore1WDT() { /* ничего */ },
    enableLoopWDT() { /* ничего */ },
    disableLoopWDT() { /* ничего */ },
    esp_task_wdt_reset: () => 0,
  };

  /** pulseIn: ожидание фронтов по событиям схемы. */
  function* pulse(pin: number, state: number, timeout: number): Generator<unknown, number, unknown> {
    const want = state ? 1 : 0;
    const start = M.now();
    const deadline = start + timeout;
    const waitWhile = function* (cond: () => boolean): Generator<unknown, boolean, unknown> {
      while (cond()) {
        const now = M.now();
        if (now >= deadline) return false;
        const nextEv = M.events.length ? M.events[0].t : Infinity;
        const step = Math.max(1, Math.min(nextEv - now, deadline - now, 2000));
        yield* M.sleep(step);
      }
      return true;
    };
    if (!(yield* waitWhile(() => levelOf(pin) === want))) return 0;
    if (!(yield* waitWhile(() => levelOf(pin) !== want))) return 0;
    const t0 = M.now();
    if (!(yield* waitWhile(() => levelOf(pin) === want))) return 0;
    return Math.round(M.now() - t0);
  }

  return F;
}

export type Core = ReturnType<typeof createCore>;
