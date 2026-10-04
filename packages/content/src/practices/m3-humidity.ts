import type { Practice } from '../types';
import { circuit, expectPeriod, linesWith, p, w } from '../helpers';

const parts = () => [p('dht', 'dht22', 300, 70, { temperature: 21.5, humidity: 45 })];
const wires = () => [
  w('dht:VCC', 'esp:3V3', 'red'),
  w('dht:DATA', 'esp:D4', 'green'),
  w('dht:GND', 'esp:GND.2', 'black'),
];

const LINE = /Temp:\s*(-?\d+(?:\.\d+)?)\s*;\s*Hum:\s*(\d+(?:\.\d+)?)/i;

export const humidity: Practice = {
  id: 'm3-humidity',
  module: 3,
  order: 2,
  kind: 'lab',
  title: 'Проверка влажности',
  subtitle: 'DHT22: температура и влажность по одному проводу',
  difficulty: 1,
  xp: 60,
  minutes: 20,
  tags: ['DHT22', '1-Wire', 'millis'],
  story: `В кладовой станции хранятся запасные платы и аккумуляторы. После шторма туда задувает снег, а сырость
для электроники — смерть. У входа висит датчик DHT22: научи станцию читать его и предупреждать мигающим
светодиодом, когда влажность подскочит.`,
  goals: [
    'Читать датчик **DHT22** на **GPIO4** не чаще раза в 2 секунды',
    'Печатать в Serial строку вида `Temp: 21.5; Hum: 45.0`',
    'Пока влажность **не выше 60 %** — встроенный светодиод (GPIO2) мигает медленно: период **1000 мс**',
    'Когда влажность **больше 60 %** — мигает быстро: период **200 мс**',
  ],
  theory: `### Однопроводной протокол

DHT22 общается с микроконтроллером по **одному проводу данных** (плюс питание и земля). Обмен выглядит так:

1. ESP32 прижимает линию к нулю на ~1 мс — «эй, датчик, проснись!».
2. Датчик отвечает импульсом и передаёт **40 бит**: 16 бит влажности, 16 бит температуры и 8 бит контрольной суммы.
3. Ноль и единицу различают по **длительности** высокого уровня: ~26 мкс — это 0, ~70 мкс — это 1.

Похожий принцип у протокола **1-Wire** (датчик DS18B20): тоже один провод, обмен идёт **тайм-слотами**
фиксированной длительности, но на одну линию можно повесить много устройств — у каждого свой 64-битный адрес.
DHT22 формально не 1-Wire, а «однопроводной протокол» собственного формата.

Отсчитывать микросекунды вручную не нужно — это делает библиотека:

\`\`\`cpp
#include <DHT.h>

DHT dht(4, DHT22);           // вывод DATA, тип датчика

void setup() {
  Serial.begin(115200);
  dht.begin();
}

void loop() {
  float t = dht.readTemperature();   // °C
  float h = dht.readHumidity();      // %
  if (isnan(t) || isnan(h)) {
    Serial.println("Ошибка чтения датчика");
  }
  delay(2000);
}
\`\`\`

> ⏱ DHT22 измеряет медленно: **читать его чаще раза в 2 с бессмысленно** — библиотека вернёт старое значение.

### Мигать и одновременно ждать 2 секунды

Если мигать через \`delay()\`, светодиод «замрёт» на время ожидания датчика. Удобнее вести два независимых
таймера на \`millis()\`:

\`\`\`cpp
unsigned long lastRead = 0, lastBlink = 0;

void loop() {
  if (millis() - lastRead >= 2000) { lastRead = millis(); /* читаем датчик */ }
  if (millis() - lastBlink >= halfPeriod) { lastBlink = millis(); /* переключаем светодиод */ }
}
\`\`\`

Период — это время полного цикла «горит + не горит». Период 1000 мс = 500 мс горит и 500 мс не горит.`,
  hints: [
    'Создайте объект `DHT dht(4, DHT22);` и не забудьте `dht.begin()` в `setup()`.',
    'Строка печатается так: `Serial.print("Temp: "); Serial.print(t, 1); Serial.print("; Hum: "); Serial.println(h, 1);`',
    'Храните полупериод в переменной: `halfPeriod = (h > 60) ? 100 : 500;` — и переключайте светодиод, когда прошло `halfPeriod` мс.',
    'Чтобы первое измерение появилось сразу, прочитайте датчик ещё и в `setup()` (или начните с `lastRead = millis() - 2000`).',
  ],
  starterCode: `#include <DHT.h>

const int DHT_PIN = 4;
const int LED_PIN = 2;   // встроенный светодиод

DHT dht(DHT_PIN, DHT22);

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  // TODO: запустите датчик
}

void loop() {
  // TODO: раз в 2 секунды читайте температуру и влажность и печатайте "Temp: X; Hum: Y"
  // TODO: мигайте светодиодом: медленно (1000 мс) или быстро (200 мс), если влажность > 60 %
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `#include <DHT.h>

const int DHT_PIN = 4;
const int LED_PIN = 2;

DHT dht(DHT_PIN, DHT22);

unsigned long lastRead = 0;
unsigned long lastBlink = 0;
int halfPeriod = 500;
bool ledOn = false;

void readSensor() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("Ошибка чтения DHT22");
    return;
  }
  Serial.print("Temp: ");
  Serial.print(t, 1);
  Serial.print("; Hum: ");
  Serial.println(h, 1);
  halfPeriod = (h > 60) ? 100 : 500;
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  dht.begin();
  readSensor();
  lastRead = millis();
}

