import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const parts = () => [
  // автомобильный светофор
  p('carR', 'led', 300, -150, { color: 'red' }),
  p('carY', 'led', 300, -100, { color: 'yellow' }),
  p('carG', 'led', 300, -50, { color: 'green' }),
  p('r1', 'resistor', 240, -160, { value: 220 }),
  p('r2', 'resistor', 240, -110, { value: 220 }),
  p('r3', 'resistor', 240, -60, { value: 220 }),
  // пешеходный светофор
  p('pedR', 'led', 440, -150, { color: 'red' }),
  p('pedG', 'led', 440, -100, { color: 'green' }),
  p('r4', 'resistor', 380, -160, { value: 220 }),
  p('r5', 'resistor', 380, -110, { value: 220 }),
  // кнопка пешехода
  p('btn', 'button', 440, -40, { color: 'yellow', label: 'Переход' }),
];

const wires = () => [
  w('esp:D27', 'r1:1', 'red'), w('r1:2', 'carR:A', 'red'), w('carR:C', 'esp:GND.1', 'black'),
  w('esp:D26', 'r2:1', 'yellow'), w('r2:2', 'carY:A', 'yellow'), w('carY:C', 'esp:GND.1', 'black'),
  w('esp:D25', 'r3:1', 'green'), w('r3:2', 'carG:A', 'green'), w('carG:C', 'esp:GND.1', 'black'),
  w('esp:D33', 'r4:1', 'red'), w('r4:2', 'pedR:A', 'red'), w('pedR:C', 'esp:GND.1', 'black'),
  w('esp:D32', 'r5:1', 'green'), w('r5:2', 'pedG:A', 'green'), w('pedG:C', 'esp:GND.1', 'black'),
  w('esp:D14', 'btn:1', 'blue'), w('btn:2', 'esp:GND.1', 'black'),
];

type Snap = { t: number; r: boolean; y: boolean; g: boolean; pr: boolean; pg: boolean };

function snap(h: CheckContext): Snap {
  return { t: h.now, r: h.ledOn('carR'), y: h.ledOn('carY'), g: h.ledOn('carG'), pr: h.ledOn('pedR'), pg: h.ledOn('pedG') };
}

/** Прогнать время, записывая состояние огней каждые step мс. */
async function record(h: CheckContext, ms: number, out: Snap[], step = 20) {
  const end = h.now + ms;
  while (h.now < end) {
    await h.wait(step);
    out.push(snap(h));
  }
}

const carName = (s: Snap) => {
  const on = [s.r && 'красный', s.y && 'жёлтый', s.g && 'зелёный'].filter(Boolean);
  return on.length ? on.join(' + ') : 'всё погасло';
};

/** Фазы автомобильного светофора: подряд идущие одинаковые состояния. */
function phases(log: Snap[]) {
  const res: { name: string; from: number; to: number }[] = [];
  for (const s of log) {
    const name = carName(s);
    const last = res[res.length - 1];
    if (last && last.name === name) last.to = s.t;
    else res.push({ name, from: s.t, to: s.t });
  }
  return res;
}

/** Нарушения безопасности, державшиеся хотя бы два замера подряд (≥ 20 мс). */
function conflicts(log: Snap[]): string | null {
  const bad = (s: Snap) => {
    if (s.pg && s.g) return 'пешеходам зелёный одновременно с зелёным для машин';
    if (s.pg && s.y) return 'пешеходам зелёный, пока у машин горит жёлтый';
    if (s.pg && !s.r) return 'пешеходам зелёный, а у машин не горит красный';
    if (s.pg && s.pr) return 'у пешеходов горят красный и зелёный одновременно';
    if (s.r && s.g) return 'у машин горят красный и зелёный одновременно';
    return null;
  };
  for (let i = 1; i < log.length; i++) {
    const a = bad(log[i - 1]);
    if (a && bad(log[i]) === a) return `${a} (на ${(log[i].t / 1000).toFixed(1)} с)`;
  }
  return null;
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} с`;

export const traffic: Practice = {
  id: 'm1-traffic',
  module: 1,
  order: 4,
  kind: 'case',
  title: 'Перекрёсток вездеходов',
  subtitle: 'Светофор с вызывной кнопкой — первая задача лекции',
  difficulty: 2,
  xp: 180,
  minutes: 50,
  tags: ['GPIO', 'millis', 'конечный автомат', 'кнопки'],
  story: `Между жилым модулем и гаражом — перекрёсток: там разворачиваются вездеходы и ходят люди. После шторма
