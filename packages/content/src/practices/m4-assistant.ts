import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';
import { weatherFor } from '@esp32lab/sim';
import { CHECK_DATE, botReplies, needWifi, say } from './c-helpers';
import type { CheckContext } from '@esp32lab/sim';

const ROOM = 'polar';

const parts = () => [
  p('r1', 'resistor', 260, -30, { value: 220 }),
  p('light', 'led', 330, -30, { color: 'yellow' }),
  p('rR', 'resistor', 400, -90, { value: 220 }),
  p('rG', 'resistor', 400, -115, { value: 220 }),
  p('rB', 'resistor', 400, -140, { value: 220 }),
  p('rgb', 'rgb', 470, -30),
  p('relay', 'relay', 300, 130),
  p('fan', 'motor', 450, 130),
];

const wires = () => [
  // свет: D25 → 220 Ом → светодиод → GND
  w('esp:D25', 'r1:1', 'yellow'),
  w('r1:2', 'light:A', 'yellow'),
  w('light:C', 'esp:GND.1', 'black'),
  // RGB: D27 / D33 / D32 через резисторы, общий катод → GND
  w('esp:D27', 'rR:1', 'red'),
  w('rR:2', 'rgb:R', 'red'),
  w('esp:D33', 'rG:1', 'green'),
  w('rG:2', 'rgb:G', 'green'),
  w('esp:D32', 'rB:1', 'blue'),
  w('rB:2', 'rgb:B', 'blue'),
  w('rgb:COM', 'esp:GND.1', 'black'),
  // вентилятор через реле: питание реле от VIN, нагрузка VIN → COM → NO → мотор → GND
  w('esp:VIN', 'relay:VCC', 'red'),
  w('esp:GND.2', 'relay:GND', 'black'),
  w('esp:D26', 'relay:IN', 'orange'),
  w('esp:VIN', 'relay:COM', 'red'),
  w('relay:NO', 'fan:1', 'red'),
  w('fan:2', 'esp:GND.2', 'black'),
];

const isPoll = (url: string) => /chat\.iot\/(get_messages|messages)/.test(url);

/** Дождаться Wi-Fi и первого опроса чата. */
async function ready(h: CheckContext) {
  await needWifi(h);
  const polled = await h.waitFor(() => h.requests.some((r) => isPoll(r.url)), 8000, 50);
  h.expect(polled, 'Плата не опрашивает чат: нужен GET-запрос http://chat.iot/get_messages?chat_name=polar&after_id=N');
  await h.wait(300);
}

/** Отправить команду и дождаться условия. */
async function command(h: CheckContext, text: string, cond: () => boolean, fail: string, limit = 5000) {
  say(h, ROOM, text);
  const ok = await h.waitFor(cond, limit, 50);
  h.expect(ok, fail);
}

const fanOn = (h: CheckContext) => h.relayOn('relay') && h.loadLevel('fan') > 0.5;

