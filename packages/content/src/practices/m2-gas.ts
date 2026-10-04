import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const GAS = 34;

const parts = () => [
  p('gas', 'mq2', 300, -30, { ppm: 200 }),
  p('relay', 'relay', 380, -150),
  p('fan', 'motor', 530, -60),
  p('led', 'led', 250, -50, { color: 'red' }),
  p('r1', 'resistor', 190, -40, { value: 220 }),
];

const fanOn = (h: CheckContext) => h.relayOn('relay') && h.loadLevel('fan') > 0.5;

/** Держим концентрацию ms миллисекунд и следим, менялось ли состояние вентилятора. */
async function holdPpm(h: CheckContext, ppm: number, ms: number) {
  h.set('gas', 'ppm', ppm);
  const states = new Set<boolean>();
  const end = h.now + ms;
  while (h.now < end) {
    await h.wait(50);
    states.add(fanOn(h));
  }
  return states;
}

async function waitFan(h: CheckContext, ppm: number, want: boolean, ms = 1500) {
  h.set('gas', 'ppm', ppm);
  return h.waitFor(() => fanOn(h) === want && h.ledOn('led') === want, ms, 20);
}

/** Какое число должен вернуть analogRead при текущем напряжении на AO. */
const expectedRaw = (h: CheckContext) => Math.round((Math.min(3.3, h.gpio(GAS).voltage) / 3.3) * 4095);

