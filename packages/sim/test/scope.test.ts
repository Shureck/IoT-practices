// Осциллограф и запись сигнала: ШИМ, уровни через нагрузку, UART, поиск перепадов, измерения.
import { describe, expect, it } from 'vitest';
import { CheckContext, Waveform, columns, compileSketch, type CircuitDoc } from '../src/index';

const esp = { id: 'esp', type: 'esp32', x: 0, y: 0, rot: 0, props: {} };
const wire = (id: string, a: string, b: string) => {
  const [ap, an] = a.split(':'); const [bp, bn] = b.split(':');
  return { id, a: { part: ap, pin: an }, b: { part: bp, pin: bn }, pts: [], color: 'green' };
};

/** GPIO25 → 220 Ом → светодиод → GND; CH1 — на выводе, CH2 — на аноде, CH3 — на D26, CH4 — на TX0. */
const circuit: CircuitDoc = {
  parts: [
    esp,
    { id: 'r1', type: 'resistor', x: 300, y: 300, rot: 0, props: { value: 220 } },
    { id: 'led', type: 'led', x: 400, y: 300, rot: 0, props: { color: 'red' } },
    { id: 'pot', type: 'pot', x: 500, y: 300, rot: 0, props: { position: 50 } },
    { id: 'scope', type: 'scope', x: 600, y: 300, rot: 0, props: {} },
  ],
  wires: [
    wire('w1', 'esp:D25', 'r1:1'), wire('w2', 'r1:2', 'led:A'), wire('w3', 'led:C', 'esp:GND.1'),
    wire('w4', 'scope:CH1', 'esp:D25'), wire('w5', 'scope:CH2', 'led:A'), wire('w6', 'scope:GND', 'esp:GND.2'),
    wire('w7', 'scope:CH3', 'esp:D26'), wire('w8', 'scope:CH4', 'esp:TX0'),
    wire('w9', 'pot:VCC', 'esp:3V3'), wire('w10', 'pot:GND', 'esp:GND.1'),
  ],
};

function run(code: string, c: CircuitDoc = circuit) {
  const compiled = compileSketch(code);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const h = new CheckContext(code, c, compiled, { seed: 1 });
  const waves = () => (h.sim.board.models.get('scope') as unknown as { waves: Waveform[] }).waves;
  return { h, waves };
}

describe('запись сигнала (Waveform)', () => {
  it('постоянный уровень, ШИМ и пакет битов поверх', () => {
    const w = new Waveform();
    w.push(0, 0);
    w.push(0, 0); // повтор — не новое состояние
    w.push(1000, 3.3, { T: 200, duty: 0.25, hi: 3.3, lo: 0 });
    w.push(3000, 1.5);
    expect(w.t).toEqual([0, 1000, 3000]);
    expect(w.valueAt(500)).toBe(0);
    expect(w.valueAt(1010)).toBe(3.3); // фаза 10 из 200, заполнение 50 мкс
    expect(w.valueAt(1100)).toBe(0);
    expect(w.valueAt(3500)).toBe(1.5);
    // фронты ШИМ — в k·T, спады — в k·T + 50
    const e = w.edges(1000, 2000, 1.65);
    expect(e.rise.slice(0, 3)).toEqual([1200, 1400, 1600]);
    expect(e.fall.slice(0, 3)).toEqual([1050, 1250, 1450]);
    const st = w.stats(1000, 3000)!;
    expect(st.freq).toBeCloseTo(5000, 0);
    expect(st.duty).toBeCloseTo(0.25, 3);
    expect(st.avg).toBeCloseTo(3.3 * 0.25, 3);
    expect(st.rms).toBeCloseTo(3.3 * Math.sqrt(0.25), 3);
    expect(w.lastEdge(1900, 0, 1.65, 'rise')).toBe(1800);
    expect(w.firstEdge(1001, 5000, 1.65, 'fall')).toBe(1050);
    // пакет битов перекрывает ШИМ
    w.burst([1500, 1510, 1520, 1530], [0, 3.3, 0, 0]);
    expect(w.valueAt(1515)).toBe(3.3);
    expect(w.valueAt(1525)).toBe(0);
    expect(w.valueAt(1540)).toBe(0); // снова ШИМ: фаза 140 → низкий
    const ps = w.pieces(1490, 1540);
    expect(ps.map((p) => [p.t0, p.t1])).toEqual([[1490, 1500], [1500, 1510], [1510, 1520], [1520, 1530], [1530, 1540]]);
  });
});

describe('столбцы экрана', () => {
  it('быстрый ШИМ на медленной развёртке — полоса от нижнего до верхнего уровня', () => {
    const w = new Waveform();
    w.push(0, 0);
    w.push(10_000, 3.3, { T: 200, duty: 0.3, hi: 3.3, lo: 0 });
    const c = columns(w, 0, 110_000, 110); // столбец = 1 мс
    expect([c.min[5], c.max[5]]).toEqual([0, 0]);
    for (const j of [10, 50, 109]) expect([c.min[j], c.max[j]]).toEqual([0, 3.3]);
    // крупным планом виден сам прямоугольник
    const z = columns(w, 10_000, 10_200, 20); // столбец = 10 мкс
    expect(Array.from(z.max).map((v) => (v > 1 ? 1 : 0))).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // до начала записи — пусто
    expect(Number.isNaN(columns(w, -100, -10, 3).min[0])).toBe(true);
  });
});

