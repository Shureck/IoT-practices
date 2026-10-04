// Электрическая модель схемы: сети, узловой анализ (MNA), модели компонентов.
import { DEFS, pinPos, propValue, type CircuitDoc, type Part } from './defs';
import type { Board, I2CDevice, Machine } from '../runtime/machine';
import { Panic } from '../runtime/rt';
import { glyph } from '../runtime/font';

const G_LEAK = 1e-9;
const R_GPIO = 30;
const R_PULL = 45000;

// ---------------- узловой анализ ----------------
interface Diode { a: number; k: number; vf: number; rs: number; on: boolean; i: number }

export class MNA {
  n: number;
  G: Float64Array;
  I: Float64Array;
  edges: [number, number][] = [];
  anchors = new Set<number>();
  constructor(public idx: Int32Array, n: number) {
    this.n = n;
    this.G = new Float64Array(n * n);
    this.I = new Float64Array(n);
  }
  private ix(net: number) { return net < 0 ? -1 : this.idx[net]; }
  /** резистор между сетями */
  r(a: number, b: number, ohm: number, conductive = true) {
    if (a === b || a < 0 || b < 0) return;
    const g = 1 / Math.max(ohm, 1e-4);
    const i = this.ix(a);
    const j = this.ix(b);
    if (i >= 0) this.G[i * this.n + i] += g;
    if (j >= 0) this.G[j * this.n + j] += g;
    if (i >= 0 && j >= 0) { this.G[i * this.n + j] -= g; this.G[j * this.n + i] -= g; }
    if (conductive) this.edges.push([a, b]);
  }
  /** источник напряжения (относительно GND) с внутренним сопротивлением */
  src(a: number, volts: number, ohm: number) {
    if (a < 0) return;
    const i = this.ix(a);
    this.anchors.add(a);
    if (i < 0) return;
    const g = 1 / ohm;
    this.G[i * this.n + i] += g;
    this.I[i] += volts * g;
  }
  /** источник между двумя сетями: V(a) - V(b) = volts через ohm (для модулей с собственной «землёй») */
  srcRel(a: number, ref: number, volts: number, ohm: number) {
    if (a < 0 || ref < 0) return;
    this.r(a, ref, ohm, true);
    const g = 1 / ohm;
    const i = this.ix(a);
    const j = this.ix(ref);
    if (i >= 0) this.I[i] += volts * g;
    if (j >= 0) this.I[j] -= volts * g;
  }
  diode(d: Diode) {
    if (d.a < 0 || d.k < 0 || d.a === d.k) return;
    if (!d.on) { this.r(d.a, d.k, 1e9, false); return; }
    const g = 1 / d.rs;
    this.r(d.a, d.k, d.rs, true);
    const i = this.ix(d.a);
    const j = this.ix(d.k);
    if (i >= 0) this.I[i] += d.vf * g;
    if (j >= 0) this.I[j] -= d.vf * g;
  }
  solve(): Float64Array {
    const n = this.n;
    const A = this.G.slice();
    const b = this.I.slice();
    for (let i = 0; i < n; i++) A[i * n + i] += G_LEAK;
    for (let c = 0; c < n; c++) {
      let p = c;
      let best = Math.abs(A[c * n + c]);
      for (let r = c + 1; r < n; r++) { const v = Math.abs(A[r * n + c]); if (v > best) { best = v; p = r; } }
      if (best < 1e-18) continue;
      if (p !== c) {
        for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; }
        const t = b[c]; b[c] = b[p]; b[p] = t;
      }
      const piv = A[c * n + c];
      for (let r = c + 1; r < n; r++) {
        const f = A[r * n + c] / piv;
        if (f === 0) continue;
        for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
        b[r] -= f * b[c];
      }
    }
    const x = new Float64Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
      const d = A[r * n + r];
      x[r] = Math.abs(d) < 1e-18 ? 0 : s / d;
    }
    return x;
  }
}

/** Среднее значение по времени (яркость при программном ШИМ и т.п.). */
export class Integrator {
  value = 0;
  private acc = 0;
  private last = 0;
  private start = 0;
  set(t: number, v: number) {
    if (t > this.last) { this.acc += this.value * (t - this.last); this.last = t; }
    this.value = v;
  }
  /** среднее с прошлого опроса */
  sample(t: number): number {
    if (t > this.last) { this.acc += this.value * (t - this.last); this.last = t; }
    const dt = t - this.start;
    const r = dt > 0 ? this.acc / dt : this.value;
    this.acc = 0;
    this.start = t;
    return r;
  }
}

// ---------------- базовая модель ----------------
export abstract class Model {
  issues: string[] = [];
  /** номер версии визуального состояния */
  rev = 0;
  constructor(public sim: CircuitSim, public part: Part) {}
  get kind(): string { return this.part.type; }
  net(pin: string): number { return this.sim.pinNet.get(`${this.part.id}:${pin}`) ?? -1; }
  prop<T = string | number | boolean>(k: string): T { return propValue(this.part, k) as T; }
  setProp(k: string, v: string | number | boolean) {
    this.part.props[k] = v;
    this.sim.markDirty();
    this.sim.solveNow();
    this.rev++;
  }
  V(pin: string): number { return this.sim.voltage(this.net(pin)); }
  /** питание модуля: VCC−GND ≥ min */
  powered(vcc = 'VCC', gnd = 'GND', min = 2.8): boolean {
    const nv = this.net(vcc);
    const ng = this.net(gnd);
    if (nv < 0 || ng < 0 || this.sim.isNetFloating(nv) || this.sim.isNetFloating(ng)) return false;
    return this.sim.voltage(nv) - this.sim.voltage(ng) >= min;
  }
  stamp(_m: MNA): void { /* нет электрической модели */ }
  diodes(): Diode[] { return []; }
  update(_t: number): void { /* нет состояния */ }
  /** сериализуемое состояние для отрисовки */
  view(_t: number): Record<string, unknown> { return {}; }
  reset(): void { /* сброс при перезапуске */ }
}

const LED_VF: Record<string, number> = { red: 1.8, orange: 1.9, yellow: 2.0, green: 2.1, blue: 2.9, white: 2.9 };

