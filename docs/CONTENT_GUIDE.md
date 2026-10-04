# Руководство автора практик ESP32 Lab

Практики — TypeScript-объекты `Practice` (см. `packages/content/src/types.ts`). Каждая практика — отдельный файл
`packages/content/src/practices/<id>.ts`, зарегистрированный в одном из реестров:

* `part-a.ts` — модули 1–2 (лекции 1–2);
* `part-b.ts` — модуль 3 (лекция 3);
* `part-c.ts` — модули 4–6 (лекции 4–5 и итоговый проект).

Образцы стиля и качества: **`m1-blink.ts`** (только код, схема заблокирована) и **`m1-button.ts`**
(студент сам собирает схему, проверки смотрят провода). Повторяйте их структуру.

## Сюжет

Студент — младший инженер на арктической станции «Полярная-5» после шторма (см. `modules.ts`). Каждая практика —
маленький эпизод: что сломалось и зачем это станции. Пишите живо, по-русски, на «ты», 2–4 предложения.
Без штампов и канцелярита.

## Требования к практике

1. `id` вида `m<модуль>-<слово>`, `order` уникален внутри модуля.
2. `kind`: `lab` — лабораторная по лекции (проще, больше теории); `homework` — домашка (сложнее, интереснее,
   меньше подсказок, выходит за рамки лекции); `case` — большой кейс из лекции; `quiz` — тест.
