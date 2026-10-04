import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';
import type { CheckContext } from '@esp32lab/sim';
import { topicMatches } from '@esp32lab/sim';
import { needMqtt, needWifi } from './c-helpers';

const BASE = 'station/polar5';

const parts = () => [
  p('door', 'servo', 300, -20, { horn: 'barrier' }),
  p('r1', 'resistor', 390, -20, { value: 220 }),
  p('light', 'led', 450, -20, { color: 'white' }),
];

const wires = () => [
  w('door:GND', 'esp:GND.1', 'black'),
  w('door:V+', 'esp:VIN', 'red'),
  w('door:PWM', 'esp:D18', 'orange'),
  w('esp:D25', 'r1:1', 'yellow'),
  w('r1:2', 'light:A', 'yellow'),
  w('light:C', 'esp:GND.1', 'black'),
];

async function start(h: CheckContext) {
  await needWifi(h);
  const id = await needMqtt(h, 8000);
  await h.wait(500);
  return id;
}

const lastState = (h: CheckContext, device: string) => {
  const log = h.mqttLog(`${BASE}/${device}/state`);
  return log.length ? log[log.length - 1].payload.trim() : null;
};

/** Отправить команду и дождаться условия. */
async function send(h: CheckContext, device: string, payload: string, cond: () => boolean, fail: string) {
  h.mqttPublish(`${BASE}/${device}/set`, payload);
  const ok = await h.waitFor(cond, 1500, 20);
  h.expect(ok, fail);
}