class LedModel extends Model {
  d: Diode = { a: -1, k: -1, vf: 2, rs: 15, on: false, i: 0 };
  burnt = false;
  bright = new Integrator();
  overload = false;
  diodes(): Diode[] {
    if (this.burnt) return [];
    this.d.a = this.net('A');
    this.d.k = this.net('C');
    this.d.vf = LED_VF[this.prop<string>('color')] ?? 2;
    return [this.d];
  }
  update(t: number) {
    const i = this.d.on ? this.d.i : 0;
    this.issues = [];
    if (!this.burnt && i > 0.06) {
      this.burnt = true;
      this.sim.M?.warnOnce(`led-burn-${this.part.id}`, 'Светодиод сгорел! Ток был ' + Math.round(i * 1000) + ' мА', 'Светодиод подключают через резистор 150–330 Ом');
      this.sim.markDirty();
    }
    this.overload = i > 0.025;
    if (this.overload && !this.burnt) {
      this.issues.push(`Ток ${Math.round(i * 1000)} мА — больше нормы 20 мА. Нужен резистор!`);
      this.sim.M?.warnOnce(`led-over-${this.part.id}`, `Через светодиод течёт ${Math.round(i * 1000)} мА — он перегревается`, 'Добавьте последовательно резистор 220 Ом');
    }
    const va = this.V('A');
    const vk = this.V('C');
    if (!this.burnt && vk - va > 1.5 && !this.sim.isNetFloating(this.net('A'))) this.issues.push('Светодиод включён наоборот: длинная ножка (анод) должна смотреть к «+»');
    const f = this.sim.pwmFactor(this.net('A'), this.net('C'));
    const b = this.burnt ? 0 : Math.min(1, Math.sqrt(Math.max(0, i) / 0.012)) * f;
    this.bright.set(t, b);
  }
  view(t: number) { return { b: this.bright.sample(t), burnt: this.burnt, over: this.overload }; }
  reset() { this.burnt = false; this.bright = new Integrator(); }
}

class RgbModel extends Model {
  ds: Diode[] = [0, 1, 2].map(() => ({ a: -1, k: -1, vf: 2, rs: 20, on: false, i: 0 }));
  br = [new Integrator(), new Integrator(), new Integrator()];
  diodes(): Diode[] {
    const anode = this.prop<string>('common') === 'anode';
    const vfs = [1.9, 2.6, 2.8];
    ['R', 'G', 'B'].forEach((p, i) => {
      const d = this.ds[i];
      d.vf = vfs[i];
      if (anode) { d.a = this.net('COM'); d.k = this.net(p); } else { d.a = this.net(p); d.k = this.net('COM'); }
    });
    return this.ds;
  }
  update(t: number) {
    this.ds.forEach((d, i) => {
      const f = this.sim.pwmFactor(d.a, d.k);
      this.br[i].set(t, d.on ? Math.min(1, Math.sqrt(d.i / 0.012)) * f : 0);
    });
  }
  view(t: number) { return { r: this.br[0].sample(t), g: this.br[1].sample(t), b: this.br[2].sample(t) }; }
}

class ResistorModel extends Model {
  stamp(m: MNA) { m.r(this.net('1'), this.net('2'), Number(this.prop('value')) || 220); }
}

class ButtonModel extends Model {
  pressed = false;
  latched = false;
  stamp(m: MNA) { if (this.pressed) m.r(this.net('1'), this.net('2'), 0.05); }
  press(on: boolean) {
    if (this.pressed === on) return;
    const M = this.sim.M;
    if (this.prop<boolean>('bounce') && M) {
      // дребезг: несколько быстрых переключений за ~3 мс
      const seq = on ? [1, 0, 1, 0, 1, 0, 1] : [0, 1, 0, 1, 0];
      const times = [0, 250, 600, 1100, 1600, 2300, 3000];
      seq.forEach((v, i) => M.schedule(M.now() + times[i], () => this.setState(!!v)));
      this.setState(on);
      return;
    }
    this.setState(on);
  }
  setState(on: boolean) {
    if (this.pressed === on) return;
    this.pressed = on;
    this.rev++;
    this.sim.markDirty();
    this.sim.solveNow();
  }
  view() { return { pressed: this.pressed }; }
  reset() { this.pressed = false; }
}

class SwitchModel extends Model {
  stamp(m: MNA) {
    const on = !!this.prop('on');
    m.r(this.net('C'), this.net(on ? '2' : '1'), 0.05);
  }
  view() { return { on: !!this.prop('on') }; }
}

class PotModel extends Model {
  stamp(m: MNA) {
    const R = Number(this.prop('value')) || 10000;
    const pos = Math.max(0, Math.min(100, Number(this.prop('position')))) / 100;
    m.r(this.net('GND'), this.net('SIG'), Math.max(1, R * pos));
    m.r(this.net('SIG'), this.net('VCC'), Math.max(1, R * (1 - pos)));
  }
  view() { return { pos: Number(this.prop('position')) }; }
}

class LdrModel extends Model {
  stamp(m: MNA) {
    const lux = Math.max(0.01, Number(this.prop('lux')));
    m.r(this.net('1'), this.net('2'), LdrModel.resistance(lux));
  }
  static resistance(lux: number) { return Math.min(2e6, 10000 * (10 / lux) ** 0.75); }
  view() { return { lux: Number(this.prop('lux')) }; }
}

class BuzzerModel extends Model {
  freq = 0;
  stamp(m: MNA) { m.r(this.net('PLUS'), this.net('MINUS'), 42); }
  update() {
    const v = this.V('PLUS') - this.V('MINUS');
    const pwm = this.sim.pwmOf(this.net('PLUS'));
    let f = 0;
    if (this.prop('kind') === 'active') f = v > 2.4 ? 2300 : pwm && pwm.duty > 0 && pwm.freq < 200 ? 2300 : 0;
    else if (pwm && pwm.freq >= 20 && pwm.freq <= 20000 && pwm.duty > 0.02 && pwm.duty < 0.98) f = pwm.freq;
    if (f !== this.freq) { this.freq = f; this.rev++; }
    if (this.prop('kind') !== 'active' && v > 2.4 && !pwm) {
      this.issues = ['Пассивная пищалка от постоянного напряжения молчит — используйте tone()'];
    } else this.issues = [];
  }
  view() { return { freq: this.freq }; }
}

class RelayModel extends Model {
  on = false;
  stamp(m: MNA) {
    const low = this.prop('trigger') === 'low';
    m.r(this.net('IN'), low ? this.net('VCC') : this.net('GND'), 10000);
    if (this.on) m.r(this.net('VCC'), this.net('GND'), 70);
    m.r(this.net('COM'), this.net(this.on ? 'NO' : 'NC'), 0.03);
  }
  update(t: number) {
    const pw = this.powered('VCC', 'GND', 3.0);
    const vin = this.V('IN') - this.V('GND');
    const low = this.prop('trigger') === 'low';
    const want = pw && (low ? vin < 1.0 : vin > 1.6);
    if (want !== this.on) {
      this.on = want;
      this.rev++;
      this.sim.markDirty();
      this.sim.relayClick?.(t);
    }
    this.issues = [];
    const vcc = this.V('VCC') - this.V('GND');
    if (!pw && this.net('IN') >= 0 && !this.sim.isNetFloating(this.net('IN'))) this.issues.push('Модуль реле без питания: подключите VCC и GND');
    else if (pw && vcc < 4.5) this.issues.push('Реле на 5 В: лучше питать VCC от VIN');
  }
  view() { return { on: this.on }; }
  reset() { this.on = false; }
}

