import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';
import type { CheckContext } from '@esp32lab/sim';
import { avgInterval, needMqtt, needWifi, parseJson, track } from './c-helpers';

const T_TELEMETRY = 'station/polar5/telemetry';
const T_FAN = 'station/polar5/fan/set';
const T_ALERT = 'station/polar5/alert';

const parts = () => [
  p('dht', 'dht22', 280, -30),
  p('r1', 'resistor', 340, -30, { value: 220 }),
  p('alarm', 'led', 400, -30, { color: 'red' }),
  p('btn', 'button', 460, -30, { color: 'yellow', label: 'Вент.' }),
  p('lcd', 'lcd1602', 280, 130),
  p('relay', 'relay', 510, 130),
  p('fan', 'motor', 650, 130),
];

const wires = () => [
  // DHT22: питание 3V3, данные GPIO4
  w('dht:VCC', 'esp:3V3', 'red'),
  w('dht:DATA', 'esp:D4', 'yellow'),
  w('dht:GND', 'esp:GND.2', 'black'),
  // сигнальный светодиод: GPIO25 → 220 Ом → LED → GND
  w('esp:D25', 'r1:1', 'orange'),
  w('r1:2', 'alarm:A', 'orange'),
  w('alarm:C', 'esp:GND.1', 'black'),
  // кнопка: GPIO14 ↔ GND (INPUT_PULLUP)
  w('btn:1', 'esp:D14', 'blue'),
  w('btn:2', 'esp:GND.1', 'black'),
  // LCD 1602 по I²C: SDA 21, SCL 22, питание 5 В
  w('lcd:GND', 'esp:GND.2', 'black'),
  w('lcd:VCC', 'esp:VIN', 'red'),
  w('lcd:SDA', 'esp:D21', 'green'),
  w('lcd:SCL', 'esp:D22', 'blue'),
  // вентилятор через реле на GPIO26
  w('esp:VIN', 'relay:VCC', 'red'),
  w('esp:GND.2', 'relay:GND', 'black'),
  w('esp:D26', 'relay:IN', 'purple'),
  w('esp:VIN', 'relay:COM', 'red'),
  w('relay:NO', 'fan:1', 'red'),
  w('fan:2', 'esp:GND.2', 'black'),
];

const fanOn = (h: CheckContext) => h.relayOn('relay') && h.loadLevel('fan') > 0.5;
const telemetry = (h: CheckContext) => h.mqttLog(T_TELEMETRY).map((m) => parseJson(m.payload));
const lastTelemetry = (h: CheckContext) => {
  const t = telemetry(h);
  return t.length ? t[t.length - 1] : null;
};

async function start(h: CheckContext, temp = 23.4) {
  h.set('dht', 'temperature', temp);
  h.set('dht', 'humidity', 41);
  await needWifi(h);
  await needMqtt(h, 8000);
  await h.wait(2500);
}

/** Ждать условия; если не дождались — ошибка. */
async function expectSoon(h: CheckContext, cond: () => boolean, limit: number, fail: string) {
  const ok = await h.waitFor(cond, limit, 50);
  h.expect(ok, fail);
}

