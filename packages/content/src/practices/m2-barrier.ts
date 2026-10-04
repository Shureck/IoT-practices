import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const SERVO = 13;

const parts = () => [
  p('servo', 'servo', 300, -30, { horn: 'barrier' }),
  p('btn', 'button', 420, -40, { color: 'green', label: 'Шлагбаум' }),
];

const angleMsg = (h: CheckContext) => `${Math.round(h.servoAngle('servo'))}°`;

async function pressAndCheck(h: CheckContext, want: number, n: number) {
  await h.press('btn', 200);
  await h.wait(600);
  const a = h.servoAngle('servo');
  h.expect(Math.abs(a - want) <= 6, `После ${n}-го нажатия шлагбаум должен стоять на ${want}°, а он на ${angleMsg(h)}`);
}

export const barrier: Practice = {
  id: 'm2-barrier',
  module: 2,
  order: 2,
  kind: 'lab',
  title: 'Шлагбаум гаража',
  subtitle: 'Сервопривод на LEDC: 50 Гц и 10 бит',
  difficulty: 2,
  xp: 70,
  minutes: 25,
  tags: ['ШИМ', 'LEDC', 'сервопривод', 'кнопки'],
  story: `У гаража вездеходов стоит шлагбаум — чтобы снегоход не влетел в открытые ворота. Мотор шлагбаума
сгорел, но на складе нашёлся сервопривод SG90. Водитель жмёт кнопку — шлагбаум поднимается на 90°,
ещё раз — опускается. Сервопривод уже подключён: питание от VIN, сигнал — на **GPIO13**.`,
  goals: [
    'Настроить ШИМ для сервопривода на **GPIO13**: частота **50 Гц**, разрешение **10 бит** (как в лекции) — или библиотека ESP32Servo',
    'После включения шлагбаум закрыт: **0°**',
    'Каждое нажатие кнопки (GPIO14, к GND, `INPUT_PULLUP`) переключает шлагбаум: 0° ↔ 90°',
    'Одно нажатие — одно движение, даже если кнопку держат долго',
  ],
  theory: `### Как сервопривод понимает угол

Сервоприводу нужен импульс каждые **20 мс** (частота 50 Гц). Угол задаётся **шириной** импульса:

| Импульс | Угол |
|---|---|
| ≈ 0,5 мс | 0° |
| ≈ 1,45 мс | 90° |
| ≈ 2,4 мс | 180° |

### Считаем заполнение для LEDC

При разрешении 10 бит период 20 мс делится на 2¹⁰ = 1024 ступени, одна ступень ≈ **19,5 мкс**. Отсюда:

\`\`\`
0,5 мс / 19,5 мкс ≈ 26    → 0°
2,4 мс / 19,5 мкс ≈ 123   → 180°
\`\`\`

Всё, что между, — линейно. Функция \`map()\` делает такой пересчёт за нас:

\`\`\`cpp
const int CH = 0;
ledcSetup(CH, 50, 10);            // 50 Гц, 10 бит: значения 0…1023
ledcAttachPin(13, CH);

int duty = map(angle, 0, 180, 26, 123);
ledcWrite(CH, duty);               // 90° → 74
\`\`\`

> С библиотекой **ESP32Servo** всё это спрятано внутри: \`servo.attach(13); servo.write(90);\`.
> Но полезно один раз понять, что происходит «под капотом».

### Одно нажатие — одно действие

Реагируйте на **момент** нажатия (было HIGH, стало LOW), а не на состояние — иначе пока палец на кнопке,
шлагбаум будет дёргаться вверх-вниз.`,
  hints: [
    'В `setup()`: `ledcSetup(0, 50, 10); ledcAttachPin(13, 0); ledcWrite(0, 26);` — сразу закрываем шлагбаум.',
    'Заведите `bool isOpen = false;` и `int last = HIGH;` — прошлое состояние кнопки.',
    'При нажатии: `isOpen = !isOpen; ledcWrite(0, map(isOpen ? 90 : 0, 0, 180, 26, 123));`',
  ],
  starterCode: `// Шлагбаум гаража: сервопривод на GPIO13, кнопка на GPIO14
const int SERVO_PIN = 13;
const int BUTTON = 14;
const int CH = 0;              // канал LEDC

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  // TODO: ШИМ 50 Гц, 10 бит на SERVO_PIN; шлагбаум закрыт (0°)
}

void loop() {
  // TODO: по нажатию переключать 0° ↔ 90°
}
`,
  starterCircuit: circuit(parts(), [
    w('servo:GND', 'esp:GND.1', 'black'),
    w('servo:V+', 'esp:VIN', 'red'),
    w('servo:PWM', 'esp:D13', 'orange'),
    w('esp:D14', 'btn:1', 'blue'),
    w('btn:2', 'esp:GND.1', 'black'),
  ]),
  circuitLocked: true,
  solution: {
    code: `const int SERVO_PIN = 13;
const int BUTTON = 14;
const int CH = 0;

bool isOpen = false;
int last = HIGH;

int angleToDuty(int angle) {
  return map(angle, 0, 180, 26, 123);   // 0,5 мс … 2,4 мс при 50 Гц и 10 битах
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON, INPUT_PULLUP);
  ledcSetup(CH, 50, 10);
  ledcAttachPin(SERVO_PIN, CH);
  ledcWrite(CH, angleToDuty(0));
}

void loop() {
  int now = digitalRead(BUTTON);
  if (now == LOW && last == HIGH) {
    isOpen = !isOpen;
    ledcWrite(CH, angleToDuty(isOpen ? 90 : 0));
    Serial.println(isOpen ? "Шлагбаум открыт" : "Шлагбаум закрыт");
  }
  last = now;
  delay(20);
}
`,
  },
  checks: [
    {
      id: 'pwm',
      title: 'На GPIO13 — ШИМ 50 Гц',
      run: async (h) => {
        await h.wait(500);
        const pwm = h.gpio(SERVO).pwm;
        h.expect(pwm && pwm.freq > 0, 'На GPIO13 нет ШИМ-сигнала — сервопривод не знает, куда повернуться');
        h.expect(Math.abs(pwm!.freq - 50) <= 3, `Частота ШИМ ${Math.round(pwm!.freq)} Гц, а сервоприводу нужно 50 Гц (импульс каждые 20 мс)`);
      },
    },
    {
      id: 'closed',
      title: 'После включения шлагбаум закрыт (0°)',
      run: async (h) => {
        await h.wait(800);
        const a = h.servoAngle('servo');
        h.expect(Math.abs(a) <= 6, `После включения шлагбаум стоит на ${angleMsg(h)}, а должен быть закрыт — 0°. Для LEDC 10 бит это ledcWrite(канал, 26)`);
      },
    },
    {
      id: 'toggle',
      title: 'Кнопка переключает шлагбаум: 0° → 90° → 0° → 90°',
      run: async (h) => {
        await h.wait(800);
        await pressAndCheck(h, 90, 1);
        await pressAndCheck(h, 0, 2);
        await pressAndCheck(h, 90, 3);
      },
    },
    {
      id: 'hold',
      title: 'Долгое нажатие — одно движение',
      run: async (h) => {
        await h.wait(800);
        h.hold('btn', true);
        await h.wait(300);
        let moved = 0;
        let prev = h.servoAngle('servo');
        for (let i = 0; i < 30; i++) {
          await h.wait(50);
          const a = h.servoAngle('servo');
          if (Math.abs(a - prev) > 3) moved++;
          prev = a;
        }
        h.hold('btn', false);
        await h.wait(400);
        h.expect(moved === 0, 'Пока кнопку держат, шлагбаум дёргается — реагируйте только на момент нажатия (было HIGH, стало LOW)');
        h.expect(Math.abs(h.servoAngle('servo') - 90) <= 6, `После одного долгого нажатия шлагбаум должен быть открыт (90°), а он на ${angleMsg(h)}`);
      },
    },
  ],
};
