import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, codeUses, p, w } from '../helpers';

const LED = 26;

const parts = () => [
  p('led1', 'led', 330, -50, { color: 'red' }),
  p('r1', 'resistor', 260, -30, { value: 220 }),
];

/** Вспышки светодиода: [начало, конец] в мс. */
function flashes(h: CheckContext, pin: number, to: number) {
  const res: { on: number; off: number }[] = [];
  let start: number | null = null;
  for (const x of h.history(pin, 0, to)) {
    if (x.v > 0 && start === null) start = x.t;
    else if (x.v === 0 && start !== null) { res.push({ on: start, off: x.t }); start = null; }
  }
  return res;
}

const DOT = 200;
const DASH = 600;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** Расшифровка: точки, тире, пробел между буквами, « / » между словами, «?» — непонятная пауза. */
function decode(h: CheckContext, to: number) {
  const fl = flashes(h, LED, to);
  let text = '';
  const bad: string[] = [];
  fl.forEach((f, i) => {
    const d = f.off - f.on;
    if (near(d, DOT, 40)) text += '.';
    else if (near(d, DASH, 70)) text += '-';
    else { text += '?'; bad.push(`вспышка №${i + 1} длится ${Math.round(d)} мс`); }
    const next = fl[i + 1];
    if (!next) return;
    const g = next.on - f.off;
    if (near(g, 200, 40)) text += '';
    else if (near(g, 600, 70)) text += ' ';
    else if (near(g, 1400, 140)) text += ' / ';
    else text += ` [пауза ${Math.round(g)} мс?] `;
  });
  return { fl, text, bad };
}

