import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const parts = () => [
  p('dht', 'dht22', 300, 70, { temperature: 23.4, humidity: 61 }),
  p('lcd', 'lcd1602', 300, -140),
];
const dhtWires = () => [
  w('dht:VCC', 'esp:3V3', 'red'),
  w('dht:DATA', 'esp:D4', 'green'),
  w('dht:GND', 'esp:GND.2', 'black'),
];

const T_RE = /^T:\s*(-?\d+\.\d)\s*□?\s*C$/;
const H_RE = /^H:\s*(\d+)\s*%$/;

/** Проверить, что дисплей показывает нужные значения (ждём не дольше limit мс). */
async function expectScreen(h: CheckContext, t: string, hum: number, limit: number, when: string) {
  const ok = () => {
    const [l0 = '', l1 = ''] = h.lcd('lcd').map((s) => s.trim());
    const a = l0.match(T_RE);
    const b = l1.match(H_RE);
    return !!a && a[1] === t && !!b && Number(b[1]) === hum;
  };
  if (await h.waitFor(ok, limit, 50)) return;
  const [l0 = '', l1 = ''] = h.lcd('lcd');
  const shown = `«${l0.trimEnd()}» / «${l1.trimEnd()}»`;
  if (!l0.trim() && !l1.trim()) h.fail(`${when}: дисплей пуст. Вызваны ли lcd.init() и lcd.backlight()? Подключён ли дисплей к GPIO21/22?`);
  if (/▓/.test(l0 + l1)) h.fail(`${when}: на дисплее «мусор» ${shown}. Не используйте lcd.println() и русские буквы`);
  h.fail(`${when}: на дисплее ${shown}, а ожидалось «T: ${t} C» / «H: ${hum} %». Проверьте формат и не остались ли хвосты от прошлого текста`);
}

