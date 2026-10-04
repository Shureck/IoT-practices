import type { Practice } from '../types';
import { checkLedWiring, circuit, gpioFor, p, w } from '../helpers';

const parts = () => [
  p('led1', 'led', 330, -40, { color: 'green' }),
  p('r1', 'resistor', 300, 150, { value: 220 }),
  p('btn', 'button', 420, 150, { color: 'red', label: 'Вызов' }),
];

export const button: Practice = {
  id: 'm1-button',
  module: 1,
  order: 2,
  kind: 'lab',
  title: 'Кнопка вызова',
  subtitle: 'Собираем схему: кнопка и светодиод',
  difficulty: 1,
  xp: 70,
  minutes: 20,
  tags: ['GPIO', 'digitalRead', 'подтяжка', 'сборка схемы'],
  story: `В кают-компании есть кнопка вызова дежурного — но провода к ней оборваны. Собери схему заново:
пока кнопка нажата, на пульте дежурного горит зелёный светодиод, а в журнал (Serial) пишется «ВЫЗОВ!».`,
  goals: [
    'Подключить светодиод через резистор 220 Ом к **GPIO25**, катод — к **GND**',
    'Подключить кнопку между **GPIO14** и **3V3**, включить подтяжку вниз `INPUT_PULLDOWN`',
    'Пока кнопка нажата — светодиод горит, отпущена — не горит',
    'При каждом нажатии печатать в Serial строку `ВЫЗОВ!` (один раз на нажатие)',
  ],
  theory: `### Как прочитать кнопку

Кнопка — это просто контакт. Когда она не нажата, вход микроконтроллера ни к чему не подключён и «висит в воздухе»:
значение будет случайным. Поэтому вход **подтягивают** резистором к земле или к питанию. У ESP32 такие резисторы
встроены:

\`\`\`cpp
pinMode(14, INPUT_PULLDOWN);   // не нажата → LOW, нажата (к 3V3) → HIGH
int state = digitalRead(14);
\`\`\`

### Как не печатать сообщение тысячу раз

\`loop()\` выполняется тысячи раз в секунду. Чтобы реагировать **на момент нажатия**, запоминайте прошлое состояние:

\`\`\`cpp
int last = LOW;
void loop() {
  int now = digitalRead(14);
  if (now == HIGH && last == LOW) {
    // кнопку только что нажали
  }
  last = now;
}
\`\`\`

### Сборка

Чтобы протянуть провод, кликните по выводу компонента, затем по выводу платы. Светодиоду обязательно нужен
резистор — иначе он сгорит! Длинная ножка (анод, **A**) — к резистору, короткая (катод, **C**) — к GND.`,
  hints: [
    'Провода: D25 → резистор → анод светодиода (A); катод (C) → GND.',
    'Кнопка: один вывод → D14, второй → 3V3.',
    'В setup(): `pinMode(25, OUTPUT); pinMode(14, INPUT_PULLDOWN); Serial.begin(115200);`',
    'Чтобы «ВЫЗОВ!» печаталось один раз, сравнивайте текущее состояние кнопки с предыдущим.',
  ],
  starterCode: `const int LED_PIN = 25;
const int BUTTON_PIN = 14;

void setup() {
  Serial.begin(115200);
  // TODO: настройте выводы
}

void loop() {
  // TODO: светодиод горит, пока кнопка нажата
  // TODO: при нажатии один раз напечатать "ВЫЗОВ!"
}
`,
  starterCircuit: circuit(parts()),
  palette: ['led', 'resistor', 'button'],
  solution: {
    code: `const int LED_PIN = 25;
const int BUTTON_PIN = 14;
int last = LOW;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLDOWN);
}

void loop() {
  int now = digitalRead(BUTTON_PIN);
  digitalWrite(LED_PIN, now);
  if (now == HIGH && last == LOW) {
    Serial.println("ВЫЗОВ!");
  }
  last = now;
  delay(10);
}
`,
    circuit: circuit(parts(), [
      w('esp:D25', 'r1:1', 'green'),
      w('r1:2', 'led1:A', 'green'),
      w('led1:C', 'esp:GND.1', 'black'),
      w('esp:D14', 'btn:1', 'yellow'),
      w('btn:2', 'esp:3V3', 'red'),
    ]),
  },
  checks: [
    {
      id: 'wiring',
      title: 'Схема собрана: светодиод через резистор на GPIO25, кнопка на GPIO14',
      run: async (h) => {
        const ledPin = checkLedWiring(h, 'led1');
        h.expect(ledPin === 25, `Светодиод подключён к GPIO${ledPin}, а нужно к GPIO25 (вывод D25)`);
        const btnPins = [...h.gpioAt('btn', '1'), ...h.gpioAt('btn', '2')];
        h.expect(btnPins.includes(14), 'Один вывод кнопки должен идти на GPIO14 (D14)');
        h.expect(h.onNet('btn', '1', '3V3') || h.onNet('btn', '2', '3V3'), 'Второй вывод кнопки подключите к 3V3');
      },
    },
    {
      id: 'follow',
      title: 'Светодиод горит только пока кнопка нажата',
      run: async (h) => {
        await h.wait(200);
        h.expect(!h.ledOn('led1'), 'Светодиод горит, хотя кнопка не нажата. Включена ли подтяжка INPUT_PULLDOWN?');
        h.hold('btn', true);
        await h.wait(100);
        h.expect(h.ledOn('led1'), 'Нажали кнопку — светодиод не загорелся');
        h.hold('btn', false);
        await h.wait(100);
        h.expect(!h.ledOn('led1'), 'Отпустили кнопку — светодиод не погас');
      },
    },
    {
      id: 'once',
      title: '«ВЫЗОВ!» печатается один раз на каждое нажатие',
      run: async (h) => {
        gpioFor(h, 'btn', '1', 'Кнопка');
        await h.wait(200);
        const m = h.mark();
        await h.press('btn', 400);
        await h.wait(300);
        await h.press('btn', 400);
        await h.wait(300);
        const calls = h.serialSince(m).split(/\r?\n/).filter((l) => l.includes('ВЫЗОВ!')).length;
        h.expect(calls > 0, 'При нажатии в Serial не появилось «ВЫЗОВ!»');
        h.expect(calls === 2, `За два нажатия «ВЫЗОВ!» напечатано ${calls} раз(а), а нужно ровно 2 — отслеживайте момент нажатия`);
      },
    },
  ],
};
