import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';
import type { CheckContext } from '@esp32lab/sim';
import { avgInterval, needWifi, track } from './c-helpers';

const parts = () => [p('dht', 'dht22', 280, -30)];
const wires = () => [
  w('dht:VCC', 'esp:3V3', 'red'),
  w('dht:DATA', 'esp:D4', 'yellow'),
  w('dht:GND', 'esp:GND.2', 'black'),
];

interface Telemetry { station?: unknown; temperature?: unknown; humidity?: unknown }
const entries = (h: CheckContext) => h.net.telemetry.map((x) => x.data as Telemetry);
const posts = (h: CheckContext) => h.requests.filter((r) => /station\.iot\/telemetry/.test(r.url));

async function start(h: CheckContext) {
  h.set('dht', 'temperature', 18.3);
  h.set('dht', 'humidity', 52);
  await needWifi(h);
}

export const report: Practice = {
  id: 'm4-report',
  module: 4,
  order: 5,
  kind: 'homework',
  title: 'Отчёт в центр управления',
  subtitle: 'HTTP POST с JSON и обработка ошибок',
  difficulty: 2,
  xp: 110,
  minutes: 40,
  tags: ['HTTP POST', 'JSON', 'REST API', 'DHT22', 'millis'],
  story: `Центр управления в Мурманске наконец ответил: «Ждём от вас метеоданные каждые 10 секунд. Формат —
JSON, адрес — \`station.iot/telemetry\`». До сих пор станция только *спрашивала* сервер. Теперь она сама будет
*отправлять* отчёты — а если связь пропадёт, честно скажет об этом в журнал, а не зависнет.`,
  goals: [
    'Каждые **10 секунд** отправлять HTTP **POST** на `http://station.iot/telemetry`',
    'Тело — JSON `{"station": "polar-5", "temperature": 21.4, "humidity": 40.5}` с показаниями DHT22 (**GPIO4**); числа — числами',
    'Указать заголовок `Content-Type: application/json`',
    'Печатать ответ сервера; при коде, отличном от 200, — печатать код ошибки и продолжать работу',
  ],
  theory: `### GET и POST

**GET** — «дай данные», параметры едут в адресе. **POST** — «прими данные», они едут в **теле** запроса,
и их может быть сколько угодно. Чтобы сервер понял, что в теле JSON, добавляют заголовок \`Content-Type\`.

\`\`\`cpp
HTTPClient http;
http.begin("http://station.iot/telemetry");
http.addHeader("Content-Type", "application/json");
int code = http.POST("{\\"station\\":\\"polar-5\\",\\"temperature\\":21.4}");
String answer = http.getString();
http.end();
\`\`\`

Собирать JSON руками неудобно (кавычки!). Пусть это делает ArduinoJson — \`serializeJson()\` превращает документ
в строку:

\`\`\`cpp
DynamicJsonDocument doc(256);
doc["station"] = "polar-5";
doc["temperature"] = 21.4;
String body;
serializeJson(doc, body);   // {"station":"polar-5","temperature":21.4}
\`\`\`

### Коды ответа

| Код | Значение |
|---|---|
| 200 | OK, данные приняты |
| 400 | неверный запрос (например, температура пришла строкой) |
| 404 | нет такого адреса |
| 500 | ошибка на сервере |
| < 0 | ответа нет вообще: нет Wi-Fi, сервер недоступен (\`http.errorToString(code)\`) |

### Каждые 10 секунд — без delay()

\`\`\`cpp
unsigned long lastSend = 0;
void loop() {
  if (millis() - lastSend >= 10000) {
    lastSend = millis();
    sendReport();
  }
}
\`\`\``,
  hints: [
    'Сначала прочитайте датчик: `float t = dht.readTemperature();` и проверьте `isnan(t)`.',
    'JSON: `DynamicJsonDocument doc(256); doc["station"] = "polar-5"; doc["temperature"] = t; doc["humidity"] = h; String body; serializeJson(doc, body);`',
    'Запрос: `http.begin(URL); http.addHeader("Content-Type", "application/json"); int code = http.POST(body);`',
    'Ошибки: `if (code == 200) Serial.println(http.getString()); else Serial.printf("Ошибка: %d\\n", code);` — и не забудьте `http.end();`',
  ],
  starterCode: `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";
const char* URL = "http://station.iot/telemetry";

DHT dht(4, DHT22);

void sendReport() {
  // TODO: прочитать температуру и влажность
  // TODO: собрать JSON {"station": "polar-5", "temperature": ..., "humidity": ...}
  // TODO: POST на URL с заголовком Content-Type: application/json
  // TODO: напечатать ответ сервера или код ошибки
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" в сети");
}

void loop() {
  // TODO: каждые 10 секунд вызывать sendReport()
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";
const char* URL = "http://station.iot/telemetry";
const unsigned long PERIOD = 10000;

DHT dht(4, DHT22);
unsigned long lastSend = 0;
bool firstReport = true;

void sendReport() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("Датчик DHT22 не отвечает, отчёт пропущен");
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Нет Wi-Fi, отчёт не отправлен");
    return;
  }

  DynamicJsonDocument doc(256);
  doc["station"] = "polar-5";
  doc["temperature"] = t;
  doc["humidity"] = h;
  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(URL);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  if (code == 200) {
    Serial.print("Отправлено ");
    Serial.print(body);
    Serial.print(" -> ");
    Serial.println(http.getString());
  } else if (code > 0) {
    Serial.printf("Центр вернул ошибку %d: ", code);
    Serial.println(http.getString());
  } else {
    Serial.printf("Нет связи с центром (%d: %s)\\n", code, http.errorToString(code).c_str());
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" в сети");
}

void loop() {
  if (firstReport || millis() - lastSend >= PERIOD) {
    firstReport = false;
    lastSend = millis();
    sendReport();
  }
}
`,
  },
  checks: [
    {
      id: 'post',
      title: 'Отчёт с показаниями датчика принят центром',
      run: async (h) => {
        await start(h);
        await h.waitFor(() => entries(h).length > 0, 12000, 50);
        if (!entries(h).length) {
          const sent = posts(h);
          if (!sent.length) h.fail('Центр не получил ни одного отчёта: нет POST-запроса на http://station.iot/telemetry');
          const bad = sent[sent.length - 1];
          h.expect(bad.method === 'POST', `Запрос отправлен методом ${bad.method}, а нужен POST: http.POST(body)`);
          h.fail(`Центр отклонил отчёт. Тело запроса: «${(bad.body ?? '').slice(0, 100)}». Нужен JSON с числовым полем "temperature"`);
        }
        const d = entries(h)[0];
        h.expect(d.station === 'polar-5', `Поле "station" должно быть "polar-5", а пришло ${JSON.stringify(d.station)}`);
        h.expect(typeof d.temperature === 'number' && h.near(d.temperature, 18.3, 0.15), `Датчик показывает 18.3 °C, а в отчёте temperature = ${JSON.stringify(d.temperature)}`);
        h.expect(typeof d.humidity === 'number' && h.near(d.humidity, 52, 0.6), `Датчик показывает влажность 52 %, а в отчёте humidity = ${JSON.stringify(d.humidity)} (нужно число)`);
        h.set('dht', 'temperature', -2.5);
        const n = entries(h).length;
        await h.waitFor(() => entries(h).length > n, 12000, 50);
        const last = entries(h)[entries(h).length - 1];
        h.expect(entries(h).length > n && h.near(last.temperature as number, -2.5, 0.15), `Температура упала до −2.5 °C, но следующий отчёт ${entries(h).length > n ? `пришёл с ${JSON.stringify(last.temperature)}` : 'так и не пришёл'}. Читайте датчик перед каждой отправкой`);
      },
    },
    {
      id: 'interval',
      title: 'Отчёты уходят каждые 10 секунд',
      timeoutMs: 30000,
      run: async (h) => {
        await start(h);
        const times = await track(h, () => posts(h).length, 41000, 50);
        h.expect(times.length >= 2, `За 41 с отправлено ${times.length} отчёт(ов), а нужно по одному каждые 10 с`);
        const avg = avgInterval(times)!;
        h.expect(Math.abs(avg - 10000) <= 700, `Отчёты уходят раз в ${(avg / 1000).toFixed(1)} с, а нужно раз в 10 с`);
        h.expect(times.length >= 4, `За 41 с отправлено только ${times.length} отчёта — должно быть 4–5`);
      },
    },
    {
      id: 'headers',
      title: 'Заголовок Content-Type и печать ответа сервера',
      run: async (h) => {
        await start(h);
        await h.waitFor(() => posts(h).length > 0, 12000, 50);
        const req = posts(h)[0];
        h.expect(req, 'Нет POST-запроса на http://station.iot/telemetry');
        const ct = Object.entries(req.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
        h.expect(ct.includes('application/json'), ct ? `Заголовок Content-Type = «${ct}», а нужен application/json` : 'Не указан заголовок: http.addHeader("Content-Type", "application/json");');
        await h.wait(500);
        h.expect(/принята|accepted/i.test(h.serial), 'Ответ сервера не напечатан. После POST выведите Serial.println(http.getString());');
      },
    },
    {
      id: 'errors',
      title: 'Без связи программа сообщает об ошибке и не зависает',
      run: async (h) => {
        await start(h);
        await h.waitFor(() => posts(h).length > 0, 12000, 50);
        await h.wait(500);
        (h.sim.M.lib.wifi as { disconnect(): void }).disconnect();
        const mark = h.mark();
        await h.wait(11000);
        const out = h.serialSince(mark);
        h.expect(/-\d+|ошиб|error|нет связи|не отправ|недоступ|wi-?fi/i.test(out), 'Wi-Fi пропал, а в журнале ни слова. Если код ответа не 200 (или отрицательный), напечатайте его');
      },
    },
  ],
};
