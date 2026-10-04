import type { Practice } from '../types';
import { bare } from '../helpers';
import type { CheckContext } from '@esp32lab/sim';
import { dropMqtt, needMqtt, needWifi } from './c-helpers';

const STATUS = 'station/polar5/status';
const CMD = 'station/polar5/cmd';
const DEFAULT_IDS = ['esp32', 'esp32client', 'esp8266client', 'arduinoclient', 'client', 'esp', 'test', 'mqtt'];

const retainedText = (h: CheckContext, topic: string) => {
  const v = h.retained.get(topic);
  return v ? new TextDecoder().decode(v) : null;
};

async function connected(h: CheckContext) {
  await needWifi(h);
  const id = await needMqtt(h, 8000);
  await h.wait(300);
  return id;
}

export const mqttHello: Practice = {
  id: 'm5-hello',
  module: 5,
  order: 1,
  kind: 'lab',
  title: 'Первый контакт',
  subtitle: 'Брокер MQTT: публикация, подписка, переподключение',
  difficulty: 1,
  xp: 70,
  minutes: 25,
  tags: ['MQTT', 'PubSubClient', 'publish', 'subscribe', 'retain'],
  story: `Центр управления больше не хочет каждые 10 секунд получать HTTP-запросы от каждой станции — серверу
тяжело. Вместо этого в Мурманске подняли **MQTT-брокер** \`mqtt.iot\`: станции публикуют данные в «каналы»,
а все, кому интересно, на них подписываются. Первый шаг — представиться брокеру и сказать: «Полярная-5 в эфире».`,
  goals: [
    'Подключиться к брокеру `mqtt.iot`, порт `1883`, с **уникальным** clientId (например, `polar5-` + случайное число)',
    'Сразу после подключения опубликовать `online` в топик `station/polar5/status` **с флагом retain**',
    'Подписаться на `station/polar5/cmd` и печатать в Serial каждое пришедшее сообщение',
    'Написать функцию `reconnect()`: если связь с брокером пропала, `loop()` подключается заново и восстанавливает подписку',
  ],
  theory: `### Издатель — брокер — подписчик

В HTTP клиент сам спрашивает сервер. В MQTT все общаются через **брокер**:

* **издатель** (publisher) отправляет сообщение в **топик** — строку вида \`station/polar5/status\`;
* **подписчик** (subscriber) заранее говорит брокеру: «присылай мне всё из этого топика»;
* брокер раскладывает сообщения по подписчикам. Издатель и подписчик друг о друге не знают.

### PubSubClient

\`\`\`cpp
#include <WiFi.h>
#include <PubSubClient.h>

WiFiClient espClient;
PubSubClient client(espClient);

void callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.println(String(topic) + ": " + msg);
}

void setup() {
  // ... Wi-Fi
  client.setServer("mqtt.iot", 1883);
  client.setCallback(callback);   // кто обработает входящие сообщения
}

void loop() {
  client.loop();                  // обязательно и часто!
}
\`\`\`

\`client.loop()\` принимает входящие сообщения и поддерживает соединение (keepalive). Если долго его не
вызывать (длинный \`delay()\`), брокер решит, что клиент умер, и разорвёт связь.

### clientId должен быть уникальным

Если два устройства подключатся с одинаковым id, брокер выкинет первое — и они будут бесконечно выбивать друг друга.

\`\`\`cpp
String clientId = "polar5-" + String(random(0xffff), HEX);
client.connect(clientId.c_str());
\`\`\`

### Переподключение

Связь рвётся: пропал Wi-Fi, перезапустили брокер. Типовой приём из лекции:

\`\`\`cpp
void reconnect() {
  while (!client.connected()) {
    if (client.connect(clientId.c_str())) {
      client.subscribe("station/polar5/cmd");   // подписки после переподключения теряются!
    } else {
      Serial.print("Ошибка, rc=");
      Serial.println(client.state());
      delay(5000);
    }
  }
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();
}
\`\`\`

### retain — «последнее известное значение»

\`client.publish(topic, "online", true)\` — третий аргумент \`true\` просит брокер **запомнить** сообщение.
Любой, кто подпишется позже, сразу получит его. Идеально для статуса «станция в сети».`,
  hints: [
    'В `setup()` после Wi-Fi: `client.setServer("mqtt.iot", 1883); client.setCallback(callback);`',
    'Уникальный id: `clientId = "polar5-" + String(random(0xffff), HEX);`',
    'В `reconnect()` после успешного `client.connect(...)`: `client.publish("station/polar5/status", "online", true); client.subscribe("station/polar5/cmd");`',
    'В `loop()`: `if (!client.connected()) reconnect(); client.loop();` — и никаких длинных `delay()`.',
  ],
  starterCode: `#include <WiFi.h>
#include <PubSubClient.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";
const char* mqtt_server = "mqtt.iot";

WiFiClient espClient;
PubSubClient client(espClient);
String clientId;

void callback(char* topic, byte* payload, unsigned int length) {
  // TODO: собрать payload в строку и напечатать вместе с топиком
}

void reconnect() {
  // TODO: пока нет связи — подключиться с clientId,
  //       опубликовать "online" (retain) в station/polar5/status
  //       и подписаться на station/polar5/cmd
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Wi-Fi есть");

  // TODO: придумать уникальный clientId, настроить сервер и callback
}

void loop() {
  // TODO: переподключение и client.loop()
}
`,
  starterCircuit: bare(),
  circuitLocked: true,
  solution: {
    code: `#include <WiFi.h>
#include <PubSubClient.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";
const char* mqtt_server = "mqtt.iot";

WiFiClient espClient;
PubSubClient client(espClient);
String clientId;

void callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.print("Сообщение [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(msg);
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Подключаюсь к брокеру как ");
    Serial.print(clientId);
    Serial.print("... ");
    if (client.connect(clientId.c_str())) {
      Serial.println("готово");
      client.publish("station/polar5/status", "online", true);
      client.subscribe("station/polar5/cmd");
    } else {
      Serial.print("ошибка, rc=");
      Serial.print(client.state());
      Serial.println(", повтор через 5 с");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Wi-Fi есть");

  randomSeed(micros());
  clientId = "polar5-" + String(random(0xffff), HEX);
  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();
}
`,
  },
  checks: [
    {
      id: 'connect',
      title: 'Подключение к брокеру с уникальным clientId',
      run: async (h) => {
        const id = await connected(h);
        h.expect(id.length >= 3, `clientId «${id}» слишком короткий`);
        h.expect(!DEFAULT_IDS.includes(id.toLowerCase()), `clientId «${id}» — типовой, такой же будет у соседей, и брокер начнёт их выбивать. Добавьте случайную часть: "polar5-" + String(random(0xffff), HEX)`);
      },
    },
    {
      id: 'status',
      title: 'Статус online опубликован с retain',
      run: async (h) => {
        await connected(h);
        const sent = h.mqttLog(STATUS);
        h.expect(sent.length > 0, `В топик ${STATUS} ничего не опубликовано. После подключения: client.publish("${STATUS}", "online", true);`);
        h.expect(sent[0].payload === 'online', `В ${STATUS} опубликовано «${sent[0].payload}», а нужно «online»`);
        h.expect(retainedText(h, STATUS) === 'online', 'Сообщение online опубликовано без флага retain — брокер его не запомнил. Третий аргумент publish должен быть true');
      },
    },
    {
      id: 'cmd',
      title: 'Сообщения из station/polar5/cmd печатаются в Serial',
      run: async (h) => {
        await connected(h);
        h.mqttPublish(CMD, 'ping-42');
        await h.wait(800);
        h.expect(h.serial.includes('ping-42'), `Отправили «ping-42» в ${CMD}, но в Serial его нет. Подпишитесь: client.subscribe("${CMD}"); и печатайте payload в callback`);
      },
    },
    {
      id: 'reconnect',
      title: 'После обрыва связи плата переподключается',
      run: async (h) => {
        const id = await connected(h);
        dropMqtt(h, id);
        await h.wait(100);
        const back = await h.waitFor(() => h.mqttConnected().length > 0, 8000, 50);
        h.expect(back, 'Брокер разорвал соединение, и плата не переподключилась за 8 с. В loop(): if (!client.connected()) reconnect();');
        await h.wait(300);
        h.mqttPublish(CMD, 'after-storm');
        await h.wait(800);
        h.expect(h.serial.includes('after-storm'), 'После переподключения сообщения из station/polar5/cmd не приходят — подписку надо восстанавливать в reconnect()');
      },
    },
  ],
};
