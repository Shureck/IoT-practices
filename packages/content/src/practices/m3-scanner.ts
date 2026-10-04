import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const parts = () => [
  p('lcd', 'lcd1602', 460, -200),
  p('oled', 'oled', 290, -40),
  p('box', 'i2cbox', 390, -40, { address: 0x42, secret: 'IOT5' }),
];

const wires = () => [
  // питание
  w('lcd:VCC', 'esp:VIN', 'red'),
  w('lcd:GND', 'esp:GND.1', 'black'),
  w('oled:VCC', 'esp:3V3', 'red'),
  w('oled:GND', 'esp:GND.2', 'black'),
  w('box:VCC', 'esp:3V3', 'red'),
  w('box:GND', 'esp:GND.2', 'black'),
  // шина I²C: SDA — GPIO21, SCL — GPIO22
  w('oled:SDA', 'esp:D21', 'blue'),
  w('oled:SCL', 'esp:D22', 'yellow'),
  w('lcd:SDA', 'oled:SDA', 'blue'),
  w('lcd:SCL', 'oled:SCL', 'yellow'),
  w('box:SDA', 'oled:SDA', 'blue'),
  w('box:SCL', 'oled:SCL', 'yellow'),
];

/** Все адреса вида 0x.., напечатанные в Serial. */
function hexAddrs(h: CheckContext): number[] {
  const found = new Set<number>();
  for (const m of h.serial.matchAll(/0x([0-9a-f]{1,2})\b/gi)) found.add(parseInt(m[1], 16));
  return [...found].sort((a, b) => a - b);
}
const hex = (a: number) => `0x${a.toString(16).toUpperCase().padStart(2, '0')}`;

