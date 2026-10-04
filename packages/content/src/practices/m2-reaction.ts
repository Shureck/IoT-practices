import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, codeUses, p, w } from '../helpers';

const parts = () => [
  p('led', 'led', 330, -50, { color: 'green' }),
  p('r1', 'resistor', 260, -30, { value: 220 }),
  p('btn', 'button', 420, -40, { color: 'red', label: 'Жми!' }),
];

/** Дождаться сигнала, выждать reactMs и нажать. Возвращает текст, напечатанный после нажатия. */
async function round(h: CheckContext, reactMs: number): Promise<{ text: string; onAt: number }> {
  const ok = await h.waitFor(() => h.ledOn('led'), 7000, 1);
  h.expect(ok, 'Светодиод-сигнал так и не загорелся (ждали 7 с). Задержка перед сигналом — случайная, от 1 до 3 с');
  const onAt = h.now;
  await h.wait(reactMs);
  const m = h.mark();
  await h.press('btn', 100);
  await h.wait(400);
  return { text: h.serialSince(m), onAt };
}

const hasNear = (h: CheckContext, text: string, x: number, tol = 25) => h.numbers(text).some((n) => Math.abs(n - x) <= tol);

export const reaction: Practice = {
  id: 'm2-reaction',
  module: 2,
  order: 6,
  kind: 'homework',
  title: 'Реакция пилота',
  subtitle: 'Игра на прерываниях: кто быстрее нажмёт',
  difficulty: 2,
  xp: 100,
  minutes: 35,
  tags: ['прерывания', 'attachInterrupt', 'millis', 'random'],
  story: `Через неделю прилетает вертолёт со сменой, и пилот на связи шутит: «Проверь, не уснули ли вы там
от полярной ночи». Станция устраивает турнир на скорость реакции. Зелёный огонёк загорается в случайный
момент — жми кнопку как можно быстрее. Кто нажмёт раньше сигнала — фальстарт!`,
  goals: [
    'После случайной паузы **1–3 с** (`random`) загорается светодиод GPIO25',
    'Кнопка (GPIO14, к GND) обрабатывается **прерыванием** `attachInterrupt`; время реакции в мс печатается в Serial',
    'Нажатие до сигнала — печатать `Фальстарт!` и начинать раунд заново',
    'Хранить **лучший результат** и печатать его после каждой попытки; после паузы — новый раунд',
  ],
  theory: `### Прерывание

Обычно программа сама опрашивает кнопку в \`loop()\` — и может опоздать, если занята. **Прерывание** работает
иначе: при изменении уровня на выводе процессор бросает текущие дела и вызывает вашу функцию-обработчик.

\`\`\`cpp
volatile bool pressed = false;
volatile unsigned long pressedAt = 0;

void IRAM_ATTR onPress() {          // обработчик: коротко и быстро!
  if (!pressed) {
    pressed = true;
    pressedAt = millis();
  }
}

void setup() {
  pinMode(14, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(14), onPress, FALLING);  // FALLING: HIGH → LOW, т.е. нажатие
}
\`\`\`

* \`volatile\` — переменная меняется «за спиной» у loop(), компилятор не должен её кешировать.
* \`IRAM_ATTR\` — код обработчика кладётся в быструю память.
* В обработчике **нельзя** \`delay()\` и долгий \`Serial.print\` — только запомнить, что произошло.

### Случайная пауза

\`random(1000, 3001)\` — случайное число от 1000 до 3000. Засеките момент сигнала в переменную и сравнивайте
с \`millis()\` — тогда во время ожидания можно ловить фальстарт.`,
  hints: [
    'Раунд удобно разбить на фазы: ожидание (светодиод погашен) → сигнал (светодиод горит) → пауза с результатом.',
    'В фазе ожидания: если `pressed` — это фальстарт; если `millis() >= goAt` — зажечь светодиод и запомнить `goAt = millis()`.',
    'В фазе сигнала: если `pressed` — реакция `pressedAt - goAt`; сравнить с `best`, напечатать оба числа.',
    'Перед новым раундом не забудьте сбросить `pressed = false` и выбрать новый `goAt = millis() + random(1000, 3001)`.',
  ],
  starterCode: `// Игра «Реакция пилота»: светодиод GPIO25, кнопка GPIO14 (к GND)
const int LED = 25;
const int BUTTON = 14;

volatile bool pressed = false;
volatile unsigned long pressedAt = 0;

void IRAM_ATTR onPress() {
  // TODO: запомнить, что кнопку нажали, и когда
}

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
  // TODO: attachInterrupt(...)
}

void loop() {
  // TODO: случайная пауза 1–3 с → сигнал → измерить реакцию
  // TODO: фальстарт, лучший результат
}
`,
  starterCircuit: circuit(parts(), [
    w('esp:D25', 'r1:1', 'green'),
    w('r1:2', 'led:A', 'green'),
    w('led:C', 'esp:GND.1', 'black'),
    w('esp:D14', 'btn:1', 'blue'),
    w('btn:2', 'esp:GND.1', 'black'),
  ]),
  circuitLocked: true,
  solution: {
    code: `const int LED = 25;
const int BUTTON = 14;

volatile bool pressed = false;
volatile unsigned long pressedAt = 0;

enum Phase { WAITING, SIGNAL };
Phase phase = WAITING;
unsigned long goAt = 0;
unsigned long best = 0;

void IRAM_ATTR onPress() {
  if (!pressed) {
    pressed = true;
    pressedAt = millis();
  }
}

void newRound() {
  digitalWrite(LED, LOW);
  goAt = millis() + random(1000, 3001);
  pressed = false;
  phase = WAITING;
  Serial.println("Приготовься...");
}

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(BUTTON), onPress, FALLING);
  newRound();
}

void loop() {
  if (phase == WAITING) {
    if (pressed) {
      Serial.println("Фальстарт!");
      delay(1000);
      newRound();
    } else if (millis() >= goAt) {
      digitalWrite(LED, HIGH);
      goAt = millis();
      phase = SIGNAL;
    }
  } else if (pressed) {
    unsigned long ms = pressedAt - goAt;
    digitalWrite(LED, LOW);
    Serial.print("Реакция: ");
    Serial.print(ms);
    Serial.println(" мс");
    if (best == 0 || ms < best) {
      best = ms;
      Serial.println("Новый рекорд!");
    }
    Serial.print("Лучшее время: ");
    Serial.print(best);
    Serial.println(" мс");
    delay(2000);
    newRound();
  }
  delay(1);
}
`,
  },
  checks: [
    {
      id: 'reaction',
      title: 'Время реакции измеряется точно',
      timeoutMs: 30000,
      run: async (h) => {
        for (const x of [250, 420]) {
          const r = await round(h, x);
          h.expect(h.numbers(r.text).length > 0, `Нажали через ${x} мс после сигнала — в Serial не появилось время реакции`);
          h.expect(hasNear(h, r.text, x), `Нажали через ${x} мс после сигнала, а напечатано: «${r.text.trim().split(/\r?\n/)[0]}». Реакция = момент нажатия − момент сигнала`);
          h.expect(!h.ledOn('led'), 'После нажатия светодиод-сигнал должен погаснуть');
        }
      },
    },
    {
      id: 'random',
      title: 'Пауза перед сигналом — случайная, не меньше 1 с',
      timeoutMs: 40000,
      run: async (h) => {
        const ons: number[] = [];
        const offs: number[] = [0];
        for (let i = 0; i < 4; i++) {
          const r = await round(h, 200);
          ons.push(r.onAt);
          offs.push(h.now - 400);
        }
        h.expect(ons[0] >= 950, `Сигнал загорелся уже через ${Math.round(ons[0])} мс после старта — пауза должна быть не меньше 1 с`);
        const gaps = ons.map((t, i) => t - offs[i]);
        const spread = Math.max(...gaps) - Math.min(...gaps);
        h.expect(spread >= 150, `Пауза перед сигналом каждый раз одинаковая (${gaps.map((g) => (g / 1000).toFixed(2)).join(', ')} с) — так её легко угадать. Используйте random(1000, 3001)`);
      },
    },
    {
      id: 'false-start',
      title: 'Нажатие до сигнала — «Фальстарт!», раунд начинается заново',
      timeoutMs: 30000,
      run: async (h) => {
        await h.wait(300);
        h.expect(!h.ledOn('led'), 'Сигнал загорелся сразу после старта — нужна случайная пауза 1–3 с');
        const m = h.mark();
        await h.press('btn', 100);
        await h.wait(300);
        h.expect(/фальстарт/i.test(h.serialSince(m)), 'Нажали до сигнала — в Serial нет слова «Фальстарт»');
        h.expect(!h.ledOn('led'), 'После фальстарта сигнал не должен загораться сразу');
        const r = await round(h, 300);
        h.expect(hasNear(h, r.text, 300), 'После фальстарта игра не продолжилась: следующий раунд не измерил реакцию (нажали через 300 мс)');
      },
    },
    {
      id: 'best',
      title: 'Лучший результат запоминается и печатается',
      timeoutMs: 40000,
      run: async (h) => {
        await round(h, 400);
        await round(h, 250);
        const r = await round(h, 350);
        h.expect(hasNear(h, r.text, 350), 'Третья попытка (350 мс) не напечатана');
        h.expect(hasNear(h, r.text, 250), 'После попыток 400, 250 и 350 мс должен печататься лучший результат — 250 мс, а его нет');
      },
    },
    {
      id: 'interrupt',
      title: 'Кнопка обрабатывается прерыванием',
      run: async (h) => {
        h.expect(codeUses(h, /attachInterrupt\s*\(/), 'Подключите обработчик кнопки через attachInterrupt(digitalPinToInterrupt(14), onPress, FALLING)');
      },
    },
  ],
};