export const remote: Practice = {
  id: 'm5-remote',
  module: 5,
  order: 3,
  kind: 'homework',
  title: 'Дистанционное управление',
  subtitle: 'Шаблоны топиков, команды и обратная связь',
  difficulty: 3,
  xp: 130,
  minutes: 50,
  tags: ['MQTT', 'wildcard +', 'сервопривод', 'LEDC', 'обратная связь'],
  story: `Дежурный в Мурманске хочет сам открывать ворота ангара и включать прожектор на вертолётной площадке,
не дожидаясь, пока ты проснёшься. Команды будут приходить по MQTT, а станция — докладывать, что всё сделано.
Правило центра: на каждое устройство — свой топик \`…/<устройство>/set\` для команд и \`…/<устройство>/state\`
для ответа.`,
  goals: [
    'Одной подпиской с шаблоном **`+`** получать команды всех устройств: `station/polar5/+/set`',
    '`station/polar5/door/set`: `open` → ворота (сервопривод, **GPIO18**) на 90°, `close` → на 0°; ответ в `station/polar5/door/state`: `open` / `closed`',
    '`station/polar5/light/set`: `on`, `off` или число **0–255** → яркость прожектора (светодиод, **GPIO25**) через LEDC; ответ в `station/polar5/light/state` — яркость числом',
    'Непонятные команды игнорировать (с сообщением в Serial), а свои же `…/state` не принимать за команды',
  ],
  theory: `### Шаблоны топиков

Топик — это путь из уровней через \`/\`. При подписке можно использовать шаблоны:

| Шаблон | Значит | Пример |
|---|---|---|
| \`+\` | ровно **один** любой уровень | \`station/+/temp\` ловит \`station/polar5/temp\`, но не \`station/polar5/in/temp\` |
| \`#\` | **сколько угодно** уровней, только в конце | \`station/polar5/#\` ловит всё о станции |

Подписка \`station/polar5/+/set\` получит \`door/set\` и \`light/set\` — и любое будущее устройство тоже.
А вот \`station/polar5/#\` поймает и ваши собственные \`…/state\` — плата начнёт получать свои же ответы.

### Какое устройство прислало команду?

\`\`\`cpp
void callback(char* topic, byte* payload, unsigned int length) {
  String t = topic;                                 // "station/polar5/door/set"
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  int end = t.lastIndexOf('/');                     // перед "set"
  int start = t.lastIndexOf('/', end - 1);          // перед "door"
  String device = t.substring(start + 1, end);      // "door"
}
\`\`\`

### Обратная связь

Команда могла потеряться, а устройство — не сработать. Поэтому после выполнения станция публикует
**фактическое** состояние, а пульт показывает именно его:

\`\`\`cpp
client.publish("station/polar5/door/state", "open", true);   // retain: новый пульт сразу узнает состояние
\`\`\`

### Число из строки

\`\`\`cpp
int level = msg.toInt();              // "128" → 128, "abc" → 0
level = constrain(level, 0, 255);
\`\`\``,
  hints: [
    'Подписка в `reconnect()`: `client.subscribe("station/polar5/+/set");`',
    'Устройство — предпоследний уровень топика: найдите два последних `/` через `lastIndexOf` и возьмите `substring` между ними.',
    'Ворота: `door.write(90)` / `door.write(0)` и `client.publish("station/polar5/door/state", "open")`.',
    'Свет: `ledcAttach(25, 5000, 8)` в `setup()`; `on` → 255, `off` → 0, иначе `msg.toInt()` (проверьте, что первая буква — цифра: `isDigit(msg[0])`); затем `ledcWrite(25, level)` и публикация `String(level)`.',
  ],
  starterCode: `#include <WiFi.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";

const int SERVO_PIN = 18;
const int LIGHT_PIN = 25;

WiFiClient espClient;
PubSubClient client(espClient);
Servo door;
String clientId;

void callback(char* topic, byte* payload, unsigned int length) {
  String t = topic;
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.println(t + " <- " + msg);
  // TODO: определить устройство (door / light) и выполнить команду
  // TODO: опубликовать новое состояние в station/polar5/<устройство>/state
}

void reconnect() {
  while (!client.connected()) {
    if (client.connect(clientId.c_str())) {
      // TODO: подписаться на команды всех устройств одним шаблоном
    } else {
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  door.attach(SERVO_PIN);
  door.write(0);
  // TODO: настроить ШИМ для LIGHT_PIN

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Wi-Fi есть");
  randomSeed(micros());
  clientId = "polar5-remote-" + String(random(0xffff), HEX);
  client.setServer("mqtt.iot", 1883);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `#include <WiFi.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";

const int SERVO_PIN = 18;
const int LIGHT_PIN = 25;

WiFiClient espClient;
PubSubClient client(espClient);
Servo door;
String clientId;

void publishState(String device, String state) {
  String topic = "station/polar5/" + device + "/state";
  client.publish(topic.c_str(), state.c_str(), true);
}

void handleDoor(String msg) {
  if (msg == "open") {
    door.write(90);
    publishState("door", "open");
  } else if (msg == "close") {
    door.write(0);
    publishState("door", "closed");
  } else {
    Serial.println("Ворота: непонятная команда " + msg);
  }
}

void handleLight(String msg) {
  int level;
  if (msg == "on") level = 255;
  else if (msg == "off") level = 0;
  else if (msg.length() > 0 && isDigit(msg[0])) level = constrain(msg.toInt(), 0, 255);
  else {
    Serial.println("Прожектор: непонятная команда " + msg);
    return;
  }
  ledcWrite(LIGHT_PIN, level);
  publishState("light", String(level));
}

void callback(char* topic, byte* payload, unsigned int length) {
  String t = topic;
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  msg.trim();
  msg.toLowerCase();
  Serial.println(t + " <- " + msg);

  if (!t.endsWith("/set")) return;
  int end = t.lastIndexOf('/');
  int start = t.lastIndexOf('/', end - 1);
  String device = t.substring(start + 1, end);

  if (device == "door") handleDoor(msg);
  else if (device == "light") handleLight(msg);
  else Serial.println("Неизвестное устройство: " + device);
}

void reconnect() {
  while (!client.connected()) {
    if (client.connect(clientId.c_str())) {
      client.subscribe("station/polar5/+/set");
      Serial.println("MQTT: жду команд");
    } else {
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  door.attach(SERVO_PIN);
  door.write(0);
  ledcAttach(LIGHT_PIN, 5000, 8);
  ledcWrite(LIGHT_PIN, 0);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Wi-Fi есть");
  randomSeed(micros());
  clientId = "polar5-remote-" + String(random(0xffff), HEX);
  client.setServer("mqtt.iot", 1883);
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
      id: 'subscribe',
      title: 'Одна подписка с шаблоном на команды всех устройств',
      run: async (h) => {
        const id = await start(h);
        const subs = [...(h.net.broker.clients.get(id)?.subs.keys() ?? [])];
        h.expect(subs.length > 0, 'Плата ни на что не подписана. В reconnect(): client.subscribe("station/polar5/+/set");');
        const covers = (topic: string) => subs.some((f) => topicMatches(f, topic));
        h.expect(covers(`${BASE}/door/set`) && covers(`${BASE}/light/set`), `Подписки ${subs.join(', ')} не ловят команды station/polar5/door/set и station/polar5/light/set`);
        h.expect(covers(`${BASE}/hatch/set`), `Подписка ${subs.join(', ')} не поймает новое устройство (например, station/polar5/hatch/set). Используйте шаблон +`);
        h.expect(!covers(`${BASE}/door/state`), `Подписка ${subs.join(', ')} ловит и ваши собственные ответы …/state. Сузьте её: station/polar5/+/set`);
      },
    },
    {
      id: 'door',
      title: 'Ворота: open → 90°, close → 0°, ответ в door/state',
      run: async (h) => {
        await start(h);
        await send(h, 'door', 'open', () => Math.abs(h.servoAngle('door') - 90) <= 8,
          `После «open» ворота стоят на ${Math.round(h.servoAngle('door'))}°, а нужно 90°`);
        await h.wait(300);
        h.expect(lastState(h, 'door') === 'open', `После открытия в ${BASE}/door/state должно прийти «open», а пришло ${JSON.stringify(lastState(h, 'door'))}`);
        await send(h, 'door', 'close', () => Math.abs(h.servoAngle('door')) <= 8,
          `После «close» ворота стоят на ${Math.round(h.servoAngle('door'))}°, а нужно 0°`);
        await h.wait(300);
        h.expect(lastState(h, 'door') === 'closed', `После закрытия в ${BASE}/door/state должно прийти «closed», а пришло ${JSON.stringify(lastState(h, 'door'))}`);
        const n = h.mqttLog(`${BASE}/door/state`).length;
        h.mqttPublish(`${BASE}/door/set`, 'banana');
        await h.wait(800);
        h.expect(Math.abs(h.servoAngle('door')) <= 8, 'Непонятная команда «banana» сдвинула ворота — такие команды надо игнорировать');
        h.expect(h.mqttLog(`${BASE}/door/state`).length === n, 'На непонятную команду плата опубликовала новое состояние ворот, хотя они не двигались');
      },
    },
    {
      id: 'light',
      title: 'Прожектор: on / off / яркость 0–255, ответ в light/state',
      run: async (h) => {
        await start(h);
        await send(h, 'light', 'on', () => h.led('light') > 0.15, 'После «on» прожектор (GPIO25) не загорелся');
        const full = h.led('light');
        await h.wait(300);
        h.expect(lastState(h, 'light') === '255', `После «on» в ${BASE}/light/state ожидалось 255, а пришло ${JSON.stringify(lastState(h, 'light'))}`);
        await send(h, 'light', '64', () => h.near(h.led('light') / full, 64 / 255, 0.06),
          `После «64» яркость ${Math.round((h.led('light') / full) * 100)}% от полной, а нужно около 25%. Используйте ledcWrite(LIGHT_PIN, level)`);
        await h.wait(300);
        h.expect(lastState(h, 'light') === '64', `После «64» в ${BASE}/light/state ожидалось 64, а пришло ${JSON.stringify(lastState(h, 'light'))}`);
        await send(h, 'light', 'off', () => h.led('light') < 0.01, 'После «off» прожектор не погас');
        await h.wait(300);
        h.expect(lastState(h, 'light') === '0', `После «off» в ${BASE}/light/state ожидалось 0, а пришло ${JSON.stringify(lastState(h, 'light'))}`);
        await send(h, 'light', '200', () => h.near(h.led('light') / full, 200 / 255, 0.06), 'Команда «200» не установила яркость 200 из 255');
        h.mqttPublish(`${BASE}/light/set`, 'дискотека');
        await h.wait(800);
        h.expect(h.near(h.led('light') / full, 200 / 255, 0.06), 'Непонятная команда «дискотека» изменила яркость — такие команды надо игнорировать');
      },
    },
  ],
};