светофор «сошёл с ума». Механик Петрович уже собрал новую схему: автомобильный светофор, пешеходный и кнопку
«Переход». Тебе осталась программа. Главное правило станции: **зелёный для людей и зелёный для машин не горят
никогда одновременно** — вездеход весит восемь тонн.`,
  goals: [
    'Автоматический режим: машинам зелёный **5 с** → жёлтый **1 с** → красный **5 с** → жёлтый **1 с** → снова зелёный; у пешеходов всё это время красный',
    'Нажатие кнопки «Переход» (GPIO14, к GND — `INPUT_PULLUP`): машинам сразу жёлтый на 1 с, потом красный, и только тогда пешеходам зелёный',
    'Через **10 с** пешеходам красный, светофор возвращается в автоматический режим (жёлтый 1 с → зелёный)',
    'Сигналы никогда не противоречат друг другу; кнопку видно в любой момент, даже коротким нажатием',
  ],
  theory: `### Схема

| Сигнал | Вывод |
|---|---|
| машины: красный / жёлтый / зелёный | GPIO27 / GPIO26 / GPIO25 |
| пешеходы: красный / зелёный | GPIO33 / GPIO32 |
| кнопка «Переход» (замыкает на GND) | GPIO14, \`INPUT_PULLUP\` |

### Почему \`delay(5000)\` не подойдёт

Пока идёт \`delay\`, программа «спит» и не видит кнопку: пешеход нажмёт и отпустит — и ничего не произойдёт.
Вместо этого засекайте время функцией \`millis()\` — она возвращает число миллисекунд с момента включения:

\`\`\`cpp
unsigned long since = 0;      // когда началась текущая фаза

void loop() {
  if (millis() - since >= 5000) {
    // прошло 5 секунд — переключаем фазу
    since = millis();
  }
  // ...а здесь можно читать кнопку хоть 1000 раз в секунду
}
\`\`\`

### Конечный автомат

Светофор удобно описать **состояниями** и **переходами** между ними:

\`\`\`cpp
enum State { CAR_GREEN, CAR_YELLOW, CAR_RED, PED_GO };
State state = CAR_GREEN;

void go(State s) { state = s; since = millis(); }

void loop() {
  unsigned long t = millis() - since;
  switch (state) {
    case CAR_GREEN:
      // зажечь нужные огни...
      if (t >= 5000) go(CAR_YELLOW);
      break;
    // ...остальные состояния
  }
}
\`\`\`

Нажатие кнопки удобно запомнить во флаг (\`bool request = true;\`), а обработать в том состоянии, где это
безопасно. Ещё одна хитрость: при смене огней **сначала гасите**, потом зажигайте — тогда даже на микросекунду
не загорятся два противоречащих сигнала.`,
  hints: [
    'Начните с автоматического режима на `millis()`: четыре состояния — зелёный, жёлтый, красный, жёлтый.',
    'Кнопку читайте в начале каждого `loop()`: `if (digitalRead(14) == LOW) request = true;`',
    'Добавьте состояние «пешеходы идут» (машинам красный, людям зелёный, 10 с). Из зелёного при `request` — в жёлтый, из жёлтого — в «пешеходы идут».',
    'Удобно написать функцию `setLights(r, y, g, walk)`, которая выставляет все пять огней разом: сначала гасит лишнее, потом зажигает нужное.',
  ],
  starterCode: `// Светофор перекрёстка вездеходов
const int CAR_RED = 27, CAR_YELLOW = 26, CAR_GREEN = 25;
const int PED_RED = 33, PED_GREEN = 32;
const int BUTTON = 14;   // к GND, нажата = LOW

unsigned long since = 0; // время начала текущей фазы
bool request = false;    // пешеход нажал кнопку

void setup() {
  pinMode(CAR_RED, OUTPUT);
  pinMode(CAR_YELLOW, OUTPUT);
  pinMode(CAR_GREEN, OUTPUT);
  pinMode(PED_RED, OUTPUT);
  pinMode(PED_GREEN, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
}

void loop() {
  // TODO: автоматический режим 5 с / 1 с / 5 с / 1 с
  // TODO: по кнопке — жёлтый, красный, пешеходам зелёный на 10 с
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `const int CAR_RED = 27, CAR_YELLOW = 26, CAR_GREEN = 25;
const int PED_RED = 33, PED_GREEN = 32;
const int BUTTON = 14;

enum State { CAR_GREEN_ST, YELLOW_TO_RED, CAR_RED_ST, YELLOW_TO_GREEN, PED_GO };
State state = CAR_GREEN_ST;
unsigned long since = 0;
bool request = false;

