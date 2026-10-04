import type { Practice } from '../types';
import { bare, codeUses } from '../helpers';
import { weatherFor } from '@esp32lab/sim';
import { CHECK_DATE, needWifi } from './c-helpers';

const CITY = 'Murmansk';
const expected = () => weatherFor(CITY, CHECK_DATE);

const isWeatherReq = (url: string) => /^https?:\/\/(weather\.iot|goweather\.)/i.test(url) && /murmansk/i.test(decodeURIComponent(url));

export const weather: Practice = {
  id: 'm4-weather',
  module: 4,
  order: 2,
  kind: 'lab',
  title: 'Прогноз для вылета',
  subtitle: 'HTTP GET, REST API и разбор JSON',
  difficulty: 2,
  xp: 70,
  minutes: 30,
  tags: ['HTTP GET', 'REST API', 'JSON', 'ArduinoJson'],
  story: `Через три дня из Мурманска за пробами должен вылететь вертолёт. Пилот спрашивает по рации: «Какая
погода и что обещают на ближайшие дни?» Синоптика на станции нет — зато есть метеосервис **weather.iot**.
Научи плату запрашивать прогноз и печатать его так, чтобы пилот понял с первого взгляда.`,
  goals: [
    'Отправить HTTP GET-запрос на `http://weather.iot/api?city=Murmansk` и проверить код ответа (200 — успех)',
    'Разобрать ответ библиотекой **ArduinoJson**',
    'Напечатать текущую погоду: **температуру**, **влажность**, **ветер** и **описание** (`description`)',
    'Напечатать прогноз на 3 дня из массива `forecast` — **по строке на день**: день, температура, ветер',
  ],
  theory: `### Из чего состоит адрес REST API

\`\`\`
http://weather.iot/api?city=Murmansk
└┬─┘   └────┬────┘└┬─┘└──────┬────┘
протокол   хост   путь   параметры (ключ=значение, через &)
\`\`\`

**GET** — «дай мне данные». Ответ сервера — **код состояния** (200 — всё хорошо, 404 — не найдено,
500 — ошибка сервера) и **тело**, обычно в формате JSON.

### HTTP-запрос на ESP32

\`\`\`cpp
#include <HTTPClient.h>

HTTPClient http;
http.begin("http://weather.iot/api?city=Murmansk");
int code = http.GET();            // отправить запрос, дождаться ответа
if (code == 200) {
  String payload = http.getString();
  Serial.println(payload);
} else {
  Serial.printf("Ошибка HTTP: %d\\n", code);   // отрицательный код — нет связи
}
http.end();                       // освободить соединение
\`\`\`

### Что приходит в ответ

\`\`\`json
{
  "city": "Murmansk",
  "temp": -6,
  "humidity": 81,
  "wind": 7,
  "description": "Snow",
  "forecast": [
    { "day": "1", "temp": -5, "wind": 12 },
    { "day": "2", "temp": -8, "wind": 4 },
    { "day": "3", "temp": -2, "wind": 9 }
  ]
}
\`\`\`

JSON — это **объекты** \`{ "ключ": значение }\` и **массивы** \`[ ... ]\`, которые можно вкладывать друг в друга.

### Разбор JSON: ArduinoJson

\`\`\`cpp
#include <ArduinoJson.h>

DynamicJsonDocument doc(1024);           // в ArduinoJson 7 — просто JsonDocument doc;
DeserializationError err = deserializeJson(doc, payload);
if (err) {
  Serial.println(err.c_str());           // ответ — не JSON
  return;
}
int temp = doc["temp"];                  // число
const char* descr = doc["description"];  // строка
JsonArray forecast = doc["forecast"];    // массив
for (JsonObject day : forecast) {
  int t = day["temp"];
  Serial.println(t);
}
\`\`\`

### Формат из лекции (goweather)

На лекции мы брали погоду с \`goweather.herokuapp.com/weather/Moscow\` (в симуляторе — \`weather.iot/weather/Moscow\`).
Там числа приходят **строками с единицами измерения**:

\`\`\`json
{ "temperature": "+5 °C", "wind": "14 km/h", "description": "Sunny", "forecast": [ ... ] }
\`\`\`

Чтобы получить число, строку переводят функцией \`toInt()\` — она читает цифры с начала и останавливается на пробеле:

\`\`\`cpp
String t = doc["temperature"];   // "+5 °C"
int temp = t.toInt();            // 5
\`\`\`

Поэтому хорошие API отдают числа числами — как \`weather.iot/api\`.`,
  hints: [
    'Структура: `HTTPClient http; http.begin(url); int code = http.GET();` — и только при `code == 200` читаем `http.getString()`.',
    'Разбор: `DynamicJsonDocument doc(1024); deserializeJson(doc, payload);` затем `int temp = doc["temp"];`',
    'Описание — строка: `const char* descr = doc["description"];`. Массив прогноза: `JsonArray forecast = doc["forecast"];`',
    'Прогноз: `for (JsonObject day : forecast) { Serial.printf("День %s: %d °C, ветер %d км/ч\\n", (const char*)day["day"], (int)day["temp"], (int)day["wind"]); }`',
  ],
  starterCode: `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";
const char* url = "http://weather.iot/api?city=Murmansk";

void showWeather() {
  // TODO: отправьте GET-запрос на url и проверьте код ответа

  // TODO: разберите JSON и напечатайте текущую погоду:
  //       температура, влажность, ветер, описание

  // TODO: напечатайте прогноз из массива "forecast" — по строке на день
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  Serial.print("Подключаюсь к Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" готово!");
  showWeather();
}

void loop() {
}
`,
  starterCircuit: bare(),
  circuitLocked: true,
  solution: {
    code: `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";
const char* url = "http://weather.iot/api?city=Murmansk";

void showWeather() {
  HTTPClient http;
  http.begin(url);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("Ошибка HTTP: %d\\n", code);
    http.end();
    return;
  }
  String payload = http.getString();
  http.end();

  DynamicJsonDocument doc(1024);
  DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    Serial.print("Не удалось разобрать JSON: ");
    Serial.println(err.c_str());
    return;
  }

  const char* city = doc["city"];
  int temp = doc["temp"];
  int humidity = doc["humidity"];
  int wind = doc["wind"];
  const char* descr = doc["description"];

  Serial.println("===== ПОГОДА =====");
  Serial.printf("Город: %s\\n", city);
  Serial.printf("Сейчас: %d °C, %s\\n", temp, descr);
  Serial.printf("Влажность: %d %%\\n", humidity);
  Serial.printf("Ветер: %d км/ч\\n", wind);
  Serial.println("Прогноз:");
  JsonArray forecast = doc["forecast"];
  for (JsonObject day : forecast) {
    const char* d = day["day"];
    int t = day["temp"];
    int w = day["wind"];
    Serial.printf("  День %s: %d °C, ветер %d км/ч\\n", d, t, w);
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  Serial.print("Подключаюсь к Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" готово!");
  showWeather();
}

void loop() {
}
`,
  },
  checks: [
    {
      id: 'request',
      title: 'GET-запрос к weather.iot отправлен',
      run: async (h) => {
        await needWifi(h);
        await h.wait(3000);
        const reqs = h.requests.filter((r) => isWeatherReq(r.url));
        if (!reqs.length) {
          const other = h.requests[0]?.url;
          h.fail(other ? `Запрос ушёл на ${other}, а нужен http://weather.iot/api?city=Murmansk` : 'Плата не отправила ни одного HTTP-запроса. Нужны http.begin(url) и http.GET()');
        }
        h.expect(reqs[0].method === 'GET', `Запрос отправлен методом ${reqs[0].method}, а для получения данных нужен GET`);
      },
    },
    {
      id: 'current',
      title: 'Текущая погода напечатана верно',
      run: async (h) => {
        await needWifi(h);
        await h.wait(3000);
        const w = expected();
        const nums = h.numbers();
        h.expect(nums.includes(w.temp), `Сервис сообщает температуру ${w.temp} °C, а в Serial её нет. Прочитайте int temp = doc["temp"];`);
        h.expect(nums.includes(w.humidity), `Влажность ${w.humidity} % не напечатана. Поле называется "humidity"`);
        h.expect(nums.includes(w.wind), `Ветер ${w.wind} км/ч не напечатан. Поле называется "wind"`);
        h.expect(h.serial.includes(w.description) || h.serial.includes(w.description_ru), `Не напечатано описание погоды («${w.description}»). Поле "description" — строка: const char* descr = doc["description"];`);
        h.expect(codeUses(h, /deserializeJson\s*\(/), 'Разбирайте ответ через deserializeJson(), а не поиском по строке');
      },
    },
    {
      id: 'forecast',
      title: 'Прогноз на 3 дня — по строке на день',
      run: async (h) => {
        await needWifi(h);
        await h.wait(3000);
        const w = expected();
        const lines = h.serialLines();
        const used = new Set<number>();
        w.forecast.forEach((f, i) => {
          const idx = lines.findIndex((l, j) => {
            if (used.has(j)) return false;
            const n = h.numbers(l);
            return n.includes(f.temp) && n.includes(f.wind);
          });
          h.expect(idx >= 0, `Не найдена строка прогноза на день ${i + 1}: ожидалось ${f.temp} °C и ветер ${f.wind} км/ч в одной строке. Пройдите циклом по массиву doc["forecast"]`);
          used.add(idx);
        });
      },
    },
  ],
};