class LoadModel extends Model {
  level = new Integrator();
  constructor(sim: CircuitSim, part: Part, private ohm: number, private full: number) { super(sim, part); }
  stamp(m: MNA) { m.r(this.net('1'), this.net('2'), this.ohm); }
  update(t: number) {
    const v = Math.abs(this.V('1') - this.V('2'));
    const f = this.sim.pwmFactor(this.net('1'), this.net('2'));
    this.level.set(t, Math.min(1, v / this.full) * f);
    this.issues = [];
    const g = this.sim.gpioDriving(this.net('1')) ?? this.sim.gpioDriving(this.net('2'));
    if (g !== null && v < 1) this.issues.push(`Вывод GPIO${g} не может питать такую нагрузку — подключите её через реле`);
  }
  view(t: number) { return { level: this.level.sample(t) }; }
}

class ServoModel extends Model {
  angle = 90;
  target = 90;
  lastT = 0;
  stamp(m: MNA) { m.r(this.net('V+'), this.net('GND'), 200); m.r(this.net('PWM'), this.net('GND'), 1e6, false); }
  update(t: number) {
    const pw = this.powered('V+', 'GND', 3.0);
    const pwm = this.sim.pwmOf(this.net('PWM'));
    this.issues = [];
    if (!pw) { if (this.net('PWM') >= 0 && pwm) this.issues.push('Сервопривод без питания: V+ → VIN (5 В), GND → GND'); }
    else if (this.V('V+') - this.V('GND') < 4.4) this.issues.push('Сервоприводу нужно 5 В — подключите V+ к VIN');
    if (pw && pwm && pwm.freq > 0) {
      const us = (pwm.duty / pwm.freq) * 1e6;
      if (us >= 400 && us <= 2700) this.target = Math.max(0, Math.min(180, ((us - 500) / (2400 - 500)) * 180));
      else if (pwm.duty > 0) this.issues.push(`Неверный импульс ${Math.round(us)} мкс (нужно 500–2400 мкс при 50 Гц)`);
    }
    // скорость поворота ~ 60° за 0.12 с
    const dt = Math.max(0, t - this.lastT) / 1e6;
    this.lastT = t;
    const step = 500 * dt;
    const before = this.angle;
    if (Math.abs(this.target - this.angle) <= step) this.angle = this.target;
    else this.angle += Math.sign(this.target - this.angle) * step;
    if (this.angle !== before) this.rev++;
  }
  view() { return { angle: this.angle }; }
  reset() { this.angle = 90; this.target = 90; }
}

class DhtModel extends Model {
  read() {
    if (!this.powered('VCC', 'GND', 3.0)) return null;
    return { t: Number(this.prop('temperature')), h: Number(this.prop('humidity')), model: String(this.prop('model')) };
  }
  view() { return { t: Number(this.prop('temperature')), h: Number(this.prop('humidity')) }; }
}

class HcsrModel extends Model {
  echo = false;
  trigRise = -1;
  trigLevel = 0;
  busyUntil = 0;
  stamp(m: MNA) {
    m.r(this.net('VCC'), this.net('GND'), 330);
    if (this.powered('VCC', 'GND', 3.0)) m.srcRel(this.net('ECHO'), this.net('GND'), this.echo ? this.V('VCC') - this.V('GND') : 0, 100);
  }
  update(t: number) {
    const lvl = this.V('TRIG') - this.V('GND') > 1.5 ? 1 : 0;
    const M = this.sim.M;
    this.issues = [];
    const vcc = this.V('VCC') - this.V('GND');
    if (vcc > 0.5 && vcc < 4.5) this.issues.push('HC-SR04 работает от 5 В — подключите VCC к VIN');
    if (lvl && !this.trigLevel) this.trigRise = t;
    if (!lvl && this.trigLevel && this.trigRise >= 0 && M) {
      const width = t - this.trigRise;
      if (width >= 8 && t >= this.busyUntil && vcc >= 4.5) {
        const dist = Number(this.prop('distance'));
        const dur = dist >= 2 && dist <= 400 ? dist * 58.3 : 38000;
        const start = t + 450;
        this.busyUntil = start + dur + 200;
        M.schedule(start, () => { this.echo = true; this.rev++; this.sim.markDirty(); this.sim.solveNow(); });
        M.schedule(start + dur, () => { this.echo = false; this.rev++; this.sim.markDirty(); this.sim.solveNow(); });
      }
    }
    this.trigLevel = lvl;
  }
  view() { return { d: Number(this.prop('distance')), echo: this.echo }; }
  reset() { this.echo = false; this.busyUntil = 0; this.trigRise = -1; }
}

class PirModel extends Model {
  activeUntil = -1;
  stamp(m: MNA) {
    if (this.powered('VCC', 'GND', 3.0)) m.srcRel(this.net('OUT'), this.net('GND'), this.active() ? 3.3 : 0, 100);
  }
  active() { return (this.sim.M?.now() ?? 0) < this.activeUntil; }
  trigger() {
    const M = this.sim.M;
    if (!M) return;
    const was = this.active();
    this.activeUntil = M.now() + Number(this.prop('hold')) * 1e6;
    M.schedule(this.activeUntil + 1, () => { this.rev++; this.sim.markDirty(); this.sim.solveNow(); });
    if (!was) { this.rev++; this.sim.markDirty(); this.sim.solveNow(); }
  }
  view() { return { active: this.active() }; }
  reset() { this.activeUntil = -1; }
}

class Mq2Model extends Model {
  stamp(m: MNA) {
    m.r(this.net('VCC'), this.net('GND'), 35);
    if (!this.powered('VCC', 'GND', 3.0)) return;
    const vcc = this.V('VCC') - this.V('GND');
    const ppm = Number(this.prop('ppm'));
    const k = Math.max(0.02, Math.min(0.95, 0.1 + 0.33 * Math.log10(Math.max(100, ppm) / 100)));
    m.srcRel(this.net('AO'), this.net('GND'), vcc * k, 1000);
    m.srcRel(this.net('DO'), this.net('GND'), ppm >= Number(this.prop('threshold')) ? 0 : vcc, 1000);
  }
  view() { return { ppm: Number(this.prop('ppm')), alarm: Number(this.prop('ppm')) >= Number(this.prop('threshold')) }; }
}

