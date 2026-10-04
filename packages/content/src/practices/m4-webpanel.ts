import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';
import type { CheckContext } from '@esp32lab/sim';
import { needWifi, parseJson } from './c-helpers';

const parts = () => [
  p('dht', 'dht22', 280, -30),
  p('r1', 'resistor', 350, -30, { value: 220 }),
  p('led', 'led', 420, -30, { color: 'green' }),
];

const wires = () => [
  w('dht:VCC', 'esp:3V3', 'red'),
  w('dht:DATA', 'esp:D4', 'yellow'),
  w('dht:GND', 'esp:GND.2', 'black'),
  w('esp:D25', 'r1:1', 'green'),
  w('r1:2', 'led:A', 'green'),
  w('led:C', 'esp:GND.1', 'black'),
];

/** Wi-Fi + запущенный веб-сервер. */
async function ready(h: CheckContext) {
  h.set('dht', 'temperature', 19.5);
  h.set('dht', 'humidity', 38);
  await needWifi(h);
  const ok = await h.waitFor(() => !!h.sim.M.lib.webServer, 3000, 50);
  h.expect(ok, 'Веб-сервер не запущен: создайте WebServer server(80); и вызовите server.begin() после подключения к Wi-Fi');
  await h.wait(2500);
}

async function status(h: CheckContext) {
  const r = await h.web('/api/status');
  h.expect(r.status !== 0, `Плата не отвечает на запрос: ${r.body}. В loop() должен вызываться server.handleClient()`);
  h.expect(r.status === 200, `GET /api/status вернул код ${r.status}, а нужен 200. Зарегистрируйте обработчик: server.on("/api/status", handleStatus);`);
  const ctype = Object.entries(r.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  h.expect(ctype.includes('json'), `Ответ /api/status отдан как «${ctype}», а нужен тип application/json`);
  const j = parseJson(r.body);
  h.expect(j, `Ответ /api/status — не JSON-объект: «${r.body.slice(0, 80)}»`);
  return j!;
}

export const webpanel: Practice = {
  id: 'm4-webpanel',
  module: 4,
  order: 4,
  kind: 'homework',
  title: 'Веб-пульт станции',
  subtitle: 'Веб-сервер на ESP32: страница, кнопки и REST API',
  difficulty: 2,
  xp: 110,
  minutes: 45,
  tags: ['WebServer', 'HTML', 'REST API', 'JSON', 'DHT22'],
  story: `Метеоролог Лена жалуется: чтобы узнать температуру в лаборатории, ей приходится идти через весь
жилой модуль к щитку. Пусть плата сама станет маленьким сайтом: открываешь в браузере её адрес — видишь
температуру и кнопки управления светом. А для будущих программ сделай ещё и **REST API**, который отдаёт данные в JSON.`,
  goals: [
    '`GET /` — HTML-страница с текущей **температурой** и **влажностью** (DHT22 на **GPIO4**) и ссылками/кнопками «Включить» и «Выключить» свет',
    '`GET /led?state=on` и `GET /led?state=off` — включают и выключают светодиод на **GPIO25**; другое значение `state` — ответ с кодом **400**',
    '`GET /api/status` — JSON `{"temperature": 21.5, "humidity": 40, "led": false}` с типом `application/json` (числа — числами, `led` — `true`/`false`)',
    'Датчик опрашивать не чаще раза в 2 секунды — в `loop()`, а не в обработчиках',
  ],
  theory: `### Плата — веб-сервер

\`\`\`cpp
#include <WebServer.h>

WebServer server(80);                  // порт 80 — стандартный для HTTP

void handleRoot() {
  server.send(200, "text/html; charset=utf-8", "<h1>Привет!</h1>");
}

void setup() {
  // ... подключение к Wi-Fi
  server.on("/", handleRoot);          // путь → функция-обработчик
  server.begin();
  Serial.println(WiFi.localIP());      // этот адрес открываем в браузере
}

void loop() {
  server.handleClient();               // обработать входящие запросы
}
\`\`\`

\`server.send(код, тип, тело)\`: код (200, 400, 404…), **тип содержимого** (\`text/html\`, \`text/plain\`,
\`application/json\`) и сам ответ.

### Параметры запроса

Для адреса \`/led?state=on\` значение параметра достают так:

\`\`\`cpp
String state = server.arg("state");    // "on"
if (!server.hasArg("state")) { ... }   // параметра нет
\`\`\`

### Кнопки на странице

Самая простая кнопка — ссылка. После нажатия удобно вернуть браузер на главную (перенаправление):

\`\`\`cpp
String html = "<a href='/led?state=on'><button>Включить</button></a>";

// в обработчике /led:
server.sendHeader("Location", "/");
server.send(303);                      // «смотри другую страницу»
\`\`\`

### JSON-ответ

\`\`\`cpp
DynamicJsonDocument doc(256);
doc["temperature"] = 21.5;
doc["led"] = true;
String json;
serializeJson(doc, json);              // {"temperature":21.5,"led":true}
server.send(200, "application/json", json);
\`\`\`

> 💡 Такой адрес (\`/api/status\`) — это и есть **REST API**: другая программа (или другая ESP32) может
> раз в минуту забирать данные станции без всякого HTML.`,
  hints: [
    'Три обработчика: `server.on("/", handleRoot); server.on("/led", handleLed); server.on("/api/status", handleStatus);`',
    'В `loop()`: `server.handleClient();` и раз в 2 с — `temperature = dht.readTemperature(); humidity = dht.readHumidity();`',
    'В `handleLed()`: `String state = server.arg("state");` → `on` / `off` → `digitalWrite`; иначе `server.send(400, "text/plain", "state: on или off");`',
    'Страница: `String html = "<p>Температура: " + String(temperature, 1) + " °C</p>";` плюс две ссылки `/led?state=on` и `/led?state=off`.',
  ],
  starterCode: `#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <DHT.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";

const int LED_PIN = 25;
DHT dht(4, DHT22);
WebServer server(80);

bool ledOn = false;
float temperature = NAN;
float humidity = NAN;

void handleRoot() {
  // TODO: HTML-страница с температурой, влажностью и кнопками
}

void handleLed() {
  // TODO: state=on / state=off, иначе код 400
}

void handleStatus() {
  // TODO: JSON {"temperature":..., "humidity":..., "led": true/false}
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  dht.begin();

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Пульт: http://");
  Serial.println(WiFi.localIP());

  // TODO: зарегистрируйте обработчики и запустите сервер
}

void loop() {
  // TODO: обрабатывать запросы и раз в 2 с читать датчик
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <DHT.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";

const int LED_PIN = 25;
DHT dht(4, DHT22);
WebServer server(80);

bool ledOn = false;
float temperature = NAN;
float humidity = NAN;
unsigned long lastRead = 0;

void readSensor() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    temperature = t;
    humidity = h;
  }
}

void handleRoot() {
  String html = "<!DOCTYPE html><html><head><meta charset='utf-8'>";
  html += "<meta name='viewport' content='width=device-width'><title>Полярная-5</title></head><body>";
  html += "<h1>Станция «Полярная-5»</h1>";
  html += "<p>Температура: <b>" + String(temperature, 1) + " °C</b></p>";
  html += "<p>Влажность: <b>" + String(humidity, 0) + " %</b></p>";
  html += "<p>Свет: " + String(ledOn ? "включён" : "выключен") + "</p>";
  html += "<a href='/led?state=on'><button>Включить</button></a> ";
  html += "<a href='/led?state=off'><button>Выключить</button></a>";
  html += "</body></html>";
  server.send(200, "text/html; charset=utf-8", html);
}

void handleLed() {
  String state = server.arg("state");
  if (state == "on") {
    ledOn = true;
  } else if (state == "off") {
    ledOn = false;
  } else {
    server.send(400, "text/plain; charset=utf-8", "Параметр state: on или off");
    return;
  }
  digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
  server.sendHeader("Location", "/");
  server.send(303, "text/plain", "");
}

void handleStatus() {
  DynamicJsonDocument doc(256);
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["led"] = ledOn;
  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  dht.begin();

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Пульт: http://");
  Serial.println(WiFi.localIP());

  readSensor();
  server.on("/", handleRoot);
  server.on("/led", handleLed);
  server.on("/api/status", handleStatus);
  server.begin();
}

void loop() {
  server.handleClient();
  if (millis() - lastRead >= 2000) {
    lastRead = millis();
    readSensor();
  }
}
`,
  },
  checks: [
    {
      id: 'api',
      title: 'GET /api/status отдаёт JSON с показаниями датчика',
      run: async (h) => {
        await ready(h);
        const j = await status(h);
        h.expect(typeof j.temperature === 'number', `Поле "temperature" должно быть числом, а пришло: ${JSON.stringify(j.temperature)}`);
        h.expect(h.near(j.temperature as number, 19.5, 0.15), `Датчик показывает 19.5 °C, а API вернул ${j.temperature}`);
        h.expect(typeof j.humidity === 'number' && h.near(j.humidity as number, 38, 0.6), `Влажность 38 %, а API вернул ${JSON.stringify(j.humidity)}`);
        h.expect(j.led === false, `Свет выключен — поле "led" должно быть false, а пришло ${JSON.stringify(j.led)}`);
        h.set('dht', 'temperature', 23.5);
        await h.wait(4500);
        const j2 = await status(h);
        h.expect(h.near(j2.temperature as number, 23.5, 0.15), `Температура поднялась до 23.5 °C, а API всё ещё отдаёт ${j2.temperature}. Обновляйте показания в loop() раз в 2 с`);
      },
    },
    {
      id: 'led',
      title: 'GET /led?state=on|off управляет светом, неверный state → 400',
      run: async (h) => {
        await ready(h);
        h.expect(!h.ledOn('led'), 'Свет горит сразу после запуска — изначально он должен быть выключен');
        const on = await h.web('/led', 'GET', { state: 'on' });
        h.expect(on.status > 0 && on.status < 400, `GET /led?state=on вернул код ${on.status}. Зарегистрируйте обработчик server.on("/led", handleLed);`);
        await h.wait(100);
        h.expect(h.ledOn('led'), 'После /led?state=on светодиод на GPIO25 не загорелся');
        const j = await status(h);
        h.expect(j.led === true, `Свет включён, а /api/status сообщает "led": ${JSON.stringify(j.led)}`);
        await h.web('/led', 'GET', { state: 'off' });
        await h.wait(100);
        h.expect(!h.ledOn('led'), 'После /led?state=off светодиод не погас');
        const bad = await h.web('/led', 'GET', { state: 'banana' });
        h.expect(bad.status === 400, `На /led?state=banana сервер ответил кодом ${bad.status}, а нужен 400 (неверный запрос)`);
        h.expect(!h.ledOn('led'), 'Неверный state не должен включать свет');
      },
    },
    {
      id: 'page',
      title: 'Главная страница: температура и кнопки управления',
      run: async (h) => {
        await ready(h);
        const r = await h.web('/');
        h.expect(r.status === 200, `GET / вернул код ${r.status}${r.status === 0 ? ` (${r.body})` : ''}, а нужен 200`);
        const ctype = Object.entries(r.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
        h.expect(ctype.includes('text/html'), `Страница отдана с типом «${ctype}», а нужен text/html — иначе браузер покажет код вместо страницы`);
        h.expect(r.body.includes('19.5'), 'На странице нет текущей температуры (19.5 °C). Добавьте String(temperature, 1) в HTML');
        h.expect(r.body.includes('38'), 'На странице нет влажности (38 %)');
        h.expect(r.body.includes('/led') && r.body.includes('state'),'На странице нет ссылок или кнопок на /led?state=on и /led?state=off');
      },
    },
  ],
};
