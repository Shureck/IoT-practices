import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const LED = 25;
const RELAY = 26;

const parts = () => [
  // клавиатура кода
  p('b1', 'button', 40, 170, { color: 'white', label: '1' }),
  p('b2', 'button', 90, 170, { color: 'white', label: '2' }),
  p('b3', 'button', 140, 170, { color: 'white', label: '3' }),
  p('b4', 'button', 190, 170, { color: 'white', label: '4' }),
  // индикатор
  p('led', 'led', 250, -50, { color: 'red' }),
  p('r1', 'resistor', 190, -40, { value: 220 }),
  // реле и замок
  p('relay', 'relay', 300, -150),
  p('lock', 'lock', 450, -60),
  // датчик освещённости (делитель)
  p('ldr', 'ldr', 260, 70, { lux: 3 }),
  p('r2', 'resistor', 290, 70, { value: 10000 }),
];

const wires = () => [
  w('esp:D4', 'b1:1', 'blue'), w('b1:2', 'esp:GND.2', 'black'),
  w('esp:D5', 'b2:1', 'blue'), w('b2:2', 'esp:GND.2', 'black'),
  w('esp:D18', 'b3:1', 'blue'), w('b3:2', 'esp:GND.2', 'black'),
  w('esp:D19', 'b4:1', 'blue'), w('b4:2', 'esp:GND.2', 'black'),
  w('esp:D25', 'r1:1', 'orange'), w('r1:2', 'led:A', 'orange'), w('led:C', 'esp:GND.1', 'black'),
  w('relay:VCC', 'esp:VIN', 'red'), w('relay:GND', 'esp:GND.1', 'black'), w('relay:IN', 'esp:D26', 'yellow'),
  w('relay:COM', 'esp:VIN', 'red'), w('relay:NO', 'lock:1', 'red'), w('lock:2', 'esp:GND.1', 'black'),
  w('ldr:1', 'esp:3V3', 'red'), w('ldr:2', 'esp:D34', 'green'), w('r2:1', 'ldr:2', 'green'), w('r2:2', 'esp:GND.2', 'black'),
];

const isOpen = (h: CheckContext) => h.relayOn('relay') && h.loadLevel('lock') > 0.5;

async function enter(h: CheckContext, digits: number[]) {
  for (const d of digits) {
    await h.press(`b${d}`, 150);
    await h.wait(250);
  }
}

/** Ввести верный код и дождаться открытия. Возвращает момент открытия. */
async function unlock(h: CheckContext): Promise<number> {
  await h.wait(500);
  await enter(h, [1, 2, 3]);
  await h.press('b4', 150);
  const ok = await h.waitFor(() => isOpen(h), 1000, 5);
  h.expect(ok, 'Ввели код 1-2-3-4 — замок не открылся (реле не включилось)');
  return h.now;
}

/** Светодиод горит ровно (без мигания) последние ms миллисекунд? */
async function solid(h: CheckContext, ms: number): Promise<boolean> {
  const end = h.now + ms;
  let ok = true;
  while (h.now < end) {
    await h.wait(20);
    if (!h.ledOn('led')) ok = false;
  }
  return ok;
}

