import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';
import type { CheckContext } from '@esp32lab/sim';
import { avgInterval, dropMqtt, needMqtt, needWifi, parseJson, track } from './c-helpers';

const TOPIC = 'station/polar5/weather';
const STATUS = 'station/polar5/status';

const parts = () => [p('dht', 'dht22', 280, -30)];
const wires = () => [
  w('dht:VCC', 'esp:3V3', 'red'),
  w('dht:DATA', 'esp:D4', 'yellow'),
  w('dht:GND', 'esp:GND.2', 'black'),
];

const retainedText = (h: CheckContext, topic: string) => {
  const v = h.retained.get(topic);
  return v ? new TextDecoder().decode(v) : null;
};

async function start(h: CheckContext) {
  h.set('dht', 'temperature', 12.4);
  h.set('dht', 'humidity', 63);
  await needWifi(h);
  return needMqtt(h, 8000);
}

const weatherMsgs = (h: CheckContext) => h.mqttLog(TOPIC);

export const telemetry: Practice = {
  id: 'm5-telemetry',
  module: 5,
  order: 2,
  kind: 'homework',
  title: 'Метеотелеметрия',
  subtitle: 'JSON по MQTT, retain и «завещание» LWT',
  difficulty: 2,
  xp: 120,
  minutes: 45,
  tags: ['MQTT', 'JSON', 'LWT', 'retain', 'DHT22'],
  story: `Метеомачта снова меряет температуру, и центр хочет видеть её в реальном времени. Но есть подвох:
когда станцию в прошлый раз накрыло штормом, в Мурманске ещё сутки думали, что она «в сети», — никто не сказал
обратного. Сделай так, чтобы даже внезапная смерть платы не прошла незамеченной: брокер сам сообщит, что
станция **offline**.`,
  goals: [
    'Каждые **5 секунд** публиковать в `station/polar5/weather` JSON `{"t": 12.4, "h": 63, "uptime": 125}` — температура и влажность с DHT22 (**GPIO4**), время работы в секундах',
    'Подключаться к брокеру с **LWT**: топик `station/polar5/status`, сообщение `offline`, retain',
    'Сразу после подключения (и после каждого переподключения) публиковать `online` в `station/polar5/status` с retain',
    'Не использовать длинных `delay()` — `client.loop()` должен вызываться постоянно',
  ],
  theory: `### LWT — последняя воля

**Last Will and Testament** — сообщение, которое клиент оставляет брокеру *при подключении*. Если клиент
пропадёт без прощания (сел аккумулятор, оборвался Wi-Fi), брокер сам опубликует его «завещание».

\`\`\`cpp
// id, топик завещания, QoS, retain, сообщение
client.connect(clientId.c_str(), "station/polar5/status", 1, true, "offline");
client.publish("station/polar5/status", "online", true);
\`\`\`

Вместе с retain получается честный индикатор: в топике статуса всегда лежит \`online\` или \`offline\`.

### JSON-телеметрия

Одно сообщение с несколькими полями удобнее, чем по топику на каждую величину:

\`\`\`cpp
DynamicJsonDocument doc(128);
doc["t"] = round(t * 10) / 10.0;   // 12.4, а не 12.3999996
doc["h"] = round(h);
doc["uptime"] = millis() / 1000;
char buf[128];
serializeJson(doc, buf);
client.publish("station/polar5/weather", buf);
\`\`\`

> 💡 Буфер PubSubClient по умолчанию — **256 байт** вместе с топиком. Длинный JSON молча не отправится
> (\`publish\` вернёт \`false\`) — увеличьте его: \`client.setBufferSize(512);\`

### Таймер без delay()

\`\`\`cpp
unsigned long lastPub = 0;
void loop() {
  if (!client.connected()) reconnect();
  client.loop();
  if (millis() - lastPub >= 5000) {
    lastPub = millis();
    publishWeather();
  }
}
\`\`\``,
  hints: [
    'Подключение с завещанием: `client.connect(clientId.c_str(), "station/polar5/status", 1, true, "offline")`.',
    'Сразу после успешного connect: `client.publish("station/polar5/status", "online", true);`',
    'JSON: `doc["t"] = t; doc["h"] = h; doc["uptime"] = millis() / 1000;` → `serializeJson(doc, buf);` → `client.publish(TOPIC, buf);`',
    'Таймер: `if (millis() - lastPub >= 5000) { lastPub = millis(); publishWeather(); }` и `client.loop()` на каждом проходе `loop()`.',
  ],
  starterCode: `#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";
const char* TOPIC = "station/polar5/weather";
const char* STATUS = "station/polar5/status";

DHT dht(4, DHT22);
WiFiClient espClient;
PubSubClient client(espClient);
String clientId;

void reconnect() {
  while (!client.connected()) {
    // TODO: подключиться с завещанием (LWT): STATUS, "offline", retain
    if (client.connect(clientId.c_str())) {
      // TODO: опубликовать "online" с retain
    } else {
      delay(2000);
    }
  }
}

void publishWeather() {
  // TODO: прочитать датчик, собрать JSON {"t":..,"h":..,"uptime":..}
  //       и опубликовать в TOPIC
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Wi-Fi есть");
  randomSeed(micros());
  clientId = "polar5-meteo-" + String(random(0xffff), HEX);
  client.setServer("mqtt.iot", 1883);
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();
  // TODO: каждые 5 секунд — publishWeather()
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";
const char* TOPIC = "station/polar5/weather";
const char* STATUS = "station/polar5/status";

DHT dht(4, DHT22);
WiFiClient espClient;
PubSubClient client(espClient);
String clientId;
unsigned long lastPub = 0;

void reconnect() {
  while (!client.connected()) {
    Serial.print("MQTT... ");
    if (client.connect(clientId.c_str(), STATUS, 1, true, "offline")) {
      Serial.println("на связи");
      client.publish(STATUS, "online", true);
    } else {
      Serial.printf("ошибка %d\\n", client.state());
      delay(2000);
    }
  }
}

void publishWeather() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("DHT22 не отвечает");
    return;
  }
  DynamicJsonDocument doc(128);
  doc["t"] = round(t * 10) / 10.0;
  doc["h"] = round(h);
  doc["uptime"] = millis() / 1000;
  char buf[128];
  serializeJson(doc, buf);
  bool ok = client.publish(TOPIC, buf);
  Serial.print(ok ? "-> " : "Не отправлено: ");
  Serial.println(buf);
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Wi-Fi есть");
  randomSeed(micros());
  clientId = "polar5-meteo-" + String(random(0xffff), HEX);
  client.setServer("mqtt.iot", 1883);
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();
  if (millis() - lastPub >= 5000) {
    lastPub = millis();
    publishWeather();
  }
}
`,
  },
  checks: [
    {
      id: 'json',
      title: 'JSON с показаниями датчика в station/polar5/weather',
      run: async (h) => {
        await start(h);
        const got = await h.waitFor(() => weatherMsgs(h).length > 0, 7000, 50);
        h.expect(got, `За 7 с в топик ${TOPIC} не пришло ни одного сообщения`);
        const raw = weatherMsgs(h)[0].payload;
        const j = parseJson(raw);
        h.expect(j, `Сообщение «${raw.slice(0, 80)}» — не JSON-объект. Соберите его через ArduinoJson и serializeJson()`);
        h.expect(typeof j!.t === 'number' && h.near(j!.t as number, 12.4, 0.15), `Датчик показывает 12.4 °C, а в поле "t" пришло ${JSON.stringify(j!.t)} (нужно число)`);
        h.expect(typeof j!.h === 'number' && h.near(j!.h as number, 63, 1), `Влажность 63 %, а в поле "h" пришло ${JSON.stringify(j!.h)}`);
        h.expect(typeof j!.uptime === 'number', `Поле "uptime" должно быть числом (секунды с запуска: millis() / 1000), а пришло ${JSON.stringify(j!.uptime)}`);
        h.set('dht', 'temperature', 15);
        const n = weatherMsgs(h).length;
        await h.waitFor(() => weatherMsgs(h).length > n + 1, 12000, 50);
        const last = parseJson(weatherMsgs(h)[weatherMsgs(h).length - 1].payload);
        h.expect(last && h.near(last.t as number, 15, 0.15), `Температура выросла до 15 °C, а в телеметрии всё ещё ${JSON.stringify(last?.t)}. Читайте датчик перед каждой публикацией`);
      },
    },
    {
      id: 'interval',
      title: 'Публикация каждые 5 секунд, uptime растёт',
      timeoutMs: 30000,
      run: async (h) => {
        await start(h);
        const times = await track(h, () => weatherMsgs(h).length, 21000, 50);
        h.expect(times.length >= 2, `За 21 с опубликовано ${times.length} сообщений, а нужно по одному каждые 5 с`);
        const avg = avgInterval(times)!;
        h.expect(Math.abs(avg - 5000) <= 400, `Сообщения уходят раз в ${(avg / 1000).toFixed(1)} с, а нужно раз в 5 с`);
        const up = weatherMsgs(h).map((m) => parseJson(m.payload)?.uptime).filter((x): x is number => typeof x === 'number');
        h.expect(up.length >= 2 && up[up.length - 1] > up[0], `uptime не растёт: ${up.slice(0, 4).join(', ')}. Используйте millis() / 1000`);
      },
    },
    {
      id: 'lwt',
      title: 'Завещание offline и статус online (retain)',
      run: async (h) => {
        const id = await start(h);
        await h.wait(300);
        const will = h.net.broker.clients.get(id)?.will;
        h.expect(will, 'Подключение без завещания (LWT). Используйте client.connect(id, "station/polar5/status", 1, true, "offline")');
        h.expect(will!.topic === STATUS, `Завещание отправится в «${will!.topic}», а нужен топик ${STATUS}`);
        h.expect(will!.payload === 'offline', `Текст завещания «${will!.payload}», а нужен «offline»`);
        h.expect(will!.retain, 'Завещание без retain: тот, кто подпишется позже, не узнает, что станция offline. Четвёртый аргумент connect — true');
        h.expect(retainedText(h, STATUS) === 'online', `После подключения в ${STATUS} должно лежать «online» с retain, а там ${JSON.stringify(retainedText(h, STATUS))}`);
        dropMqtt(h, id);
        h.expect(retainedText(h, STATUS) === 'offline', 'После обрыва брокер не опубликовал завещание');
        const back = await h.waitFor(() => h.mqttConnected().length > 0 && retainedText(h, STATUS) === 'online', 8000, 50);
        h.expect(back, 'После обрыва связи плата не переподключилась или не вернула статус «online»');
      },
    },
  ],
};