3. `goals` — 3–5 конкретных пунктов (markdown), из них должны следовать проверки.
4. `theory` (markdown, ```cpp блоки) — объясняет ровно то, что нужно, с примером кода. Для homework короче.
5. `hints` — 3–4 подсказки от общей к почти-решению.
6. `starterCode` **компилируется** и содержит `// TODO`, но проверки **не проходит**.
7. `solution.code` (+ `solution.circuit`, если студент собирает схему) **проходит все проверки**.
8. `checks` — 2–5 проверок. Сообщения об ошибках — конкретные и полезные: что ожидалось, что получилось, что сделать.
   Проверки не должны зависеть от несущественных деталей (точного текста, если не требуется; порядка
   строк кода; имён переменных). Допуски по времени — разумные (±5–10 %).
9. `xp`: lab 50–80, homework 90–130, case 150–250, quiz 40.
10. `minutes`: реалистичная оценка.
11. Для задач «только код» — готовая схема в `starterCircuit` и `circuitLocked: true`.
    Для задач на сборку — компоненты стоят на схеме без проводов (`p(...)`, `locked: true` не даёт их удалить,
    но двигать и подключать можно), `palette` ограничивает палитру, проверки смотрят соединения (`gpioNear`,
    `onGnd`, `onNet`, `checkLedWiring`).
12. Квиз: 6–8 вопросов `QuizQuestion` (варианты, `correct` — индексы, `explain` — пояснение), `passScore` 0.7.
    Вопросы — на понимание, а не на запоминание; можно с кодом (`code`).

## Схемы

```ts
import { circuit, p, w, bare } from '../helpers';
circuit([
  p('led1', 'led', 330, -40, { color: 'green' }),     // id, тип, x, y, свойства, поворот
  p('r1', 'resistor', 300, 150, { value: 220 }),
], [
  w('esp:D25', 'r1:1', 'green'),                      // провод «компонент:вывод» → «компонент:вывод», цвет
  w('r1:2', 'led1:A'), w('led1:C', 'esp:GND.1', 'black'),
]);
```

Плата `esp` стоит в (0,0), размер 220×100. Выводы — `packages/sim/src/circuit/defs.ts`:
* верхний ряд (y=10, x=40…180): `VIN, GND.1, D13, D12, D14, D27, D26, D25, D33, D32, D35, D34, VN(36), VP(39), EN`
* нижний ряд (y=90): `3V3, GND.2, D15, D2, D4, RX2(16), TX2(17), D5, D18, D19, D21, RX0, TX0, D22, D23`

Координаты компонента — положение его первого вывода; у большинства выводы снизу, а корпус над ними.
Ставьте компоненты над платой (y = −40…−200) и справа (x = 260…700), не налезая друг на друга (рамки — поле `box`
в `defs.ts`). Провода рисуются прямыми ломаными; можно не задавать `pts`.

Компоненты и выводы: `led (C, A)`, `resistor (1, 2)`, `button (1, 2)`, `switch (1, C, 2)`, `pot (GND, SIG, VCC)`,
`ldr (1, 2)`, `rgb (R, COM, G, B)`, `buzzer (PLUS, MINUS)`, `relay (VCC, GND, IN, NO, COM, NC)`, `motor (1, 2)`,
`lamp (1, 2)`, `lock (1, 2)`, `servo (GND, V+, PWM)`, `dht22 (VCC, DATA, NC, GND)`, `hcsr04 (VCC, TRIG, ECHO, GND)`,
`pir (VCC, OUT, GND)`, `mq2 (VCC, GND, DO, AO)`, `lcd1602 (GND, VCC, SDA, SCL)`, `oled (GND, VCC, SCL, SDA)`,
`neopixel (VCC, GND, DIN, DOUT)`, `logic (D0…D7, GND)`, `uartbox (VCC, GND, TX, RX)`, `i2cbox (VCC, GND, SDA, SCL)`,
`breadboard`. Свойства и значения по умолчанию — в `defs.ts`.

Электрика моделируется по-настоящему: светодиоду нужен резистор (без него ток > 25 мА — предупреждение, от 5 В —
сгорит), модулям нужно питание (HC-SR04, реле, сервопривод — от `VIN` 5 В; DHT22, OLED — от `3V3`), нагрузку
(мотор, лампа, замок) подключают через реле: `VIN → COM`, `NO → нагрузка → GND`. Вход без подтяжки «висит».
Кнопка обычно: `GPIO ↔ кнопка ↔ 3V3` с `INPUT_PULLDOWN`, или `GPIO ↔ кнопка ↔ GND` с `INPUT_PULLUP`.

## Что умеет симулятор

Язык: почти весь «ардуиновский» C++ — типы, массивы, struct/class, enum, лямбды, ссылки, String, `sprintf`, `#define`.
Нет шаблонов, указательной арифметики, `std::vector`.
Библиотеки: `Serial/Serial1/Serial2`, `WiFi`, `HTTPClient`, `WebServer`, `PubSubClient`, `ArduinoJson` (v6 и v7),
`DHT`, `ESP32Servo`, `LiquidCrystal_I2C`, `Adafruit_SSD1306`+GFX, `Adafruit_NeoPixel`, `Preferences`, `Wire`, `SPI`,
`Ticker`, LEDC (`ledcSetup/ledcAttachPin/ledcWrite` ядра 2.x и `ledcAttach` 3.x), `analogWrite`, `tone`,
аппаратные таймеры (`timerBegin…`), прерывания, FreeRTOS (задачи, очереди, семафоры, уведомления), регистры
`GPIO.out_w1ts`, `REG_WRITE`. Полный список — `packages/sim/src/lang/api.ts`.

Сеть (в проверках всё работает без интернета):
* Wi-Fi: `Samsung_IoT / IOT5iot5`, `Polar-Station / aurora2025`, `Wokwi-GUEST` (открытая) и др. (`net/types.ts`).
  Подключение занимает ~1–2 с виртуального времени.
* HTTP-сервисы (`packages/sim/src/net/services.ts`): `weather.iot/api?city=X` (числа),
  `weather.iot/weather/X` и `goweather.herokuapp.com/weather/X` (формат из лекции), `chat.iot/send_message?chat_name=&sender=&content=`,
  `chat.iot/get_messages?chat_name=&after_id=`, `time.iot/now`, `facts.iot`, `api.iot/echo`,
  `station.iot/telemetry` (POST JSON, нужно числовое поле `temperature`), `station.iot/mission`.
  В проверках дата фиксирована: 2025-10-15 09:00 UTC + виртуальное время, поэтому `weatherFor(city, date)` детерминирован.
* MQTT: брокер в памяти, любой хост (рекомендуемый — `mqtt.iot`, порт 1883). Буфер PubSubClient — 256 байт.

## API проверок (`CheckContext h`, `packages/sim/src/harness.ts`)

Каждая проверка запускается на **свежей** симуляции (с нуля). Время — в мс виртуального времени.

* Время: `await h.wait(ms)`, `await h.until(ms)`, `await h.waitFor(() => cond, limitMs)`, `h.now`.
* Serial: `h.serial`, `h.serialLines()`, `h.mark()` + `h.serialSince(mark)`, `h.numbers(text?)`, `h.send('текст\n')`.
* Выводы: `h.gpio(pin)` → `{ mode, out, isOutput, pwm: {freq,duty}|null, level, voltage }`,
  `h.history(pin, from, to)`, `h.period(pin, from, to)`, `h.dutyOver(pin, from, to)`, `h.toggles(...)`.
* Компоненты: `h.part(id)`, `h.model(id)`, `h.find(type, filter)`, `h.findOne(type, filter, 'описание')`,
  `h.led(id)` (яркость 0…1), `h.ledOn(id)`, `h.rgb(id)`, `await h.press(id, holdMs)`, `h.hold(id, true/false)`,
  `h.set(id, 'temperature', 30)`, `h.motion(pirId)`, `h.servoAngle(id)`, `h.relayOn(id)`, `h.lcd(id)` (строки),
  `h.buzzerFreq(id)`, `h.loadLevel(id)` (мотор/лампа/замок 0…1), `h.neo(id)`, `h.oledPixels(id)`.
* Соединения: `h.gpioAt(partId, pin)`, `h.gpioNear(partId, pin)` (через 1 резистор), `h.onGnd(partId, pin, viaResistor?)`,
  `h.onNet(partId, pin, '3V3'|'VIN'|'GND')`.
* Сеть: `h.requests` (HTTP-запросы), `h.chatSay(room, sender, text)`, `h.chatMessages(room)`,
  `h.mqttPublish(topic, payload, retain?)`, `h.mqttLog(filter)` (сообщения от программы), `h.mqttConnected()`,
  `h.retained` (Map), `await h.web(path, method?, query?)` (запрос к WebServer на ESP32), `h.net.telemetry`.
* Утверждения: `h.expect(cond, 'сообщение')`, `h.fail('сообщение')`, `h.near(a, b, tol)`, `h.warnings()`, `h.code`.
* Помощники (`helpers.ts`): `expectPeriod`, `gpioFor`, `checkLedWiring`, `linesWith`, `lastNumber`, `codeUses`.

## Как проверять

```bash
cd packages/content
PRACTICE=m1-sos npx vitest run          # одна практика
npx vitest run                          # всё
npx tsc -p .                            # типы
```

Тест `content.test.ts` проверяет: схемы корректны, стартовый код компилируется, эталон проходит все проверки,
стартовый код — нет. Все практики должны проходить. Если находите ошибку симулятора (`packages/sim`) — исправьте
её минимальной правкой (перечитайте файл прямо перед правкой — им могут пользоваться другие), добавьте тест в
`packages/sim/test/` и убедитесь, что `cd packages/sim && npx vitest run` зелёный.
