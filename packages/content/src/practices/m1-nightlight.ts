import { propValue, type CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { checkLedWiring, circuit, p, w } from '../helpers';

const ADC_PIN = 34;

const parts = () => [
  p('ldr', 'ldr', 290, -60, { lux: 300 }),
  p('r1', 'resistor', 330, -70, { value: 10000 }),
  p('led1', 'led', 440, -60, { color: 'yellow' }),
  p('r2', 'resistor', 480, -70, { value: 220 }),
];

/** Проверка делителя: LDR между GPIO34 и одной шиной питания, резистор — между GPIO34 и другой. */
function checkDivider(h: CheckContext) {
  const ldrPins = ['1', '2'];
  const onAdc = ldrPins.filter((pin) => h.gpioAt('ldr', pin).includes(ADC_PIN));
  const anyGpio = ldrPins.flatMap((pin) => h.gpioAt('ldr', pin));
  if (!onAdc.length) {
    if (anyGpio.length) h.fail(`Фоторезистор подключён к GPIO${anyGpio[0]}, а нужно к GPIO34 (D34) — это вход АЦП1`);
    h.fail('Один вывод фоторезистора должен идти на GPIO34 (D34)');
  }
  const other = onAdc[0] === '1' ? '2' : '1';
  const ldrTo3v3 = h.onNet('ldr', other, '3V3');
  const ldrToGnd = h.onNet('ldr', other, 'GND');
  h.expect(!h.onNet('ldr', other, 'VIN'), 'Фоторезистор подключён к VIN (5 В) — на вход АЦП ESP32 можно подавать не больше 3,3 В. Используйте 3V3');
  h.expect(ldrTo3v3 || ldrToGnd, 'Второй вывод фоторезистора подключите к 3V3 или к GND');
  // постоянный резистор делителя
  const res = h.find('resistor').filter((r) => h.gpioAt(r.id, '1').includes(ADC_PIN) || h.gpioAt(r.id, '2').includes(ADC_PIN));
  h.expect(res.length > 0, 'Делителю нужен второй резистор: между GPIO34 и ' + (ldrTo3v3 ? 'GND' : '3V3'));
  const r = res[0];
  const value = Number(propValue(r, 'value'));
  const rOther = h.gpioAt(r.id, '1').includes(ADC_PIN) ? '2' : '1';
  const want = ldrTo3v3 ? 'GND' : '3V3';
  h.expect(h.onNet(r.id, rOther, want), `Резистор делителя: второй вывод должен идти на ${want} (на другую шину, чем фоторезистор)`);
  h.expect(value >= 4700 && value <= 47000, `В делителе стоит резистор ${value} Ом — с ним показания почти не меняются. Возьмите 10 кОм`);
}

async function ledAt(h: CheckContext, lux: number) {
  h.set('ldr', 'lux', lux);
  await h.wait(1200);
  return h.ledOn('led1');
}

export const nightlight: Practice = {
  id: 'm1-nightlight',
  module: 1,
  order: 6,
  kind: 'homework',
  title: 'Ночник',
  subtitle: 'Фоторезистор, делитель напряжения и автоматика',
  difficulty: 2,
  xp: 110,
  minutes: 35,
  tags: ['АЦП', 'делитель напряжения', 'фоторезистор', 'сборка схемы'],
  story: `Полярная ночь подкрадывается: солнце встаёт всё позже, а в коридоре к метеоплощадке хоть глаз выколи.
Повесим там ночник, который сам загорается в темноте и гаснет, когда включают свет. Детали на столе:
фоторезистор, резистор 10 кОм, жёлтый светодиод и 220 Ом. Схему собираешь сам.`,
  goals: [
    'Собрать делитель напряжения: фоторезистор и резистор **10 кОм**, средняя точка — на **GPIO34**, концы — на **3V3** и **GND**',
    'Подключить светодиод через резистор 220 Ом к **GPIO25**',
    'В темноте (≈ 2 лк) светодиод горит, при свете (≈ 2000 лк) — не горит',
    'Раз в полсекунды печатать показание АЦП в Serial — пригодится для подбора порога',
  ],
  theory: `### Фоторезистор

Его сопротивление зависит от света: на ярком свету — сотни ом, в темноте — десятки килоом.
Но АЦП измеряет **напряжение**, а не сопротивление. Чтобы превратить одно в другое, собирают **делитель**:

\`\`\`
3V3 ── [фоторезистор] ──┬── [10 кОм] ── GND
                        └── GPIO34
U = 3,3 × 10к / (R_ф + 10к)
\`\`\`

Светло → R_ф маленькое → напряжение почти 3,3 В. Темно → R_ф большое → напряжение падает.
Если поменять местами фоторезистор и резистор, зависимость станет обратной — так тоже можно, просто порог
и знак сравнения будут другими.

\`\`\`cpp
int light = analogRead(34);
Serial.println(light);       // посмотрите, какие числа при свете и в темноте
if (light < 1500) { /* темно */ }
\`\`\`

> 💡 Во время симуляции кликните по фоторезистору — появится регулятор освещённости.`,
  hints: [
    'Фоторезистор: один вывод → 3V3, другой → D34. Резистор 10 кОм: D34 → GND.',
    'Светодиод: D25 → резистор 220 Ом → анод (A), катод (C) → GND.',
    'Запустите симуляцию и подвигайте регулятор освещённости — посмотрите в Serial, какие числа при 2 лк и при 2000 лк. Порог возьмите посередине.',
  ],
  starterCode: `// Ночник: фоторезистор на GPIO34, светодиод на GPIO25
const int LDR_PIN = 34;
const int LED_PIN = 25;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  int light = analogRead(LDR_PIN);
  Serial.println(light);
  // TODO: если темно — включить светодиод, иначе — выключить
  delay(500);
}
`,
  starterCircuit: circuit(parts()),
  palette: ['ldr', 'resistor', 'led'],
  solution: {
    code: `const int LDR_PIN = 34;
const int LED_PIN = 25;
const int DARK = 1500;   // меньше — темно

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  int light = analogRead(LDR_PIN);
  Serial.println(light);
  digitalWrite(LED_PIN, light < DARK ? HIGH : LOW);
  delay(500);
}
`,
    circuit: circuit(parts(), [
      w('ldr:1', 'esp:3V3', 'red'),
      w('ldr:2', 'esp:D34', 'yellow'),
      w('r1:1', 'esp:D34', 'yellow'),
      w('r1:2', 'esp:GND.1', 'black'),
      w('esp:D25', 'r2:1', 'green'),
      w('r2:2', 'led1:A', 'green'),
      w('led1:C', 'esp:GND.1', 'black'),
    ]),
  },
  checks: [
    {
      id: 'divider',
      title: 'Делитель собран: фоторезистор и 10 кОм, средняя точка на GPIO34',
      run: async (h) => {
        checkDivider(h);
      },
    },
    {
      id: 'led',
      title: 'Светодиод подключён через резистор к GPIO25',
      run: async (h) => {
        const pin = checkLedWiring(h, 'led1');
        h.expect(pin === 25, `Светодиод подключён к GPIO${pin}, а нужно к GPIO25 (D25)`);
      },
    },
    {
      id: 'auto',
      title: 'В темноте ночник горит, при свете — гаснет',
      run: async (h) => {
        checkDivider(h);
        const dark = await ledAt(h, 2);
        h.expect(dark, 'Освещённость 2 лк (темно) — а светодиод не горит. Посмотрите в Serial, какие числа выдаёт АЦП в темноте, и проверьте порог');
        const light = await ledAt(h, 2000);
        h.expect(!light, 'Освещённость 2000 лк (светло) — а светодиод горит. Возможно, перепутан знак сравнения');
        h.expect(await ledAt(h, 1), 'Снова стемнело (1 лк) — а светодиод не загорелся');
        h.expect(!(await ledAt(h, 500)), 'Обычный свет в комнате (500 лк) — ночник должен быть выключен');
      },
    },
    {
      id: 'serial',
      title: 'Показания АЦП печатаются в Serial',
      run: async (h) => {
        await h.wait(300);
        const m = h.mark();
        await h.wait(2000);
        const n = h.numbers(h.serialSince(m)).length;
        h.expect(n >= 2, 'В Serial не видно показаний АЦП — печатайте analogRead(34) раз в полсекунды');
      },
    },
  ],
};
