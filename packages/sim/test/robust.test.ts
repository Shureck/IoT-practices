// Устойчивость автопроверки к «тяжёлым» программам: Serial без паузы, вывод, который
// дёргается на каждом проходе loop(), сроки проверок. И то, что ускорения не исказили поведение.
import { describe, expect, it } from 'vitest';
import { Harness, CheckContext, compileSketch, type CircuitDoc, type CheckSpec } from '../src/index';

const esp = { id: 'esp', type: 'esp32', x: 0, y: 0, rot: 0, props: {} };
const bare: CircuitDoc = { parts: [esp], wires: [] };

const ledCircuit: CircuitDoc = {
  parts: [
    esp,
    { id: 'r1', type: 'resistor', x: 300, y: 300, rot: 0, props: { value: 220 } },
    { id: 'led1', type: 'led', x: 400, y: 300, rot: 0, props: { color: 'red' } },
    { id: 'btn', type: 'button', x: 500, y: 300, rot: 0, props: {} },
  ],
  wires: [
    { id: 'w1', a: { part: 'esp', pin: 'D25' }, b: { part: 'r1', pin: '1' }, pts: [], color: 'green' },
    { id: 'w2', a: { part: 'r1', pin: '2' }, b: { part: 'led1', pin: 'A' }, pts: [], color: 'green' },
    { id: 'w3', a: { part: 'led1', pin: 'C' }, b: { part: 'esp', pin: 'GND.1' }, pts: [], color: 'black' },
    { id: 'w4', a: { part: 'esp', pin: 'D14' }, b: { part: 'btn', pin: '1' }, pts: [], color: 'yellow' },
    { id: 'w5', a: { part: 'btn', pin: '2' }, b: { part: 'esp', pin: '3V3' }, pts: [], color: 'red' },
  ],
};

/** GPIO25 → резистор → GPIO26 (петля для проверки фронтов). */
const loopback: CircuitDoc = {
  parts: [esp, { id: 'r1', type: 'resistor', x: 300, y: 300, rot: 0, props: { value: 1000 } }],
  wires: [
    { id: 'w1', a: { part: 'esp', pin: 'D25' }, b: { part: 'r1', pin: '1' }, pts: [], color: 'green' },
    { id: 'w2', a: { part: 'r1', pin: '2' }, b: { part: 'esp', pin: 'D26' }, pts: [], color: 'green' },
  ],
};

function ctx(code: string, circuit: CircuitDoc = bare) {
  const compiled = compileSketch(code);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return new CheckContext(code, circuit, compiled, { seed: 1 });
}

const SPAM = 'void setup() { Serial.begin(BAUD); }\nvoid loop() { Serial.println("Waiting for darkness..."); }';

