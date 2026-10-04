import type { Practice } from '../types';
import { bare, codeUses, expectPeriod } from '../helpers';

export const blink: Practice = {
  id: 'm1-blink',
  module: 1,
  order: 1,
  kind: 'lab',
  title: 'Первый вдох',
  subtitle: 'Мигаем встроенным светодиодом',
  difficulty: 1,
  xp: 50,
  minutes: 10,
  tags: ['setup и loop', 'GPIO', 'delay'],
  story: `Ты включил плату ESP32 — на ней загорелся красный индикатор питания. Но станции нужен
сигнал жизни: дежурный маяк, который мигает раз в секунду. Начнём с синего светодиода, встроенного прямо в плату.`,
  goals: [
    'Настроить вывод **GPIO2** на выход (`pinMode`)',
    'Включать и выключать светодиод: 1 секунда горит, 1 секунда не горит',
    'Нажать **▶ Запуск** и убедиться, что синий светодиод на плате мигает',
  ],
  theory: `### Как устроена программа Arduino

\`\`\`cpp
void setup() {
  // выполняется один раз при включении
}

void loop() {
  // повторяется бесконечно
}
\`\`\`

Встроенный светодиод платы подключён к **GPIO2**. Чтобы управлять выводом, его сначала настраивают на выход,
а потом подают высокий (\`HIGH\` = 3,3 В) или низкий (\`LOW\` = 0 В) уровень:

\`\`\`cpp
pinMode(2, OUTPUT);       // вывод 2 — выход
digitalWrite(2, HIGH);    // включить
delay(1000);              // подождать 1000 мс = 1 с
digitalWrite(2, LOW);     // выключить
\`\`\`

> 💡 Номер вывода удобно хранить в константе: \`const int LED_PIN = 2;\` — тогда его легко поменять в одном месте.`,
  hints: [
    'В `setup()` нужна одна строка: `pinMode(2, OUTPUT);`',
    'В `loop()` четыре строки: включить, подождать 1000 мс, выключить, подождать 1000 мс.',
    'Если светодиод горит постоянно — проверьте, что после `digitalWrite(2, LOW)` тоже стоит `delay(1000)`.',
  ],
  starterCode: `// Маяк станции: мигаем встроенным светодиодом (GPIO2)
const int LED_PIN = 2;

void setup() {
  // TODO: настройте LED_PIN на выход

}

void loop() {
  // TODO: 1 секунда — включено, 1 секунда — выключено

}
`,
  starterCircuit: bare(),
  circuitLocked: true,
  solution: {
    code: `const int LED_PIN = 2;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(1000);
  digitalWrite(LED_PIN, LOW);
  delay(1000);
}
`,
  },
  checks: [
    {
      id: 'mode',
      title: 'GPIO2 настроен на выход',
      run: async (h) => {
        await h.wait(50);
        h.expect(h.gpio(2).isOutput, 'GPIO2 не настроен как OUTPUT — добавьте pinMode(2, OUTPUT) в setup()');
      },
    },
    {
      id: 'blinks',
      title: 'Светодиод мигает: 1 с горит, 1 с не горит',
      run: async (h) => {
        await h.wait(8200);
        expectPeriod(h, 2, 0, 8200, 2000, 60, 'Светодиод');
        const duty = h.dutyOver(2, 0, 8000);
        h.expect(Math.abs(duty - 0.5) < 0.08, `Светодиод горит ${Math.round(duty * 100)}% времени, а должен — половину`);
      },
    },
    {
      id: 'delay',
      title: 'Пауза сделана через delay()',
      run: async (h) => {
        h.expect(codeUses(h, /\bdelay\s*\(/), 'Используйте delay(1000) для паузы');
      },
    },
  ],
};