export const assistant: Practice = {
  id: 'm4-assistant',
  module: 4,
  order: 3,
  kind: 'case',
  title: 'Умный помощник',
  subtitle: 'Чат-бот, который управляет станцией',
  difficulty: 3,
  xp: 200,
  minutes: 60,
  tags: ['HTTP', 'JSON', 'REST API', 'чат-бот', 'реле', 'ШИМ'],
  story: `Начальник станции диктует в рацию с метеоплощадки: «Включи свет в лаборатории!» — и ты бежишь к
щитку. Хватит бегать. На станции есть общий чат **polar** (сервис \`chat.iot\`), и до него дотягивается любой
телефон. Сделай из ESP32 умного помощника: пусть он читает чат, понимает команды по-русски, сам щёлкает реле
и отвечает, что всё сделано.`,
  goals: [
    'Каждые ~2 с запрашивать новые сообщения: `GET http://chat.iot/get_messages?chat_name=polar&after_id=N`, запоминая `id` последнего — каждая команда выполняется **ровно один раз**',
    'Понимать команды без учёта регистра: «Включи свет» / «Выключи свет» (светодиод **GPIO25**), «Включи вентилятор» / «Выключи вентилятор» (реле на **GPIO26**)',
    'Отвечать в чат от имени `esp32` через `/send_message` («Свет включён» и т.п.), свои сообщения не обрабатывать, на непонятную команду — вежливо ответить, что не понял',
    '**Бонус:** «Зажги красный / зелёный / синий» (RGB: GPIO27, 33, 32), «Уменьши яркость» (ШИМ на свету), «Погода» → ответ с температурой из `weather.iot/api?city=Murmansk`',
  ],
  theory: `### Как бот узнаёт о новых сообщениях

Сервер чата не может сам «позвонить» плате — HTTP работает по схеме **запрос → ответ**. Поэтому плата
**опрашивает** (polling) сервер раз в пару секунд: «есть что-нибудь новое после сообщения N?»

\`\`\`
GET http://chat.iot/get_messages?chat_name=polar&after_id=12
\`\`\`

\`\`\`json
{
  "chat_name": "polar",
  "messages": [
    { "id": 13, "sender": "captain", "content": "Включи свет", "time": "..." }
  ],
  "last_id": 13
}
\`\`\`

Запоминайте \`id\` последнего обработанного сообщения и в следующий раз просите только то, что после него.
Иначе бот будет выполнять одну и ту же команду снова и снова.

\`\`\`cpp
int lastId = 0;

void checkChat() {
  HTTPClient http;
  http.begin("http://chat.iot/get_messages?chat_name=polar&after_id=" + String(lastId));
  int code = http.GET();
  if (code == 200) {
    DynamicJsonDocument doc(4096);
    deserializeJson(doc, http.getString());
    JsonArray messages = doc["messages"];
    for (JsonObject m : messages) {
      lastId = m["id"];
      String sender = m["sender"].as<String>();
      String text = m["content"].as<String>();
      // ... обработать text
    }
  }
  http.end();
}
\`\`\`

> 💡 Бот видит в чате и **свои собственные** ответы. Пропускайте сообщения, где \`sender == "esp32"\`,
> иначе он начнёт разговаривать сам с собой.

### Ответ в чат

Отправить сообщение можно GET-запросом \`/send_message?chat_name=…&sender=…&content=…\`, но русский текст
и пробелы в адресе пришлось бы кодировать (\`%D0%A1…\`). Проще отправить те же поля **POST-запросом в JSON** —
готовая функция \`sendMessage()\` уже есть в заготовке.

### Понимаем команды

Пользователь может написать «Включи свет», «включи свет» или «ВКЛЮЧИ СВЕТ». Приводим текст к нижнему регистру
и ищем подстроку:

\`\`\`cpp
String cmd = lowerRu(text);                 // «включи свет»
if (cmd.indexOf("выключи свет") >= 0) { ... }
else if (cmd.indexOf("включи свет") >= 0) { ... }
\`\`\`

> ⚠️ На настоящей плате \`String::toLowerCase()\` понимает только латиницу — русские буквы в UTF-8 занимают
> по два байта. Поэтому в заготовке есть функция \`lowerRu()\`, которая заменяет заглавные русские буквы вручную.

Порядок проверок важен: «в**ы**ключи свет» не содержит «включи свет», но если искать просто «свет» —
обе команды перепутаются.

### Яркость — ШИМ

\`\`\`cpp
ledcAttach(25, 5000, 8);   // вывод, частота, 8 бит → 0…255 (ядро 3.x)
ledcWrite(25, 128);        // половина яркости
\`\`\`

### Вентилятор через реле

Мотор вентилятора потребляет сотни миллиампер — вывод GPIO такое не потянет. На схеме он подключён через
реле от **VIN** (5 В): \`digitalWrite(26, HIGH)\` замыкает контакты COM–NO, и вентилятор крутится.`,
  hints: [
    'В `loop()`: `if (millis() - lastPoll >= 2000) { lastPoll = millis(); checkChat(); }` — без длинных `delay()`.',
    'В `checkChat()` обновляйте `lastId = m["id"];` для каждого сообщения, а `continue` для `sender == "esp32"`.',
    'Команды: `String cmd = lowerRu(text);` и цепочка `if (cmd.indexOf("выключи свет") >= 0) … else if (cmd.indexOf("включи свет") >= 0) …` — «выключи» проверяйте первым.',
    'Свет через ШИМ: в `setup()` — `ledcAttach(LIGHT_PIN, 5000, 8);`, включить — `ledcWrite(LIGHT_PIN, brightness);`, выключить — `ledcWrite(LIGHT_PIN, 0);`. Погода: GET `weather.iot/api?city=Murmansk`, `int t = doc["temp"];` и `sendMessage("Сейчас " + String(t) + " °C");`',
  ],
  starterCode: `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";
const String CHAT = "http://chat.iot";
const String ROOM = "polar";

const int LIGHT_PIN = 25;   // свет в лаборатории (ШИМ)
const int FAN_PIN = 26;     // реле вентилятора
const int R_PIN = 27, G_PIN = 33, B_PIN = 32;   // RGB-индикатор

int lastId = 0;             // id последнего обработанного сообщения
unsigned long lastPoll = 0;

// Перевести строку в нижний регистр, включая русские буквы
String lowerRu(String s) {
  const char* UP[] = {"А","Б","В","Г","Д","Е","Ё","Ж","З","И","Й","К","Л","М","Н","О","П",
                      "Р","С","Т","У","Ф","Х","Ц","Ч","Ш","Щ","Ъ","Ы","Ь","Э","Ю","Я"};
  const char* LO[] = {"а","б","в","г","д","е","ё","ж","з","и","й","к","л","м","н","о","п",
                      "р","с","т","у","ф","х","ц","ч","ш","щ","ъ","ы","ь","э","ю","я"};
  s.toLowerCase();
  for (int i = 0; i < 33; i++) s.replace(UP[i], LO[i]);
  return s;
}

// Отправить сообщение в чат от имени esp32
void sendMessage(String text) {
  HTTPClient http;
  http.begin(CHAT + "/send_message");
  http.addHeader("Content-Type", "application/json");
  DynamicJsonDocument doc(512);
  doc["chat_name"] = ROOM;
  doc["sender"] = "esp32";
  doc["content"] = text;
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  if (code != 200) Serial.printf("Не удалось отправить ответ: %d\\n", code);
  http.end();
}

void handleCommand(String text) {
  String cmd = lowerRu(text);
  // TODO: «включи свет» / «выключи свет», «включи вентилятор» / «выключи вентилятор»
  // TODO: ответить в чат через sendMessage(...)
  // TODO (бонус): цвета RGB, «уменьши яркость», «погода»
}

void checkChat() {
  // TODO: GET CHAT + "/get_messages?chat_name=" + ROOM + "&after_id=" + String(lastId)
  // TODO: разобрать JSON, для каждого сообщения обновить lastId,
  //       пропустить свои (sender == "esp32"), остальные передать в handleCommand()
}

void setup() {
  Serial.begin(115200);
  pinMode(FAN_PIN, OUTPUT);
  pinMode(R_PIN, OUTPUT);
  pinMode(G_PIN, OUTPUT);
  pinMode(B_PIN, OUTPUT);
  // TODO: настройте ШИМ для LIGHT_PIN

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.println("Помощник на связи!");
}

void loop() {
  // TODO: раз в 2 секунды вызывать checkChat()
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";
const String CHAT = "http://chat.iot";
const String ROOM = "polar";

const int LIGHT_PIN = 25;
const int FAN_PIN = 26;
const int R_PIN = 27, G_PIN = 33, B_PIN = 32;

int lastId = 0;
unsigned long lastPoll = 0;
bool lightOn = false;
int brightness = 255;

String lowerRu(String s) {
  const char* UP[] = {"А","Б","В","Г","Д","Е","Ё","Ж","З","И","Й","К","Л","М","Н","О","П",
                      "Р","С","Т","У","Ф","Х","Ц","Ч","Ш","Щ","Ъ","Ы","Ь","Э","Ю","Я"};
  const char* LO[] = {"а","б","в","г","д","е","ё","ж","з","и","й","к","л","м","н","о","п",
                      "р","с","т","у","ф","х","ц","ч","ш","щ","ъ","ы","ь","э","ю","я"};
  s.toLowerCase();
  for (int i = 0; i < 33; i++) s.replace(UP[i], LO[i]);
  return s;
}

void sendMessage(String text) {
  HTTPClient http;
  http.begin(CHAT + "/send_message");
  http.addHeader("Content-Type", "application/json");
  DynamicJsonDocument doc(512);
  doc["chat_name"] = ROOM;
  doc["sender"] = "esp32";
  doc["content"] = text;
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  if (code != 200) Serial.printf("Не удалось отправить ответ: %d\\n", code);
  http.end();
}

void applyLight() {
  ledcWrite(LIGHT_PIN, lightOn ? brightness : 0);
}

void setRgb(bool r, bool g, bool b) {
  digitalWrite(R_PIN, r);
  digitalWrite(G_PIN, g);
  digitalWrite(B_PIN, b);
}

String weatherReport() {
  HTTPClient http;
  http.begin("http://weather.iot/api?city=Murmansk");
  int code = http.GET();
  if (code != 200) {
    http.end();
    return "Метеосервис недоступен (код " + String(code) + ")";
  }
  DynamicJsonDocument doc(1024);
  deserializeJson(doc, http.getString());
  http.end();
  int temp = doc["temp"];
  int wind = doc["wind"];
  String descr = doc["description"].as<String>();
  return "Мурманск: " + String(temp) + " °C, " + descr + ", ветер " + String(wind) + " км/ч";
}

void handleCommand(String text) {
  String cmd = lowerRu(text);
  if (cmd.indexOf("выключи свет") >= 0) {
    lightOn = false;
    applyLight();
    sendMessage("Свет выключен");
  } else if (cmd.indexOf("включи свет") >= 0) {
    lightOn = true;
    applyLight();
    sendMessage("Свет включён");
  } else if (cmd.indexOf("выключи вентилятор") >= 0) {
    digitalWrite(FAN_PIN, LOW);
    sendMessage("Вентилятор выключен");
  } else if (cmd.indexOf("включи вентилятор") >= 0) {
    digitalWrite(FAN_PIN, HIGH);
    sendMessage("Вентилятор включён");
  } else if (cmd.indexOf("красн") >= 0) {
    setRgb(1, 0, 0);
    sendMessage("Индикатор: красный");
  } else if (cmd.indexOf("зелён") >= 0 || cmd.indexOf("зелен") >= 0) {
    setRgb(0, 1, 0);
    sendMessage("Индикатор: зелёный");
  } else if (cmd.indexOf("синий") >= 0) {
    setRgb(0, 0, 1);
    sendMessage("Индикатор: синий");
  } else if (cmd.indexOf("уменьши яркость") >= 0) {
    brightness = max(brightness / 2, 16);
    applyLight();
    sendMessage("Яркость: " + String(brightness * 100 / 255) + "%");
  } else if (cmd.indexOf("увеличь яркость") >= 0) {
    brightness = min(brightness * 2, 255);
    applyLight();
    sendMessage("Яркость: " + String(brightness * 100 / 255) + "%");
  } else if (cmd.indexOf("погода") >= 0) {
    sendMessage(weatherReport());
  } else {
    sendMessage("Не понимаю команду «" + text + "». Я умею: включи/выключи свет, включи/выключи вентилятор, зажги красный/зелёный/синий, уменьши яркость, погода");
  }
}

// Получить новые сообщения. execute = false — только запомнить last_id (при старте)
void checkChat(bool execute) {
  HTTPClient http;
  http.begin(CHAT + "/get_messages?chat_name=" + ROOM + "&after_id=" + String(lastId));
  int code = http.GET();
  if (code != 200) {
    Serial.printf("Чат недоступен, код %d\\n", code);
    http.end();
    return;
  }
  String payload = http.getString();
  http.end();

  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, payload)) {
    Serial.println("Чат прислал не JSON");
    return;
  }
  JsonArray messages = doc["messages"];
  for (JsonObject m : messages) {
    int id = m["id"];
    if (id > lastId) lastId = id;
    String sender = m["sender"].as<String>();
    String text = m["content"].as<String>();
    if (!execute || sender == "esp32") continue;
    Serial.println(sender + ": " + text);
    handleCommand(text);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(FAN_PIN, OUTPUT);
  pinMode(R_PIN, OUTPUT);
  pinMode(G_PIN, OUTPUT);
  pinMode(B_PIN, OUTPUT);
  ledcAttach(LIGHT_PIN, 5000, 8);
  applyLight();

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.println("Помощник на связи!");
  checkChat(false);   // старые сообщения не выполняем
  sendMessage("Помощник станции на связи. Напишите «Включи свет»");
}

void loop() {
  if (millis() - lastPoll >= 2000) {
    lastPoll = millis();
    checkChat(true);
  }
}
`,
  },
  checks: [
    {
      id: 'light',
      title: 'Опрос чата каждые ~2 с и команды «Включи / Выключи свет»',
      run: async (h) => {
        await ready(h);
        const before = h.requests.filter((r) => isPoll(r.url)).length;
        await h.wait(10000);
        const polls = h.requests.filter((r) => isPoll(r.url)).length - before;
        h.expect(polls >= 3, `За 10 с плата опросила чат ${polls} раз — опрашивайте каждые ~2 с`);
        h.expect(polls <= 12, `За 10 с плата опросила чат ${polls} раз — слишком часто, сервер будет недоволен. Достаточно раза в 2 с`);
        await command(h, 'Включи свет', () => h.ledOn('light'), 'Через 5 с после «Включи свет» свет (GPIO25) не загорелся');
        await command(h, 'ВЫКЛЮЧИ СВЕТ', () => !h.ledOn('light'), 'На «ВЫКЛЮЧИ СВЕТ» свет не погас. Команды надо понимать без учёта регистра — используйте lowerRu()');
        await command(h, 'включи свет', () => h.ledOn('light'), 'На «включи свет» (строчными) свет не загорелся');
      },
    },
    {
      id: 'fan',
      title: 'Команды «Включи / Выключи вентилятор» через реле',
      run: async (h) => {
        await ready(h);
        h.expect(!fanOn(h), 'Вентилятор крутится сразу после запуска — до команды он должен быть выключен');
        await command(h, 'Включи вентилятор', () => fanOn(h), 'Через 5 с после «Включи вентилятор» реле (GPIO26) не включилось');
        h.expect(!h.ledOn('light'), 'По команде про вентилятор включился свет. Проверяйте, о каком устройстве речь');
        await command(h, 'Выключи вентилятор', () => !h.relayOn('relay'), 'На «Выключи вентилятор» реле не отключилось. «Выключи» проверяйте раньше, чем «включи»');
      },
    },
    {
      id: 'reply',
      title: 'Ответы в чат: один раз на команду, без разговора с самим собой',
      run: async (h) => {
        await ready(h);
        const id = say(h, ROOM, 'Включи свет');
        const answered = await h.waitFor(() => botReplies(h, ROOM, id).length > 0, 5000, 50);
        h.expect(answered, 'Плата не ответила в чат. Используйте sendMessage("Свет включён") — отправитель должен быть esp32');
        await h.wait(7000);
        const n = botReplies(h, ROOM, id).length;
        h.expect(n === 1, `На одну команду бот ответил ${n} раз(а). Запоминайте lastId и пропускайте свои сообщения (sender == "esp32")`);
        const id2 = say(h, ROOM, 'Свари кофе, пожалуйста');
        const polite = await h.waitFor(() => botReplies(h, ROOM, id2).length > 0, 5000, 50);
        h.expect(polite, 'На непонятную команду «Свари кофе» бот промолчал — ответьте, что команда не распознана');
        await command(h, 'Включи вентилятор', () => fanOn(h), 'После непонятной команды бот перестал выполнять «Включи вентилятор»');
      },
    },
    {
      id: 'rgb',
      title: 'Бонус: цвета индикатора и «Уменьши яркость»',
      run: async (h) => {
        await ready(h);
        const only = (k: number) => () => {
          const c = h.rgb('rgb');
          return c[k] > 0.3 && c.every((v, i) => i === k || v < 0.05);
        };
        await command(h, 'Зажги красный', only(0), 'На «Зажги красный» RGB-индикатор не стал красным (GPIO27 — красный канал, остальные выключить)');
        await command(h, 'Зажги зелёный', only(1), 'На «Зажги зелёный» индикатор не стал зелёным (GPIO33). Учтите, что могут написать и «зеленый» без ё');
        await command(h, 'зажги синий', only(2), 'На «зажги синий» индикатор не стал синим (GPIO32)');
        await command(h, 'Включи свет', () => h.ledOn('light'), 'Свет не включился по команде «Включи свет»');
        await h.wait(300);
        const full = h.led('light');
        await command(h, 'Уменьши яркость', () => h.led('light') > 0.02 && h.led('light') < full * 0.85,
          `После «Уменьши яркость» яркость не уменьшилась (была ${Math.round(full * 100)}%). Управляйте светом через ШИМ: ledcWrite(LIGHT_PIN, brightness)`);
      },
    },
    {
      id: 'weather',
      title: 'Бонус: команда «Погода» — ответ с температурой из weather.iot',
      run: async (h) => {
        await ready(h);
        const t = weatherFor('Murmansk', CHECK_DATE).temp;
        const id = say(h, ROOM, 'Погода');
        const ok = await h.waitFor(() => botReplies(h, ROOM, id).length > 0, 6000, 50);
        h.expect(ok, 'На «Погода» бот не ответил');
        h.expect(h.requests.some((r) => /weather\.iot|goweather/.test(r.url)), 'Бот не обращался к метеосервису: GET http://weather.iot/api?city=Murmansk');
        const text = botReplies(h, ROOM, id).map((m) => m.content).join(' ');
        h.expect(h.numbers(text).includes(t), `В ответе «${text.slice(0, 80)}» нет текущей температуры в Мурманске (${t} °C)`);
      },
    },
  ],
};
