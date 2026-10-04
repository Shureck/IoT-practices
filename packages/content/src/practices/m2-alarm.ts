import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, linesWith, p, w } from '../helpers';

const LED = 25;

const parts = () => [
  p('pir', 'pir', 300, -30, { hold: 3 }),
  p('buzzer', 'buzzer', 380, -30, { kind: 'passive' }),
  p('led', 'led', 440, -30, { color: 'red' }),
  p('r1', 'resistor', 470, -20, { value: 220 }),
  p('btn', 'button', 540, -30, { color: 'black', label: 'Охрана' }),
];

/** Наблюдаем ms миллисекунд: доля звучания пищалки, переключения тревожного светодиода, горел ли он. */
async function observe(h: CheckContext, ms: number) {
  const from = h.now;
  const end = from + ms;
  let sound = 0;
  let lit = 0;
  let n = 0;
  while (h.now < end) {
    await h.wait(20);
    n++;
    if (h.buzzerFreq('buzzer') > 0) sound++;
    if (h.ledOn('led')) lit++;
  }
  return { sound: sound / n, lit: lit / n, flips: h.toggles(LED, from, h.now) };
}

const armedLed = (h: CheckContext) => h.gpio(2).isOutput && h.gpio(2).level > 0;

async function arm(h: CheckContext) {
  await h.press('btn', 200);
  await h.wait(400);
}

async function expectAlarm(h: CheckContext, when: string) {
  const r = await observe(h, 2000);
  h.expect(r.sound > 0.3, `${when}: пищалка ${r.sound === 0 ? 'молчит' : `звучит лишь ${Math.round(r.sound * 100)} % времени`} — нужна сирена через tone()`);
  h.expect(r.flips >= 3, `${when}: красный светодиод должен мигать, а он переключился ${r.flips} раз(а) за 2 с`);
}

async function expectQuiet(h: CheckContext, when: string) {
  const r = await observe(h, 2000);
  h.expect(r.sound === 0, `${when}: пищалка звучит, а должна молчать`);
  h.expect(r.lit === 0, `${when}: красный светодиод горит, а должен быть выключен`);
}