export const scanner: Practice = {
  id: 'm3-scanner',
  module: 3,
  order: 3,
  kind: 'lab',
  title: 'Перекличка на шине',
  subtitle: 'Сканер I²C: кто откликается по своему адресу',
  difficulty: 2,
  xp: 70,
  minutes: 25,
  tags: ['I²C', 'Wire', 'адреса', 'шестнадцатеричные числа'],
  story: `В аппаратной нашлась плата, к которой двумя проводами подключены сразу три устройства: дисплей, экранчик
и какой-то модуль без маркировки. Документации нет. Устрой перекличку: опроси все адреса на шине I²C и запиши,
кто отозвался — это первый шаг к тому, чтобы с ними поговорить.`,
  goals: [
    'Запустить шину I²C: `Wire.begin()` (SDA — GPIO21, SCL — GPIO22)',
    'Перебрать адреса **1…126** и для каждого проверить, отвечает ли устройство',
    'Для каждого найденного печатать строку вида `Найдено устройство: 0x27` (адрес — в шестнадцатеричном виде)',
    'В конце печатать общее количество: `Всего устройств: 3`',
  ],
  theory: `### Шина I²C

I²C (читается «и-квадрат-си») — **синхронная** шина из двух проводов:

* **SDA** — данные (у ESP32 по умолчанию GPIO21);
* **SCL** — тактовый сигнал (GPIO22), его задаёт ведущий — наш ESP32.

На одни и те же два провода можно повесить десятки устройств. Чтобы они не путались, у каждого есть
**7-битный адрес** (0…127). Адреса 0 и 120–127 зарезервированы, поэтому обычно сканируют 1…126.
Адреса пишут в шестнадцатеричном виде: LCD-переходник — \`0x27\`, OLED — \`0x3C\`.

### ACK и NACK

Ведущий начинает обмен условием **START**, передаёт адрес и бит направления (запись/чтение) и ждёт.
Если устройство с таким адресом есть, оно прижимает SDA к нулю на девятом такте — это **ACK** («я здесь»).
Если никого нет, линия остаётся в единице — **NACK**.

В библиотеке Wire «постучаться» по адресу можно пустой передачей:

\`\`\`cpp
#include <Wire.h>

Wire.begin();                         // SDA = 21, SCL = 22
Wire.beginTransmission(0x27);         // START + адрес
byte error = Wire.endTransmission();  // STOP, результат
\`\`\`

| \`endTransmission()\` | значение |
|---|---|
| 0 | успех — устройство ответило ACK |
| 1 | данные не поместились в буфер |
| 2 | NACK на адресе — **никого нет** |
| 3 | NACK на данных |
| 4 | другая ошибка шины |
| 5 | тайм-аут |

### Печать в шестнадцатеричном виде

\`\`\`cpp
Serial.print("0x");
if (addr < 16) Serial.print("0");   // 0x0A, а не 0xA
Serial.println(addr, HEX);
\`\`\``,
  hints: [
    'Цикл: `for (byte addr = 1; addr < 127; addr++) { ... }`',
    'Внутри цикла: `Wire.beginTransmission(addr);` и `byte err = Wire.endTransmission();` — устройство есть, если `err == 0`.',
    'Заведите счётчик `int count = 0;` и увеличивайте его при каждой находке. После цикла напечатайте `Всего устройств: ` и `count`.',
    'Сканирование удобно поместить в `loop()` и повторять раз в 5 секунд — тогда видно, если устройство подключили «на ходу».',
  ],
  starterCode: `#include <Wire.h>

void setup() {
  Serial.begin(115200);
  Wire.begin();
  Serial.println("Сканирую шину I2C...");
}

void loop() {
  // TODO: переберите адреса 1..126
  //       Wire.beginTransmission(адрес) + Wire.endTransmission() == 0 → устройство найдено
  // TODO: для найденных печатайте "Найдено устройство: 0x.." и в конце "Всего устройств: N"

  delay(5000);
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `#include <Wire.h>

void setup() {
  Serial.begin(115200);
  Wire.begin();
  Serial.println("Сканирую шину I2C...");
}

void loop() {
  int count = 0;
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    byte error = Wire.endTransmission();
    if (error == 0) {
      Serial.print("Найдено устройство: 0x");
      if (addr < 16) Serial.print("0");
      Serial.println(addr, HEX);
      count++;
    } else if (error == 4) {
      Serial.print("Ошибка шины на адресе ");
      Serial.println(addr);
    }
  }
  Serial.print("Всего устройств: ");
  Serial.println(count);
  Serial.println();
  delay(5000);
}
`,
  },
  checks: [
    {
      id: 'found',
      title: 'Найдены все три устройства: 0x27, 0x3C, 0x42',
      run: async (h) => {
        await h.wait(3000);
        const got = hexAddrs(h);
        h.expect(got.length > 0, 'В Serial нет ни одного адреса вида 0x27. Печатайте адреса в шестнадцатеричном виде: Serial.println(addr, HEX) после "0x"');
        for (const a of [0x27, 0x3c, 0x42]) {
          h.expect(got.includes(a), `Устройство ${hex(a)} не найдено. Сейчас напечатано: ${got.map(hex).join(', ')}`);
        }
      },
    },
    {
      id: 'nofalse',
      title: 'Нет «ложных» адресов',
      run: async (h) => {
        await h.wait(3000);
        const extra = hexAddrs(h).filter((a) => ![0x27, 0x3c, 0x42].includes(a));
        h.expect(!extra.length, `На шине только три устройства, а напечатаны ещё адреса ${extra.map(hex).join(', ')}. Печатайте адрес, только если endTransmission() вернул 0`);
      },
    },
    {
      id: 'count',
      title: 'Напечатано общее количество устройств',
      run: async (h) => {
        await h.wait(3000);
        const line = h.serialLines().find((l) => /(всего|итого|total|количество)/i.test(l));
        h.expect(line, 'Нет итоговой строки вида «Всего устройств: 3»');
        const n = (line!.match(/\d+/g) ?? []).map(Number);
        h.expect(n.includes(3), `Итоговая строка «${line}» — а устройств на шине 3`);
      },
    },
    {
      id: 'real',
      title: 'Сканер действительно опрашивает шину',
      run: async (h) => {
        // модуль-загадку перенастроили на другой адрес — сканер должен это заметить
        h.set('box', 'address', 0x51);
        await h.wait(3000);
        const got = hexAddrs(h);
        h.expect(got.includes(0x51) && !got.includes(0x42), `Модуль переставили на адрес 0x51, а сканер напечатал: ${got.map(hex).join(', ') || 'ничего'}. Адреса должны браться из ответа шины, а не из кода`);
      },
    },
  ],
};