export const sos: Practice = {
  id: 'm1-sos',
  module: 1,
  order: 3,
  kind: 'homework',
  title: 'Сигнал бедствия',
  subtitle: 'Азбука Морзе на светодиоде',
  difficulty: 1,
  xp: 90,
  minutes: 25,
  tags: ['GPIO', 'delay', 'функции', 'азбука Морзе'],
  story: `Радио молчит, а над станцией раз в сутки проходит патрульный борт. Пилоты всё ещё читают свет:
если на мачте мигает **SOS**, они сообщат о вас на Большую землю. Красный фонарь на мачте уже подключён к
**GPIO26** — осталось научить его говорить на азбуке Морзе. Правильно и без запинок: пилот не станет гадать.`,
  goals: [
    'Точка — вспышка **200 мс**, тире — вспышка **600 мс**',
    'Пауза между знаками внутри буквы — **200 мс**, между буквами — **600 мс**, после слова — **1400 мс**',
    'Передавать **SOS** (`··· ––– ···`) бесконечно, слово за словом',
    'Оформить точку и тире отдельными функциями `dot()` и `dash()`',
  ],
  theory: `### Ритм азбуки Морзе

Вся азбука строится на одной единице времени — длительности точки (у нас 200 мс):

| Элемент | Длительность |
|---|---|
| точка | 1 единица = 200 мс света |
| тире | 3 единицы = 600 мс света |
| пауза между знаками буквы | 1 единица = 200 мс темноты |
| пауза между буквами | 3 единицы = 600 мс |
| пауза между словами | 7 единиц = 1400 мс |

**S** — три точки, **O** — три тире. Значит, SOS — это \`··· ––– ···\`, и вся посылка занимает 6,8 секунды.

### Свои функции

Когда одно и то же действие повторяется много раз, его выносят в функцию. Её объявляют один раз —
и потом вызывают по имени:

\`\`\`cpp
const int LED_PIN = 26;
const int UNIT = 200;          // длительность точки, мс

void flash(int ms) {           // вспышка заданной длины
  digitalWrite(LED_PIN, HIGH);
  delay(ms);
  digitalWrite(LED_PIN, LOW);
  delay(UNIT);                 // после любого знака — пауза в 1 единицу
}
\`\`\`

Обратите внимание на хитрость: после каждого знака мы уже выдержали паузу в 1 единицу. Поэтому между буквами
нужно добавить ещё **2** единицы (итого 3), а после слова — ещё **6** (итого 7).`,
  hints: [
    'Сделайте `dot()` и `dash()`: включить, подождать 200 (или 600) мс, выключить, подождать 200 мс.',
    'Буква S — это три вызова `dot()`, буква O — три вызова `dash()`.',
    'После буквы добавьте `delay(400)` (200 уже было после последнего знака), после слова — `delay(1200)`.',
    'Скелет loop(): S, пауза 400, O, пауза 400, S, пауза 1200.',
  ],
  starterCode: `// Маяк бедствия: SOS азбукой Морзе на GPIO26
const int LED_PIN = 26;
const int UNIT = 200;   // длительность точки, мс

void dot() {
  // TODO: вспышка 200 мс, затем пауза 200 мс
}

void dash() {
  // TODO: вспышка 600 мс, затем пауза 200 мс
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  // TODO: S (···), пауза, O (–––), пауза, S (···), длинная пауза
}
`,
  starterCircuit: circuit(parts(), [
    w('esp:D26', 'r1:1', 'orange'),
    w('r1:2', 'led1:A', 'orange'),
    w('led1:C', 'esp:GND.1', 'black'),
  ]),
  circuitLocked: true,
  solution: {
    code: `const int LED_PIN = 26;
const int UNIT = 200;

void flash(int ms) {
  digitalWrite(LED_PIN, HIGH);
  delay(ms);
  digitalWrite(LED_PIN, LOW);
  delay(UNIT);
}

void dot()  { flash(UNIT); }
void dash() { flash(3 * UNIT); }

void letterS() { dot(); dot(); dot(); }
void letterO() { dash(); dash(); dash(); }

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  letterS();
  delay(2 * UNIT);   // между буквами: 3 единицы
  letterO();
  delay(2 * UNIT);
  letterS();
  delay(6 * UNIT);   // после слова: 7 единиц
}
`,
  },
  checks: [
    {
      id: 'symbols',
      title: 'Точки длятся 200 мс, тире — 600 мс',
      run: async (h) => {
        await h.wait(7000);
        const { fl, bad } = decode(h, 7000);
        h.expect(h.gpio(LED).isOutput, 'GPIO26 не настроен на выход — нужен pinMode(26, OUTPUT)');
        h.expect(fl.length >= 3, `За 7 секунд фонарь вспыхнул ${fl.length} раз(а), а в одном SOS 9 вспышек`);
        h.expect(bad.length === 0, `Непонятные вспышки: ${bad.slice(0, 3).join('; ')}. Точка — 200 мс, тире — 600 мс`);
        const dots = fl.filter((f) => near(f.off - f.on, DOT, 40)).length;
        const dashes = fl.filter((f) => near(f.off - f.on, DASH, 70)).length;
        h.expect(dots > 0 && dashes > 0, `Есть только ${dots ? 'точки' : 'тире'} — а в SOS нужны и точки, и тире`);
      },
    },
    {
      id: 'gaps',
      title: 'Паузы: 200 мс внутри буквы, 600 мс между буквами, 1400 мс между словами',
      run: async (h) => {
        await h.wait(15000);
        const { fl, text } = decode(h, 15000);
        h.expect(fl.length >= 9, `За 15 секунд всего ${fl.length} вспышек — фонарь должен передавать SOS без остановки`);
        const odd = text.match(/\[пауза (\d+) мс\?\]/);
        h.expect(!odd, `Встретилась пауза ${odd?.[1]} мс. Допустимы только 200 (внутри буквы), 600 (между буквами) и 1400 мс (между словами)`);
        h.expect(text.includes(' / '), 'Не найдена пауза между словами (1400 мс) — пилот не поймёт, где кончается SOS');
        h.expect(/[.-] [.-]/.test(text), 'Не найдена пауза между буквами (600 мс) — буквы сливаются');
      },
    },
    {
      id: 'sos',
      title: 'Передаётся SOS, раз за разом',
      run: async (h) => {
        await h.wait(16000);
        const { text } = decode(h, 16000);
        const shown = text.length > 60 ? `${text.slice(0, 60)}…` : text || '(ничего)';
        h.expect(text.includes('... --- ... / ... --- ...'), `Пилот видит: «${shown}», а должен видеть «... --- ... / ... --- ...» (S O S, пауза, S O S)`);
      },
    },
    {
      id: 'functions',
      title: 'Точка и тире оформлены функциями dot() и dash()',
      run: async (h) => {
        h.expect(codeUses(h, /void\s+dot\s*\(/) && codeUses(h, /void\s+dash\s*\(/), 'Объявите функции void dot() и void dash()');
        h.expect(codeUses(h, /\bdot\s*\(\s*\)\s*;/) && codeUses(h, /\bdash\s*\(\s*\)\s*;/), 'Функции dot() и dash() объявлены, но нигде не вызываются');
      },
    },
  ],
};