export const alarm: Practice = {
  id: 'm2-alarm',
  module: 2,
  order: 4,
  kind: 'homework',
  title: 'Охрана периметра',
  subtitle: 'PIR-датчик, сирена и кнопка постановки на охрану',
  difficulty: 2,
  xp: 110,
  minutes: 40,
  tags: ['PIR', 'цифровые датчики', 'tone', 'конечный автомат'],
  story: `Ночью у склада продуктов снова кто-то был: следы, разорванный мешок с крупой. Песцы, скорее всего, —
но начальник хочет знать наверняка. Поставь у двери охранную систему: инфракрасный датчик движения,
сирену и красный маячок. Дежурный ставит склад на охрану кнопкой и той же кнопкой снимает.`,
  goals: [
    'Кнопка (GPIO14, к GND) по очереди **ставит на охрану** и **снимает с охраны**; пока охрана включена, горит встроенный светодиод **GPIO2**',
    'Под охраной движение (PIR, выход на **GPIO27**) включает тревогу: красный светодиод (GPIO25) **мигает**, пищалка (GPIO23) **воет** через `tone()`, в Serial — `ТРЕВОГА`',
    'Тревога **не прекращается сама**, даже когда движение закончилось, — только кнопкой',
    'Без охраны движение ни к чему не приводит',
  ],
  theory: `### PIR-датчик

Пироэлектрический датчик ловит изменение **инфракрасного** (теплового) излучения: тёплое тело прошло перед
линзой Френеля — на выходе OUT появляется \`HIGH\` на несколько секунд (время удержания настраивается).
Это **цифровой** датчик: читаем обычным \`digitalRead\`.

\`\`\`cpp
if (digitalRead(27) == HIGH) { /* кто-то движется */ }
\`\`\`

### Тревога «защёлкивается»

Если просто повторять за датчиком, сирена замолчит через 3 секунды — вор переждёт и пойдёт дальше.
Поэтому храните состояние в переменных: \`armed\` (под охраной) и \`alarm\` (тревога). Движение только
**включает** \`alarm\`, а выключает её кнопка.

### Сирена

Плавающий тон звучит тревожнее одного писка: \`tone(23, 1800)\` и \`tone(23, 1200)\` по очереди,
переключаясь каждые 200 мс по \`millis()\`.`,
  hints: [
    'Две переменные-флага: `bool armed = false; bool alarm = false;` Кнопку обрабатывайте по моменту нажатия.',
    'При нажатии: `armed = !armed; alarm = false;` — снятие с охраны заодно гасит тревогу.',
    '`if (armed && !alarm && digitalRead(PIR) == HIGH) { alarm = true; Serial.println("ТРЕВОГА!"); }`',
    'В конце loop(): если `alarm` — мигаем и воем по `(millis() / 200) % 2`, иначе `digitalWrite(LED, LOW); noTone(BUZZER);`',
  ],
  starterCode: `// Охрана склада: PIR (27), пищалка (23), маячок (25), кнопка (14)
const int PIR = 27;
const int BUZZER = 23;
const int LED = 25;
const int BUTTON = 14;
const int ARMED_LED = 2;   // встроенный светодиод: «под охраной»

void setup() {
  Serial.begin(115200);
  pinMode(PIR, INPUT);
  pinMode(LED, OUTPUT);
  pinMode(ARMED_LED, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
}

void loop() {
  // TODO: кнопка ставит на охрану / снимает
  // TODO: под охраной движение → тревога до снятия с охраны
}
`,
  starterCircuit: circuit(parts(), [
    w('pir:VCC', 'esp:VIN', 'red'),
    w('pir:OUT', 'esp:D27', 'yellow'),
    w('pir:GND', 'esp:GND.1', 'black'),
    w('buzzer:PLUS', 'esp:D23', 'orange'),
    w('buzzer:MINUS', 'esp:GND.2', 'black'),
    w('esp:D25', 'r1:1', 'red'),
    w('r1:2', 'led:A', 'red'),
    w('led:C', 'esp:GND.1', 'black'),
    w('esp:D14', 'btn:1', 'blue'),
    w('btn:2', 'esp:GND.1', 'black'),
  ]),
  circuitLocked: true,
  solution: {
    code: `const int PIR = 27;
const int BUZZER = 23;
const int LED = 25;
const int BUTTON = 14;
const int ARMED_LED = 2;

bool armed = false;
bool alarm = false;
int last = HIGH;

void setup() {
  Serial.begin(115200);
  pinMode(PIR, INPUT);
  pinMode(LED, OUTPUT);
  pinMode(ARMED_LED, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
}

void loop() {
  int b = digitalRead(BUTTON);
  if (b == LOW && last == HIGH) {
    armed = !armed;
    alarm = false;
    Serial.println(armed ? "Охрана включена" : "Охрана снята");
  }
  last = b;

  if (armed && !alarm && digitalRead(PIR) == HIGH) {
    alarm = true;
    Serial.println("ТРЕВОГА! Движение у склада");
  }

  digitalWrite(ARMED_LED, armed ? HIGH : LOW);
  if (alarm) {
    bool phase = (millis() / 200) % 2;
    digitalWrite(LED, phase);
    tone(BUZZER, phase ? 1800 : 1200);
  } else {
    digitalWrite(LED, LOW);
    noTone(BUZZER);
  }
  delay(10);
}
`,
  },
  checks: [
    {
      id: 'disarmed',
      title: 'Без охраны движение не вызывает тревогу',
      run: async (h) => {
        await h.wait(500);
        h.expect(!armedLed(h), 'Сразу после включения горит индикатор охраны GPIO2 — система должна стартовать снятой с охраны');
        h.motion('pir');
        await expectQuiet(h, 'Охрана выключена, у склада движение');
        h.expect(linesWith(h, 'тревог').length === 0, 'Охрана выключена — а в Serial напечатана тревога');
      },
    },
    {
      id: 'alarm',
      title: 'Под охраной движение включает тревогу: маячок, сирена, «ТРЕВОГА» в Serial',
      run: async (h) => {
        await h.wait(500);
        await arm(h);
        h.expect(armedLed(h), 'Нажали кнопку — встроенный светодиод GPIO2 не загорелся. Система встала на охрану?');
        await expectQuiet(h, 'Под охраной, но движения нет');
        const m = h.mark();
        h.motion('pir');
        await expectAlarm(h, 'Под охраной обнаружено движение');
        h.expect(/тревог/i.test(h.serialSince(m)), 'При тревоге в Serial должно появиться слово «ТРЕВОГА»');
      },
    },
    {
      id: 'latch',
      title: 'Тревога не прекращается сама, когда движение закончилось',
      timeoutMs: 30000,
      run: async (h) => {
        await h.wait(500);
        await arm(h);
        h.motion('pir');
        await h.wait(8000);
        await expectAlarm(h, 'Движение закончилось 5 с назад, охрану никто не снимал');
      },
    },
    {
      id: 'disarm',
      title: 'Кнопка снимает охрану и выключает тревогу; потом охрану можно включить снова',
      timeoutMs: 30000,
      run: async (h) => {
        await h.wait(500);
        await arm(h);
        h.motion('pir');
        await h.wait(1500);
        await h.press('btn', 200);
        await h.wait(300);
        await expectQuiet(h, 'Нажали кнопку во время тревоги');
        h.expect(!armedLed(h), 'Охрана снята — а индикатор GPIO2 всё ещё горит');
        h.motion('pir');
        await expectQuiet(h, 'Охрана снята, снова движение');
        await h.wait(3000);
        await arm(h);
        h.motion('pir');
        await expectAlarm(h, 'Снова поставили на охрану и снова движение');
      },
    },
  ],
};
