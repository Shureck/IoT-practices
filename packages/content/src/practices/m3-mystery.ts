import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const parts = () => [p('box', 'i2cbox', 330, -40, { address: 0x42, secret: 'NORD' })];
const wires = () => [
  w('box:VCC', 'esp:3V3', 'red'),
  w('box:GND', 'esp:GND.2', 'black'),
  w('box:SDA', 'esp:D21', 'blue'),
  w('box:SCL', 'esp:D22', 'yellow'),
];

export const mystery: Practice = {
  id: 'm3-mystery',
  module: 3,
  order: 6,
  kind: 'homework',
  title: 'Модуль-загадка',
  subtitle: 'Читаем и пишем регистры I²C-устройства',
  difficulty: 3,
  xp: 110,
  minutes: 40,
  tags: ['I²C', 'Wire', 'регистры', 'датащит'],
  story: `Сканер нашёл на шине модуль по адресу 0x42 — тот самый, без маркировки. В ящике стола обнаружился
обрывок датащита с картой регистров. Похоже, внутри модуля спрятан код доступа к складу топлива, а ещё у него
есть свой светодиод. Проверь, что это действительно нужный модуль, вытащи код и зажги лампочку.`,
  goals: [
    'Прочитать регистр **WHO_AM_I** (0x00) и напечатать его в шестнадцатеричном виде — должно быть `0x5A`',
    'Прочитать 4 байта кода из регистров **0x01…0x04** и напечатать их как текст (это ASCII-символы)',
    'Прочитать температуру модуля из регистра **0x10** — это **знаковый** байт — и напечатать её в °C',
    'Включить светодиод модуля: записать `0x01` в регистр **CTRL** (0x30)',
  ],
  theory: `### Карта регистров (обрывок датащита)

| Адрес | Имя | Доступ | Описание |
|---|---|---|---|
| \`0x00\` | WHO_AM_I | R | Идентификатор модели, всегда \`0x5A\` |
| \`0x01\`–\`0x04\` | CODE | R | Код доступа, 4 символа ASCII |
| \`0x10\` | TEMP | R | Температура, °C, \`int8_t\` (дополнительный код) |
| \`0x30\` | CTRL | R/W | Бит 0 — светодиод (1 — горит) |

Адрес модуля на шине — \`0x42\`. После чтения указатель регистра сам сдвигается на следующий —
поэтому несколько регистров подряд можно прочитать одним запросом.

### Как читают регистр по I²C

Сначала **записывают** номер регистра (без STOP — «повторный старт»), затем **запрашивают** байты:

\`\`\`cpp
Wire.beginTransmission(ADDR);
Wire.write(REG);                 // с какого регистра читать
Wire.endTransmission(false);     // false — не отпускать шину
Wire.requestFrom(ADDR, 3);       // прочитать 3 байта: REG, REG+1, REG+2
while (Wire.available()) {
  byte b = Wire.read();
}
\`\`\`

### Как пишут в регистр

\`\`\`cpp
Wire.beginTransmission(ADDR);
Wire.write(REG);                 // номер регистра
Wire.write(VALUE);               // значение
Wire.endTransmission();
\`\`\`

### Знаковый байт

Байт \`0xF6\` можно понимать как 246 (\`uint8_t\`) или как −10 (\`int8_t\`): отрицательные числа хранятся
в **дополнительном коде**. Чтобы получить знак, приведите тип: \`int8_t t = (int8_t)b;\``,
  hints: [
    'Напишите функцию `byte readReg(byte reg)` по примеру из теории — пригодится несколько раз.',
    'Код — это символы: `Serial.print((char)b);` для каждого из четырёх байтов.',
    'Байт температуры 0xEB без приведения типа напечатается как 235. Нужно `(int8_t)`.',
    'Светодиод: `beginTransmission(0x42)`, `write(0x30)`, `write(0x01)`, `endTransmission()`.',
  ],
  starterCode: `#include <Wire.h>

const byte ADDR = 0x42;

void setup() {
  Serial.begin(115200);
  Wire.begin();

  // TODO: прочитайте WHO_AM_I (0x00) и напечатайте "WHO_AM_I: 0x5A"
  // TODO: прочитайте код из регистров 0x01..0x04 и напечатайте его как текст
  // TODO: прочитайте температуру (0x10, int8_t)
  // TODO: включите светодиод: 0x01 в регистр 0x30
}

void loop() {
  delay(1000);
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `#include <Wire.h>

const byte ADDR = 0x42;
const byte REG_WHO_AM_I = 0x00;
const byte REG_CODE = 0x01;
const byte REG_TEMP = 0x10;
const byte REG_CTRL = 0x30;

byte readReg(byte reg) {
  Wire.beginTransmission(ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom(ADDR, (byte)1);
  return Wire.available() ? Wire.read() : 0;
}

void writeReg(byte reg, byte value) {
  Wire.beginTransmission(ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

void setup() {
  Serial.begin(115200);
  Wire.begin();

  byte id = readReg(REG_WHO_AM_I);
  Serial.print("WHO_AM_I: 0x");
  Serial.println(id, HEX);
  if (id != 0x5A) {
    Serial.println("Это не тот модуль!");
    return;
  }

  // код: 4 байта подряд одним запросом
  Wire.beginTransmission(ADDR);
  Wire.write(REG_CODE);
  Wire.endTransmission(false);
  Wire.requestFrom(ADDR, (byte)4);
  Serial.print("Код доступа: ");
  while (Wire.available()) {
    Serial.print((char)Wire.read());
  }
  Serial.println();

  int8_t t = (int8_t)readReg(REG_TEMP);
  Serial.print("Температура модуля: ");
  Serial.print(t);
  Serial.println(" C");

  writeReg(REG_CTRL, 0x01);
  Serial.println("Светодиод включён");
}

void loop() {
  delay(1000);
}
`,
  },
  checks: [
    {
      id: 'whoami',
      title: 'WHO_AM_I прочитан: 0x5A',
      run: async (h) => {
        await h.wait(1000);
        h.expect(/0x5A\b/i.test(h.serial), /\b90\b/.test(h.serial)
          ? 'Число 90 — это и есть 0x5A, но напечатайте его в шестнадцатеричном виде: Serial.println(id, HEX)'
          : 'В Serial нет значения WHO_AM_I «0x5A». Запишите номер регистра 0x00, затем requestFrom(0x42, 1)');
      },
    },
    {
      id: 'code',
      title: 'Код доступа прочитан из регистров 0x01–0x04',
      run: async (h) => {
        h.set('box', 'secret', 'K7Q2');
        await h.wait(1000);
        h.expect(h.serial.includes('K7Q2'), /75\D*55\D*81\D*50/.test(h.serial)
          ? 'Байты прочитаны, но напечатаны числами. Это коды ASCII — печатайте их как символы: Serial.print((char)b)'
          : 'В Serial нет кода из регистров 0x01–0x04 (в этой проверке модулю задан код «K7Q2»). Читайте 4 байта начиная с регистра 0x01');
      },
    },
    {
      id: 'temp',
      title: 'Температура модуля прочитана со знаком',
      run: async (h) => {
        await h.wait(1000);
        if (/\b235\b/.test(h.serial)) h.fail('Напечатано 235 — это байт 0xEB без знака. Приведите его к int8_t, чтобы получить отрицательную температуру');
        h.expect(/-21\b/.test(h.serial), 'В Serial нет температуры модуля из регистра 0x10 (подсказка: на улице мороз)');
      },
    },
    {
      id: 'led',
      title: 'Светодиод модуля включён',
      run: async (h) => {
        await h.wait(1000);
        const box = h.model<{ led: boolean; regs: number[] }>('box');
        h.expect(box.led, box.regs[0x30]
          ? 'В регистре 0x30 что-то есть, но светодиод не горит: запишите номер регистра и значение 0x01 в одной передаче'
          : 'Светодиод модуля не горит. Запишите 0x01 в регистр 0x30: write(0x30), write(0x01), endTransmission()');
      },
    },
  ],
};
