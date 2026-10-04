import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, codeUses, expectPeriod, p, w } from '../helpers';

const parts = () => [
  p('r1', 'resistor', 260, -120, { value: 220 }),
  p('r2', 'resistor', 260, -160, { value: 220 }),
  p('ledR', 'led', 330, -40, { color: 'red' }),
  p('ledG', 'led', 400, -40, { color: 'green' }),
];

const wires = () => [
  w('esp:D25', 'r1:1', 'orange'),
  w('r1:2', 'ledR:A', 'orange'),
  w('ledR:C', 'esp:GND.1', 'black'),
  w('esp:D26', 'r2:1', 'green'),
  w('r2:2', 'ledG:A', 'green'),
  w('ledG:C', 'esp:GND.1', 'black'),
];

/** Моменты фронтов (любых) на выводе. */
function edges(h: CheckContext, pin: number, from: number, to: number): number[] {
  return h.history(pin, from, to).filter((x) => x.t > 0).map((x) => x.t);
}

export const registers: Practice = {
  id: 'm3-registers',
  module: 3,
  order: 1,
  kind: 'lab',
  title: 'Быстрее digitalWrite',
  subtitle: 'Управляем выводами напрямую через регистры GPIO',
  difficulty: 2,
  xp: 70,
  minutes: 25,
  tags: ['регистры', 'GPIO', 'битовые маски'],
  story: `Над вертолётной площадкой «Полярной-5» висят два проблесковых огня — красный и зелёный. Пилот ориентируется
по ним в пурге, и они должны мигать строго попеременно: один гаснет ровно в тот момент, когда загорается другой.
Старый контроллер делал это «по-взрослому» — записью прямо в регистры. Повтори этот трюк на ESP32.`,
  goals: [
    'Настроить **GPIO25** (красный) и **GPIO26** (зелёный) на выход — через `pinMode` или регистр `GPIO.enable_w1ts`',
    'Огни мигают попеременно: 500 мс горит красный, 500 мс — зелёный (период каждого — 1 с)',
    'Переключать выводы **записью в регистры** `GPIO.out_w1ts` / `GPIO.out_w1tc` (или `REG_WRITE(GPIO_OUT_W1TS_REG, …)`), без `digitalWrite`',
    'Один огонь гаснет в тот же момент, когда загорается другой',
  ],
  theory: `### Что такое регистр

Регистр — это ячейка памяти внутри микроконтроллера, биты которой напрямую связаны с «железом». Записал в бит
единицу — на ножке появилось 3,3 В. \`digitalWrite()\` в итоге делает именно это, но перед записью проверяет номер
вывода, режим, ищет нужный регистр… Это занимает сотни наносекунд. Прямая запись в регистр — единицы.

### Как это было на Arduino Uno (AVR)

На лекции мы видели регистры AVR: \`DDRB\` задаёт направление выводов порта B, \`PORTB\` — их уровень:

\`\`\`cpp
DDRB  |= (1 << PB5);    // вывод 13 — выход
PORTB |= (1 << PB5);    // HIGH
PORTB &= ~(1 << PB5);   // LOW
\`\`\`

Запись \`PORTB |= …\` — это **чтение-изменение-запись**: прочитать регистр, поменять бит, записать обратно. Если
между чтением и записью сработает прерывание и изменит другой бит того же порта — его изменение потеряется.

### Как это устроено у ESP32

У ESP32 выводы пронумерованы от 0 до 39, поэтому регистры 32-битные: бит *N* отвечает за GPIO*N*.
Чтобы не делать опасное «чтение-изменение-запись», у каждого регистра есть два помощника:

| Регистр | Что делает запись единицы в бит N |
|---|---|
| \`GPIO.out_w1ts\` (*write 1 to set*) | GPIO*N* → HIGH |
| \`GPIO.out_w1tc\` (*write 1 to clear*) | GPIO*N* → LOW |
| \`GPIO.enable_w1ts\` | GPIO*N* становится выходом |

Нули ничего не меняют — поэтому запись **атомарна** и безопасна даже при прерываниях и двух ядрах.

### Битовые маски

Число, в котором единицы стоят только в нужных битах, называют **маской**:

\`\`\`cpp
const uint32_t MASK_A = (1 << 25);           // или BIT25
const uint32_t MASK_B = (1 << 26);

GPIO.out_w1ts = MASK_A | MASK_B;             // оба вывода HIGH одной записью
GPIO.out_w1tc = MASK_A;                      // GPIO25 → LOW, GPIO26 не трогаем

REG_WRITE(GPIO_OUT_W1TS_REG, MASK_B);        // то же через макрос и адрес регистра
\`\`\`

Оператор \`|\` объединяет маски, \`<<\` сдвигает единицу на нужную позицию.

> 💡 Регистры дают скорость, но лишают переносимости: этот код не заработает на Arduino Uno или ESP32-C3.
> Пользуйтесь ими там, где важны наносекунды — например, в протоколах, которые «дёргают» ножку сами.`,
  hints: [
    'Маска вывода — это `1 << номер`. Сделайте две константы: для 25 и для 26.',
    'В `loop()` две фазы: «красный включить, зелёный выключить» и наоборот, между ними `delay(500)`.',
    'Включить: `GPIO.out_w1ts = MASK_R;` Выключить: `GPIO.out_w1tc = MASK_G;` — записи идут подряд, без задержки между ними.',
    'Если проверка ругается на `digitalWrite` — уберите его совсем, даже закомментированный код не мешает, а вот живой вызов — да.',
  ],
  starterCode: `// Проблесковые огни вертолётной площадки: GPIO25 — красный, GPIO26 — зелёный
const int LED_R = 25;
const int LED_G = 26;

// TODO: маски выводов — единица в бите с номером вывода
// const uint32_t MASK_R = ...;
// const uint32_t MASK_G = ...;

void setup() {
  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
}

void loop() {
  // TODO: красный горит, зелёный не горит — через GPIO.out_w1ts / GPIO.out_w1tc
  delay(500);
  // TODO: зелёный горит, красный не горит
  delay(500);
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `const int LED_R = 25;
const int LED_G = 26;
const uint32_t MASK_R = (1 << LED_R);
const uint32_t MASK_G = (1 << LED_G);

void setup() {
  GPIO.enable_w1ts = MASK_R | MASK_G;   // оба вывода — выходы
}

void loop() {
  GPIO.out_w1ts = MASK_R;   // красный — HIGH
  GPIO.out_w1tc = MASK_G;   // зелёный — LOW
  delay(500);
  GPIO.out_w1ts = MASK_G;
  GPIO.out_w1tc = MASK_R;
  delay(500);
}
`,
  },
  checks: [
    {
      id: 'outputs',
      title: 'GPIO25 и GPIO26 — выходы',
      run: async (h) => {
        await h.wait(50);
        h.expect(h.gpio(25).isOutput, 'GPIO25 не настроен как выход — pinMode(25, OUTPUT) или GPIO.enable_w1ts = (1 << 25)');
        h.expect(h.gpio(26).isOutput, 'GPIO26 не настроен как выход — pinMode(26, OUTPUT) или GPIO.enable_w1ts = (1 << 26)');
      },
    },
    {
      id: 'blink',
      title: 'Оба огня мигают с периодом 1 с',
      run: async (h) => {
        await h.wait(6200);
        expectPeriod(h, 25, 0, 6200, 1000, 50, 'Красный огонь (GPIO25)');
        expectPeriod(h, 26, 0, 6200, 1000, 50, 'Зелёный огонь (GPIO26)');
        const d = h.dutyOver(25, 1000, 6000);
        h.expect(Math.abs(d - 0.5) < 0.08, `Красный огонь горит ${Math.round(d * 100)}% времени, а должен — половину`);
      },
    },
    {
      id: 'antiphase',
      title: 'Огни переключаются попеременно и одновременно',
      run: async (h) => {
        await h.wait(4100);
        for (let t = 750; t < 4000; t += 500) {
          await h.until(t);
          const r = h.gpio(25).level;
          const g = h.gpio(26).level;
          h.expect(r !== g, `В момент ${t} мс ${r ? 'оба огня горят' : 'оба огня погашены'} — они должны гореть по очереди`);
        }
        const er = edges(h, 25, 200, 4000);
        const eg = edges(h, 26, 150, 4050);
        h.expect(er.length >= 6 && eg.length >= 6, 'Огни переключаются слишком редко');
        for (const t of er) {
          const near = eg.reduce((best, x) => Math.min(best, Math.abs(x - t)), Infinity);
          h.expect(near < 0.05, `Красный переключился в ${t.toFixed(1)} мс, а зелёный — только через ${near.toFixed(1)} мс. Между записями в регистры не должно быть задержки`);
        }
      },
    },
    {
      id: 'registers',
      title: 'Выводы переключаются через регистры, без digitalWrite',
      run: async (h) => {
        h.expect(!codeUses(h, /\bdigitalWrite\s*\(/), 'В коде есть digitalWrite — переключайте выводы записью в GPIO.out_w1ts / GPIO.out_w1tc');
        h.expect(
          codeUses(h, /GPIO\s*\.\s*out(_w1ts|_w1tc)?\b|GPIO_OUT(_W1TS|_W1TC)?_REG/),
          'Не нашёл записи в регистр выхода: используйте GPIO.out_w1ts / GPIO.out_w1tc или REG_WRITE(GPIO_OUT_W1TS_REG, …)',
        );
      },
    },
  ],
};