export const lock: Practice = {
  id: 'm1-lock',
  module: 1,
  order: 7,
  kind: 'case',
  title: 'Электронный замок шлюза',
  subtitle: 'Кодовая клавиатура, реле и датчик света — кейс 1 из лекции',
  difficulty: 3,
  xp: 220,
  minutes: 60,
  tags: ['реле', 'кнопки', 'АЦП', 'конечный автомат', 'millis'],
  story: `Шлюз между тамбуром и складом топлива держит электромагнитный замок. Пока шторм гулял, кто-то
оставил его открытым — и склад промёрз. Начальник станции распорядился: дверь открывается кодом **1-2-3-4**
(«поменяем, когда вернётся связь»), а запирается только в тёмное время — днём через шлюз идёт разгрузка,
и дёргать дверь каждые 10 секунд никто не хочет.`,
  goals: [
    'Пока шлюз заперт: реле выключено, индикатор (GPIO25) **горит ровно**',
    'Код вводится кнопками 1–4 (GPIO4, 5, 18, 19, замыкают на GND). Верная последовательность **1-2-3-4** включает реле (GPIO26) — замок открыт, индикатор **мигает**',
    'Неверная цифра сбрасывает ввод: код нужно набирать заново',
    'Через **10 с** шлюз запирается — но только если **темно** (датчик света на GPIO34: чем темнее, тем меньше число). Если светло — дверь остаётся открытой, пока не стемнеет',
  ],
  theory: `### Схема

| Что | Вывод |
|---|---|
| кнопки 1, 2, 3, 4 (к GND) | GPIO4, GPIO5, GPIO18, GPIO19 — \`INPUT_PULLUP\` |
| индикатор | GPIO25 |
| реле замка (IN) | GPIO26: \`HIGH\` — открыто |
| фоторезистор (делитель с 10 кОм) | GPIO34: темно → меньше 2000 |

### Реле

Замку нужно 5 В и ток в сотни миллиампер — вывод GPIO такого не выдержит. Поэтому замок питается от VIN через
**реле**: GPIO подаёт слабый сигнал на вход IN, а контакты реле замыкают мощную цепь.

* **COM** — общий контакт, **NO** (normally open) — замкнут с COM, только когда реле включено,
  **NC** (normally closed) — замкнут, когда реле выключено.
* Замок подключён к NO: пропало питание платы — замок закрылся.

### Нажатие, а не удержание

Кнопку нужно засечь **один раз** в момент нажатия — иначе одно нажатие превратится в десяток цифр.
Для нескольких кнопок удобен массив:

\`\`\`cpp
const int BTN[4] = {4, 5, 18, 19};
int last[4] = {HIGH, HIGH, HIGH, HIGH};

int readKey() {                 // 1…4 — какую кнопку только что нажали, 0 — никакую
  int key = 0;
  for (int i = 0; i < 4; i++) {
    int now = digitalRead(BTN[i]);
    if (now == LOW && last[i] == HIGH) key = i + 1;
    last[i] = now;
  }
  return key;
}
\`\`\`

### Проверка кода

Храните, сколько цифр уже введено верно:

\`\`\`cpp
const int CODE[4] = {1, 2, 3, 4};
int pos = 0;

if (key == CODE[pos]) pos++;   // угадали очередную цифру
else pos = 0;                  // ошиблись — всё сначала
if (pos == 4) { /* открыть! */ }
\`\`\`

Мигание и отсчёт 10 секунд делайте через \`millis()\` — \`delay(10000)\` «заморозит» и клавиатуру, и датчик.
Удобный приём для мигания: \`digitalWrite(LED, (millis() / 250) % 2);\``,
  hints: [
    'Заведите переменные: `int pos` (сколько цифр введено верно), `bool opened`, `unsigned long openedAt`.',
    'Каждый `loop()`: прочитать нажатую кнопку `readKey()`; если замок закрыт и кнопка нажата — проверить цифру по массиву `CODE`.',
    'Открытие: `digitalWrite(RELAY, HIGH); opened = true; openedAt = millis();`. Пока открыто — мигаем, иначе индикатор просто горит.',
    'Запирание: `if (opened && millis() - openedAt >= 10000 && analogRead(LDR) < 2000) { ... }` — условие проверяется каждый loop(), поэтому днём дверь закроется сама, как только стемнеет.',
  ],
  starterCode: `// Электронный замок шлюза
const int BTN[4] = {4, 5, 18, 19};   // кнопки 1, 2, 3, 4 (к GND)
const int LED_PIN = 25;              // индикатор
const int RELAY_PIN = 26;            // реле замка: HIGH — открыто
const int LDR_PIN = 34;              // датчик света: темно → меньше 2000
const int CODE[4] = {1, 2, 3, 4};

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 4; i++) pinMode(BTN[i], INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);
}

void loop() {
  // TODO: заперто — индикатор горит ровно
  // TODO: ловить нажатия и сверять с CODE
  // TODO: верный код — реле на 10 с, индикатор мигает
  // TODO: запирать только в темноте
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `const int BTN[4] = {4, 5, 18, 19};
const int LED_PIN = 25;
const int RELAY_PIN = 26;
const int LDR_PIN = 34;
const int CODE[4] = {1, 2, 3, 4};
const int DARK = 2000;
const unsigned long OPEN_MS = 10000;

int last[4] = {HIGH, HIGH, HIGH, HIGH};
int pos = 0;
bool opened = false;
unsigned long openedAt = 0;

int readKey() {
  int key = 0;
  for (int i = 0; i < 4; i++) {
    int now = digitalRead(BTN[i]);
    if (now == LOW && last[i] == HIGH) key = i + 1;
    last[i] = now;
  }
  return key;
}

void setOpen(bool on) {
  opened = on;
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
  if (on) openedAt = millis();
  Serial.println(on ? "Шлюз открыт" : "Шлюз заперт");
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 4; i++) pinMode(BTN[i], INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);
  setOpen(false);
}