export const gas: Practice = {
  id: 'm2-gas',
  module: 2,
  order: 5,
  kind: 'homework',
  title: 'Котельная',
  subtitle: 'MQ-2, реле вентилятора и гистерезис',
  difficulty: 2,
  xp: 110,
  minutes: 35,
  tags: ['MQ-2', 'аналоговые датчики', 'реле', 'гистерезис'],
  story: `Дизельный котёл станции капризничает после шторма, и в котельной временами пахнет гарью. Механик
поставил датчик газа MQ-2 и вытяжной вентилятор на реле. Сделай автоматику: газа много — вентилятор и красная
лампа включаются, проветрили — выключаются. Только без «дребезга»: реле, которое щёлкает раз в секунду,
долго не проживёт.`,
  goals: [
    'Раз в 0,5 с читать аналоговый выход MQ-2 (AO → **GPIO34**) и печатать показание АЦП в Serial',
    'Показание **больше 2500** — включить реле вентилятора (GPIO26) и красную лампу (GPIO25)',
    'Выключать, только когда показание упадёт **ниже 2000** (гистерезис); между порогами — ничего не менять',
  ],
  theory: `### MQ-2

Внутри датчика — нагреваемый слой диоксида олова. Горючие газы и дым меняют его сопротивление, и на выходе
**AO** растёт напряжение: больше газа — больше напряжение. Выход **DO** — цифровой: компаратор с порогом,
настроенным подстроечным резистором на плате модуля.

Датчику нужен разогрев и питание 5 В (VIN). AO подключаем к выводу **АЦП1** — например, GPIO34: тогда схема
продолжит работать и после включения Wi-Fi.

### Гистерезис

Если включать и выключать по одному порогу, то при концентрации «около порога» реле будет щёлкать без конца:
шум датчика туда-сюда перекидывает значение через границу. Решение — два порога:

\`\`\`
   показание
     │      ┌──── выше 2500: включить
     │      │
     │ ─ ─ ─│─ ─ ─ между порогами: оставить как было
     │      │
     │      └──── ниже 2000: выключить
\`\`\`

\`\`\`cpp
bool fan = false;
int level = analogRead(34);
if (!fan && level > 2500) fan = true;
if (fan && level < 2000)  fan = false;
\`\`\``,
  hints: [
    'Состояние вентилятора храните в переменной `bool fan` — решение принимается с учётом её текущего значения.',
    'Реле и лампа управляются одинаково: `digitalWrite(RELAY, fan); digitalWrite(LED, fan);`',
    'Печатайте само показание `analogRead(34)`, без пересчёта, — проверка сравнивает его с напряжением на входе.',
  ],
  starterCode: `// Котельная: MQ-2 (AO → 34), реле вентилятора (26), лампа (25)
const int GAS = 34;
const int RELAY = 26;
const int LED = 25;
const int ON_LEVEL = 2500;   // выше — включаем
const int OFF_LEVEL = 2000;  // ниже — выключаем

void setup() {
  Serial.begin(115200);
  pinMode(RELAY, OUTPUT);
  pinMode(LED, OUTPUT);
}

void loop() {
  // TODO: прочитать датчик и напечатать показание
  // TODO: включать/выключать вентилятор с гистерезисом
  delay(500);
}
`,
  starterCircuit: circuit(parts(), [
    w('gas:VCC', 'esp:VIN', 'red'),
    w('gas:GND', 'esp:GND.1', 'black'),
    w('gas:AO', 'esp:D34', 'green'),
    w('relay:VCC', 'esp:VIN', 'red'),
    w('relay:GND', 'esp:GND.1', 'black'),
    w('relay:IN', 'esp:D26', 'yellow'),
    w('relay:COM', 'esp:VIN', 'red'),
    w('relay:NO', 'fan:1', 'red'),
    w('fan:2', 'esp:GND.1', 'black'),
    w('esp:D25', 'r1:1', 'orange'),
    w('r1:2', 'led:A', 'orange'),
    w('led:C', 'esp:GND.1', 'black'),
  ]),
  circuitLocked: true,
  solution: {
    code: `const int GAS = 34;
const int RELAY = 26;
const int LED = 25;
const int ON_LEVEL = 2500;
const int OFF_LEVEL = 2000;

bool fan = false;

void setup() {
  Serial.begin(115200);
  pinMode(RELAY, OUTPUT);
  pinMode(LED, OUTPUT);
}

void loop() {
  int level = analogRead(GAS);
  if (!fan && level > ON_LEVEL) fan = true;
  if (fan && level < OFF_LEVEL) fan = false;
  digitalWrite(RELAY, fan ? HIGH : LOW);
  digitalWrite(LED, fan ? HIGH : LOW);

  Serial.print("Газ: ");
  Serial.print(level);
  Serial.println(fan ? "  (вентилятор работает)" : "");
  delay(500);
}
`,
  },
  checks: [
    {
      id: 'print',
      title: 'Показание датчика печатается в Serial',
      run: async (h) => {
        for (const ppm of [200, 2000, 600]) {
          h.set('gas', 'ppm', ppm);
          await h.wait(800);
          const m = h.mark();
          await h.wait(1200);
          const nums = h.numbers(h.serialSince(m)).filter((x) => x >= 0 && x <= 4095);
          h.expect(nums.length > 0, `Концентрация ${ppm} ppm — за секунду в Serial не появилось ни одного показания`);
          const want = expectedRaw(h);
          const got = nums.some((x) => Math.abs(x - want) <= 60);
          h.expect(got, `Концентрация ${ppm} ppm: на входе ${h.gpio(GAS).voltage.toFixed(2)} В, analogRead должен вернуть ≈ ${want}, а в Serial: ${nums.slice(-3).join(', ')}`);
        }
      },
    },
    {
      id: 'switch',
      title: 'Много газа — вентилятор и лампа включаются, мало — выключены',
      run: async (h) => {
        h.set('gas', 'ppm', 200);
        await h.wait(1500);
        h.expect(!h.relayOn('relay'), 'Газа почти нет (≈ 1200 по АЦП) — а реле вентилятора включено');
        h.expect(!h.ledOn('led'), 'Газа почти нет — а красная лампа горит');
        const on = await waitFan(h, 2000, true);
        h.expect(on, `Концентрация 2000 ppm (≈ ${expectedRaw(h)} по АЦП) — за 1,5 с не включились ${!h.relayOn('relay') ? 'реле вентилятора' : 'красная лампа'}`);
        const off = await waitFan(h, 200, false);
        h.expect(off, 'Газ ушёл (≈ 1200 по АЦП) — а вентилятор или лампа не выключились за 1,5 с');
      },
    },
    {
      id: 'hysteresis',
      title: 'Гистерезис: между 2000 и 2500 состояние не меняется',
      timeoutMs: 30000,
      run: async (h) => {
        await h.wait(500);
        h.expect(await waitFan(h, 2000, true), 'При 2000 ppm вентилятор не включился — сначала добейтесь простого включения');
        const a = await holdPpm(h, 600, 3000);
        h.expect(!a.has(false), `Газа стало меньше (≈ ${expectedRaw(h)}, между порогами) — вентилятор выключился рано. Выключать нужно только ниже 2000`);
        h.expect(await waitFan(h, 400, false), `Показание упало до ≈ ${expectedRaw(h)} (ниже 2000) — а вентилятор не выключился`);
        const b = await holdPpm(h, 600, 3000);
        h.expect(!b.has(true), `Показание ≈ ${expectedRaw(h)} (между порогами), вентилятор был выключен — и включился. Включать нужно только выше 2500`);
      },
    },
  ],
};