class LcdModel extends Model implements I2CDevice {
  ddram = new Array(128).fill(32);
  cgram: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));
  cursor = 0;
  shift = 0;
  bl = false;
  disp = true;
  showCursor = false;
  blinkOn = false;
  ltr = true;
  autoscroll = false;
  inited = false;
  get address() { return Number(this.prop('address')); }
  get model() { return this; }
  dims() { return this.prop('size') === '20x4' ? [20, 4] : [16, 2]; }
  write() { /* сырые байты PCF8574 не эмулируются */ }
  read(n: number) { return new Array(n).fill(0); }
  init() { this.inited = true; this.clear(); this.disp = true; this.rev++; }
  clear() { this.ddram.fill(32); this.cursor = 0; this.shift = 0; this.rev++; }
  home() { this.cursor = 0; this.shift = 0; this.rev++; }
  addr(c: number, r: number) {
    const rows = [0x00, 0x40, 0x14, 0x54];
    return (rows[r] ?? 0) + c;
  }
  setCursor(c: number, r: number) {
    const [, rows] = this.dims();
    this.cursor = this.addr(Math.max(0, c), Math.max(0, Math.min(rows - 1, r)));
  }
  writeByte(b: number) {
    this.ddram[this.cursor & 0x7f] = b & 255;
    // адресация HD44780: строки 0x00–0x27 и 0x40–0x67
    if (this.ltr) { this.cursor++; if (this.cursor === 0x28) this.cursor = 0x40; else if (this.cursor === 0x68) this.cursor = 0; }
    else { this.cursor--; if (this.cursor < 0) this.cursor = 0x67; }
    if (this.autoscroll) this.shift += this.ltr ? 1 : -1;
    this.rev++;
  }
  setBacklight(on: boolean) { this.bl = on; this.rev++; }
  setDisplay(on: boolean) { this.disp = on; this.rev++; }
  setCursorVisible(on: boolean) { this.showCursor = on; this.rev++; }
  setBlink(on: boolean) { this.blinkOn = on; this.rev++; }
  createChar(slot: number, rows: number[]) { this.cgram[slot & 7] = rows.map((x) => x & 31).concat(new Array(8).fill(0)).slice(0, 8); this.rev++; }
  scroll(dir: number) { this.shift -= dir; this.rev++; }
  setDirection(ltr: boolean) { this.ltr = ltr; }
  setAutoscroll(on: boolean) { this.autoscroll = on; }
  /** текст строк (для проверок): символы ASCII как есть */
  lines(): string[] {
    const [cols, rows] = this.dims();
    const out: string[] = [];
    for (let r = 0; r < rows; r++) {
      let s = '';
      for (let c = 0; c < cols; c++) {
        const base = r % 2 === 0 ? 0 : 0x40;
        const off = r >= 2 ? cols : 0;
        const pos = ((c + off + this.shift) % 40 + 40) % 40;
        const code = this.ddram[base + pos];
        s += code >= 32 && code < 127 ? String.fromCharCode(code) : code < 8 ? '□' : '▓';
      }
      out.push(s);
    }
    return out;
  }
  /** пиксели символов для отрисовки */
  glyphs(): number[][][] {
    const [cols, rows] = this.dims();
    const res: number[][][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const base = r % 2 === 0 ? 0 : 0x40;
        const off = r >= 2 ? cols : 0;
        const pos = ((c + off + this.shift) % 40 + 40) % 40;
        const code = this.ddram[base + pos];
        if (code < 16) {
          const rowsBits = this.cgram[code & 7];
          res.push(rowsBits.map((bits) => [4, 3, 2, 1, 0].map((k) => (bits >> k) & 1)));
        } else {
          const g = glyph(code);
          res.push(Array.from({ length: 8 }, (_, y) => g.map((col) => (col >> y) & 1)));
        }
      }
    }
    return res;
  }
  view() {
    const [cols, rows] = this.dims();
    const on = this.powered('VCC', 'GND', 3.0);
    const codes: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const base = r % 2 === 0 ? 0 : 0x40;
        const off = r >= 2 ? cols : 0;
        codes.push(this.ddram[base + (((c + off + this.shift) % 40) + 40) % 40]);
      }
    }
    return { cols, rows, on, bl: on && this.bl, disp: this.disp, codes, cg: this.cgram, rev: this.rev, cursor: this.showCursor || this.blinkOn ? this.cursor : -1 };
  }
  reset() { this.ddram.fill(32); this.cursor = 0; this.shift = 0; this.bl = false; this.inited = false; }
}

class OledModel extends Model implements I2CDevice {
  buf: Uint8Array<ArrayBufferLike> = new Uint8Array(128 * 64);
  inv = false;
  dimmed = false;
  get address() { return Number(this.prop('address')); }
  get model() { return this; }
  write() { /* не эмулируется */ }
  read(n: number) { return new Array(n).fill(0); }
  show(b: Uint8Array) { this.buf = b; this.rev++; }
  invert(on: boolean) { this.inv = on; this.rev++; }
  dim(on: boolean) { this.dimmed = on; this.rev++; }
  view() { return { on: this.powered('VCC', 'GND', 2.8), inv: this.inv, dim: this.dimmed, rev: this.rev }; }
  reset() { this.buf = new Uint8Array(128 * 64); this.inv = false; }
}

class NeoModel extends Model {
  colors: number[] = [];
  show(c: number[]) {
    const n = Number(this.prop('count'));
    if (!this.powered('VCC', 'GND', 3.0)) return;
    this.colors = c.slice(0, n);
    this.rev++;
  }
  view() { return { colors: this.colors, n: Number(this.prop('count')), on: this.powered('VCC', 'GND', 3.0) }; }
  reset() { this.colors = []; }
}

export interface AnalyzerTrace { t: number[]; v: number[] }

class LogicModel extends Model {
  traces: AnalyzerTrace[] = Array.from({ length: 8 }, () => ({ t: [], v: [] }));
  lastLevel = new Array(8).fill(-1);
  stamp(m: MNA) { for (let i = 0; i < 8; i++) m.r(this.net(`D${i}`), this.net('GND'), 1e6, false); }
  record(ch: number, t: number, v: number) {
    const tr = this.traces[ch];
    if (tr.v.length && tr.v[tr.v.length - 1] === v && tr.t[tr.t.length - 1] <= t) return;
    // вставка с сохранением порядка по времени
    let i = tr.t.length;
    while (i > 0 && tr.t[i - 1] > t) i--;
    tr.t.splice(i, 0, t);
    tr.v.splice(i, 0, v);
    if (tr.t.length > 40000) { tr.t.splice(0, 10000); tr.v.splice(0, 10000); }
    this.rev++;
  }
  update(t: number) {
    for (let i = 0; i < 8; i++) {
      const n = this.net(`D${i}`);
      if (n < 0) continue;
      const v = this.sim.isNetFloating(n) ? 0 : this.sim.voltage(n) > 1.5 ? 1 : 0;
      if (v !== this.lastLevel[i]) { this.lastLevel[i] = v; this.record(i, t, v); }
    }
  }
  channelsForNet(net: number): number[] {
    const r: number[] = [];
    for (let i = 0; i < 8; i++) if (this.net(`D${i}`) === net && net >= 0) r.push(i);
    return r;
  }
  view() { return { rev: this.rev }; }
  reset() { this.traces = Array.from({ length: 8 }, () => ({ t: [], v: [] })); this.lastLevel.fill(-1); }
}