export const final: Practice = {
  id: 'm6-final',
  module: 6,
  order: 1,
  kind: 'case',
  title: 'Станция онлайн',
  subtitle: 'Итоговый проект: датчики, дисплей, автоматика и MQTT',
  difficulty: 3,
  xp: 300,
  minutes: 120,
  tags: ['MQTT', 'JSON', 'DHT22', 'LCD I²C', 'реле', 'автоматика', 'millis'],
  story: `Месяц работы позади. Свет горит, шлюз открывается, метеомачта меряет погоду, а радиорубка снова
слышит эфир. Осталось последнее: собрать всё в **одну** систему, которая живёт сама.

В аппаратной стоит щит: термодатчик, дисплей, вентилятор охлаждения серверной, красная лампа тревоги и
кнопка. Серверная греется — вентилятор должен включаться сам. Перегрелась всерьёз — мигает тревога и летит
сообщение в Мурманск. А дежурный центра может в любой момент взять управление на себя.

Когда всё заработает, в эфире раздастся: «Полярная-5, вас слышим. Добро пожаловать обратно». Вперёд, инженер.`,
  goals: [
    '**Телеметрия:** каждые **5 с** публиковать в `station/polar5/telemetry` JSON `{"t": 23.4, "h": 41, "fan": false, "mode": "auto", "alarm": false}` (DHT22 на **GPIO4**)',
    '**Вентилятор** (реле на **GPIO26**) — три режима из `station/polar5/fan/set`: `on`, `off`, `auto`. В режиме `auto` вентилятор работает, когда температура **выше 28 °C**',
    '**Тревога:** при температуре **выше 35 °C** красный светодиод (**GPIO25**) мигает, а в `station/polar5/alert` **один раз** уходит сообщение о перегреве; когда остыло — светодиод гаснет',
    '**Дисплей** LCD1602 (I²C, 0x27): в первой строке температура и влажность, во второй — режим (`AUTO` / `ON` / `OFF`) и состояние вентилятора',
    '**Кнопка** (**GPIO14**, к GND): ручное управление — каждое нажатие включает или выключает вентилятор (режим `on` / `off`); вернуть автоматику — командой `auto`',
  ],
  theory: `### Как собрать большую программу

Главное правило итогового проекта: **никаких длинных \`delay()\`**. Пока программа спит, она не принимает
MQTT-команды, не замечает кнопку и не мигает тревогой. Каждая подсистема — своё расписание на \`millis()\`:

\`\`\`cpp
void loop() {
  if (!client.connected()) reconnect();
  client.loop();                         // MQTT — постоянно
  handleButton();                        // кнопка — постоянно

  unsigned long now = millis();
  if (now - lastRead >= 2000) {          // датчик — раз в 2 с
    lastRead = now;
    readSensor();
    updateFan();
    updateAlarm();
    updateLcd();
  }
  if (alarm && now - lastBlink >= 250) { // мигание — 2 раза в секунду
    lastBlink = now;
    blinkState = !blinkState;
    digitalWrite(ALARM_PIN, blinkState);
  }
  if (now - lastPub >= 5000) {           // телеметрия — раз в 5 с
    lastPub = now;
    publishTelemetry();
  }
}
\`\`\`

### Состояние — в переменных, решения — в функциях

\`\`\`cpp
String mode = "auto";       // "auto" | "on" | "off"

void updateFan() {
  bool want = (mode == "on") || (mode == "auto" && temperature > 28.0);
  digitalWrite(FAN_PIN, want ? HIGH : LOW);
}
\`\`\`

Команда из MQTT, нажатие кнопки и автоматика лишь меняют \`mode\` и вызывают \`updateFan()\` — так логика живёт в одном месте.

### Сообщить один раз

Тревогу нужно отправить **в момент**, когда температура перешла порог, а не каждые 2 секунды, пока жарко.
Запоминайте прошлое состояние — как с кнопкой в первом модуле:

\`\`\`cpp
bool hot = temperature > 35.0;
if (hot && !alarm) client.publish("station/polar5/alert", "...");   // только что перегрелось
alarm = hot;
\`\`\`

### LCD 1602

\`\`\`cpp
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);

lcd.init();
lcd.backlight();
lcd.setCursor(0, 0);                 // столбец, строка
lcd.print("T:23.4C H:41%");
\`\`\`

Дисплей не знает кириллицы — пишите латиницей. Перед выводом новой строки затирайте старую (\`lcd.clear()\`
или пробелы до конца строки), иначе останутся «хвосты».`,
  hints: [
    'Начните с «каркаса»: Wi-Fi, `reconnect()` с подпиской на `station/polar5/fan/set`, пустые функции `readSensor()`, `updateFan()`, `updateAlarm()`, `updateLcd()`, `publishTelemetry()` и расписание в `loop()`.',
    'В callback: собрать payload в `String msg`; если `msg` — `on`, `off` или `auto`, записать его в `mode` и вызвать `updateFan()`.',
    'Кнопка с `INPUT_PULLUP`: нажатие — переход `HIGH → LOW`. При нажатии: `mode = fanIsOn ? "off" : "on"; updateFan(); updateLcd();`',
    'Тревога: `bool hot = temperature > 35;` → при `hot && !alarm` — `client.publish(T_ALERT, "...")`; при `!hot` — `digitalWrite(ALARM_PIN, LOW)`. Телеметрия: `doc["t"]`, `doc["h"]`, `doc["fan"] = fanIsOn`, `doc["mode"] = mode`, `doc["alarm"] = alarm`.',
  ],
  starterCode: `#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";

const int DHT_PIN = 4;
const int ALARM_PIN = 25;
const int FAN_PIN = 26;
const int BTN_PIN = 14;

const float FAN_TEMP = 28.0;     // авто-вентилятор выше этой температуры
const float ALARM_TEMP = 35.0;   // тревога выше этой температуры

const char* T_TELEMETRY = "station/polar5/telemetry";
const char* T_FAN_SET = "station/polar5/fan/set";
const char* T_ALERT = "station/polar5/alert";

DHT dht(DHT_PIN, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);
WiFiClient espClient;
PubSubClient client(espClient);
String clientId;

String mode = "auto";            // "auto" | "on" | "off"
float temperature = NAN;
float humidity = NAN;
bool fanIsOn = false;
bool alarm = false;

void callback(char* topic, byte* payload, unsigned int length) {
  // TODO: команды on / off / auto для вентилятора
}

void reconnect() {
  while (!client.connected()) {
    if (client.connect(clientId.c_str())) {
      // TODO: подписаться на T_FAN_SET
    } else {
      delay(2000);
    }
  }
}

// TODO: readSensor(), updateFan(), updateAlarm(), updateLcd(), publishTelemetry(), handleButton()

void setup() {
  Serial.begin(115200);
  pinMode(ALARM_PIN, OUTPUT);
  pinMode(FAN_PIN, OUTPUT);
  pinMode(BTN_PIN, INPUT_PULLUP);
  dht.begin();
  lcd.init();
  lcd.backlight();
  lcd.print("Polar-5 boot...");

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Wi-Fi есть");
  randomSeed(micros());
  clientId = "polar5-main-" + String(random(0xffff), HEX);
  client.setServer("mqtt.iot", 1883);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();
  // TODO: кнопка, датчик раз в 2 с, мигание тревоги, телеметрия раз в 5 с
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";

const int DHT_PIN = 4;
const int ALARM_PIN = 25;
const int FAN_PIN = 26;
const int BTN_PIN = 14;

const float FAN_TEMP = 28.0;
const float ALARM_TEMP = 35.0;

const char* T_TELEMETRY = "station/polar5/telemetry";
const char* T_FAN_SET = "station/polar5/fan/set";
const char* T_ALERT = "station/polar5/alert";
const char* T_STATUS = "station/polar5/status";

DHT dht(DHT_PIN, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);
WiFiClient espClient;
PubSubClient client(espClient);
String clientId;

String mode = "auto";
float temperature = NAN;
float humidity = NAN;
bool fanIsOn = false;
bool alarm = false;
bool blinkState = false;
int lastBtn = HIGH;
unsigned long lastRead = 0, lastPub = 0, lastBlink = 0, lastPress = 0;

void updateLcd() {
  char line[17];
  lcd.setCursor(0, 0);
  if (isnan(temperature)) {
    lcd.print("Sensor error    ");
  } else {
    snprintf(line, sizeof(line), "T:%.1fC H:%.0f%%   ", temperature, humidity);
    lcd.print(line);
  }
  lcd.setCursor(0, 1);
  String mtext = mode;
  mtext.toUpperCase();
  if (alarm) snprintf(line, sizeof(line), "%-4s Fan:%-3s !!", mtext.c_str(), fanIsOn ? "ON" : "OFF");
  else snprintf(line, sizeof(line), "%-4s Fan:%-3s   ", mtext.c_str(), fanIsOn ? "ON" : "OFF");
  lcd.print(line);
}

void updateFan() {
  bool want = (mode == "on") || (mode == "auto" && !isnan(temperature) && temperature > FAN_TEMP);
  if (want != fanIsOn) {
    fanIsOn = want;
    digitalWrite(FAN_PIN, fanIsOn ? HIGH : LOW);
    Serial.println(fanIsOn ? "Вентилятор включён" : "Вентилятор выключен");
  }
}

void updateAlarm() {
  bool hot = !isnan(temperature) && temperature > ALARM_TEMP;
  if (hot && !alarm) {
    DynamicJsonDocument doc(128);
    doc["alert"] = "overheat";
    doc["t"] = round(temperature * 10) / 10.0;
    char buf[128];
    serializeJson(doc, buf);
    client.publish(T_ALERT, buf);
    Serial.print("ТРЕВОГА: ");
    Serial.println(buf);
  }
  if (!hot && alarm) {
    digitalWrite(ALARM_PIN, LOW);
    blinkState = false;
    Serial.println("Температура в норме");
  }
  alarm = hot;
}

void readSensor() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    temperature = t;
    humidity = h;
  }
}

void publishTelemetry() {
  if (isnan(temperature)) return;
  DynamicJsonDocument doc(256);
  doc["t"] = round(temperature * 10) / 10.0;
  doc["h"] = round(humidity);
  doc["fan"] = fanIsOn;
  doc["mode"] = mode;
  doc["alarm"] = alarm;
  char buf[256];
  serializeJson(doc, buf);
  client.publish(T_TELEMETRY, buf);
}

void setMode(String m) {
  mode = m;
  updateFan();
  updateLcd();
  Serial.println("Режим: " + mode);
}

void handleButton() {
  int b = digitalRead(BTN_PIN);
  if (b == LOW && lastBtn == HIGH && millis() - lastPress > 200) {
    lastPress = millis();
    setMode(fanIsOn ? "off" : "on");
  }
  lastBtn = b;
}

void callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  msg.trim();
  msg.toLowerCase();
  if (msg == "on" || msg == "off" || msg == "auto") setMode(msg);
  else Serial.println("Неизвестная команда: " + msg);
}

void reconnect() {
  while (!client.connected()) {
    if (client.connect(clientId.c_str(), T_STATUS, 1, true, "offline")) {
      client.publish(T_STATUS, "online", true);
      client.subscribe(T_FAN_SET);
      Serial.println("MQTT: станция онлайн");
    } else {
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(ALARM_PIN, OUTPUT);
  pinMode(FAN_PIN, OUTPUT);
  pinMode(BTN_PIN, INPUT_PULLUP);
  dht.begin();
  lcd.init();
  lcd.backlight();
  lcd.print("Polar-5 boot...");

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Wi-Fi есть");
  randomSeed(micros());
  clientId = "polar5-main-" + String(random(0xffff), HEX);
  client.setServer("mqtt.iot", 1883);
  client.setCallback(callback);
  lcd.clear();
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();
  handleButton();

  unsigned long now = millis();
  if (now - lastRead >= 2000) {
    lastRead = now;
    readSensor();
    updateFan();
    updateAlarm();
    updateLcd();
  }
  if (alarm && now - lastBlink >= 250) {
    lastBlink = now;
    blinkState = !blinkState;
    digitalWrite(ALARM_PIN, blinkState);
  }
  if (now - lastPub >= 5000) {
    lastPub = now;
    publishTelemetry();
  }
}
`,
  },
  checks: [
    {
      id: 'telemetry',
      title: 'Телеметрия: JSON каждые 5 секунд',
      timeoutMs: 30000,
      run: async (h) => {
        await start(h);
        const times = await track(h, () => h.mqttLog(T_TELEMETRY).length, 16000, 50);
        h.expect(times.length >= 2, `За 16 с в ${T_TELEMETRY} пришло ${times.length} сообщений, а нужно по одному каждые 5 с`);
        const avg = avgInterval(times)!;
        h.expect(Math.abs(avg - 5000) <= 500, `Телеметрия уходит раз в ${(avg / 1000).toFixed(1)} с, а нужно раз в 5 с`);
        const j = lastTelemetry(h);
        h.expect(j, `Телеметрия — не JSON-объект: «${h.mqttLog(T_TELEMETRY).at(-1)?.payload.slice(0, 80)}»`);
        h.expect(typeof j!.t === 'number' && h.near(j!.t as number, 23.4, 0.15), `Датчик показывает 23.4 °C, а в "t" пришло ${JSON.stringify(j!.t)}`);
        h.expect(typeof j!.h === 'number' && h.near(j!.h as number, 41, 1), `Влажность 41 %, а в "h" пришло ${JSON.stringify(j!.h)}`);
        h.expect(j!.fan === false, `Вентилятор выключен — "fan" должно быть false, а пришло ${JSON.stringify(j!.fan)}`);
        h.expect(j!.mode === 'auto', `Режим по умолчанию — "auto", а в телеметрии "mode": ${JSON.stringify(j!.mode)}`);
        h.expect(j!.alarm === false, `Тревоги нет — "alarm" должно быть false, а пришло ${JSON.stringify(j!.alarm)}`);
      },
    },
    {
      id: 'auto',
      title: 'Автоматика: вентилятор выше 28 °C',
      run: async (h) => {
        await start(h);
        h.expect(!fanOn(h), 'При 23.4 °C в режиме auto вентилятор должен стоять');
        h.set('dht', 'temperature', 30);
        await expectSoon(h, () => fanOn(h), 6000, 'Температура 30 °C (выше 28), а вентилятор так и не включился. Проверяйте датчик раз в 2 с и сравнивайте с порогом');
        await h.wait(5500);
        h.expect(lastTelemetry(h)?.fan === true, `Вентилятор работает, а телеметрия сообщает "fan": ${JSON.stringify(lastTelemetry(h)?.fan)}`);
        h.set('dht', 'temperature', 25);
        await expectSoon(h, () => !h.relayOn('relay'), 6000, 'Температура упала до 25 °C, а вентилятор продолжает работать');
      },
    },
    {
      id: 'commands',
      title: 'Команды on / off / auto из station/polar5/fan/set',
      run: async (h) => {
        await start(h);
        h.mqttPublish(T_FAN, 'on');
        await expectSoon(h, () => fanOn(h), 2500, `Команда «on» в ${T_FAN} не включила вентилятор. Подпишитесь на топик и меняйте режим в callback`);
        h.set('dht', 'temperature', 30);
        await h.wait(1000);
        h.mqttPublish(T_FAN, 'off');
        await expectSoon(h, () => !h.relayOn('relay'), 2500, 'Команда «off» не выключила вентилятор');
        await h.wait(5000);
        h.expect(!h.relayOn('relay'), 'В режиме off вентилятор включился сам, хотя 30 °C. Ручной режим важнее автоматики');
        h.expect(lastTelemetry(h)?.mode === 'off', `После команды «off» телеметрия сообщает "mode": ${JSON.stringify(lastTelemetry(h)?.mode)}`);
        h.mqttPublish(T_FAN, 'auto');
        await expectSoon(h, () => fanOn(h), 3000, 'После «auto» при 30 °C вентилятор должен включиться сам');
      },
    },
    {
      id: 'alarm',
      title: 'Тревога выше 35 °C: мигание и одно сообщение',
      timeoutMs: 30000,
      run: async (h) => {
        await start(h);
        h.expect(!h.ledOn('alarm'), 'Красный светодиод тревоги горит при нормальной температуре');
        h.set('dht', 'temperature', 37);
        await expectSoon(h, () => h.mqttLog(T_ALERT).length > 0, 5000, `При 37 °C в ${T_ALERT} не пришло сообщение о перегреве`);
        const from = h.now;
        await h.wait(3000);
        const toggles = h.toggles(25, from, h.now);
        h.expect(toggles >= 4, `При тревоге светодиод GPIO25 должен мигать, а за 3 с он переключился ${toggles} раз. Мигайте через millis(), а не delay()`);
        await h.wait(7000);
        const n = h.mqttLog(T_ALERT).length;
        h.expect(n <= 2, `За 10 с перегрева в ${T_ALERT} отправлено ${n} сообщений — тревога должна уходить один раз, при переходе через порог`);
        h.expect(lastTelemetry(h)?.alarm === true, `Идёт тревога, а телеметрия сообщает "alarm": ${JSON.stringify(lastTelemetry(h)?.alarm)}`);
        h.set('dht', 'temperature', 25);
        await h.wait(5000);
        const quiet = h.now;
        await h.wait(2000);
        h.expect(h.toggles(25, quiet, h.now) === 0 && !h.ledOn('alarm'), 'Температура в норме (25 °C), а светодиод тревоги всё ещё мигает или горит');
      },
    },
    {
      id: 'lcd',
      title: 'Дисплей: температура, влажность и режим',
      run: async (h) => {
        await start(h);
        await h.wait(2500);
        const text = h.lcdText('lcd');
        h.expect(text.replace(/\s/g, '').length > 0, 'Дисплей пустой. lcd.init(); lcd.backlight(); затем lcd.setCursor(…) и lcd.print(…)');
        h.expect(text.includes('23'), `На дисплее «${text.replace('\n', ' | ')}» нет температуры 23.4 °C`);
        h.expect(text.includes('41'), `На дисплее «${text.replace('\n', ' | ')}» нет влажности 41 %`);
        h.expect(/auto/i.test(text), `На дисплее «${text.replace('\n', ' | ')}» не виден режим AUTO`);
        h.set('dht', 'temperature', 31.6);
        await h.wait(4500);
        const t2 = h.lcdText('lcd');
        h.expect(t2.includes('31') || t2.includes('32'), `Температура выросла до 31.6 °C, а на дисплее всё ещё «${t2.replace('\n', ' | ')}»`);
      },
    },
    {
      id: 'button',
      title: 'Кнопка: ручное включение и выключение вентилятора',
      run: async (h) => {
        await start(h);
        h.expect(!fanOn(h), 'При 23.4 °C вентилятор должен стоять');
        await h.press('btn', 150);
        await expectSoon(h, () => fanOn(h), 1000, 'Нажали кнопку — вентилятор не включился. Кнопка на GPIO14 подключена к GND: INPUT_PULLUP, нажатие = LOW');
        await h.wait(2500);
        const text = h.lcdText('lcd');
        h.expect(/\bon\b/i.test(text) && !/auto/i.test(text), `После нажатия кнопки режим стал ручным (ON), а на дисплее «${text.replace('\n', ' | ')}»`);
        await h.wait(1000);
        h.expect(fanOn(h), 'Вентилятор, включённый кнопкой, сам выключился — в ручном режиме автоматика не должна вмешиваться');
        await h.press('btn', 150);
        await expectSoon(h, () => !h.relayOn('relay'), 1000, 'Повторное нажатие кнопки не выключило вентилятор');
        await h.wait(5500);
        h.expect(lastTelemetry(h)?.mode === 'off', `После выключения кнопкой в телеметрии ожидался "mode": "off", а пришло ${JSON.stringify(lastTelemetry(h)?.mode)}`);
      },
    },
  ],
};
