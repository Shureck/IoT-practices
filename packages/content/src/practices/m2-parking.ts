import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const parts = () => [
  p('sonar', 'hcsr04', 300, -30, { distance: 150 }),
  p('buzzer', 'buzzer', 440, -30, { kind: 'passive' }),
];

/** Слушаем пищалку ms миллисекунд: доля звучания, число и средний период «бипов». */
async function listen(h: CheckContext, ms: number) {
  const end = h.now + ms;
  let on = 0;
  let total = 0;
  let prev = h.buzzerFreq('buzzer') > 0;
  const onsets: number[] = [];
  while (h.now < end) {
    await h.wait(10);
    const s = h.buzzerFreq('buzzer') > 0;
    total++;
    if (s) on++;
    if (s && !prev) onsets.push(h.now);
    prev = s;
  }
  const period = onsets.length >= 2 ? (onsets[onsets.length - 1] - onsets[0]) / (onsets.length - 1) : null;
  return { share: on / total, beeps: onsets.length, period };
}

async function at(h: CheckContext, cm: number) {
  h.set('sonar', 'distance', cm);
  await h.wait(1000);
}

export const parking: Practice = {
  id: 'm2-parking',
  module: 2,
  order: 3,
  kind: 'homework',
  title: 'Парктроник вездехода',
  subtitle: 'HC-SR04, pulseIn и пищалка, которая торопится',
  difficulty: 2,
  xp: 110,
  minutes: 40,
  tags: ['HC-SR04', 'pulseIn', 'tone', 'импульсные датчики'],
  story: `Задним ходом вездеход уже снёс угол дизельной и бочку с соляркой: из кабины в метель ничего не видно.
Сделаем парктроник, как в машине: чем ближе препятствие, тем чаще пищит, а вплотную — сплошной тон.
Дальномер HC-SR04 питается от VIN (5 В): TRIG — **GPIO5**, ECHO — **GPIO18**; пассивная пищалка — на **GPIO23**.`,
  goals: [
    'Измерять расстояние HC-SR04 (импульс 10 мкс на TRIG, `pulseIn` на ECHO, см = мкс / 58) и печатать его в Serial',
    'Дальше **100 см** — тишина',
    'От 100 до 15 см — короткие «бипы» (`tone`), и чем ближе препятствие, тем чаще',
    'Ближе **15 см** — непрерывный тон',
  ],
  theory: `### Дальномер — импульсный датчик

Ответ HC-SR04 — не напряжение и не число, а **длительность импульса** на ECHO: сколько микросекунд звук летел
до препятствия и обратно. \`pulseIn()\` как раз меряет длину импульса:

\`\`\`cpp
digitalWrite(TRIG, LOW);  delayMicroseconds(2);
digitalWrite(TRIG, HIGH); delayMicroseconds(10);   // «пинг»
digitalWrite(TRIG, LOW);
long us = pulseIn(ECHO, HIGH, 30000);              // 0 — эха не дождались
long cm = us / 58;
\`\`\`

Почему 58: звук проходит 1 см примерно за 29 мкс, а путь — туда и обратно.

### Пассивная пищалка

Ей нужен переменный сигнал нужной частоты — \`tone(вывод, частота)\`, выключение — \`noTone(вывод)\`.
Удобно: \`tone(23, 2000, 80)\` — пискнуть 80 мс и замолчать самой.`,
  hints: [
    'Сделайте функцию `long readCm()` — она возвращает расстояние (или большое число, если эха нет).',
    'Паузу между писками удобно считать через `map(cm, 15, 100, 150, 800)` — близко 150 мс, далеко 800 мс.',
    'Скелет loop(): измерить → напечатать → если < 15: `tone(23, 2000)`; если ≤ 100: `tone(23, 2000, 80)` и пауза; иначе `noTone(23)`.',
  ],
  starterCode: `// Парктроник: HC-SR04 (TRIG 5, ECHO 18) и пассивная пищалка (23)
const int TRIG = 5;
const int ECHO = 18;
const int BUZZER = 23;

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
}

void loop() {
  // TODO: измерить расстояние и напечатать его
  // TODO: пищать тем чаще, чем ближе препятствие
}
`,
  starterCircuit: circuit(parts(), [
    w('sonar:VCC', 'esp:VIN', 'red'),
    w('sonar:TRIG', 'esp:D5', 'yellow'),
    w('sonar:ECHO', 'esp:D18', 'green'),
    w('sonar:GND', 'esp:GND.2', 'black'),
    w('buzzer:PLUS', 'esp:D23', 'orange'),
    w('buzzer:MINUS', 'esp:GND.2', 'black'),
  ]),
  circuitLocked: true,
  solution: {
    code: `const int TRIG = 5;
const int ECHO = 18;
const int BUZZER = 23;

long readCm() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 30000);
  if (us == 0) return 999;      // эха нет — препятствие далеко
  return us / 58;
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
}

void loop() {
  long cm = readCm();
  Serial.print("Расстояние: ");
  Serial.print(cm);
  Serial.println(" см");

  if (cm < 15) {
    tone(BUZZER, 2000);                 // вплотную — сплошной тон
    delay(100);
  } else if (cm <= 100) {
    tone(BUZZER, 2000, 80);             // короткий бип
    delay(map(cm, 15, 100, 150, 800));  // чем ближе, тем короче пауза
  } else {
    noTone(BUZZER);
    delay(200);
  }
}
`,
  },
  checks: [
    {
      id: 'distance',
      title: 'Расстояние измеряется и печатается в Serial',
      run: async (h) => {
        await h.wait(500);
        for (const cm of [50, 120, 23]) {
          h.set('sonar', 'distance', cm);
          await h.wait(1000);
          const m = h.mark();
          await h.wait(1000);
          const nums = h.numbers(h.serialSince(m)).filter((x) => x > 0 && x < 1000);
          h.expect(nums.length > 0, `Препятствие на ${cm} см — за секунду в Serial не напечатано ни одного расстояния`);
          const got = nums[nums.length - 1];
          h.expect(Math.abs(got - cm) <= 2, `Препятствие на ${cm} см, а напечатано ${got}. Длительность эха в мкс делится на 58`);
        }
      },
    },
    {
      id: 'silent',
      title: 'Дальше 100 см — тишина',
      run: async (h) => {
        await at(h, 150);
        const r = await listen(h, 3000);
        h.expect(r.share === 0, `Препятствие на 150 см, а пищалка звучит ${Math.round(r.share * 100)} % времени — дальше метра должно быть тихо`);
      },
    },
    {
      id: 'faster',
      title: 'Ближе — чаще: на 30 см пищит заметно чаще, чем на 80 см',
      timeoutMs: 30000,
      run: async (h) => {
        await at(h, 80);
        const far = await listen(h, 4000);
        h.expect(far.beeps >= 3, `На 80 см за 4 с прозвучало ${far.beeps} писк(а) — парктроник должен пищать`);
        h.expect(far.share < 0.7, 'На 80 см звук почти не прерывается — нужны отдельные короткие писки');
        await at(h, 30);
        const near = await listen(h, 4000);
        h.expect(near.beeps >= 3 && near.share < 0.9, 'На 30 см должны быть частые, но отдельные писки');
        h.expect(near.period! < far.period! * 0.75,
          `Писки на 30 см (каждые ${Math.round(near.period!)} мс) должны быть заметно чаще, чем на 80 см (каждые ${Math.round(far.period!)} мс)`);
      },
    },
    {
      id: 'continuous',
      title: 'Ближе 15 см — непрерывный тон',
      run: async (h) => {
        await at(h, 10);
        const r = await listen(h, 2000);
        h.expect(r.share >= 0.95, `Препятствие на 10 см, а пищалка звучит только ${Math.round(r.share * 100)} % времени — нужен сплошной тон`);
      },
    },
  ],
};