class UartBoxModel extends Model {
  txLevel = 1;
  counter = 0;
  received = '';
  ev: number | null = null;
  started = false;
  stamp(m: MNA) {
    if (this.powered('VCC', 'GND', 2.8)) m.srcRel(this.net('TX'), this.net('GND'), this.txLevel ? 3.3 : 0, 100);
  }
  start() {
    const M = this.sim.M;
    if (!M || this.started) return;
    this.started = true;
    const tick = () => {
      this.ev = M.schedule(M.now() + 1_000_000, tick);
      if (!this.powered('VCC', 'GND', 2.8)) return;
      const mode = String(this.prop('mode'));
      if (mode === 'beacon') this.send(`STATION-5 #${++this.counter} T=${(-21.4 + Math.sin(this.counter / 3) * 2).toFixed(1)} OK\r\n`);
      else if (mode === 'cipher') this.send(`${caesar(String(this.prop('secret')).toUpperCase(), 3)}\r\n`);
      else if (mode === 'gps') this.send(nmea(++this.counter));
    };
    this.ev = M.schedule(M.now() + 500_000, tick);
  }
  send(text: string) {
    const bytes = Array.from(new TextEncoder().encode(text));
    this.sim.deliverUart(this.net('TX'), bytes, Number(this.prop('baud')));
  }
  receive(bytes: number[], baud: number) {
    const mine = Number(this.prop('baud'));
    if (Math.abs(baud - mine) / mine > 0.05) bytes = bytes.map((b) => garble(b, baud, mine));
    const text = new TextDecoder().decode(new Uint8Array(bytes));
    this.received = (this.received + text).slice(-500);
    this.rev++;
    const mode = String(this.prop('mode'));
    let idx: number;
    while ((idx = this.received.search(/[\r\n]/)) >= 0) {
      const line = this.received.slice(0, idx).trim();
      this.received = this.received.slice(idx + 1);
      if (!line) continue;
      if (mode === 'echo') this.send(`ECHO: ${line.toUpperCase()}\r\n`);
      else if (mode === 'cipher' && line.toUpperCase() === 'KEY?') this.send('KEY=3\r\n');
      else if (mode === 'cipher' && line.toUpperCase() === String(this.prop('secret')).toUpperCase()) this.send('ACCESS GRANTED\r\n');
      else if (mode === 'beacon' && line.toUpperCase() === 'STATUS?') this.send('STATUS: ALL SYSTEMS NOMINAL\r\n');
    }
  }
  view() { return { rx: this.received, on: this.powered('VCC', 'GND', 2.8) }; }
  reset() { if (this.ev !== null && this.sim.M) this.sim.M.cancel(this.ev); this.started = false; this.counter = 0; this.received = ''; }
}

function caesar(s: string, k: number) {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + k) % 26) + 65));
}
function garble(b: number, from: number, to: number) {
  const x = (b * 2654435761 + Math.round(from / to * 1000)) >>> 0;
  return 128 + (x % 120);
}
function nmea(n: number) {
  const lat = 6904.25 + Math.sin(n / 10) * 0.05;
  const lon = 3304.12 + Math.cos(n / 10) * 0.05;
  const hh = String(10 + Math.floor(n / 3600) % 14).padStart(2, '0');
  const mm = String(Math.floor(n / 60) % 60).padStart(2, '0');
  const ss = String(n % 60).padStart(2, '0');
  const body = `GPGGA,${hh}${mm}${ss}.00,${lat.toFixed(2)},N,${lon.toFixed(2)},E,1,07,1.2,42.0,M,15.0,M,,`;
  let cs = 0;
  for (const c of body) cs ^= c.charCodeAt(0);
  return `$${body}*${cs.toString(16).toUpperCase().padStart(2, '0')}\r\n`;
}

class I2cBoxModel extends Model implements I2CDevice {
  regs = new Array(256).fill(0);
  ptr = 0;
  led = false;
  get address() { return Number(this.prop('address')); }
  get model() { return this; }
  init() {
    this.regs.fill(0);
    this.regs[0x00] = 0x5a;
    const secret = String(this.prop('secret')).slice(0, 8);
    for (let i = 0; i < secret.length; i++) this.regs[0x01 + i] = secret.charCodeAt(i);
    this.regs[0x0f] = 0x13;
    this.regs[0x10] = 0xeb; // −21 °C
  }
  write(bytes: number[]) {
    if (!bytes.length) return;
    if (!this.regs[0]) this.init();
    this.ptr = bytes[0] & 255;
    for (let i = 1; i < bytes.length; i++) this.regs[(this.ptr + i - 1) & 255] = bytes[i] & 255;
    if (bytes.length > 1 && this.ptr <= 0x30 && this.ptr + bytes.length - 1 > 0x30) {
      this.led = (this.regs[0x30] & 1) === 1;
      this.rev++;
    }
  }
  read(n: number) {
    if (!this.regs[0]) this.init();
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.ptr === 0x11) this.regs[0x11] = (this.regs[0x11] + 1) & 255;
      out.push(this.regs[this.ptr & 255]);
      this.ptr = (this.ptr + 1) & 255;
    }
    return out;
  }
  view() { return { led: this.led, on: this.powered('VCC', 'GND', 2.8) }; }
  reset() { this.regs.fill(0); this.ptr = 0; this.led = false; }
}

class EspModel extends Model {
  led: Diode = { a: -1, k: -1, vf: 2.7, rs: 1000, on: false, i: 0 };
  ledBright = new Integrator();
  diodes() {
    // встроенный синий светодиод на GPIO2 (через резистор 1 кОм на GND)
    this.led.a = this.sim.gpioNet.get(2) ?? -1;
    this.led.k = this.net('GND.1');
    return [this.led];
  }
  update(t: number) {
    const f = this.sim.pwmFactor(this.led.a, this.led.k);
    this.ledBright.set(t, this.led.on ? Math.min(1, Math.sqrt(this.led.i / 0.0003)) * f : 0);
  }
  view(t: number) { return { led: this.ledBright.sample(t), power: !this.sim.shortCircuit }; }
}

class PassiveModel extends Model {}