void setLights(bool r, bool y, bool g, bool walk) {
  // сначала гасим, потом зажигаем
  if (!walk) { digitalWrite(PED_GREEN, LOW); digitalWrite(PED_RED, HIGH); }
  if (!r) digitalWrite(CAR_RED, LOW);
  if (!y) digitalWrite(CAR_YELLOW, LOW);
  if (!g) digitalWrite(CAR_GREEN, LOW);
  if (r) digitalWrite(CAR_RED, HIGH);
  if (y) digitalWrite(CAR_YELLOW, HIGH);
  if (g) digitalWrite(CAR_GREEN, HIGH);
  if (walk) { digitalWrite(PED_RED, LOW); digitalWrite(PED_GREEN, HIGH); }
}

void go(State s) {
  state = s;
  since = millis();
}

void setup() {
  pinMode(CAR_RED, OUTPUT);
  pinMode(CAR_YELLOW, OUTPUT);
  pinMode(CAR_GREEN, OUTPUT);
  pinMode(PED_RED, OUTPUT);
  pinMode(PED_GREEN, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
  go(CAR_GREEN_ST);
}

void loop() {
  if (digitalRead(BUTTON) == LOW && state != PED_GO) request = true;
  unsigned long t = millis() - since;

  switch (state) {
    case CAR_GREEN_ST:
      setLights(false, false, true, false);
      if (request || t >= 5000) go(YELLOW_TO_RED);
      break;
    case YELLOW_TO_RED:
      setLights(false, true, false, false);
      if (t >= 1000) go(request ? PED_GO : CAR_RED_ST);
      break;
    case CAR_RED_ST:
      setLights(true, false, false, false);
      if (request) go(PED_GO);
      else if (t >= 5000) go(YELLOW_TO_GREEN);
      break;
    case YELLOW_TO_GREEN:
      setLights(false, true, false, false);
      if (t >= 1000) go(request ? PED_GO : CAR_GREEN_ST);
      break;
    case PED_GO:
      setLights(true, false, false, true);
      request = false;
      if (t >= 10000) go(YELLOW_TO_GREEN);
      break;
  }
  delay(10);
}
`,
  },
  checks: [
    {
      id: 'auto',
      title: 'Автоматический режим: зелёный 5 с → жёлтый 1 с → красный 5 с → жёлтый 1 с',
      timeoutMs: 40000,
      run: async (h) => {
        const log: Snap[] = [];
        await record(h, 26000, log);
        const ped = log.find((s) => s.pg || !s.pr);
        h.expect(!ped, `Без нажатия кнопки у пешеходов должен гореть только красный, а на ${sec(ped?.t ?? 0)} это не так`);
        const ph = phases(log);
        const weird = ph.find((x) => !['красный', 'жёлтый', 'зелёный'].includes(x.name) && x.to - x.from >= 40);
        h.expect(!weird, `У машин должен гореть ровно один сигнал, а на ${sec(weird?.from ?? 0)}: ${weird?.name}`);
        const full = ph.filter((x) => x.to - x.from >= 40).slice(1, -1);
        h.expect(full.length >= 4, `За 26 с светофор сменил сигнал всего ${Math.max(0, full.length)} раз(а) — автоматический режим не работает`);
        const want: Record<string, number> = { 'зелёный': 5000, 'жёлтый': 1000, 'красный': 5000 };
        for (const x of full) {
          const d = x.to - x.from + 20;
          const tol = want[x.name] > 2000 ? 300 : 150;
          h.expect(Math.abs(d - want[x.name]) <= tol, `${x.name[0].toUpperCase()}${x.name.slice(1)} горел ${sec(d)}, а нужно ${sec(want[x.name])}`);
        }
        for (let i = 1; i < full.length; i++) {
          const a = full[i - 1].name;
          const b = full[i].name;
          h.expect(b === 'жёлтый' || a === 'жёлтый', `После «${a}» сразу загорелся «${b}» — между ними должен быть жёлтый`);
        }
        h.expect(full.some((x) => x.name === 'красный') && full.some((x) => x.name === 'зелёный'), 'В цикле должны быть и красный, и зелёный сигналы');
      },
    },
    {
      id: 'button',
      title: 'Кнопка: машинам жёлтый, затем красный, и только потом пешеходам зелёный',
      timeoutMs: 30000,
      run: async (h) => {
        const ok = await h.waitFor(() => h.ledOn('carG'), 14000, 20);
        h.expect(ok, 'Не дождались зелёного сигнала для машин — сначала добейтесь работы автоматического режима');
        await h.wait(1000);
        const log: Snap[] = [];
        const t0 = h.now;
        const HOLD = 300;
        h.hold('btn', true);
        await record(h, HOLD, log);
        h.hold('btn', false);
        await record(h, 4000, log);
        const y = log.find((s) => s.y);
        h.expect(y, 'Нажали «Переход» на зелёном — у машин так и не загорелся жёлтый');
        h.expect(y!.t - t0 <= 600, `Жёлтый загорелся только через ${sec(y!.t - t0)} после нажатия — кнопка должна срабатывать сразу`);
        const pg = log.find((s) => s.pg);
        h.expect(pg, 'Через 4 с после нажатия у пешеходов так и не загорелся зелёный');
        const yLen = log.filter((s) => s.y).length * 20;
        // Отсчёт жёлтого и от нажатия, и от отпускания кнопки верен: допускаем 1 с + время удержания.
        h.expect(yLen >= 1000 - 150 && yLen <= 1000 + HOLD + 150, `Жёлтый перед красным горел ${sec(yLen)}, а нужен 1 с`);
        h.expect(pg!.r && !pg!.y && !pg!.g, `Когда пешеходам загорелся зелёный, у машин горит «${carName(pg!)}» — а должен быть красный`);
        const c = conflicts(log);
        h.expect(!c, `Опасно: ${c}`);
      },
    },
    {
      id: 'return',
      title: 'Через 10 с пешеходам красный и светофор возвращается в автоматический режим',
      timeoutMs: 40000,
      run: async (h) => {
        await h.waitFor(() => h.ledOn('carG'), 14000, 20);
        await h.wait(500);
        await h.press('btn', 300);
        const ok = await h.waitFor(() => h.ledOn('pedG'), 4000, 10);
        h.expect(ok, 'После нажатия кнопки пешеходам так и не загорелся зелёный');
        const start = h.now;
        const log: Snap[] = [];
        await record(h, 13000, log);
        const lastGreen = [...log].reverse().find((s) => s.pg);
        const walk = (lastGreen?.t ?? start) - start + 20;
        h.expect(walk < 12900, 'Пешеходный зелёный не гаснет — через 10 с должен вернуться автоматический режим');
        h.expect(Math.abs(walk - 10000) <= 500, `Пешеходный зелёный горел ${sec(walk)}, а нужно 10 с`);
        const after = log.filter((s) => s.t > lastGreen!.t + 50);
        h.expect(after.every((s) => s.pr), 'После перехода у пешеходов снова должен гореть красный');
        h.expect(after.some((s) => s.g), 'После перехода машинам так и не загорелся зелёный (ждали 3 с)');
        const g = log.find((s) => s.t > lastGreen!.t && s.g)!;
        await record(h, 7000, log);
        const ph = phases(log.filter((s) => s.t >= g.t));
        h.expect(ph.length >= 2 && ph[1].name === 'жёлтый', 'После возврата светофор не продолжил автоматический цикл (зелёный → жёлтый → …)');
        h.expect(Math.abs(ph[0].to - ph[0].from + 20 - 5000) <= 300, `Первый зелёный после перехода горел ${sec(ph[0].to - ph[0].from + 20)}, а нужно 5 с`);
      },
    },
    {
      id: 'safety',
      title: 'Сигналы никогда не противоречат друг другу (минута с нажатиями в разные моменты)',
      timeoutMs: 60000,
      run: async (h) => {
        const log: Snap[] = [];
        // нажатия в разных фазах: на зелёном, на жёлтом, на красном, во время перехода и сразу после него
        const presses = [2500, 6200, 8000, 9000, 21500, 27000, 33000, 40500, 41000, 52300];
        for (const t of presses) {
          await record(h, t - h.now, log);
          h.hold('btn', true);
          await record(h, 250, log);
          h.hold('btn', false);
        }
        await record(h, 62000 - h.now, log);
        const c = conflicts(log);
        h.expect(!c, `Опасно: ${c}`);
        const dark = log.findIndex((s, i) => i > 50 && !s.r && !s.y && !s.g && log[i - 1] && !log[i - 1].r && !log[i - 1].y && !log[i - 1].g);
        h.expect(dark < 0, `На ${sec(log[dark]?.t ?? 0)} у машин не горит ни один сигнал`);
        h.expect(log.some((s) => s.pg), 'За минуту с десятью нажатиями пешеходам ни разу не дали зелёный');
      },
    },
  ],
};
