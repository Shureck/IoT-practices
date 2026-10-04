import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const parts = () => [
  p('rgb', 'rgb', 400, -40),
  p('rR', 'resistor', 300, -110, { value: 220 }),
  p('rG', 'resistor', 300, -80, { value: 220 }),
  p('rB', 'resistor', 300, -50, { value: 220 }),
  p('pot', 'pot', 500, -40, { position: 0 }),
];

const NAMES = ['красный', 'зелёный', 'синий'];
const ON = 0.25;
const OFF = 0.08;

const fmt = (c: number[]) => `R ${Math.round(c[0] * 100)} %, G ${Math.round(c[1] * 100)} %, B ${Math.round(c[2] * 100)} %`;

async function colorAt(h: CheckContext, pos: number) {
  h.set('pot', 'position', pos);
  await h.wait(600);
  return h.rgb('rgb');
}

/** Ожидаемый цвет: какие каналы горят ярко, какие — нет. */
async function expectColor(h: CheckContext, pos: number, name: string, on: number[], off: number[]) {
  const c = await colorAt(h, pos);
  const ok = on.every((i) => c[i] > ON) && off.every((i) => c[i] < OFF);
  const want = [...on.map((i) => `${NAMES[i]} ярко`), ...off.map((i) => `${NAMES[i]} не горит`)].join(', ');
  h.expect(ok, `Ручка на ${pos}% — ожидался ${name} (${want}), а светодиод показывает ${fmt(c)}`);
}