function makeModel(sim: CircuitSim, p: Part): Model {
  switch (p.type) {
    case 'esp32': return new EspModel(sim, p);
    case 'led': return new LedModel(sim, p);
    case 'rgb': return new RgbModel(sim, p);
    case 'resistor': return new ResistorModel(sim, p);
    case 'button': return new ButtonModel(sim, p);
    case 'switch': return new SwitchModel(sim, p);
    case 'pot': return new PotModel(sim, p);
    case 'ldr': return new LdrModel(sim, p);
    case 'buzzer': return new BuzzerModel(sim, p);
    case 'relay': return new RelayModel(sim, p);
    case 'motor': return new LoadModel(sim, p, 12, 4.5);
    case 'lamp': return new LoadModel(sim, p, 30, 4.8);
    case 'lock': return new LoadModel(sim, p, 20, 3.5);
    case 'servo': return new ServoModel(sim, p);
    case 'dht22': return new DhtModel(sim, p);
    case 'hcsr04': return new HcsrModel(sim, p);
    case 'pir': return new PirModel(sim, p);
    case 'mq2': return new Mq2Model(sim, p);
    case 'lcd1602': return new LcdModel(sim, p);
    case 'oled': return new OledModel(sim, p);
    case 'neopixel': return new NeoModel(sim, p);
    case 'logic': return new LogicModel(sim, p);
    case 'uartbox': return new UartBoxModel(sim, p);
    case 'i2cbox': return new I2cBoxModel(sim, p);
    default: return new PassiveModel(sim, p);
  }
}

export type {
  LedModel, RgbModel, ButtonModel, ServoModel, LcdModel, OledModel, NeoModel, LogicModel, PirModel, HcsrModel,
  RelayModel, LoadModel, BuzzerModel, UartBoxModel, I2cBoxModel, EspModel, DhtModel,
};

// ---------------- схема ----------------
export class CircuitSim implements Board {
  M: Machine | null = null;
  models = new Map<string, Model>();
  pinNet = new Map<string, number>();
  netCount = 0;
  gpioNet = new Map<number, number>();
  netGpios = new Map<number, number[]>();
  /** соседние сети через один резистор (для оценки ШИМ) */
  neighbors = new Map<number, number[]>();
  gnd = -1;
  v33 = -1;
  vin = -1;
  V = new Float64Array(0);
  floating = new Uint8Array(0);
  dirty = true;
  solving = false;
  version = 0;
  shortCircuit: string | null = null;
  hasAnalyzer = false;
  /** у сети есть что-то кроме вывода ESP32 */
  netLoaded = new Uint8Array(0);
  relayClick?: (t: number) => void;
  overcurrent = new Set<number>();

  constructor(public doc: CircuitDoc) {
    this.build();
  }

  attach(M: Machine) {
    this.M = M;
    M.board = this;
    for (const m of this.models.values()) { m.reset(); if (m instanceof UartBoxModel) m.start(); }
    this.dirty = true;
  }

