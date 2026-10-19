// Запись сигнала для приборов (осциллограф, логический анализатор).
//
// Сигнал — кусочно-постоянное напряжение: схема пересчитывается только при событиях, между ними
// напряжение не меняется. Аппаратный ШИМ (LEDC, analogWrite, tone, Servo) — не события, а состояние
// вывода, поэтому он хранится как точный прямоугольник: период, заполнение, верхний и нижний уровни.
// Поверх — «пакеты» битов UART/I²C/SPI, которые библиотеки передают целиком.
// Все времена — микросекунды виртуального времени, напряжения — вольты.

export interface PwmPiece {
  /** период, мкс */
  T: number;
  /** заполнение 0…1 (доля периода с верхним уровнем; фронт — в моменты k·T) */
  duty: number;
  hi: number;
  lo: number;
}

/** Отрезок сигнала [t0, t1): постоянный уровень v или ШИМ. */
export interface Piece { t0: number; t1: number; v: number; pwm: PwmPiece | null }

interface Burst { t0: number; t1: number; ts: number[]; vs: number[] }

export interface WaveStats {
  vmin: number; vmax: number; vpp: number; avg: number; rms: number;
  /** частота, Гц (null — меньше двух периодов на экране) */
  freq: number | null;
  /** период, мкс */
  period: number | null;
  /** длительность импульса (верхний уровень), мкс */
  width: number | null;
  /** заполнение 0…1 */
  duty: number | null;
}

export type EdgeDir = 'rise' | 'fall' | 'both';

const EPS_V = 1e-6;
const MAX_STATES = 400_000;
const MAX_BURSTS = 5000;

function samePwm(a: PwmPiece | null, b: PwmPiece | null): boolean {
  if (!a || !b) return a === b;
  return a.T === b.T && a.duty === b.duty && Math.abs(a.hi - b.hi) < EPS_V && Math.abs(a.lo - b.lo) < EPS_V;
}

/** Время верхнего уровня ШИМ на [a, b]. */
function highTime(p: PwmPiece, a: number, b: number): number {
  const H = (x: number) => { const k = Math.floor(x / p.T); return k * p.duty * p.T + Math.min(x - k * p.T, p.duty * p.T); };
  return Math.max(0, H(b) - H(a));
}

function pwmValue(p: PwmPiece, t: number): number {
  const ph = t - Math.floor(t / p.T) * p.T;
  return ph < p.duty * p.T ? p.hi : p.lo;
}

export function pieceValue(pc: Piece, t: number): number { return pc.pwm ? pwmValue(pc.pwm, t) : pc.v; }

/** Минимум и максимум отрезка на [a, b]. */
export function pieceMinMax(pc: Piece, a: number, b: number): [number, number] {
  if (!pc.pwm) return [pc.v, pc.v];
  const len = b - a;
  if (len <= 0) { const v = pwmValue(pc.pwm, a); return [v, v]; }
  const hiT = highTime(pc.pwm, a, b);
  const hasHi = hiT > 1e-9;
  const hasLo = len - hiT > 1e-9;
  const { hi, lo } = pc.pwm;
  if (hasHi && hasLo) return [Math.min(hi, lo), Math.max(hi, lo)];
  const v = hasHi ? hi : lo;
  return [v, v];
}

export class Waveform {
  /** начало состояния, уровень, ШИМ (null — постоянный уровень) */
  t: number[] = [];
  v: number[] = [];
  p: (PwmPiece | null)[] = [];
  bursts: Burst[] = [];
  /** счётчик изменений — чтобы панели знали, что перерисовать */
  rev = 0;

  get empty(): boolean { return !this.t.length && !this.bursts.length; }
  get start(): number { return Math.min(this.t.length ? this.t[0] : Infinity, this.bursts.length ? this.bursts[0].t0 : Infinity); }