describe('осциллограф на схеме', () => {
  it('аппаратный ШИМ: прямоугольник 5 кГц, заполнение 25 %, уровни на выводе и на светодиоде', async () => {
    const { h, waves } = run(`
void setup() { ledcSetup(0, 5000, 8); ledcAttachPin(25, 0); ledcWrite(0, 64); }
void loop() { delay(100); }`);
    await h.wait(100);
    const now = h.sim.M.now();
    const [ch1, ch2] = waves();
    const s1 = ch1.stats(now - 10_000, now)!;
    expect(s1.freq).toBeCloseTo(5000, -1);
    expect(s1.duty).toBeCloseTo(0.25, 2);
    expect(s1.vmax).toBeGreaterThan(3);
    expect(s1.vmin).toBeLessThan(0.1);
    // на аноде светодиода: сверху — падение на светодиоде (~1,8 В), снизу — 0
    const s2 = ch2.stats(now - 10_000, now)!;
    expect(s2.vmax).toBeGreaterThan(1.6);
    expect(s2.vmax).toBeLessThan(2.4);
    expect(s2.vmin).toBeLessThan(0.1);
    expect(s2.duty).toBeCloseTo(0.25, 2);
  });

  it('tone() и сервопривод: частота и длительность импульса', async () => {
    const t = run('void setup() { tone(25, 1000); }\nvoid loop() { delay(100); }');
    await t.h.wait(50);
    const n1 = t.h.sim.M.now();
    const st = t.waves()[0].stats(n1 - 20_000, n1)!;
    expect(st.freq).toBeCloseTo(1000, 0);
    expect(st.duty).toBeCloseTo(0.5, 2);

    const s = run('#include <ESP32Servo.h>\nServo sv;\nvoid setup() { sv.attach(26); sv.writeMicroseconds(1500); }\nvoid loop() { delay(100); }');
    await s.h.wait(200);
    const n2 = s.h.sim.M.now();
    const ss = s.waves()[2].stats(n2 - 100_000, n2)!;
    expect(ss.freq).toBeCloseTo(50, 0);
    expect(ss.width).toBeCloseTo(1500, -1);
  });

  it('программное переключение через digitalWrite — каждый фронт на своём месте', async () => {
    const { h, waves } = run(`
void setup() { pinMode(26, OUTPUT); }
void loop() { digitalWrite(26, HIGH); delayMicroseconds(100); digitalWrite(26, LOW); delayMicroseconds(300); }`);
    await h.wait(50);
    const now = h.sim.M.now();
    const st = waves()[2].stats(now - 20_000, now)!;
    expect(st.width).toBeGreaterThan(99);
    expect(st.width).toBeLessThan(102);
    expect(st.period).toBeGreaterThan(400);
    expect(st.period).toBeLessThan(420); // + накладные расходы loop()
  });

  it('аналоговый уровень и UART на TX0', async () => {
    const c = structuredClone(circuit);
    c.wires.push(wire('w11', 'scope:CH3', 'pot:SIG'));
    c.wires = c.wires.filter((x) => x.id !== 'w7');
    const { h, waves } = run('void setup() { Serial.begin(115200); }\nvoid loop() { Serial.print("U"); delay(5); }', c);
    await h.wait(30);
    const now = h.sim.M.now();
    const pot = waves()[2].stats(now - 10_000, now)!;
    expect(pot.avg).toBeCloseTo(1.65, 1);
    expect(pot.vpp).toBeLessThan(0.01);
    // TX: в покое высокий уровень, 'U' = 0x55 — чередование битов по 8,68 мкс
    const tx = waves()[3];
    const start = tx.firstEdge(now - 6000, now, 1.65, 'fall')!;
    expect(start).not.toBeNull();
    const bit = 1e6 / 115200;
    const bits = Array.from({ length: 10 }, (_, i) => (tx.valueAt(start + bit * (i + 0.5))! > 1.65 ? 1 : 0));
    expect(bits).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]); // старт, 0x55 младшим вперёд, стоп
    expect(tx.valueAt(start - 50)).toBeGreaterThan(3);
  });
});

describe('щупы без детали на схеме', () => {
  it('щуп на выводе светодиода показывает ШИМ; правка схемы его не теряет', async () => {
    const c: CircuitDoc = { parts: circuit.parts.filter((p) => p.type !== 'scope'), wires: circuit.wires.filter((w) => !w.a.part.startsWith('scope')) };
    const { h } = run('void setup() { ledcSetup(0, 2000, 8); ledcAttachPin(25, 0); ledcWrite(0, 128); }\nvoid loop() { delay(100); }', c);
    const [p1, p2, none] = h.sim.board.setProbes([{ part: 'r1', pin: '1' }, { part: 'led', pin: 'A' }, null]);
    expect(none).toBeNull();
    await h.wait(50);
    let now = h.sim.M.now();
    expect(p1!.stats(now - 10_000, now)!.freq).toBeCloseTo(2000, -1);
    expect(p2!.stats(now - 10_000, now)!.duty).toBeCloseTo(0.5, 2);
    // тот же щуп — та же запись; перестройка схемы привязывает его к выводу заново
    expect(h.sim.board.setProbes([{ part: 'r1', pin: '1' }, null])[0]).toBe(p1);
    h.sim.board.rebuild(structuredClone(c));
    await h.wait(20);
    now = h.sim.M.now();
    expect(p1!.stats(now - 5_000, now)!.freq).toBeCloseTo(2000, -1);
  });
});