void loop() {
  if (millis() - lastRead >= 2000) {
    lastRead = millis();
    readSensor();
  }
  if (millis() - lastBlink >= halfPeriod) {
    lastBlink = millis();
    ledOn = !ledOn;
    digitalWrite(LED_PIN, ledOn);
  }
}
`,
  },
  checks: [
    {
      id: 'print',
      title: 'В Serial печатается «Temp: X; Hum: Y» с показаниями датчика',
      run: async (h) => {
        h.set('dht', 'temperature', -7.5);
        h.set('dht', 'humidity', 38);
        await h.wait(4500);
        const lines = linesWith(h, LINE);
        h.expect(lines.length > 0, 'В Serial нет строки вида «Temp: -7.5; Hum: 38.0». Проверьте формат: Temp, двоеточие, число, точка с запятой, Hum…');
        const m = lines[lines.length - 1].match(LINE)!;
        h.expect(Math.abs(Number(m[1]) + 7.5) < 0.15, `Температура в строке — ${m[1]}, а датчик показывает -7.5 °C`);
        h.expect(Math.abs(Number(m[2]) - 38) < 0.6, `Влажность в строке — ${m[2]}, а датчик показывает 38 %`);
      },
    },
    {
      id: 'rate',
      title: 'Датчик опрашивается раз в 2 секунды, не чаще',
      run: async (h) => {
        await h.wait(10500);
        const n = linesWith(h, LINE).length;
        h.expect(n >= 4, `За 10 с напечатано всего ${n} измерений — нужно примерно 5 (раз в 2 с)`);
        h.expect(n <= 7, `За 10 с напечатано ${n} измерений — DHT22 нельзя опрашивать чаще раза в 2 с`);
      },
    },
    {
      id: 'slow',
      title: 'Нормальная влажность — медленное мигание (1000 мс)',
      run: async (h) => {
        h.set('dht', 'humidity', 45);
        await h.wait(9000);
        expectPeriod(h, 2, 3000, 9000, 1000, 60, 'При влажности 45 % светодиод');
      },
    },
    {
      id: 'fast',
      title: 'Влажность выше 60 % — быстрое мигание (200 мс), потом снова медленное',
      run: async (h) => {
        h.set('dht', 'humidity', 78);
        await h.wait(7000);
        expectPeriod(h, 2, 3000, 7000, 200, 20, 'При влажности 78 % светодиод');
        h.set('dht', 'humidity', 52);
        await h.wait(9000);
        expectPeriod(h, 2, 11000, 16000, 1000, 60, 'Когда влажность упала до 52 %, светодиод');
      },
    },
  ],
};