void loop() {
  int key = readKey();
  if (!opened && key != 0) {
    if (key == CODE[pos]) pos++;
    else pos = (key == CODE[0]) ? 1 : 0;
    if (pos == 4) {
      pos = 0;
      setOpen(true);
    }
  }

  if (opened) {
    digitalWrite(LED_PIN, (millis() / 250) % 2);
    bool dark = analogRead(LDR_PIN) < DARK;
    if (millis() - openedAt >= OPEN_MS && dark) setOpen(false);
  } else {
    digitalWrite(LED_PIN, HIGH);
  }
  delay(10);
}
`,
  },
  checks: [
    {
      id: 'locked',
      title: 'После включения шлюз заперт, индикатор горит ровно',
      run: async (h) => {
        await h.wait(300);
        h.expect(!h.relayOn('relay'), 'Сразу после включения реле включено — замок открыт! Подайте LOW на GPIO26');
        h.expect(await solid(h, 2000), 'Пока шлюз заперт, индикатор на GPIO25 должен гореть ровно, без мигания');
      },
    },
    {
      id: 'wrong',
      title: 'Неверный код не открывает, ошибка сбрасывает ввод',
      run: async (h) => {
        await h.wait(500);
        await enter(h, [4, 3, 2, 1]);
        await h.wait(300);
        h.expect(!h.relayOn('relay'), 'Набрали 4-3-2-1 — а замок открылся');
        await enter(h, [1, 2, 4, 3, 4]);
        await h.wait(300);
        h.expect(!h.relayOn('relay'), 'Набрали 1-2-4-3-4 — замок открылся. Неверная цифра (4 на третьем месте) должна сбрасывать ввод');
        await enter(h, [1, 1, 1, 1]);
        await h.wait(300);
        h.expect(!h.relayOn('relay'), 'Набрали 1-1-1-1 — замок открылся');
        await enter(h, [1, 2, 3, 4]);
        await h.wait(300);
        h.expect(h.relayOn('relay'), 'После неудачных попыток верный код 1-2-3-4 не открыл замок — ввод должен начинаться заново');
      },
    },
    {
      id: 'open',
      title: 'Код 1-2-3-4 открывает замок, индикатор мигает',
      run: async (h) => {
        h.set('ldr', 'lux', 2);
        await h.wait(300);
        h.expect(!isOpen(h), 'Замок открыт ещё до ввода кода');
        const t = await unlock(h);
        await h.wait(3000);
        const flips = h.toggles(LED, t, t + 3000);
        h.expect(flips >= 4, `Пока шлюз открыт, индикатор должен мигать, а он переключился ${flips} раз(а) за 3 с`);
        h.expect(isOpen(h), 'Замок закрылся раньше, чем через 10 с');
      },
    },
    {
      id: 'close-dark',
      title: 'Ночью через 10 с шлюз запирается сам',
      timeoutMs: 30000,
      run: async (h) => {
        h.set('ldr', 'lux', 2);
        const t = await unlock(h);
        await h.until(t + 9300);
        h.expect(isOpen(h), `Замок закрылся раньше 10 с (через ${((h.now - t) / 1000).toFixed(1)} с проверки он уже заперт)`);
        await h.until(t + 10800);
        h.expect(!h.relayOn('relay'), 'Прошло 10 с, на улице темно — а реле всё ещё включено');
        h.expect(await solid(h, 1500), 'Шлюз заперт, но индикатор не горит ровно — должен перестать мигать');
        await enter(h, [1, 2, 3, 4]);
        h.expect(await h.waitFor(() => isOpen(h), 800), 'После запирания шлюз не открывается кодом повторно');
      },
    },
    {
      id: 'stay-light',
      title: 'Днём шлюз остаётся открытым и запирается, как только стемнеет',
      timeoutMs: 30000,
      run: async (h) => {
        h.set('ldr', 'lux', 2000);
        const t = await unlock(h);
        await h.until(t + 14000);
        h.expect(isOpen(h), 'Светло (2000 лк) — а шлюз заперся. Днём дверь должна оставаться открытой');
        h.expect(h.toggles(LED, t + 11000, t + 14000) >= 4, 'Шлюз открыт, а индикатор перестал мигать');
        h.set('ldr', 'lux', 2);
        const closed = await h.waitFor(() => !h.relayOn('relay'), 2000);
        h.expect(closed, 'Стемнело (2 лк), 10 с давно прошли — а шлюз так и не заперся за 2 с');
      },
    },
  ],
};
