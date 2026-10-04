// Помощники для описания схем и проверок в практиках.
import type { CheckContext, CircuitDoc, Part, Wire } from '@esp32lab/sim';

/**
 * Компонент: p('led1', 'led', x, y, { color: 'red' }, rot)
 * Плата ESP32 (id 'esp') стоит в (0,0) и занимает 220×100; её выводы:
 *   верхний ряд y=10, x=40…180: VIN, GND.1, D13, D12, D14, D27, D26, D25, D33, D32, D35, D34, VN, VP, EN
 *   нижний ряд y=90, x=40…180: 3V3, GND.2, D15, D2, D4, RX2, TX2, D5, D18, D19, D21, RX0, TX0, D22, D23
 * Координаты (x, y) компонента — это положение его первого вывода.
 * Компоненты с выводами снизу удобно ставить над платой (y ≈ −40…−80) или правее (x ≥ 280).
 */
export function p(id: string, type: string, x: number, y: number, props: Part['props'] = {}, rot = 0, locked = true): Part {
  return { id, type, x, y, rot, props, locked };
}

/** Провод: w('esp:D25', 'r1:1', 'green') — между выводами «компонент:вывод». */
export function w(a: string, b: string, color = 'green', pts: [number, number][] = []): Wire {
  const [pa, pina] = a.split(':');
  const [pb, pinb] = b.split(':');
  return { id: `w_${a}_${b}`.replace(/[^A-Za-z0-9_]/g, '_'), a: { part: pa, pin: pina }, b: { part: pb, pin: pinb }, pts, color };
}

export const ESP = (): Part => ({ id: 'esp', type: 'esp32', x: 0, y: 0, rot: 0, props: {}, locked: true });

export function circuit(parts: Part[], wires: Wire[] = []): CircuitDoc {
  return { parts: [ESP(), ...parts], wires };
}

/** Схема только с платой. */
export const bare = (): CircuitDoc => circuit([]);

// ---------- проверки ----------

/** Средний период мигания GPIO в окне [from, to] (мс) — с понятной ошибкой. */
export function expectPeriod(h: CheckContext, pin: number, from: number, to: number, expected: number, tol: number, what = `GPIO${pin}`) {
  const per = h.period(pin, from, to);
  if (per === null) return h.fail(`${what} не мигает: за ${((to - from) / 1000).toFixed(0)} с не было переключений`);
  h.expect(Math.abs(per - expected) <= tol, `${what} мигает с периодом ${Math.round(per)} мс, а нужно ${expected} мс`);
}

/** Найти GPIO, к которому подключён вывод (напрямую или через резистор). */
export function gpioFor(h: CheckContext, partId: string, pin: string, what: string): number {
  const g = h.gpioNear(partId, pin);
  h.expect(g.length > 0, `${what} не подключён ни к одному выводу GPIO`);
  return g[0];
}

/** Светодиод подключён правильно: анод через резистор к GPIO, катод к GND. Возвращает GPIO. */
export function checkLedWiring(h: CheckContext, ledId: string, what = 'Светодиод'): number {
  const direct = h.gpioAt(ledId, 'A');
  const near = h.gpioNear(ledId, 'A');
  h.expect(near.length > 0, `${what}: анод (длинная ножка, +) не подключён к GPIO`);
  h.expect(h.onGnd(ledId, 'C', true), `${what}: катод (короткая ножка, −) должен идти на GND`);
  const resistorOk = direct.length === 0 || !h.onGnd(ledId, 'C', false);
  h.expect(resistorOk, `${what}: нужен резистор 220 Ом между GPIO и светодиодом`);
  return near[0];
}

/** Строки Serial, содержащие подстроку. */
export function linesWith(h: CheckContext, needle: string | RegExp): string[] {
  return h.serialLines().filter((l) => (typeof needle === 'string' ? l.toLowerCase().includes(needle.toLowerCase()) : needle.test(l)));
}

/** Последнее число, напечатанное в Serial после метки. */
export function lastNumber(h: CheckContext, mark = 0): number | null {
  const nums = h.numbers(h.serialSince(mark));
  return nums.length ? nums[nums.length - 1] : null;
}

/** Код без комментариев — для проверок «используется ли функция». */
export function codeUses(h: CheckContext, re: RegExp): boolean {
  const src = h.code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return re.test(src);
}
