// Библиотеки периферии: Serial, DHT, Servo, LCD, OLED, NeoPixel, Preferences,
// Wire, SPI, ESP, регистры GPIO, Ticker.
import type { Core } from './core';
import { Machine, type GenFn } from './machine';
import { Panic, cs, format, printText } from './rt';
import { glyph, utf8Bytes } from './font';

// ---------- интерфейсы моделей устройств (реализуются в схеме) ----------
export interface DhtModel { read(): { t: number; h: number; model: string } | null; powered(): boolean }
export interface LcdModel {
  powered(): boolean;
  init(cols: number, rows: number): void;
  clear(): void;
  home(): void;
  setCursor(c: number, r: number): void;
  writeByte(b: number): void;
  setBacklight(on: boolean): void;
  setDisplay(on: boolean): void;
  setCursorVisible(on: boolean): void;
  setBlink(on: boolean): void;
  createChar(slot: number, rows: number[]): void;
  scroll(dir: number): void;
  setDirection(ltr: boolean): void;
  setAutoscroll(on: boolean): void;
}
export interface OledModel { powered(): boolean; show(buf: Uint8Array, w: number, h: number): void; invert(on: boolean): void; dim(on: boolean): void }
export interface NeoModel { show(colors: number[]): void; powered(): boolean }

