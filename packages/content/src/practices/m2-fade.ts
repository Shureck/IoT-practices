import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const PIN = 18;

const parts = () => [
  p('led1', 'led', 330, 160, { color: 'white' }),
  p('r1', 'resistor', 260, 170, { value: 220 }),
];

/** Скважность ШИМ на выводе каждые step мс в течение ms. */
async function sampleDuty(h: CheckContext, ms: number, step = 50) {
  const out: { t: number; d: number; pwm: boolean; freq: number }[] = [];
  const end = h.now + ms;
  while (h.now < end) {
    await h.wait(step);
    const g = h.gpio(PIN);
    out.push({ t: h.now, d: g.pwm ? g.pwm.duty : g.out && g.isOutput ? 1 : 0, pwm: !!g.pwm && g.pwm.freq > 0, freq: g.pwm?.freq ?? 0 });
  }
  return out;
}

/** Моменты входа в «яркую» зону — по ним считаем период. */
function peaks(s: { t: number; d: number }[], hi: number) {
  const res: number[] = [];
  let inside = false;
  for (const x of s) {
    if (!inside && x.d >= hi) { res.push(x.t); inside = true; }
    else if (inside && x.d < hi * 0.5) inside = false;
  }
  return res;
}

export const fade: Practice = {
  id: 'm2-fade',
  module: 2,
  order: 1,
  kind: 'lab',
  title: 'Плавный рассвет',
  subtitle: 'ШИМ и LEDC: светодиод «дышит»',
  difficulty: 1,
  xp: 60,
  minutes: 20,
  tags: ['ШИМ', 'LEDC', 'ledcWrite'],
  story: `Врач станции жалуется: после полярной ночи люди просыпаются разбитыми. Нужен «рассветный» светильник —
не щелчок выключателя, а мягкое нарастание и угасание света. Цифровой вывод умеет только «включено» и
«выключено»… но если переключать его очень быстро, глаз увидит полутона.`,
  goals: [
    'Подключить вывод **GPIO18** к ШИМ: `ledcSetup` + `ledcAttachPin` (или `analogWrite`)',
    'Частота ШИМ — не меньше 100 Гц, чтобы не было видно мерцания (обычно 5000 Гц)',
    'Яркость плавно растёт от 0 до максимума и плавно спадает обратно — без скачков',
    'Полный цикл «вверх-вниз» — **2–4 секунды**',
  ],
  theory: `### ШИМ — широтно-импульсная модуляция

Вывод быстро-быстро включается и выключается. Доля времени во включённом состоянии называется
**коэффициентом заполнения** (duty cycle). 25 % — светодиод кажется тусклым, 100 % — горит в полную силу.

\`\`\`
  25 %  ▔|____|▔|____|▔|____
  75 %  ▔▔▔▔|_|▔▔▔▔|_|▔▔▔▔|_
\`\`\`

### LEDC — аппаратный ШИМ ESP32

У ESP32 16 каналов ШИМ. Канал настраивают (частота и разрешение), привязывают к выводу и задают заполнение:

\`\`\`cpp
const int CH = 0;
ledcSetup(CH, 5000, 8);       // канал 0: 5000 Гц, 8 бит → значения 0…255
ledcAttachPin(18, CH);        // вывод 18 управляется каналом 0
ledcWrite(CH, 128);           // 128 / 255 ≈ 50 %
\`\`\`

> В ядре Arduino-ESP32 3.x то же самое пишется короче: \`ledcAttach(18, 5000, 8); ledcWrite(18, 128);\`.
> Подойдёт и привычный \`analogWrite(18, 128)\`.

### Плавное изменение

\`\`\`cpp
for (int duty = 0; duty <= 255; duty++) {
  ledcWrite(CH, duty);
  delay(5);                   // 256 шагов × 5 мс ≈ 1,3 с
}
\`\`\`

Время цикла = число шагов × задержка. Хотите 3 секунды на «вверх-вниз» — посчитайте задержку сами.`,
  hints: [
    'В `setup()`: `ledcSetup(0, 5000, 8); ledcAttachPin(18, 0);`',
    'В `loop()` два цикла `for`: от 0 до 255 и обратно от 255 до 0, в каждом — `ledcWrite(0, duty)` и маленькая пауза.',
    '512 шагов за ~3 с → пауза около 6 мс на шаг.',
  ],
  starterCode: `// «Рассветный» светильник: светодиод на GPIO18
const int LED_PIN = 18;
const int CH = 0;          // канал LEDC

void setup() {
  // TODO: настроить канал ШИМ и привязать его к LED_PIN
}

void loop() {
  // TODO: плавно разгореться и плавно погаснуть
}
`,
  starterCircuit: circuit(parts(), [
    w('esp:D18', 'r1:1', 'green'),
    w('r1:2', 'led1:A', 'green'),
    w('led1:C', 'esp:GND.2', 'black'),
  ]),
  circuitLocked: true,
  solution: {
    code: `const int LED_PIN = 18;
const int CH = 0;

void setup() {
  ledcSetup(CH, 5000, 8);
  ledcAttachPin(LED_PIN, CH);
}

void loop() {
  for (int duty = 0; duty <= 255; duty++) {
    ledcWrite(CH, duty);
    delay(6);
  }
  for (int duty = 255; duty >= 0; duty--) {
    ledcWrite(CH, duty);
    delay(6);
  }
}
`,
  },
  checks: [
    {
      id: 'pwm',
      title: 'На GPIO18 есть ШИМ-сигнал с частотой не ниже 100 Гц',
      run: async (h) => {
        const s = await sampleDuty(h, 2000);
        const withPwm = s.filter((x) => x.pwm);
        h.expect(withPwm.length > 0, 'На GPIO18 нет ШИМ: digitalWrite умеет только «вкл/выкл». Используйте ledcSetup + ledcAttachPin + ledcWrite');
        const f = withPwm[0].freq;
        h.expect(f >= 100, `Частота ШИМ ${f} Гц — глаз увидит мерцание. Нужно хотя бы 100 Гц, обычно берут 5000`);
      },
    },
    {
      id: 'range',
      title: 'Яркость меняется от нуля до максимума через много промежуточных уровней',
      run: async (h) => {
        const s = await sampleDuty(h, 8000);
        const max = Math.max(...s.map((x) => x.d));
        const min = Math.min(...s.map((x) => x.d));
        const levels = new Set(s.map((x) => Math.round(x.d * 100))).size;
        h.expect(max >= 0.9, `Максимальная яркость — ${Math.round(max * 100)} %, а должна доходить до 100 %`);
        h.expect(min <= 0.05, `Минимальная яркость — ${Math.round(min * 100)} %, светодиод должен гаснуть почти полностью`);
        h.expect(levels >= 20, `За 8 секунд яркость принимала всего ${levels} разных значений — это не плавное изменение`);
      },
    },
    {
      id: 'smooth',
      title: 'Без скачков: яркость и растёт, и спадает плавно',
      run: async (h) => {
        const s = await sampleDuty(h, 8000, 20);
        let jump = 0;
        let up = 0;
        let down = 0;
        for (let i = 1; i < s.length; i++) {
          const d = s[i].d - s[i - 1].d;
          jump = Math.max(jump, Math.abs(d));
          if (d > 0.001) up++;
          if (d < -0.001) down++;
        }
        h.expect(up > 20 && down > 20, up <= 20 ? 'Яркость почти не растёт плавно — нужен цикл от 0 до 255' : 'Яркость не спадает плавно — после разгорания нужен цикл обратно от 255 до 0 (а не резкое выключение)');
        h.expect(jump <= 0.25, `Яркость скачет на ${Math.round(jump * 100)} % за 20 мс — меняйте её маленькими шагами`);
      },
    },
    {
      id: 'period',
      title: 'Полный цикл «вверх-вниз» — 2–4 секунды',
      run: async (h) => {
        const s = await sampleDuty(h, 12000, 20);
        const max = Math.max(...s.map((x) => x.d));
        const pk = peaks(s, max * 0.9);
        h.expect(pk.length >= 3, `За 12 секунд светодиод разгорался до максимума ${pk.length} раз(а) — цикл должен повторяться каждые 2–4 с`);
        const per = (pk[pk.length - 1] - pk[0]) / (pk.length - 1);
        h.expect(per >= 1800 && per <= 4400, `Один цикл длится ${(per / 1000).toFixed(1)} с, а нужно 2–4 с — подберите задержку на шаг`);
      },
    },
  ],
};