  /** Новое состояние сигнала с момента t (если оно отличается от текущего). */
  push(t: number, v: number, pwm: PwmPiece | null = null) {
    if (pwm && (pwm.duty <= 0 || pwm.duty >= 1 || !(pwm.T > 0) || Math.abs(pwm.hi - pwm.lo) < EPS_V)) {
      v = pwm.duty >= 1 ? pwm.hi : pwm.lo;
      pwm = null;
    }
    const n = this.t.length;
    if (n) {
      if (Math.abs(this.v[n - 1] - v) < EPS_V && samePwm(this.p[n - 1], pwm)) return;
      if (t <= this.t[n - 1]) {
        // в тот же момент — заменить; если вернулись к предыдущему состоянию — убрать «иголку»
        if (n >= 2 && Math.abs(this.v[n - 2] - v) < EPS_V && samePwm(this.p[n - 2], pwm)) { this.t.pop(); this.v.pop(); this.p.pop(); }
        else { this.v[n - 1] = v; this.p[n - 1] = pwm; }
        this.rev++;
        return;
      }
    }
    this.t.push(t); this.v.push(v); this.p.push(pwm);
    this.rev++;
    if (this.t.length > MAX_STATES) {
      const k = MAX_STATES >> 1;
      this.t.splice(0, k); this.v.splice(0, k); this.p.splice(0, k);
    }
  }

  /** Пакет битов (события [t, В]) — поверх обычного сигнала; последнее событие — конец пакета. */
  burst(ts: number[], vs: number[]) {
    if (!ts.length) return;
    const b: Burst = { t0: ts[0], t1: ts[ts.length - 1], ts, vs };
    let i = this.bursts.length;
    while (i > 0 && this.bursts[i - 1].t0 > b.t0) i--;
    // перекрытие с предыдущим пакетом — новый важнее
    const prev = this.bursts[i - 1];
    if (prev && prev.t1 > b.t0) prev.t1 = b.t0;
    this.bursts.splice(i, 0, b);
    if (this.bursts.length > MAX_BURSTS) this.bursts.splice(0, MAX_BURSTS >> 1);
    this.rev++;
  }