export const lcd: Practice = {
  id: 'm3-lcd',
  module: 3,
  order: 4,
  kind: 'homework',
  title: 'Бортовой дисплей',
  subtitle: 'LCD 1602 по I²C показывает погоду за бортом',
  difficulty: 2,
  xp: 100,
  minutes: 35,
  tags: ['I²C', 'LCD 1602', 'DHT22', 'сборка схемы'],
  story: `Вездеходу станции нужен бортовой дисплей: водитель в варежках не будет открывать ноутбук, чтобы узнать,
сколько градусов за бортом. В ящике нашёлся символьный LCD 1602 с I²C-переходником. Подключи его к ESP32
и выведи показания DHT22 — крупно, понятно, без «мусора».`,
  goals: [
    'Подключить дисплей: **SDA → GPIO21**, **SCL → GPIO22**, питание VCC → **VIN** (5 В), GND → **GND**',
    'Верхняя строка: `T: 23.4 C` — температура с одним знаком после точки',
    'Нижняя строка: `H: 61 %` — влажность целым числом',
    'Обновлять показания каждые 2 секунды; при изменении длины числа на экране не должно оставаться «хвостов»',
    'Бонус: вместо пробела перед `C` нарисовать значок градуса через `lcd.createChar()` (`T: 23.4°C`)',
  ],
  theory: `### LCD 1602 с I²C-переходником

Сам дисплей HD44780 управляется по 8 (или 4) параллельным проводам. Переходник PCF8574 на обороте превращает
их в два провода I²C — поэтому дисплей подключается к тем же SDA/SCL, что и любые I²C-устройства.
Адрес переходника обычно **0x27** (иногда 0x3F — проверьте сканером).

\`\`\`cpp
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);   // адрес, столбцов, строк

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);   // столбец 0, строка 0
  lcd.print("Hello");
  lcd.setCursor(0, 1);   // вторая строка
  lcd.print(23.4, 1);    // число с одним знаком после точки
}
\`\`\`

### Подводные камни

* **Кириллицы нет.** Знакогенератор дисплея содержит латиницу и японскую катакану — русские буквы превратятся
  в «мусор». Пишите латиницей.
* **\`lcd.println()\` не работает как в Serial**: символы \`\\r\` и \`\\n\` дисплей рисует как два странных значка.
  Переход на новую строку — только через \`setCursor(0, 1)\`.
* **Хвосты.** Дисплей не стирает старый текст сам: если было \`-12.5\`, а стало \`5.0\`, получится \`5.0 C C\`.
  Либо очищайте экран \`lcd.clear()\`, либо дописывайте пробелы до конца строки.

### Свои символы

В памяти дисплея есть 8 ячеек под собственные значки 5×8 точек:

\`\`\`cpp
byte degree[8] = {0b00110, 0b01001, 0b01001, 0b00110, 0, 0, 0, 0};
lcd.createChar(0, degree);   // ячейка 0
lcd.write(0);                // нарисовать значок из ячейки 0
\`\`\``,
  hints: [
    'Схема: lcd GND → GND, VCC → VIN, SDA → D21, SCL → D22.',
    'В `loop()`: прочитать датчик, `lcd.clear()`, `setCursor(0, 0)`, напечатать температуру, `setCursor(0, 1)`, напечатать влажность, `delay(2000)`.',
    'Влажность целым числом: `lcd.print(h, 0)` или `lcd.print((int)round(h))`.',
    'Значок градуса: `lcd.write(0)` между числом и буквой `C` после `lcd.createChar(0, degree)` в `setup()`.',
  ],
  starterCode: `#include <DHT.h>
#include <LiquidCrystal_I2C.h>

DHT dht(4, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  dht.begin();
  // TODO: запустите дисплей и включите подсветку
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  // TODO: строка 0 — "T: 23.4 C", строка 1 — "H: 61 %"
  delay(2000);
}
`,
  starterCircuit: circuit(parts(), dhtWires()),
  palette: ['lcd1602', 'dht22'],
  solution: {
    code: `#include <DHT.h>
#include <LiquidCrystal_I2C.h>

DHT dht(4, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);

byte degree[8] = {
  0b00110,
  0b01001,
  0b01001,
  0b00110,
  0b00000,
  0b00000,
  0b00000,
  0b00000
};

void setup() {
  dht.begin();
  lcd.init();
  lcd.backlight();
  lcd.createChar(0, degree);
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  lcd.clear();
  if (isnan(t) || isnan(h)) {
    lcd.print("Sensor error");
  } else {
    lcd.setCursor(0, 0);
    lcd.print("T: ");
    lcd.print(t, 1);
    lcd.write(0);
    lcd.print("C");
    lcd.setCursor(0, 1);
    lcd.print("H: ");
    lcd.print(h, 0);
    lcd.print(" %");
  }
  delay(2000);
}
`,
    circuit: circuit(parts(), [
      ...dhtWires(),
      w('lcd:GND', 'esp:GND.1', 'black'),
      w('lcd:VCC', 'esp:VIN', 'red'),
      w('lcd:SDA', 'esp:D21', 'blue'),
      w('lcd:SCL', 'esp:D22', 'yellow'),
    ]),
  },
  checks: [
    {
      id: 'wiring',
      title: 'Дисплей подключён к шине I²C и питанию',
      run: async (h) => {
        const sda = h.gpioAt('lcd', 'SDA');
        const scl = h.gpioAt('lcd', 'SCL');
        if (sda.includes(22) && scl.includes(21)) h.fail('SDA и SCL перепутаны: SDA → GPIO21 (D21), SCL → GPIO22 (D22)');
        h.expect(sda.includes(21), 'Вывод SDA дисплея должен идти на GPIO21 (D21)');
        h.expect(scl.includes(22), 'Вывод SCL дисплея должен идти на GPIO22 (D22)');
        h.expect(h.onGnd('lcd', 'GND'), 'Вывод GND дисплея не подключён к GND платы');
        h.expect(h.onNet('lcd', 'VCC', 'VIN') || h.onNet('lcd', 'VCC', '3V3'), 'Вывод VCC дисплея не подключён к питанию — подключите к VIN (5 В)');
      },
    },
    {
      id: 'show',
      title: 'На дисплее «T: 23.4 C» и «H: 61 %»',
      run: async (h) => {
        await expectScreen(h, '23.4', 61, 2500, 'Через 2 с после запуска');
      },
    },
    {
      id: 'update',
      title: 'Показания обновляются, без «хвостов» от старого текста',
      run: async (h) => {
        await h.wait(500);
        h.set('dht', 'temperature', -12.5);
        h.set('dht', 'humidity', 100);
        await expectScreen(h, '-12.5', 100, 4500, 'Когда за бортом стало -12.5 °C и 100 %');
        h.set('dht', 'temperature', 5);
        h.set('dht', 'humidity', 8);
        await expectScreen(h, '5.0', 8, 4500, 'Когда стало 5.0 °C и 8 %');
      },
    },
    {
      id: 'period',
      title: 'Дисплей обновляется примерно раз в 2 секунды',
      run: async (h) => {
        await h.wait(1000);
        h.set('dht', 'temperature', 30.1);
        const t0 = h.now;
        const ok = await h.waitFor(() => (h.lcd('lcd')[0] ?? '').includes('30.1'), 3000, 20);
        h.expect(ok, 'Температура поменялась на 30.1 °C, а дисплей за 3 с так и не обновился');
        h.expect(h.now - t0 <= 2300, `Дисплей обновился только через ${Math.round(h.now - t0)} мс — нужно не реже раза в 2 с`);
      },
    },
  ],
};