export function createLibs(M: Machine, F: Core) {
  // ======================= Serial =======================
  class HardwareSerial {
    baud = 0;
    begun = false;
    rx: number[] = [];
    timeout = 1000;
    rxPin: number;
    txPin: number;
    constructor(public port: number) {
      this.rxPin = port === 0 ? 3 : port === 1 ? 9 : 16;
      this.txPin = port === 0 ? 1 : port === 1 ? 10 : 17;
    }
    __bool() { return true; }
    begin(baud: number, _config?: number, rx?: number, tx?: number) {
      this.baud = baud;
      this.begun = true;
      if (rx !== undefined && rx >= 0) this.rxPin = rx;
      if (tx !== undefined && tx >= 0) this.txPin = tx;
      M.lib[`uart${this.port}`] = this;
    }
    end() { this.begun = false; }
    updateBaudRate(b: number) { this.baud = b; }
    baudRate() { return this.baud; }
    setDebugOutput() { /* ничего */ }
    setRxBufferSize(n: number) { return n; }
    onReceive() { /* ничего */ }
    private out(text: string): number {
      if (!this.begun) {
        M.warnOnce(`serial-begin-${this.port}`, `Serial${this.port || ''}.print без Serial${this.port || ''}.begin() — данные никуда не уходят`, `Добавьте в setup(): Serial${this.port || ''}.begin(115200);`);
        return 0;
      }
      M.ops += 2 + text.length / 4;
      M.ev.serial?.(this.port, text, this.baud);
      if (this.port !== 0 && M.board) M.board.uartTx(this.txPin, utf8Bytes(text), this.baud);
      else if (this.port === 0 && M.board?.hasAnalyzer) M.board.uartTx(1, utf8Bytes(text), this.baud);
      return utf8Bytes(text).length;
    }
    print(v: unknown, fmt?: unknown) { return this.out(printText(v, fmt)); }
    println(v?: unknown, fmt?: unknown) { return this.out((v === undefined ? '' : printText(v, fmt)) + '\r\n'); }
    printf(fmt: unknown, ...args: unknown[]) { return this.out(format(cs(fmt), args)); }
    write(v: unknown, len?: number) {
      if (typeof v === 'number') return this.out(String.fromCharCode(v & 255));
      if (Array.isArray(v)) {
        const n = len ?? v.length;
        return this.out(String.fromCharCode(...(v.slice(0, n) as number[]).map((x) => x & 255)));
      }
      return this.out(cs(v));
    }
    flush() { /* ничего */ }
    availableForWrite() { return 128; }
    receive(bytes: number[]) {
      for (const b of bytes) if (this.rx.length < 256) this.rx.push(b & 255);
    }
    available() { M.ops += 1; return this.rx.length; }
    read() { M.ops += 1; return this.rx.length ? this.rx.shift()! : -1; }
    peek() { return this.rx.length ? this.rx[0] : -1; }
    setTimeout(ms: number) { this.timeout = ms; }
    private *waitByte(): Generator<unknown, number, unknown> {
      const deadline = M.now() + this.timeout * 1000;
      while (!this.rx.length) {
        if (M.now() >= deadline) return -1;
        yield* M.sleep(Math.min(1000, deadline - M.now()));
      }
      return this.rx.shift()!;
    }
    *readString() {
      const bytes: number[] = [];
      for (;;) { const b = yield* this.waitByte(); if (b < 0) break; bytes.push(b); }
      return decode(bytes);
    }
    *readStringUntil(term: number) {
      const bytes: number[] = [];
      for (;;) { const b = yield* this.waitByte(); if (b < 0 || b === term) break; bytes.push(b); }
      return decode(bytes);
    }
    *readBytes(buf: unknown[], n: number) {
      let i = 0;
      for (; i < n && i < buf.length; i++) { const b = yield* this.waitByte(); if (b < 0) break; buf[i] = b; }
      return i;
    }
    *readBytesUntil(term: number, buf: unknown[], n: number) {
      let i = 0;
      for (; i < n && i < buf.length; i++) { const b = yield* this.waitByte(); if (b < 0 || b === term) break; buf[i] = b; }
      return i;
    }
    *parseInt() {
      let s = '';
      for (;;) {
        const b = yield* this.peekWait();
        if (b < 0) break;
        const ch = String.fromCharCode(b);
        if (/[0-9]/.test(ch) || (ch === '-' && !s)) { s += ch; this.rx.shift(); } else if (s) break; else this.rx.shift();
      }
      return s && s !== '-' ? parseInt(s, 10) | 0 : 0;
    }
    *parseFloat() {
      let s = '';
      for (;;) {
        const b = yield* this.peekWait();
        if (b < 0) break;
        const ch = String.fromCharCode(b);
        if (/[0-9.]/.test(ch) || (ch === '-' && !s)) { s += ch; this.rx.shift(); } else if (s) break; else this.rx.shift();
      }
      return parseFloat(s) || 0;
    }
    private *peekWait(): Generator<unknown, number, unknown> {
      const deadline = M.now() + this.timeout * 1000;
      while (!this.rx.length) {
        if (M.now() >= deadline) return -1;
        yield* M.sleep(Math.min(1000, deadline - M.now()));
      }
      return this.rx[0];
    }
    *find(target: unknown) {
      const t = cs(target);
      let buf = '';
      for (;;) {
        const b = yield* this.waitByte();
        if (b < 0) return false;
        buf += String.fromCharCode(b);
        if (buf.endsWith(t)) return true;
      }
    }
  }
  const decode = (bytes: number[]) => {
    try { return new TextDecoder().decode(new Uint8Array(bytes)); } catch { return String.fromCharCode(...bytes); }
  };

  const serials = [new HardwareSerial(0), new HardwareSerial(1), new HardwareSerial(2)];
  M.lib.serials = serials;

  // ======================= I²C / Wire =======================
  class TwoWire {
    sda = 21;
    scl = 22;
    freq = 100000;
    begun = false;
    txAddr = -1;
    tx: number[] = [];
    rxBuf: number[] = [];
    begin(sda?: number, scl?: number, freq?: number) {
      if (sda !== undefined && sda >= 0) this.sda = sda;
      if (scl !== undefined && scl >= 0) this.scl = scl;
      if (freq) this.freq = freq;
      this.begun = true;
      return true;
    }
    setPins(sda: number, scl: number) { this.sda = sda; this.scl = scl; return true; }
    setClock(f: number) { this.freq = f; }
    getClock() { return this.freq; }
    setTimeOut() { /* ничего */ }
    end() { this.begun = false; return true; }
    devices() { return M.board ? M.board.i2cDevices(this.sda, this.scl) : new Map(); }
    beginTransmission(addr: number) { this.txAddr = addr & 0x7f; this.tx = []; }
    write(v: unknown, len?: number) {
      if (typeof v === 'number') { this.tx.push(v & 255); return 1; }
      if (Array.isArray(v)) { const n = len ?? v.length; for (let i = 0; i < n; i++) this.tx.push((v[i] as number) & 255); return n; }
      const b = utf8Bytes(cs(v));
      this.tx.push(...b);
      return b.length;
    }
    endTransmission(_stop = true) {
      const dev = this.devices().get(this.txAddr);
      logI2c(this.sda, this.scl, this.txAddr, false, this.tx, !!dev);
      M.ops += 4 + this.tx.length * 4;
      if (!dev) return 2;
      dev.write(this.tx);
      return 0;
    }
    requestFrom(addr: number, n: number) {
      const dev = this.devices().get(addr & 0x7f);
      M.ops += 4 + n * 4;
      if (!dev) { logI2c(this.sda, this.scl, addr, true, [], false); this.rxBuf = []; return 0; }
      this.rxBuf = dev.read(n);
      logI2c(this.sda, this.scl, addr, true, this.rxBuf, true);
      return this.rxBuf.length;
    }
    available() { return this.rxBuf.length; }
    read() { return this.rxBuf.length ? this.rxBuf.shift()! : -1; }
    peek() { return this.rxBuf.length ? this.rxBuf[0] : -1; }
  }
  const Wire = new TwoWire();

  /** «Осциллограмма» I²C для логического анализатора. */
  function logI2c(sda: number, scl: number, addr: number, read: boolean, data: number[], ack: boolean) {
    if (!M.board?.hasAnalyzer) return;
    const bit = 1e6 / Wire.freq;
    let t = M.now();
    const s: [number, number][] = [[t, 1]];
    const c: [number, number][] = [[t, 1]];
    const push = (arr: [number, number][], v: number) => arr.push([t, v]);
    // START: SDA ↓ при SCL = 1
    t += bit / 2; push(s, 0); t += bit / 2; push(c, 0);
    const sendByte = (b: number, ackBit: number) => {
      for (let i = 7; i >= 0; i--) {
        push(s, (b >> i) & 1); t += bit / 2; push(c, 1); t += bit / 2; push(c, 0);
      }
      push(s, ackBit); t += bit / 2; push(c, 1); t += bit / 2; push(c, 0);
    };
    sendByte((addr << 1) | (read ? 1 : 0), ack ? 0 : 1);
    if (ack) data.forEach((b, i) => sendByte(b, read && i === data.length - 1 ? 1 : 0));
    // STOP
    push(s, 0); t += bit / 2; push(c, 1); t += bit / 2; push(s, 1);
    M.board.logBits(sda, s);
    M.board.logBits(scl, c);
  }

  // ======================= SPI =======================
  class SPISettings { constructor(public freq = 1000000, public order = 1, public mode = 0) {} }
  class SPIClass {
    sck = 18; miso = 19; mosi = 23; ss = 5; freq = 1000000; order = 1; mode = 0;
    begin(sck?: number, miso?: number, mosi?: number, ss?: number) {
      if (sck !== undefined && sck >= 0) this.sck = sck;
      if (miso !== undefined && miso >= 0) this.miso = miso;
      if (mosi !== undefined && mosi >= 0) this.mosi = mosi;
      if (ss !== undefined && ss >= 0) this.ss = ss;
    }
    end() { /* ничего */ }
    beginTransaction(s?: SPISettings) { if (s) { this.freq = s.freq; this.order = s.order; this.mode = s.mode; } }
    endTransaction() { /* ничего */ }
    setFrequency(f: number) { this.freq = f; }
    setDataMode(m: number) { this.mode = m; }
    setBitOrder(o: number) { this.order = o; }
    setClockDivider() { /* ничего */ }
    transfer(b: number) { this.bits([b & 255], 8); return 0; }
    transfer16(v: number) { this.bits([(v >> 8) & 255, v & 255], 8); return 0; }
    transfer32(v: number) { this.bits([(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255], 8); return 0; }
    write(b: number) { this.transfer(b); }
    write16(v: number) { this.transfer16(v); }
    write32(v: number) { this.transfer32(v); }
    transferBytes(data: unknown[], _out: unknown, n: number) { this.bits((data as number[]).slice(0, n), 8); }
    writeBytes(data: unknown[], n: number) { this.bits((data as number[]).slice(0, n), 8); }
    private bits(bytes: number[], width: number) {
      const period = 1e6 / this.freq;
      M.ops += (bytes.length * width * period) / 0.25 + 4;
      if (!M.board?.hasAnalyzer) return;
      const cpol = this.mode >= 2 ? 1 : 0;
      let t = M.now();
      const clk: [number, number][] = [[t, cpol]];
      const dat: [number, number][] = [[t, 0]];
      for (const b of bytes) {
        for (let i = 0; i < width; i++) {
          const bit = this.order === 1 ? (b >> (width - 1 - i)) & 1 : (b >> i) & 1;
          dat.push([t, bit]);
          t += period / 2; clk.push([t, 1 - cpol]);
          t += period / 2; clk.push([t, cpol]);
        }
      }
      M.board.logBits(this.sck, clk);
      M.board.logBits(this.mosi, dat);
    }
  }
  const SPI = new SPIClass();

  // ======================= DHT =======================
  class DHT {
    last = -1e12;
    cache: { t: number; h: number } = { t: NaN, h: NaN };
    begun = false;
    constructor(public pin: number, public type: number = 22) {}
    begin() { this.begun = true; }
    read(force = false): boolean {
      const minInterval = this.type === 11 ? 1000 : 2000;
      const now = M.now() / 1000;
      if (!force && now - this.last < minInterval) return !Number.isNaN(this.cache.t);
      this.last = now;
      M.ops += 20000; // чтение занимает ~5 мс
      const dev = M.board?.deviceAt<DhtModel>('dht22', 'DATA', this.pin);
      if (!dev) {
        M.warnOnce(`dht-${this.pin}`, `Датчик DHT на GPIO${this.pin} не найден — readTemperature() вернёт nan`, 'Проверьте, что вывод DATA датчика подключён к этому GPIO');
        this.cache = { t: NaN, h: NaN };
        return false;
      }
      const r = dev.read();
      if (!r || !dev.powered()) {
        M.warnOnce(`dht-pwr-${this.pin}`, 'Датчик DHT не получает питание', 'Подключите VCC к 3V3, GND — к GND');
        this.cache = { t: NaN, h: NaN };
        return false;
      }
      const expect = r.model === 'DHT11' ? 11 : 22;
      const t = this.type === 21 ? 22 : this.type;
      if (t !== expect) {
        M.warnOnce(`dht-type-${this.pin}`, `В коде указан DHT${t}, а подключён ${r.model}`, `Исправьте тип: DHT dht(${this.pin}, ${r.model});`);
        this.cache = { t: NaN, h: NaN };
        return false;
      }
      if (r.model === 'DHT11') this.cache = { t: Math.round(r.t), h: Math.round(r.h) };
      else this.cache = { t: Math.round(r.t * 10) / 10, h: Math.round(r.h * 10) / 10 };
      return true;
    }
    readTemperature(isF = false, force = false) {
      if (!this.begun) M.warnOnce('dht-begin', 'Не вызван dht.begin()', 'Добавьте dht.begin(); в setup()');
      this.read(!!force);
      const t = this.cache.t;
      return Math.fround(isF ? t * 1.8 + 32 : t);
    }
    readHumidity(force = false) {
      this.read(!!force);
      return Math.fround(this.cache.h);
    }
    convertCtoF(c: number) { return c * 1.8 + 32; }
    convertFtoC(f: number) { return (f - 32) * 0.55555; }
    computeHeatIndex(t: number, h: number, isF = true) {
      let T = isF ? t : t * 1.8 + 32;
      let hi = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + h * 0.094);
      if (hi > 79) {
        hi = -42.379 + 2.04901523 * T + 10.14333127 * h - 0.22475541 * T * h - 0.00683783 * T * T - 0.05481717 * h * h +
          0.00122874 * T * T * h + 0.00085282 * T * h * h - 0.00000199 * T * T * h * h;
      }
      T = hi;
      return isF ? T : (T - 32) * 0.55555;
    }
  }

  // ======================= Servo =======================
  class Servo {
    pin = -1;
    min = 544;
    max = 2400;
    us = 1500;
    hz = 50;
    attach(pin: number, min?: number, max?: number) {
      this.pin = pin;
      if (min !== undefined) this.min = min;
      if (max !== undefined) this.max = max;
      M.gpio[pin].mode = 3;
      this.apply();
      return 1;
    }
    setPeriodHertz(hz: number) { this.hz = hz; }
    detach() {
      if (this.pin >= 0) { M.gpio[this.pin].pwm = null; M.board?.gpioChanged(this.pin); }
      this.pin = -1;
    }
    attached() { return this.pin >= 0; }
    write(v: number) {
      if (v < this.min) {
        const a = Math.max(0, Math.min(180, v));
        this.us = Math.round(this.min + ((this.max - this.min) * a) / 180);
      } else this.us = v;
      this.apply();
    }
    writeMicroseconds(us: number) { this.us = Math.max(this.min, Math.min(this.max, us)); this.apply(); }
    read() { return Math.round(((this.us - this.min) * 180) / (this.max - this.min)); }
    readMicroseconds() { return this.us; }
    private apply() {
      if (this.pin < 0) {
        M.warnOnce('servo-attach', 'Servo.write() до servo.attach(pin)', 'Сначала вызовите servo.attach(номер_вывода)');
        return;
      }
      M.gpio[this.pin].pwm = { freq: this.hz, duty: (this.us * this.hz) / 1e6 };
      M.board?.gpioChanged(this.pin);
    }
  }

  // ======================= LCD 1602 I²C =======================
  class LiquidCrystal_I2C {
    bl = true;
    constructor(public addr: number, public cols = 16, public rows = 2) {}
    dev(): LcdModel | null {
      const d = Wire.devices().get(this.addr);
      if (!d || (d.model as { kind?: string }).kind !== 'lcd1602') {
        M.warnOnce(`lcd-${this.addr}`, `Дисплей по адресу 0x${this.addr.toString(16).toUpperCase()} не отвечает`, 'Проверьте подключение SDA → GPIO21, SCL → GPIO22 и адрес (обычно 0x27)');
        return null;
      }
      M.ops += 40;
      return d.model as LcdModel;
    }
    init() { Wire.begin(); this.dev()?.init(this.cols, this.rows); this.dev()?.setBacklight(true); }
    begin(cols?: number, rows?: number) { if (cols) this.cols = cols; if (rows) this.rows = rows; this.init(); }
    clear() { this.dev()?.clear(); M.ops += 8000; }
    home() { this.dev()?.home(); M.ops += 8000; }
    setCursor(c: number, r: number) { this.dev()?.setCursor(c, r); }
    backlight() { this.bl = true; this.dev()?.setBacklight(true); }
    noBacklight() { this.bl = false; this.dev()?.setBacklight(false); }
    setBacklight(v: number) { if (v) this.backlight(); else this.noBacklight(); }
    display() { this.dev()?.setDisplay(true); }
    noDisplay() { this.dev()?.setDisplay(false); }
    cursor() { this.dev()?.setCursorVisible(true); }
    noCursor() { this.dev()?.setCursorVisible(false); }
    cursor_on() { this.cursor(); }
    cursor_off() { this.noCursor(); }
    blink() { this.dev()?.setBlink(true); }
    noBlink() { this.dev()?.setBlink(false); }
    blink_on() { this.blink(); }
    blink_off() { this.noBlink(); }
    scrollDisplayLeft() { this.dev()?.scroll(-1); }
    scrollDisplayRight() { this.dev()?.scroll(1); }
    leftToRight() { this.dev()?.setDirection(true); }
    rightToLeft() { this.dev()?.setDirection(false); }
    autoscroll() { this.dev()?.setAutoscroll(true); }
    noAutoscroll() { this.dev()?.setAutoscroll(false); }
    createChar(slot: number, rows: unknown[]) { this.dev()?.createChar(slot & 7, (rows as number[]).slice(0, 8)); }
    load_custom_character(slot: number, rows: unknown[]) { this.createChar(slot, rows); }
    private bytes(b: number[]) {
      const d = this.dev();
      if (!d) return b.length;
      for (const x of b) d.writeByte(x);
      return b.length;
    }
    private text(s: string) {
      if (/[^\x00-\x7f]/.test(s)) M.warnOnce('lcd-utf8', 'LCD 1602 не умеет русские буквы — они превратятся в «мусор»', 'Пишите латиницей или нарисуйте свои символы через createChar()');
      return this.bytes(utf8Bytes(s));
    }
    print(v: unknown, fmt?: unknown) { return this.text(printText(v, fmt)); }
    println(v?: unknown, fmt?: unknown) {
      M.warnOnce('lcd-println', 'lcd.println() выводит на LCD два «мусорных» символа (\\r\\n)', 'Используйте lcd.print() и lcd.setCursor(0, 1) для второй строки');
      return this.text((v === undefined ? '' : printText(v, fmt)) + '\r\n');
    }
    printstr(s: unknown) { return this.text(cs(s)); }
    printf(fmt: unknown, ...args: unknown[]) { return this.text(format(cs(fmt), args)); }
    write(v: unknown) { return typeof v === 'number' ? this.bytes([v & 255]) : this.text(cs(v)); }
    flush() { /* ничего */ }
  }

  // ======================= Adafruit GFX + SSD1306 =======================
  class Adafruit_SSD1306 {
    buf: Uint8Array;
    cx = 0; cy = 0; size = 1; sizeY = 1; fg = 1; bg = -1; wrap = true; rot = 0;
    addr = 0x3c;
    constructor(public w = 128, public h = 64) { this.buf = new Uint8Array(w * h); }
    begin(_vcc?: number, addr?: number) {
      if (addr) this.addr = addr;
      Wire.begin();
      const d = this.dev();
      return !!d || true;
    }
    dev(): OledModel | null {
      const d = Wire.devices().get(this.addr);
      if (!d || (d.model as { kind?: string }).kind !== 'oled') {
        M.warnOnce(`oled-${this.addr}`, `OLED-дисплей по адресу 0x${this.addr.toString(16).toUpperCase()} не отвечает`, 'Проверьте SDA → GPIO21, SCL → GPIO22 и адрес 0x3C');
        return null;
      }
      return d.model as OledModel;
    }
    width() { return this.rot & 1 ? this.h : this.w; }
    height() { return this.rot & 1 ? this.w : this.h; }
    display() { M.ops += 4000; this.dev()?.show(this.buf.slice(), this.w, this.h); }
    clearDisplay() { this.buf.fill(0); }
    fillScreen(c: number) { this.buf.fill(c ? 1 : 0); }
    invertDisplay(on: boolean) { this.dev()?.invert(!!on); }
    dim(on: boolean) { this.dev()?.dim(!!on); }
    setRotation(r: number) { this.rot = r & 3; }
    setTextSize(s: number, sy?: number) { this.size = Math.max(1, s); this.sizeY = Math.max(1, sy ?? s); }
    setTextColor(fg: number, bg?: number) { this.fg = fg; this.bg = bg === undefined ? -1 : bg; }
    setCursor(x: number, y: number) { this.cx = x; this.cy = y; }
    getCursorX() { return this.cx; }
    getCursorY() { return this.cy; }
    setTextWrap(w: boolean) { this.wrap = !!w; }
    cp437() { /* ничего */ }
    setFont() { M.warnOnce('gfx-font', 'Свои шрифты GFX не поддерживаются — используется стандартный 5×7'); }
    startscrollright() { /* ничего */ }
    startscrollleft() { /* ничего */ }
    stopscroll() { /* ничего */ }
    getPixel(x: number, y: number) { const p = this.map(x, y); return p ? this.buf[p[1] * this.w + p[0]] === 1 : false; }
    private map(x: number, y: number): [number, number] | null {
      x = Math.round(x); y = Math.round(y);
      let px = x; let py = y;
      switch (this.rot) {
        case 1: px = this.w - 1 - y; py = x; break;
        case 2: px = this.w - 1 - x; py = this.h - 1 - y; break;
        case 3: px = y; py = this.h - 1 - x; break;
      }
      if (px < 0 || py < 0 || px >= this.w || py >= this.h) return null;
      return [px, py];
    }
    drawPixel(x: number, y: number, c: number) {
      const p = this.map(x, y);
      if (!p) return;
      const i = p[1] * this.w + p[0];
      this.buf[i] = c === 2 ? 1 - this.buf[i] : c ? 1 : 0;
    }
    drawFastHLine(x: number, y: number, w: number, c: number) { for (let i = 0; i < w; i++) this.drawPixel(x + i, y, c); }
    drawFastVLine(x: number, y: number, h: number, c: number) { for (let i = 0; i < h; i++) this.drawPixel(x, y + i, c); }
    drawLine(x0: number, y0: number, x1: number, y1: number, c: number) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0); const sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0); const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let guard = 0; guard < 2000; guard++) {
        this.drawPixel(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    drawRect(x: number, y: number, w: number, h: number, c: number) {
      this.drawFastHLine(x, y, w, c); this.drawFastHLine(x, y + h - 1, w, c);
      this.drawFastVLine(x, y, h, c); this.drawFastVLine(x + w - 1, y, h, c);
    }
    fillRect(x: number, y: number, w: number, h: number, c: number) { for (let j = 0; j < h; j++) this.drawFastHLine(x, y + j, w, c); }
    drawCircle(x0: number, y0: number, r: number, c: number) {
      let f = 1 - r; let ddx = 1; let ddy = -2 * r; let x = 0; let y = r;
      this.drawPixel(x0, y0 + r, c); this.drawPixel(x0, y0 - r, c); this.drawPixel(x0 + r, y0, c); this.drawPixel(x0 - r, y0, c);
      while (x < y) {
        if (f >= 0) { y--; ddy += 2; f += ddy; }
        x++; ddx += 2; f += ddx;
        for (const [a, b] of [[x, y], [y, x], [-x, y], [-y, x], [x, -y], [y, -x], [-x, -y], [-y, -x]]) this.drawPixel(x0 + a, y0 + b, c);
      }
    }
    fillCircle(x0: number, y0: number, r: number, c: number) {
      for (let y = -r; y <= r; y++) {
        const dx = Math.floor(Math.sqrt(r * r - y * y));
        this.drawFastHLine(x0 - dx, y0 + y, 2 * dx + 1, c);
      }
    }
    drawRoundRect(x: number, y: number, w: number, h: number, r: number, c: number) {
      this.drawFastHLine(x + r, y, w - 2 * r, c); this.drawFastHLine(x + r, y + h - 1, w - 2 * r, c);
      this.drawFastVLine(x, y + r, h - 2 * r, c); this.drawFastVLine(x + w - 1, y + r, h - 2 * r, c);
      for (let a = 0; a <= 90; a += 3) {
        const rad = (a * Math.PI) / 180;
        const dx = Math.round(r * Math.cos(rad)); const dy = Math.round(r * Math.sin(rad));
        this.drawPixel(x + r - dx, y + r - dy, c); this.drawPixel(x + w - 1 - r + dx, y + r - dy, c);
        this.drawPixel(x + r - dx, y + h - 1 - r + dy, c); this.drawPixel(x + w - 1 - r + dx, y + h - 1 - r + dy, c);
      }
    }
    fillRoundRect(x: number, y: number, w: number, h: number, r: number, c: number) {
      for (let j = 0; j < h; j++) {
        let inset = 0;
        const dy = j < r ? r - j : j >= h - r ? j - (h - r - 1) : 0;
        if (dy) inset = r - Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
        this.drawFastHLine(x + inset, y + j, w - 2 * inset, c);
      }
    }
    drawTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number) {
      this.drawLine(x0, y0, x1, y1, c); this.drawLine(x1, y1, x2, y2, c); this.drawLine(x2, y2, x0, y0, c);
    }
    fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number) {
      const minY = Math.min(y0, y1, y2); const maxY = Math.max(y0, y1, y2);
      const edges = [[x0, y0, x1, y1], [x1, y1, x2, y2], [x2, y2, x0, y0]];
      for (let y = minY; y <= maxY; y++) {
        const xs: number[] = [];
        for (const [ax, ay, bx, by] of edges) {
          if ((y >= ay && y <= by) || (y >= by && y <= ay)) {
            if (ay === by) xs.push(ax, bx);
            else xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
          }
        }
        if (xs.length) { const a = Math.min(...xs); const b = Math.max(...xs); this.drawFastHLine(Math.round(a), y, Math.round(b - a) + 1, c); }
      }
    }
    drawBitmap(x: number, y: number, bmp: unknown[], w: number, h: number, c: number, bg?: number) {
      const bw = Math.ceil(w / 8);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const byte = (bmp[j * bw + (i >> 3)] as number) ?? 0;
          if (byte & (0x80 >> (i & 7))) this.drawPixel(x + i, y + j, c);
          else if (bg !== undefined) this.drawPixel(x + i, y + j, bg);
        }
      }
    }
    drawChar(x: number, y: number, ch: number, c: number, bg: number, size: number) {
      const g = glyph(ch);
      for (let i = 0; i < 6; i++) {
        const col = i < 5 ? g[i] : 0;
        for (let j = 0; j < 8; j++) {
          const on = (col >> j) & 1;
          if (on) { if (size === 1) this.drawPixel(x + i, y + j, c); else this.fillRect(x + i * size, y + j * size, size, size, c); }
          else if (bg >= 0 && bg !== c) { if (size === 1) this.drawPixel(x + i, y + j, bg); else this.fillRect(x + i * size, y + j * size, size, size, bg); }
        }
      }
    }
    write(v: unknown) {
      const bytes = typeof v === 'number' ? [v & 255] : utf8Bytes(cs(v));
      for (const b of bytes) {
        if (b === 10) { this.cx = 0; this.cy += this.sizeY * 8; continue; }
        if (b === 13) continue;
        if (this.wrap && this.cx + this.size * 6 > this.width()) { this.cx = 0; this.cy += this.sizeY * 8; }
        this.drawChar(this.cx, this.cy, b, this.fg, this.bg, this.size);
        this.cx += this.size * 6;
      }
      return bytes.length;
    }
    print(v: unknown, fmt?: unknown) {
      const s = printText(v, fmt);
      if (/[^\x00-\x7f]/.test(s)) M.warnOnce('oled-utf8', 'Стандартный шрифт OLED не содержит русских букв', 'Пишите латиницей');
      return this.write(s);
    }
    println(v?: unknown, fmt?: unknown) { return this.print((v === undefined ? '' : printText(v, fmt)) + '\n'); }
    printf(fmt: unknown, ...args: unknown[]) { return this.write(format(cs(fmt), args)); }
    flush() { /* ничего */ }
  }

  // ======================= NeoPixel =======================
  class Adafruit_NeoPixel {
    px: number[];
    bright = 255;
    begun = false;
    constructor(public n = 1, public pin = -1, public type = 0x52) { this.px = new Array(n).fill(0); }
    static Color(r: number, g: number, b: number, w = 0) { return (((w & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0; }
    static ColorHSV(hue = 0, sat = 255, val = 255) {
      hue = (hue * 1530 + 32768) / 65536;
      hue = Math.floor(hue) % 1530;
      let r: number; let g: number; let b: number;
      if (hue < 510) { b = 0; if (hue < 255) { r = 255; g = hue; } else { r = 510 - hue; g = 255; } }
      else if (hue < 1020) { r = 0; if (hue < 765) { g = 255; b = hue - 510; } else { g = 1020 - hue; b = 255; } }
      else if (hue < 1530) { g = 0; if (hue < 1275) { r = hue - 1020; b = 255; } else { r = 255; b = 1530 - hue; } }
      else { r = 255; g = b = 0; }
      const v1 = 1 + val; const s1 = 1 + sat; const s2 = 255 - sat;
      return (((((((r * s1) >> 8) + s2) * v1) & 0xff00) << 8) | (((((g * s1) >> 8) + s2) * v1) & 0xff00) | (((((b * s1) >> 8) + s2) * v1) >> 8)) >>> 0;
    }
    static gamma8(x: number) { return Math.round(255 * (x / 255) ** 2.6); }
    static gamma32(c: number) {
      const g = Adafruit_NeoPixel.gamma8;
      return ((g((c >>> 24) & 255) << 24) | (g((c >> 16) & 255) << 16) | (g((c >> 8) & 255) << 8) | g(c & 255)) >>> 0;
    }
    Color(r: number, g: number, b: number, w = 0) { return Adafruit_NeoPixel.Color(r, g, b, w); }
    ColorHSV(h?: number, s?: number, v?: number) { return Adafruit_NeoPixel.ColorHSV(h, s, v); }
    gamma32(c: number) { return Adafruit_NeoPixel.gamma32(c); }
    gamma8(x: number) { return Adafruit_NeoPixel.gamma8(x); }
    begin() { this.begun = true; if (this.pin >= 0) M.gpio[this.pin].mode = 3; }
    updateLength(n: number) { this.n = n; this.px = new Array(n).fill(0); }
    setPin(p: number) { this.pin = p; }
    numPixels() { return this.n; }
    setBrightness(b: number) { this.bright = Math.max(0, Math.min(255, b)); }
    getBrightness() { return this.bright; }
    setPixelColor(i: number, r: number, g?: number, b?: number, w?: number) {
      if (i < 0 || i >= this.n) return;
      this.px[i] = g === undefined ? r >>> 0 : Adafruit_NeoPixel.Color(r, g, b ?? 0, w ?? 0);
    }
    getPixelColor(i: number) { return this.px[i] ?? 0; }
    fill(c = 0, first = 0, count = 0) {
      const end = count ? Math.min(this.n, first + count) : this.n;
      for (let i = first; i < end; i++) this.px[i] = c >>> 0;
    }
    clear() { this.px.fill(0); }
    canShow() { return true; }
    rainbow(first = 0, reps = 1, sat = 255, bri = 255) {
      for (let i = 0; i < this.n; i++) this.px[i] = Adafruit_NeoPixel.ColorHSV(first + (i * reps * 65536) / this.n, sat, bri);
    }
    show() {
      if (!this.begun) M.warnOnce('neo-begin', 'Не вызван strip.begin()', 'Добавьте strip.begin(); в setup()');
      const dev = M.board?.deviceAt<NeoModel>('neopixel', 'DIN', this.pin);
      M.ops += this.n * 120;
      if (!dev) {
        M.warnOnce(`neo-${this.pin}`, `Лента NeoPixel на GPIO${this.pin} не найдена`, 'Подключите DIN кольца к этому выводу');
        return;
      }
      const k = (this.bright + 1) / 256;
      dev.show(this.px.map((c) => {
        const r = Math.floor(((c >> 16) & 255) * k); const g = Math.floor(((c >> 8) & 255) * k); const b = Math.floor((c & 255) * k);
        return (r << 16) | (g << 8) | b;
      }));
    }
  }

  // ======================= Preferences (NVS) =======================
  class Preferences {
    ns: Map<string, unknown> | null = null;
    ro = false;
    begin(name: unknown, readOnly = false) {
      const n = cs(name);
      if (n.length > 15) M.warnOnce('nvs-name', `Имя пространства Preferences длиннее 15 символов: «${n}»`);
      if (!M.nvs.has(n)) M.nvs.set(n, new Map());
      this.ns = M.nvs.get(n)!;
      this.ro = !!readOnly;
      return true;
    }
    end() { this.ns = null; }
    private need(): Map<string, unknown> {
      if (!this.ns) throw new Panic('LoadProhibited', 'Preferences: не вызван prefs.begin("имя")');
      return this.ns;
    }
    private put(key: unknown, v: unknown, size: number) {
      const k = cs(key);
      if (k.length > 15) M.warnOnce('nvs-key', `Ключ Preferences длиннее 15 символов: «${k}»`);
      if (this.ro) { M.warnOnce('nvs-ro', 'Preferences открыты только для чтения'); return 0; }
      this.need().set(k, v);
      return size;
    }
    private get<T>(key: unknown, def: T): T { const m = this.need(); const k = cs(key); return m.has(k) ? (m.get(k) as T) : def; }
    clear() { this.need().clear(); return true; }
    remove(k: unknown) { return this.need().delete(cs(k)); }
    isKey(k: unknown) { return this.need().has(cs(k)); }
    freeEntries() { return 500 - this.need().size; }
    putInt(k: unknown, v: number) { return this.put(k, v | 0, 4); }
    getInt(k: unknown, d = 0) { return this.get(k, d); }
    putUInt(k: unknown, v: number) { return this.put(k, v >>> 0, 4); }
    getUInt(k: unknown, d = 0) { return this.get(k, d); }
    putLong(k: unknown, v: number) { return this.put(k, v | 0, 4); }
    getLong(k: unknown, d = 0) { return this.get(k, d); }
    putULong(k: unknown, v: number) { return this.put(k, v >>> 0, 4); }
    getULong(k: unknown, d = 0) { return this.get(k, d); }
    putShort(k: unknown, v: number) { return this.put(k, (v << 16) >> 16, 2); }
    getShort(k: unknown, d = 0) { return this.get(k, d); }
    putUShort(k: unknown, v: number) { return this.put(k, v & 65535, 2); }
    getUShort(k: unknown, d = 0) { return this.get(k, d); }
    putChar(k: unknown, v: number) { return this.put(k, (v << 24) >> 24, 1); }
    getChar(k: unknown, d = 0) { return this.get(k, d); }
    putUChar(k: unknown, v: number) { return this.put(k, v & 255, 1); }
    getUChar(k: unknown, d = 0) { return this.get(k, d); }
    putFloat(k: unknown, v: number) { return this.put(k, Math.fround(v), 4); }
    getFloat(k: unknown, d = NaN) { return this.get(k, d); }
    putDouble(k: unknown, v: number) { return this.put(k, v, 8); }
    getDouble(k: unknown, d = NaN) { return this.get(k, d); }
    putBool(k: unknown, v: boolean) { return this.put(k, !!v, 1); }
    getBool(k: unknown, d = false) { return this.get(k, d); }
    putString(k: unknown, v: unknown) { const s = cs(v); return this.put(k, s, s.length); }
    getString(k: unknown, d: unknown = '') { return String(this.get(k, cs(d))); }
    putBytes(k: unknown, v: unknown[], n: number) { return this.put(k, (v as number[]).slice(0, n), n); }
    getBytes(k: unknown, buf: unknown[], n: number) {
      const v = this.get<number[]>(k, []);
      for (let i = 0; i < Math.min(n, v.length, buf.length); i++) buf[i] = v[i];
      return Math.min(n, v.length);
    }
    getBytesLength(k: unknown) { return this.get<number[]>(k, []).length; }
  }

  // ======================= ESP / GPIO-регистры =======================
  class EspClass {
    *restart() { yield* (M.lib.restart as () => Generator<unknown, void, unknown>)(); }
    *deepSleep(us: number) { yield* (M.lib.deepSleep as (u?: number) => Generator<unknown, void, unknown>)(us); }
    getFreeHeap() { return 290000 - Math.floor(M.rand() * 2000); }
    getHeapSize() { return 327680; }
    getMinFreeHeap() { return 270000; }
    getMaxAllocHeap() { return 110000; }
    getChipModel() { return 'ESP32-D0WDQ6'; }
    getChipRevision() { return 3; }
    getCpuFreqMHz() { return 240; }
    getChipCores() { return 2; }
    getEfuseMac() { return 0x3c71bf112233; }
    getFlashChipSize() { return 4194304; }
    getFlashChipSpeed() { return 40000000; }
    getSdkVersion() { return 'v4.4.7-dirty'; }
    getCycleCount() { return Math.floor(M.now() * 240) >>> 0; }
    getSketchSize() { return 262144; }
    getFreeSketchSpace() { return 1048576; }
    getPsramSize() { return 0; }
    getFreePsram() { return 0; }
  }

  const reg = (addr: number) => ({
    get val() { return F.__regRead(addr); },
    set val(v: number) { F.__regWrite(addr, v); },
    get data() { return F.__regRead(addr); },
    set data(v: number) { F.__regWrite(addr, v); },
  });
  const GPIO = {
    get out() { return F.__regRead(0x3ff44004); }, set out(v: number) { F.__regWrite(0x3ff44004, v); },
    get out_w1ts() { return 0; }, set out_w1ts(v: number) { F.__regWrite(0x3ff44008, v); },
    get out_w1tc() { return 0; }, set out_w1tc(v: number) { F.__regWrite(0x3ff4400c, v); },
    get enable() { return F.__regRead(0x3ff44020); }, set enable(v: number) { F.__regWrite(0x3ff44020, v); },
    get enable_w1ts() { return 0; }, set enable_w1ts(v: number) { F.__regWrite(0x3ff44024, v); },
    get enable_w1tc() { return 0; }, set enable_w1tc(v: number) { F.__regWrite(0x3ff44028, v); },
    get in() { return F.__regRead(0x3ff4403c); }, set in(_v: number) { /* только чтение */ },
    in1: reg(0x3ff44040),
    out1: reg(0x3ff44010),
    out1_w1ts: reg(0x3ff44014),
    out1_w1tc: reg(0x3ff44018),
    enable1: reg(0x3ff4402c),
    enable1_w1ts: reg(0x3ff44030),
    enable1_w1tc: reg(0x3ff44034),
  };

  // ======================= Ticker =======================
  class Ticker {
    ev: number | null = null;
    private arm(periodUs: number, cb: GenFn, arg: unknown, repeat: boolean) {
      this.detach();
      const fire = () => {
        this.ev = repeat ? M.schedule(M.now() + periodUs, fire) : null;
        try { M.runSync(cb, arg === undefined ? [] : [arg], 'Ticker'); } catch (e) { M.crash(e); }
      };
      this.ev = M.schedule(M.now() + periodUs, fire);
    }
    attach(sec: number, cb: GenFn, arg?: unknown) { this.arm(sec * 1e6, cb, arg, true); }
    attach_ms(ms: number, cb: GenFn, arg?: unknown) { this.arm(ms * 1e3, cb, arg, true); }
    once(sec: number, cb: GenFn, arg?: unknown) { this.arm(sec * 1e6, cb, arg, false); }
    once_ms(ms: number, cb: GenFn, arg?: unknown) { this.arm(ms * 1e3, cb, arg, false); }
    detach() { if (this.ev !== null) M.cancel(this.ev); this.ev = null; }
    active() { return this.ev !== null; }
  }

  return {
    Serial: serials[0], Serial1: serials[1], Serial2: serials[2],
    serialPort: (n: number) => serials[n] ?? serials[2],
    HardwareSerial, Wire, TwoWire, SPI, SPIClass, SPISettings, DHT, Servo, LiquidCrystal_I2C,
    Adafruit_SSD1306, Adafruit_NeoPixel, Preferences, ESP: new EspClass(), EspClass, GPIO, Ticker,
  };
}