export const rgb: Practice = {
  id: 'm2-rgb',
  module: 2,
  order: 7,
  kind: 'homework',
  title: 'Северное сияние',
  subtitle: 'RGB-светодиод, цветовой круг и три канала ШИМ',
  difficulty: 3,
  xp: 120,
  minutes: 45,
  tags: ['ШИМ', 'LEDC', 'RGB', 'АЦП', 'творческая'],
  story: `Полярной ночью в кают-компании не хватает красок, а настоящее сияние третью неделю прячется за тучами.
Сделаем своё: RGB-светильник, цвет которого выбирают ручкой потенциометра по кругу радуги. А если выкрутить
ручку до упора — светильник сам начинает медленно переливаться, как aurora borealis.`,
  goals: [
    'Подключить R, G, B (GPIO25, 26, 27) к трём каналам LEDC (общий катод уже на GND)',
    'Потенциометр (GPIO34) выбирает оттенок по цветовому кругу: **0 %** — красный, **≈ 33 %** — зелёный, **≈ 66 %** — синий, между ними — плавные смеси (жёлтый, голубой, фиолетовый)',
    'Ручка в крайнем правом положении (> 97 %) — **анимация**: цвет сам плавно бежит по кругу',
  ],
  theory: `### Цвет из трёх светодиодов

RGB-светодиод — это три кристалла в одном корпусе. Каждый управляется своим каналом ШИМ, а глаз смешивает
цвета: красный + зелёный = жёлтый, зелёный + синий = голубой, синий + красный = пурпурный.

\`\`\`cpp
ledcSetup(0, 5000, 8); ledcAttachPin(25, 0);   // R
ledcSetup(1, 5000, 8); ledcAttachPin(26, 1);   // G
ledcSetup(2, 5000, 8); ledcAttachPin(27, 2);   // B
ledcWrite(0, 255); ledcWrite(1, 128); ledcWrite(2, 0);   // оранжевый
\`\`\`

### Цветовой круг (HSV)

Оттенок (hue) — угол от 0 до 360°: 0° красный, 120° зелёный, 240° синий. Круг делится на 6 секторов по 60°,
в каждом один канал постоянен, второй плавно растёт или убывает, третий выключен:

| Угол | R | G | B |
|---|---|---|---|
| 0–60° | 255 | ↗ | 0 |
| 60–120° | ↘ | 255 | 0 |
| 120–180° | 0 | 255 | ↗ |
| 180–240° | 0 | ↘ | 255 |
| 240–300° | ↗ | 0 | 255 |
| 300–360° | 255 | 0 | ↘ |

\`\`\`cpp
int x = (hue % 60) * 255 / 60;   // «растущий» канал внутри сектора: 0…255
int sector = hue / 60;            // 0…5
\`\`\`

Угол из потенциометра — \`map(analogRead(34), 0, 4095, 0, 360)\`.`,
  hints: [
    'Напишите функцию `void setHue(int hue)`, которая по углу 0–359 выставляет три `ledcWrite` — через `switch (hue / 60)`.',
    'В секторе 0: `r = 255, g = x, b = 0`; в секторе 1: `r = 255 - x, g = 255, b = 0` — и так далее по таблице.',
    'Анимация: `if (adc > 4000) hue = (millis() / 20) % 360;` — полный круг примерно за 7 секунд.',
  ],
  starterCode: `// Северное сияние: RGB на 25/26/27, потенциометр на 34
const int PIN_R = 25, PIN_G = 26, PIN_B = 27;
const int POT = 34;

void setHue(int hue) {
  // TODO: угол 0…359 → три значения 0…255 → ledcWrite
}

void setup() {
  // TODO: три канала LEDC
}

void loop() {
  int adc = analogRead(POT);
  // TODO: оттенок из потенциометра; у упора — анимация
  delay(20);
}
`,
  starterCircuit: circuit(parts(), [
    w('esp:D25', 'rR:1', 'red'), w('rR:2', 'rgb:R', 'red'),
    w('esp:D26', 'rG:1', 'green'), w('rG:2', 'rgb:G', 'green'),
    w('esp:D27', 'rB:1', 'blue'), w('rB:2', 'rgb:B', 'blue'),
    w('rgb:COM', 'esp:GND.1', 'black'),
    w('pot:GND', 'esp:GND.1', 'black'),
    w('pot:SIG', 'esp:D34', 'yellow'),
    w('pot:VCC', 'esp:3V3', 'red'),
  ]),
  circuitLocked: true,
  solution: {
    code: `const int PIN_R = 25, PIN_G = 26, PIN_B = 27;
const int POT = 34;

void setHue(int hue) {
  hue = hue % 360;
  int x = (hue % 60) * 255 / 60;
  int r, g, b;
  switch (hue / 60) {
    case 0:  r = 255;     g = x;       b = 0;       break;
    case 1:  r = 255 - x; g = 255;     b = 0;       break;
    case 2:  r = 0;       g = 255;     b = x;       break;
    case 3:  r = 0;       g = 255 - x; b = 255;     break;
    case 4:  r = x;       g = 0;       b = 255;     break;
    default: r = 255;     g = 0;       b = 255 - x; break;
  }
  ledcWrite(0, r);
  ledcWrite(1, g);
  ledcWrite(2, b);
}

void setup() {
  ledcSetup(0, 5000, 8); ledcAttachPin(PIN_R, 0);
  ledcSetup(1, 5000, 8); ledcAttachPin(PIN_G, 1);
  ledcSetup(2, 5000, 8); ledcAttachPin(PIN_B, 2);
}

void loop() {
  int adc = analogRead(POT);
  int hue;
  if (adc > 4000) hue = (millis() / 20) % 360;   // сияние: круг за ~7 с
  else hue = map(adc, 0, 4095, 0, 360);
  setHue(hue);
  delay(20);
}
`,
  },
  checks: [
    {
      id: 'primary',
      title: 'Основные цвета: 0 % — красный, 33 % — зелёный, 66 % — синий',
      run: async (h) => {
        await h.wait(300);
        await expectColor(h, 0, 'красный', [0], [1, 2]);
        await expectColor(h, 33, 'зелёный', [1], [0, 2]);
        await expectColor(h, 66, 'синий', [2], [0, 1]);
      },
    },
    {
      id: 'mix',
      title: 'Смеси: жёлтый, голубой, пурпурный и оранжевый',
      run: async (h) => {
        await h.wait(300);
        await expectColor(h, 17, 'жёлтый', [0, 1], [2]);
        await expectColor(h, 50, 'голубой', [1, 2], [0]);
        await expectColor(h, 83, 'пурпурный', [0, 2], [1]);
        const c = await colorAt(h, 8);
        h.expect(c[0] > ON && c[2] < OFF && c[1] > 0.06 && c[1] < c[0] * 0.6,
          `Ручка на 8% — ожидался оранжевый (красный ярко, зелёный вполсилы), а светодиод показывает ${fmt(c)}. Каналы должны принимать промежуточные значения через ШИМ`);
      },
    },
    {
      id: 'aurora',
      title: 'У упора — анимация: цвет сам плавно бежит по кругу',
      timeoutMs: 30000,
      run: async (h) => {
        h.set('pot', 'position', 100);
        await h.wait(500);
        const lo = [1, 1, 1];
        const hi = [0, 0, 0];
        let jump = 0;
        let prev = h.rgb('rgb');
        for (let i = 0; i < 80; i++) {
          await h.wait(100);
          const c = h.rgb('rgb');
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], c[k]);
            hi[k] = Math.max(hi[k], c[k]);
            jump = Math.max(jump, Math.abs(c[k] - prev[k]));
          }
          prev = c;
        }
        const still = [0, 1, 2].filter((k) => hi[k] - lo[k] < 0.2);
        h.expect(still.length === 0, `Ручка у упора, а за 8 с ${still.length === 3 ? 'цвет не меняется' : `канал ${still.map((k) => NAMES[k]).join(', ')} почти не меняется`} — нужна анимация по всему кругу`);
        h.expect(jump <= 0.3, 'Цвет в анимации меняется скачками — сдвигайте оттенок понемногу (например, на 1° каждые 20 мс)');
        h.set('pot', 'position', 33);
        await h.wait(600);
        const c = h.rgb('rgb');
        h.expect(c[1] > ON && c[0] < OFF && c[2] < OFF, `Ручку вернули на 33% — анимация должна прекратиться и светодиод снова стать зелёным, а он: ${fmt(c)}`);
      },
    },
  ],
};
