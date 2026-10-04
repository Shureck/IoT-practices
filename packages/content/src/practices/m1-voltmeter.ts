import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const parts = () => [
  p('pot', 'pot', 300, -40, { value: 10000, position: 50 }),
];

/** Последняя строка Serial, где есть хотя бы два числа: [АЦП, напряжение]. */
function lastPair(h: CheckContext, mark: number): [number, number] | null {
  const lines = h.serialSince(mark).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const nums = h.numbers(lines[i]);
    if (nums.length >= 2) return [nums[nums.length - 2], nums[nums.length - 1]];
  }
  return null;
}

async function measure(h: CheckContext, pos: number): Promise<[number, number]> {
  h.set('pot', 'position', pos);
  await h.wait(100);
  const m = h.mark();
  await h.wait(1100);
  const pair = lastPair(h, m);
  if (!pair) h.fail(`Повернули ручку на ${pos}% — за секунду в Serial не появилось строки вида «2048, 1.65»`);
  return pair;
}

export const voltmeter: Practice = {
  id: 'm1-voltmeter',
  module: 1,
  order: 5,
  kind: 'lab',
  title: 'Вольтметр',
  subtitle: 'АЦП: превращаем напряжение в число',
  difficulty: 1,
  xp: 70,
  minutes: 20,
  tags: ['АЦП', 'analogRead', 'делитель напряжения', 'Serial'],
  story: `Аккумуляторы станции живы, но стрелочный вольтметр на щите разбит. Пока не привезут новый, его заменит
ESP32. Для калибровки Петрович дал потенциометр: крутишь ручку — меняется напряжение на входе от 0 до 3,3 В.
Научи плату показывать и «сырое» число АЦП, и настоящие вольты.`,
  goals: [
    'Читать потенциометр на **GPIO34** функцией `analogRead()`',
    'Пересчитывать показание в вольты: `voltage = adc * 3.3 / 4095`',
    'Каждые 200–500 мс печатать строку вида `2048, 1.65` — число АЦП и напряжение через запятую',
  ],
  theory: `### АЦП — аналого-цифровой преобразователь

Цифровой вход знает только «0» и «1». А **АЦП** измеряет напряжение и выдаёт число. У ESP32 АЦП 12-битный:
\`2¹² = 4096\` значений, от **0** (0 В) до **4095** (≈ 3,3 В).

\`\`\`
напряжение = показание × 3,3 / 4095
2048 → 2048 × 3,3 / 4095 ≈ 1,65 В
\`\`\`

\`\`\`cpp
int adc = analogRead(34);            // 0…4095
float voltage = adc * 3.3 / 4095;    // 3.3 — дробное, значит и результат дробный
Serial.print(adc);
Serial.print(", ");
Serial.println(voltage);             // float печатается с двумя знаками: 1.65
\`\`\`

> ⚠️ Если написать \`adc * 3 / 4095\`, всё посчитается в целых числах и почти всегда получится 0.
> Хотя бы одно число в формуле должно быть дробным: \`3.3\`.

### Потенциометр — делитель напряжения

Потенциометр — это резистор с ползунком. Крайние выводы подключены к 3V3 и GND, средний (SIG) делит
сопротивление на две части R₁ и R₂:

\`\`\`
U_SIG = 3,3 В × R₂ / (R₁ + R₂)
\`\`\`

Ручка в середине — R₁ = R₂, на входе половина: 1,65 В.

### Какие выводы умеют АЦП

У ESP32 два блока: **АЦП1** (GPIO32–39) и **АЦП2** (GPIO0, 2, 4, 12–15, 25–27). АЦП2 занят радиомодулем:
**когда включён Wi-Fi, analogRead на нём не работает**. Поэтому датчики лучше сразу вешать на АЦП1 —
как наш GPIO34. Заодно: GPIO34–39 — только входы, без внутренней подтяжки.`,
  hints: [
    'В `setup()` достаточно `Serial.begin(115200);` — для `analogRead` настраивать вывод не обязательно.',
    'В `loop()`: прочитать `analogRead(34)`, посчитать `float voltage = adc * 3.3 / 4095;`',
    'Печать: `Serial.print(adc); Serial.print(", "); Serial.println(voltage);` и `delay(300);`',
  ],
  starterCode: `// Вольтметр на АЦП: потенциометр на GPIO34
const int POT_PIN = 34;

void setup() {
  Serial.begin(115200);
}

void loop() {
  // TODO: прочитать АЦП, пересчитать в вольты
  // TODO: напечатать "показание, напряжение" и подождать 300 мс
}
`,
  starterCircuit: circuit(parts(), [
    w('pot:GND', 'esp:GND.1', 'black'),
    w('pot:SIG', 'esp:D34', 'yellow'),
    w('pot:VCC', 'esp:3V3', 'red'),
  ]),
  circuitLocked: true,
  solution: {
    code: `const int POT_PIN = 34;

void setup() {
  Serial.begin(115200);
}

void loop() {
  int adc = analogRead(POT_PIN);
  float voltage = adc * 3.3 / 4095;
  Serial.print(adc);
  Serial.print(", ");
  Serial.println(voltage);
  delay(300);
}
`,
  },
  checks: [
    {
      id: 'rate',
      title: 'Показания печатаются каждые 200–500 мс',
      run: async (h) => {
        await h.wait(500);
        const m = h.mark();
        await h.wait(3000);
        const lines = h.serialSince(m).split(/\r?\n/).filter((l) => h.numbers(l).length >= 2);
        h.expect(lines.length > 0, 'В Serial нет строк вида «2048, 1.65». Не забыли Serial.begin(115200)?');
        h.expect(lines.length >= 6, `За 3 с напечатано ${lines.length} строк(и) — это реже, чем раз в 500 мс`);
        h.expect(lines.length <= 16, `За 3 с напечатано ${lines.length} строк — слишком часто, добавьте delay(200…500)`);
      },
    },
    {
      id: 'adc',
      title: 'Число АЦП соответствует положению ручки (0…4095)',
      run: async (h) => {
        for (const pos of [25, 75, 0, 100]) {
          const [adc] = await measure(h, pos);
          const want = (pos / 100) * 4095;
          h.expect(Math.abs(adc - want) <= 60, `Ручка на ${pos}%: ожидалось показание ≈ ${Math.round(want)}, а напечатано ${adc}. Первое число в строке — результат analogRead(34)`);
        }
      },
    },
    {
      id: 'volts',
      title: 'Напряжение посчитано верно: adc × 3,3 / 4095',
      run: async (h) => {
        for (const pos of [50, 20, 90]) {
          const [adc, v] = await measure(h, pos);
          const want = (pos / 100) * 3.3;
          h.expect(Math.abs(v - (adc * 3.3) / 4095) <= 0.02 && Math.abs(v - want) <= 0.06,
            `Ручка на ${pos}%: показание ${adc} — это ${((adc * 3.3) / 4095).toFixed(2)} В, а напечатано ${v}. ` +
            (Math.abs(v) < 0.01 || Number.isInteger(v) ? 'Похоже на целочисленное деление — пишите 3.3, а не 3.' : 'Проверьте формулу: adc * 3.3 / 4095'));
        }
      },
    },
  ],
};