  private stateAt(t: number): number {
    let lo = 0; let hi = this.t.length - 1; let ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (this.t[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  private burstAt(t: number): Burst | null {
    let lo = 0; let hi = this.bursts.length - 1; let ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (this.bursts[m].t0 <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    const b = ans >= 0 ? this.bursts[ans] : null;
    return b && t < b.t1 ? b : null;
  }

  /** Напряжение в момент t (null — записи ещё нет). */
  valueAt(t: number): number | null {
    const b = this.burstAt(t);
    if (b) {
      let j = 0; let lo = 0; let hi = b.ts.length - 1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (b.ts[m] <= t) { j = m; lo = m + 1; } else hi = m - 1; }
      return b.vs[j];
    }
    const i = this.stateAt(t);
    if (i < 0) return null;
    const p = this.p[i];
    return p ? pwmValue(p, t) : this.v[i];
  }

  /** Отрезки сигнала на [a, b] по порядку (пакеты битов поверх обычного сигнала). */
  pieces(a: number, b: number): Piece[] {
    const out: Piece[] = [];
    if (b <= a) return out;
    // обычный сигнал
    const base: Piece[] = [];
    let i = Math.max(0, this.stateAt(a));
    for (; i < this.t.length; i++) {
      const t0 = Math.max(a, this.t[i]);
      const t1 = Math.min(b, i + 1 < this.t.length ? this.t[i + 1] : b);
      if (t0 >= b) break;
      if (t1 > t0) base.push({ t0, t1, v: this.v[i], pwm: this.p[i] });
    }
    // пакеты, задевающие окно
    const bs: Burst[] = [];
    if (this.bursts.length) {
      let lo = 0; let hi = this.bursts.length - 1; let k = this.bursts.length;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (this.bursts[m].t1 > a) { k = m; hi = m - 1; } else lo = m + 1; }
      for (; k < this.bursts.length && this.bursts[k].t0 < b; k++) if (this.bursts[k].t1 > this.bursts[k].t0) bs.push(this.bursts[k]);
    }
    if (!bs.length) return base;
    const emitted = new Set<Burst>();
    const emitBurst = (bu: Burst) => {
      if (emitted.has(bu)) return;
      emitted.add(bu);
      for (let j = 0; j < bu.ts.length - 1; j++) {
        const t0 = Math.max(a, bu.ts[j]); const t1 = Math.min(b, bu.t1, bu.ts[j + 1]);
        if (t1 > t0) out.push({ t0, t1, v: bu.vs[j], pwm: null });
      }
    };
    let k = 0;
    for (const pc of base) {
      let cur = pc.t0;
      while (k < bs.length && bs[k].t0 < pc.t1) {
        const bu = bs[k];
        if (bu.t0 > cur) out.push({ ...pc, t0: cur, t1: bu.t0 });
        if (bu.t1 > cur) emitBurst(bu);
        cur = Math.max(cur, bu.t1);
        if (bu.t1 <= pc.t1) k++; else break;
      }
      if (cur < pc.t1) out.push({ ...pc, t0: cur, t1: pc.t1 });
    }
    // пакеты после конца записи обычного сигнала (передача ещё идёт)
    for (; k < bs.length; k++) emitBurst(bs[k]);
    return out;
  }

  /** Перепады через уровень level на (a, b]. limit — на каждое направление; lastOnly — нужен только последний (быстро для ШИМ). */
  edges(a: number, b: number, level: number, opts: { limit?: number; lastOnly?: boolean } = {}): { rise: number[]; fall: number[] } {
    const limit = opts.limit ?? 200_000;
    const rise: number[] = []; const fall: number[] = [];
    const add = (arr: number[], t: number) => { if (opts.lastOnly) { if (arr.length) arr[0] = t; else arr.push(t); } else arr.push(t); };
    const ps = this.pieces(a, b);
    let prev: number | null = null;
    for (const pc of ps) {
      if (rise.length >= limit && fall.length >= limit) break;
      const v0 = pieceValue(pc, pc.t0);
      if (prev !== null) {
        if (prev < level && v0 >= level) add(rise, pc.t0);
        else if (prev >= level && v0 < level) add(fall, pc.t0);
      }
      const p = pc.pwm;
      if (p && Math.min(p.hi, p.lo) < level && Math.max(p.hi, p.lo) >= level) {
        // у ШИМ hi > lo: фронт в k·T, спад в k·T + duty·T (при hi < lo наоборот)
        const up = p.hi >= p.lo ? rise : fall;
        const dn = p.hi >= p.lo ? fall : rise;
        const gen = (arr: number[], off: number) => {
          let k0 = Math.floor((pc.t0 - off) / p.T) + 1;
          const k1 = Math.ceil((pc.t1 - off) / p.T) - 1;
          if (opts.lastOnly) k0 = Math.max(k0, k1);
          for (let k = k0; k <= k1 && arr.length < limit; k++) {
            const t = k * p.T + off;
            if (t > pc.t0 && t < pc.t1) add(arr, t);
          }
        };
        // внутри куска каждый массив пополняется по возрастанию — сортировать не нужно
        gen(up, 0);
        gen(dn, p.duty * p.T);
      }
      prev = pieceValue(pc, Math.max(pc.t0, pc.t1 - 1e-6));
    }
    if (opts.lastOnly) {
      // в lastOnly порядок кусков не важен — оставлен максимум
      return { rise: rise.length ? [Math.max(...rise)] : [], fall: fall.length ? [Math.max(...fall)] : [] };
    }
    return { rise, fall };
  }

  /** Последний перепад нужного направления на [notBefore, before] (поиск кусками назад). */
  lastEdge(before: number, notBefore: number, level: number, dir: EdgeDir, chunk = 1000): number | null {
    let span = Math.max(1, chunk);
    let hi = before;
    for (;;) {
      const lo = Math.max(notBefore, hi - span);
      if (hi <= lo) return null;
      const e = this.edges(lo, hi, level, { lastOnly: true });
      const cand = dir === 'rise' ? e.rise : dir === 'fall' ? e.fall : [...e.rise, ...e.fall];
      if (cand.length) return Math.max(...cand);
      if (lo <= notBefore) return null;
      // перепад ровно на границе окна виден только изнутри — следующее окно чуть перекрывает это
      hi = lo + 1e-3;
      span *= 2;
    }
  }

  /** Первый перепад нужного направления после момента from (не дальше until). */
  firstEdge(from: number, until: number, level: number, dir: EdgeDir): number | null {
    let span = 1000;
    let lo = from;
    for (;;) {
      const hi = Math.min(until, lo + span);
      if (hi <= lo) return null;
      const e = this.edges(lo, hi, level, { limit: 4 });
      const cand = dir === 'rise' ? e.rise : dir === 'fall' ? e.fall : [...e.rise, ...e.fall];
      if (cand.length) return Math.min(...cand);
      if (hi >= until) return null;
      lo = hi - 1e-3;
      span *= 2;
    }
  }

  /** Измерения на [a, b]. */
  stats(a: number, b: number): WaveStats | null {
    const ps = this.pieces(a, b);
    if (!ps.length) return null;
    let vmin = Infinity; let vmax = -Infinity; let s1 = 0; let s2 = 0; let dur = 0;
    for (const pc of ps) {
      const [mn, mx] = pieceMinMax(pc, pc.t0, pc.t1);
      vmin = Math.min(vmin, mn); vmax = Math.max(vmax, mx);
      const dt = pc.t1 - pc.t0;
      if (pc.pwm) {
        const h = highTime(pc.pwm, pc.t0, pc.t1);
        s1 += pc.pwm.hi * h + pc.pwm.lo * (dt - h);
        s2 += pc.pwm.hi ** 2 * h + pc.pwm.lo ** 2 * (dt - h);
      } else { s1 += pc.v * dt; s2 += pc.v * pc.v * dt; }
      dur += dt;
    }
    const avg = dur > 0 ? s1 / dur : 0;
    const rms = dur > 0 ? Math.sqrt(Math.max(0, s2 / dur)) : 0;
    const res: WaveStats = { vmin, vmax, vpp: vmax - vmin, avg, rms, freq: null, period: null, width: null, duty: null };
    if (vmax - vmin < 0.02) return res;
    const { rise, fall } = this.edges(a, b, (vmin + vmax) / 2, { limit: 100_000 });
    if (rise.length >= 2) {
      const period = (rise[rise.length - 1] - rise[0]) / (rise.length - 1);
      res.period = period;
      res.freq = 1e6 / period;
      // длительность импульса: от фронта до ближайшего спада
      let sum = 0; let n = 0; let j = 0;
      for (const r of rise) {
        while (j < fall.length && fall[j] <= r) j++;
        if (j < fall.length && fall[j] - r < period * 1.5) { sum += fall[j] - r; n++; }
      }
      if (n) { res.width = sum / n; res.duty = Math.min(1, res.width / period); }
    }
    return res;
  }
}

/** Сигнал по столбцам экрана: минимум, максимум, значение в начале и в конце столбца (NaN — нет данных). */
export interface Columns { min: Float64Array; max: Float64Array; first: Float64Array; last: Float64Array }

/** Разбить [a, b] на n столбцов и для каждого найти минимум/максимум сигнала (с учётом ШИМ). */
export function columns(w: Waveform, a: number, b: number, n: number): Columns {
  const min = new Float64Array(n).fill(NaN);
  const max = new Float64Array(n).fill(NaN);
  const first = new Float64Array(n).fill(NaN);
  const last = new Float64Array(n).fill(NaN);
  if (n <= 0 || b <= a) return { min, max, first, last };
  const dt = (b - a) / n;
  const put = (j: number, lo: number, hi: number) => {
    if (Number.isNaN(min[j]) || lo < min[j]) min[j] = lo;
    if (Number.isNaN(max[j]) || hi > max[j]) max[j] = hi;
  };
  for (const pc of w.pieces(a, b)) {
    const j0 = Math.max(0, Math.min(n - 1, Math.floor((pc.t0 - a) / dt)));
    const j1 = Math.max(0, Math.min(n - 1, Math.ceil((pc.t1 - a) / dt) - 1));
    for (let j = j0; j <= j1; j++) {
      const c0 = a + j * dt; const c1 = c0 + dt;
      const s0 = Math.max(c0, pc.t0); const s1 = Math.min(c1, pc.t1);
      if (s1 <= s0 && !(j === j0 && pc.t0 === pc.t1)) continue;
      const [lo, hi] = pieceMinMax(pc, s0, s1);
      put(j, lo, hi);
      if (pc.t0 <= c0 || Number.isNaN(first[j])) first[j] = pieceValue(pc, s0);
      last[j] = pieceValue(pc, Math.max(s0, s1 - 1e-9));
      // длинный постоянный кусок: середину заполняем без вызовов на каждый столбец
      if (!pc.pwm && j === j0 && j1 - j0 > 2) {
        for (let k = j0 + 1; k < j1; k++) { put(k, pc.v, pc.v); first[k] = pc.v; last[k] = pc.v; }
        j = j1 - 1;
      }
    }
  }
  return { min, max, first, last };
}