  // ---------- построение сетей ----------
  build() {
    const keys: string[] = [];
    const id = new Map<string, number>();
    const add = (k: string) => { if (!id.has(k)) { id.set(k, keys.length); keys.push(k); } return id.get(k)!; };
    const parent: number[] = [];
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a: number, b: number) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };
    const posIndex = new Map<string, number[]>();
    this.models.clear();
    for (const p of this.doc.parts) {
      const def = DEFS[p.type];
      if (!def) continue;
      this.models.set(p.id, makeModel(this, p));
      for (const pin of def.pins) {
        const k = add(`${p.id}:${pin.name}`);
        parent[k] = k;
        const pos = pinPos(p, pin.name)!;
        const pk = `${Math.round(pos[0])},${Math.round(pos[1])}`;
        const arr = posIndex.get(pk) ?? [];
        arr.push(k);
        posIndex.set(pk, arr);
      }
      for (const group of def.bus ?? []) {
        for (let i = 1; i < group.length; i++) union(id.get(`${p.id}:${group[0]}`)!, id.get(`${p.id}:${group[i]}`)!);
      }
    }
    // выводы, совпавшие по координатам (ножка в отверстии макетки)
    for (const arr of posIndex.values()) for (let i = 1; i < arr.length; i++) union(arr[0], arr[i]);
    for (const w of this.doc.wires) {
      const a = id.get(`${w.a.part}:${w.a.pin}`);
      const b = id.get(`${w.b.part}:${w.b.pin}`);
      if (a !== undefined && b !== undefined) union(a, b);
    }
    const rootNet = new Map<number, number>();
    this.pinNet.clear();
    for (let i = 0; i < keys.length; i++) {
      const r = find(i);
      if (!rootNet.has(r)) rootNet.set(r, rootNet.size);
      this.pinNet.set(keys[i], rootNet.get(r)!);
    }
    this.netCount = rootNet.size;
    // ESP32
    const esp = this.doc.parts.find((p) => p.type === 'esp32');
    this.gpioNet.clear();
    this.netGpios.clear();
    if (esp) {
      const net = (pin: string) => this.pinNet.get(`${esp.id}:${pin}`) ?? -1;
      this.gnd = net('GND.1');
      this.v33 = net('3V3');
      this.vin = net('VIN');
      for (const pin of DEFS.esp32.pins) {
        if (pin.gpio === undefined) continue;
        const n = net(pin.name);
        this.gpioNet.set(pin.gpio, n);
        const list = this.netGpios.get(n) ?? [];
        list.push(pin.gpio);
        this.netGpios.set(n, list);
      }
    } else {
      this.gnd = -1; this.v33 = -1; this.vin = -1;
    }
    this.shortCircuit = null;
    if (esp) {
      if (this.v33 === this.gnd) this.shortCircuit = '3V3 замкнут на GND';
      else if (this.vin === this.gnd) this.shortCircuit = 'VIN (5 В) замкнут на GND';
      else if (this.vin === this.v33) this.shortCircuit = 'VIN (5 В) замкнут на 3V3';
    }
    // соседи через резистор
    this.neighbors.clear();
    const loaded = new Uint8Array(this.netCount);
    for (const p of this.doc.parts) {
      const def = DEFS[p.type];
      if (!def || p.type === 'esp32' || p.type === 'breadboard') continue;
      for (const pin of def.pins) { const n = this.pinNet.get(`${p.id}:${pin.name}`); if (n !== undefined) loaded[n] = 1; }
      if (p.type === 'resistor') {
        const a = this.pinNet.get(`${p.id}:1`)!;
        const b = this.pinNet.get(`${p.id}:2`)!;
        this.neighbors.set(a, [...(this.neighbors.get(a) ?? []), b]);
        this.neighbors.set(b, [...(this.neighbors.get(b) ?? []), a]);
      }
    }
    // GPIO2 всегда нагружен встроенным светодиодом
    const n2 = this.gpioNet.get(2);
    if (n2 !== undefined && n2 >= 0) loaded[n2] = 1;
    this.netLoaded = loaded;
    this.hasAnalyzer = this.doc.parts.some((p) => p.type === 'logic');
    this.V = new Float64Array(this.netCount);
    this.floating = new Uint8Array(this.netCount).fill(1);
    this.dirty = true;
  }

  /** Перестроить после редактирования схемы, сохранив состояние моделей по id. */
  rebuild(doc: CircuitDoc) {
    const old = this.models;
    this.doc = doc;
    this.build();
    for (const [id, m] of this.models) {
      const prev = old.get(id);
      if (prev && prev.part.type === m.part.type) {
        // переносим динамическое состояние
        for (const k of Object.keys(prev)) {
          if (k === 'sim' || k === 'part' || k === 'issues') continue;
          (m as unknown as Record<string, unknown>)[k] = (prev as unknown as Record<string, unknown>)[k];
        }
        m.part = doc.parts.find((p) => p.id === id)!;
      }
    }
    if (this.M) for (const m of this.models.values()) if (m instanceof UartBoxModel && !m.started) m.start();
    this.solveNow();
  }

  model<T extends Model = Model>(id: string): T | undefined { return this.models.get(id) as T | undefined; }

  markDirty() { this.dirty = true; }

  voltage(net: number): number { this.ensure(); return net >= 0 && net < this.V.length ? this.V[net] : 0; }
  isNetFloating(net: number): boolean { this.ensure(); return net < 0 || !!this.floating[net]; }

  private ensure() { if (this.dirty && !this.solving) this.solveNow(); }

  // ---------- Board API ----------
  gpioChanged(pin: number) {
    this.dirty = true;
    const n = this.gpioNet.get(pin);
    if (n !== undefined && n >= 0 && this.netLoaded[n]) this.solveNow();
  }

  readDigital(pin: number): number {
    const n = this.gpioNet.get(pin);
    if (n === undefined || n < 0) return 0;
    this.ensure();
    if (this.floating[n]) {
      const M = this.M;
      if (M) {
        M.warnOnce(`float-${pin}`, `Вход GPIO${pin} «висит в воздухе» — значение случайное`, `Включите подтяжку: pinMode(${pin}, INPUT_PULLUP) или INPUT_PULLDOWN, либо поставьте резистор 10 кОм`);
        // шум меняется примерно раз в 3 мс
        const slot = Math.floor(M.now() / 3000);
        return ((slot * 2654435761 + pin * 97) >>> 0) % 3 === 0 ? 1 : 0;
      }
      return 0;
    }
    return this.V[n] > 1.65 ? 1 : 0;
  }

  readVoltage(pin: number): number {
    const n = this.gpioNet.get(pin);
    if (n === undefined || n < 0) return 0;
    this.ensure();
    return this.V[n];
  }

  isFloating(pin: number): boolean {
    const n = this.gpioNet.get(pin);
    if (n === undefined || n < 0) return true;
    this.ensure();
    return !!this.floating[n];
  }

  deviceAt<T>(type: string | string[], pinName: string, gpio: number): T | null {
    const n = this.gpioNet.get(gpio);
    if (n === undefined || n < 0) return null;
    const types = Array.isArray(type) ? type : [type];
    for (const m of this.models.values()) {
      if (types.includes(m.part.type) && m.net(pinName) === n) return m as unknown as T;
    }
    return null;
  }

  i2cDevices(sda: number, scl: number): Map<number, I2CDevice> {
    const res = new Map<number, I2CDevice>();
    const ns = this.gpioNet.get(sda);
    const nc = this.gpioNet.get(scl);
    if (ns === undefined || nc === undefined || ns < 0 || nc < 0) return res;
    for (const m of this.models.values()) {
      if (!(m instanceof LcdModel || m instanceof OledModel || m instanceof I2cBoxModel)) continue;
      if (m.net('SDA') !== ns || m.net('SCL') !== nc) continue;
      if (!m.powered('VCC', 'GND', 2.7)) continue;
      res.set(m.address, m as unknown as I2CDevice);
    }
    return res;
  }

  tick(t: number) {
    if (this.dirty) this.solveNow();
    else for (const m of this.models.values()) if (m instanceof ServoModel) m.update(t);
  }

  logBits(gpio: number, events: [number, number][]) {
    const n = this.gpioNet.get(gpio);
    if (n === undefined || n < 0) return;
    for (const m of this.models.values()) {
      if (!(m instanceof LogicModel)) continue;
      for (const ch of m.channelsForNet(n)) for (const [t, v] of events) m.record(ch, t, v);
    }
  }

  uartTx(txPin: number, bytes: number[], baud: number) {
    const n = this.gpioNet.get(txPin);
    if (n === undefined || n < 0) return;
    if (this.hasAnalyzer && this.M) this.logBits(txPin, uartWave(bytes, baud, this.M.now()));
    for (const m of this.models.values()) {
      if (m instanceof UartBoxModel && m.net('RX') === n && m.powered('VCC', 'GND', 2.8)) m.receive(bytes, baud);
    }
  }

  /** Байты от устройства в ESP32: в UART, чей RX подключён к этой сети. */
  deliverUart(net: number, bytes: number[], baud: number) {
    const M = this.M;
    if (!M || net < 0) return;
    const serials = M.lib.serials as { rxPin: number; baud: number; begun: boolean; receive(b: number[]): void }[] | undefined;
    const gpios = this.netGpios.get(net) ?? [];
    if (this.hasAnalyzer) for (const g of gpios) this.logBits(g, uartWave(bytes, baud, M.now()));
    for (const s of serials ?? []) {
      if (!s.begun || !gpios.includes(s.rxPin)) continue;
      const ok = Math.abs(s.baud - baud) / baud < 0.05;
      s.receive(ok ? bytes : bytes.map((b) => garble(b, baud, s.baud)));
      if (!ok) M.warnOnce(`uart-baud-${s.rxPin}`, `Скорость UART не совпадает: устройство передаёт на ${baud}, а порт настроен на ${s.baud}`, 'Скорости приёмника и передатчика должны совпадать');
    }
  }

  // ---------- ШИМ ----------
  pwmOf(net: number): { freq: number; duty: number } | null {
    if (net < 0 || !this.M) return null;
    for (const g of this.netGpios.get(net) ?? []) {
      const st = this.M.gpio[g];
      if (st.pwm && (st.mode === 3 || st.mode === 19)) return st.pwm;
    }
    return null;
  }

  /** Множитель яркости для элемента между сетями a и k с учётом ШИМ. */
  pwmFactor(a: number, k: number): number {
    const side = (net: number): number | null => {
      const p = this.pwmOf(net);
      if (p) return p.duty;
      for (const nb of this.neighbors.get(net) ?? []) { const q = this.pwmOf(nb); if (q) return q.duty; }
      return null;
    };
    const fa = side(a);
    const fk = side(k);
    return (fa ?? 1) * (fk === null ? 1 : 1 - fk);
  }

  gpioDriving(net: number): number | null {
    if (!this.M || net < 0) return null;
    for (const g of this.netGpios.get(net) ?? []) if (this.M.gpio[g].mode === 3) return g;
    return null;
  }

  // ---------- решение ----------
  solveNow() {
    if (this.solving) return;
    this.solving = true;
    try {
      this.solveInner();
    } finally {
      this.solving = false;
      this.dirty = false;
    }
    this.version++;
    const M = this.M;
    if (!M) return;
    const t = M.now();
    for (const m of this.models.values()) m.update(t);
    // уровни для прерываний
    const onLevel = M.lib.onLevel as ((pin: number, lvl: number) => void) | undefined;
    if (onLevel) {
      for (let pin = 0; pin < 40; pin++) {
        if (!M.gpio[pin].isr) continue;
        const n = this.gpioNet.get(pin);
        if (n === undefined || n < 0) continue;
        const lvl = this.floating[n] ? M.gpio[pin].lastLevel : this.V[n] > 1.65 ? 1 : 0;
        onLevel(pin, lvl);
      }
    }
    if (this.dirty) {
      // модели изменили состояние (реле щёлкнуло) — пересчитываем ещё раз
      this.solving = true;
      try { this.solveInner(); } finally { this.solving = false; this.dirty = false; }
      for (const m of this.models.values()) m.update(t);
    }
  }

  private solveInner() {
    const n = this.netCount;
    const idx = new Int32Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) idx[i] = i === this.gnd ? -1 : k++;
    const diodes: Diode[] = [];
    for (const m of this.models.values()) diodes.push(...m.diodes());
    let mna: MNA = new MNA(idx, k);
    let x: Float64Array<ArrayBufferLike> = new Float64Array(k);
    const volt = (net: number) => (net < 0 || net === this.gnd ? 0 : x[idx[net]]);
    for (let iter = 0; iter < 16; iter++) {
      mna = new MNA(idx, k);
      this.stampBoard(mna);
      for (const m of this.models.values()) m.stamp(mna);
      for (const d of diodes) mna.diode(d);
      x = mna.solve();
      let changed = false;
      for (const d of diodes) {
        const vd = volt(d.a) - volt(d.k);
        const on = d.on ? vd - d.vf > -1e-6 && (vd - d.vf) / d.rs > -1e-7 : vd > d.vf + 1e-6;
        if (on !== d.on) { d.on = on; changed = true; }
      }
      if (!changed) break;
    }
    for (const d of diodes) d.i = d.on ? Math.max(0, (volt(d.a) - volt(d.k) - d.vf) / d.rs) : 0;
    const V = new Float64Array(n);
    for (let i = 0; i < n; i++) V[i] = volt(i);
    this.V = V;
    // плавающие сети: нет проводящего пути до источника
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (const [a, b] of mna.edges) { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; }
    const anchored = new Set<number>();
    if (this.gnd >= 0) anchored.add(find(this.gnd));
    for (const a of mna.anchors) anchored.add(find(a));
    const fl = new Uint8Array(n);
    for (let i = 0; i < n; i++) fl[i] = anchored.has(find(i)) ? 0 : 1;
    this.floating = fl;
    // перегрузка выводов
    const M = this.M;
    if (M) {
      for (const [pin, net] of this.gpioNet) {
        const g = M.gpio[pin];
        if (g.mode !== 3 || net < 0) continue;
        const vs = g.out || (g.pwm && g.pwm.duty > 0) ? 3.3 : 0;
        const i = Math.abs(vs - V[net]) / R_GPIO;
        if (i > 0.04) {
          if (!this.overcurrent.has(pin)) {
            this.overcurrent.add(pin);
            M.warnOnce(`gpio-over-${pin}`, `Вывод GPIO${pin} перегружен: ток ${Math.round(i * 1000)} мА (максимум 40 мА)`,
              V[net] < 0.5 && vs > 0 ? 'Похоже, вывод напрямую соединён с GND — нужен резистор или нагрузка' : 'Мощную нагрузку подключайте через реле или транзистор');
          }
        } else this.overcurrent.delete(pin);
      }
      if (this.shortCircuit && M.status === 'running') {
        M.crash(new Panic('Brownout detector was triggered', `Короткое замыкание: ${this.shortCircuit}`, 'Плата отключилась. Уберите провод, замыкающий питание'));
      }
    }
  }

  private stampBoard(m: MNA) {
    if (this.gnd < 0) return;
    if (!this.shortCircuit) {
      m.src(this.v33, 3.3, 0.05);
      m.src(this.vin, 5.0, 0.05);
    }
    m.anchors.add(this.gnd);
    const M = this.M;
    if (!M) return;
    for (const [pin, net] of this.gpioNet) {
      if (net < 0) continue;
      const g = M.gpio[pin];
      switch (g.mode) {
        case 3: m.src(net, g.out || (g.pwm && g.pwm.duty > 0) ? 3.3 : 0, R_GPIO); break;
        case 19: if (!g.out) m.src(net, 0, R_GPIO); break;
        case 5: m.src(net, 3.3, R_PULL); break;
        case 9: m.src(net, 0, R_PULL); break;
        case 192: if (g.dac !== null) m.src(net, g.dac, 100); break;
        default: break;
      }
    }
  }

  /** Состояние всех компонентов для отрисовки. */
  views(t: number): Record<string, Record<string, unknown>> {
    this.ensure();
    const out: Record<string, Record<string, unknown>> = {};
    for (const [id, m] of this.models) out[id] = { ...m.view(t), issues: m.issues };
    return out;
  }

  /** Напряжение на выводе компонента (для щупа в интерфейсе). */
  probe(partId: string, pin: string): { v: number; floating: boolean } {
    const n = this.pinNet.get(`${partId}:${pin}`) ?? -1;
    return { v: this.voltage(n), floating: this.isNetFloating(n) };
  }

  /** Список GPIO, соединённых с выводом компонента (напрямую). */
  gpiosAt(partId: string, pin: string): number[] {
    const n = this.pinNet.get(`${partId}:${pin}`) ?? -1;
    return this.netGpios.get(n) ?? [];
  }

  /** GPIO, соединённые с выводом напрямую или через один резистор. */
  gpiosNear(partId: string, pin: string): number[] {
    const n = this.pinNet.get(`${partId}:${pin}`) ?? -1;
    const res = new Set(this.netGpios.get(n) ?? []);
    for (const nb of this.neighbors.get(n) ?? []) for (const g of this.netGpios.get(nb) ?? []) res.add(g);
    return [...res];
  }

  netOf(partId: string, pin: string): number { return this.pinNet.get(`${partId}:${pin}`) ?? -1; }
}

/** UART-кадры: старт-бит, 8 бит данных (младшим вперёд), стоп-бит. */
export function uartWave(bytes: number[], baud: number, t0: number): [number, number][] {
  const bit = 1e6 / baud;
  const ev: [number, number][] = [[t0, 1]];
  let t = t0;
  for (const b of bytes) {
    ev.push([t, 0]); t += bit;
    for (let i = 0; i < 8; i++) { ev.push([t, (b >> i) & 1]); t += bit; }
    ev.push([t, 1]); t += bit;
  }
  return ev;
}