describe('Serial передаёт со скоростью UART', () => {
  it('115200 бод: ~11,5 КБ/с, а не миллионы строк', async () => {
    const t0 = Date.now();
    const h = ctx(SPAM.replace('BAUD', '115200'));
    await h.wait(1000);
    // строка 25 байт = 2,17 мс; плюс то, что поместилось в буфер 128 байт
    const lines = h.serialLines().length;
    expect(lines).toBeGreaterThan(440);
    expect(lines).toBeLessThan(480);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('9600 бод — в 12 раз медленнее', async () => {
    const h = ctx(SPAM.replace('BAUD', '9600'));
    await h.wait(1000);
    const lines = h.serialLines().length;
    expect(lines).toBeGreaterThan(35);
    expect(lines).toBeLessThan(45);
  });

  it('длинный вывод задерживает программу, пока буфер не освободится', async () => {
    const h = ctx(String.raw`
void setup() {
  Serial.begin(115200);
  Serial.println(Serial.availableForWrite());
  unsigned long a = micros();
  Serial.print("0123456789012345678901234567890123456789");
  unsigned long b = micros();
  int free1 = Serial.availableForWrite();
  Serial.flush();
  unsigned long c = micros();
  for (int i = 0; i < 100; i++) Serial.print("0123456789");
  unsigned long d = micros();
  Serial.println();
  Serial.println(b - a < 50 ? "fast" : "slow");
  Serial.println(free1);
  Serial.println(c - b);
  Serial.println(d - c);
}
void loop() {}`);
    await h.wait(500);
    const lines = h.serialLines();
    expect(lines[0]).toBe('128');
    const [fast, free1, flushUs, bulkUs] = lines.slice(-4);
    expect(fast).toBe('fast'); // 40 байт помещаются в буфер — print не ждёт
    // 128 − 40 − ещё не ушедшие байты предыдущей строки «128»
    expect(Number(free1)).toBeGreaterThanOrEqual(80);
    expect(Number(free1)).toBeLessThanOrEqual(88);
    // flush ждёт передачи ~40 байт (8,7 мкс на байт)
    expect(Number(flushUs)).toBeGreaterThan(3000);
    expect(Number(flushUs)).toBeLessThan(4000);
    // 1000 байт при пустом буфере: ждём, пока уйдут ~872 байта
    expect(Number(bulkUs)).toBeGreaterThan(74000);
    expect(Number(bulkUs)).toBeLessThan(78000);
  });

  it('отметки журнала Serial работают и после его переполнения', async () => {
    const h = ctx(String.raw`
void setup() { Serial.begin(115200); }
void loop() { for (int i = 0; i < 20; i++) Serial.print("abcdefghij"); Serial.println(millis()); }`);
    await h.wait(40000); // ~460 КБ вывода — больше, чем хранит журнал
    expect(h.sim.serialDropped).toBeGreaterThan(0);
    const m = h.mark();
    await h.wait(1000);
    const since = h.serialSince(m);
    expect(since.length).toBeGreaterThan(10500);
    expect(since.length).toBeLessThan(12500);
    expect(h.numbers(since).every((x) => x >= 40000)).toBe(true);
  });
});

describe('вывод, переключаемый на каждом проходе loop()', () => {
  it('прерывание видит каждый фронт даже без пауз', async () => {
    const h = ctx(String.raw`
volatile int edges = 0;
void IRAM_ATTR onEdge() { edges++; }
void setup() {
  Serial.begin(115200);
  pinMode(25, OUTPUT); pinMode(26, INPUT);
  attachInterrupt(26, onEdge, RISING);
  for (int i = 0; i < 500; i++) { digitalWrite(25, HIGH); digitalWrite(25, LOW); }
}
void loop() { delay(10); Serial.println(edges); delay(100000); }`, loopback);
    await h.wait(50);
    expect(h.numbers()[0]).toBe(500);
  });

  it('чтение сразу после записи видит новое значение', async () => {
    const h = ctx(String.raw`
void setup() {
  Serial.begin(115200);
  pinMode(25, OUTPUT); pinMode(26, INPUT);
  int ok = 0;
  for (int i = 0; i < 1000; i++) {
    digitalWrite(25, HIGH); int a = digitalRead(26);
    digitalWrite(25, LOW); int b = digitalRead(26);
    if (a == 1 && b == 0) ok++;
  }
  Serial.println(ok);
}
void loop() {}`, loopback);
    await h.wait(50);
    expect(h.numbers()[0]).toBe(1000);
  });

  it('кнопка управляет светодиодом, пока другой вывод «штормит»', async () => {
    const h = ctx(String.raw`
void setup() { pinMode(2, OUTPUT); pinMode(25, OUTPUT); pinMode(14, INPUT_PULLDOWN); }
void loop() { digitalWrite(2, HIGH); digitalWrite(2, LOW); digitalWrite(25, digitalRead(14)); }`, ledCircuit);
    await h.wait(100);
    expect(h.ledOn('led1')).toBe(false);
    h.hold('btn', true);
    await h.wait(20);
    expect(h.ledOn('led1')).toBe(true);
    h.hold('btn', false);
    await h.wait(20);
    expect(h.ledOn('led1')).toBe(false);
    expect(h.toggles(2, 0, h.now)).toBeGreaterThan(10000);
  });

  it('программный ШИМ на delayMicroseconds даёт правильную среднюю яркость', async () => {
    const bright = async (code: string) => {
      const h = ctx(code, ledCircuit);
      await h.wait(50);
      const b = h.sim.board;
      b.views(h.sim.M.now());
      await h.wait(200);
      return b.views(h.sim.M.now()).led1.b as number;
    };
    const full = await bright('void setup(){ pinMode(25, OUTPUT); digitalWrite(25, HIGH); }\nvoid loop(){}');
    const q = await bright('void setup(){ pinMode(25, OUTPUT); }\nvoid loop(){ digitalWrite(25, HIGH); delayMicroseconds(250); digitalWrite(25, LOW); delayMicroseconds(750); }');
    const h50 = await bright('void setup(){ pinMode(25, OUTPUT); }\nvoid loop(){ digitalWrite(25, HIGH); delayMicroseconds(20); digitalWrite(25, LOW); delayMicroseconds(20); }');
    expect(q / full).toBeGreaterThan(0.2);
    expect(q / full).toBeLessThan(0.3);
    // 20 мкс HIGH из ~50: к LOW добавляются ~10 мкс накладных расходов самого loop()
    expect(h50 / full).toBeGreaterThan(0.35);
    expect(h50 / full).toBeLessThan(0.45);
  });
});

describe('сроки проверок', () => {
  const forever: CheckSpec = { id: 'x', title: 'долго', timeoutMs: 400, run: async (h) => { await h.wait(10_000_000); } };

  it('«шторм» на выводе: проверка обрывается вовремя и называет причину', async () => {
    const t0 = Date.now();
    const r = await Harness.run(String.raw`
void setup() { pinMode(25, OUTPUT); }
void loop() { digitalWrite(25, HIGH); digitalWrite(25, LOW); }`, ledCircuit, [forever]);
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(r.results[0].ok).toBe(false);
    expect(r.results[0].message).toMatch(/GPIO25 переключается/);
  });

  it('Serial без паузы: причина — печать', async () => {
    const r = await Harness.run(SPAM.replace('BAUD', '115200'), bare, [forever]);
    expect(r.results[0].message).toMatch(/печатает в Serial/);
  });

  it('просто тяжёлый loop(): общий совет', async () => {
    const r = await Harness.run(String.raw`
long x = 0;
void setup() {}
void loop() { for (long i = 0; i < 1000; i++) x += i; }`, bare, [forever]);
    expect(r.results[0].message).toMatch(/не уложилась во время/);
  });

  it('общий бюджет делится между проверками, последние не теряются', async () => {
    const t0 = Date.now();
    const slow = (id: string): CheckSpec => ({ id, title: id, timeoutMs: 60000, run: async (h) => { await h.wait(10_000_000); } });
    const quick: CheckSpec = { id: 'q', title: 'q', run: async (h) => { await h.wait(10); } };
    const r = await Harness.run('void setup() { Serial.begin(115200); }\nvoid loop() { Serial.println("spam"); }', bare,
      [slow('a'), slow('b'), quick], { budgetMs: 4000 });
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(r.results.map((x) => x.ok)).toEqual([false, false, true]);
  });
});
