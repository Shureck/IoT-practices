import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, codeUses, expectPeriod, p, w } from '../helpers';

const parts = () => [
  p('dht', 'dht22', 300, 70, { temperature: 21.4, humidity: 47 }),
  p('r1', 'resistor', 260, -120, { value: 220 }),
  p('led', 'led', 330, -40, { color: 'blue' }),
  p('btn', 'button', 420, -40, { color: 'yellow', label: '°C/°F', bounce: true }),
];
const wires = () => [
  w('dht:VCC', 'esp:3V3', 'red'),
  w('dht:DATA', 'esp:D4', 'green'),
  w('dht:GND', 'esp:GND.2', 'black'),
  w('esp:D25', 'r1:1', 'blue'),
  w('r1:2', 'led:A', 'blue'),
  w('led:C', 'esp:GND.1', 'black'),
  w('btn:1', 'esp:D14', 'yellow'),
  w('btn:2', 'esp:GND.1', 'black'),
];

const RE = /T\s*=\s*(-?\d+(?:\.\d+)?)\s*°?\s*([CF])\b/;

interface Reading { t: number; v: number; unit: string }

/** Прогнать симуляцию до момента to, записывая время появления каждой строки с показаниями. */
async function collect(h: CheckContext, to: number, out: Reading[]) {
  let seen = h.serialLines().length;
  while (h.now < to) {
    await h.wait(20);
    const lines = h.serialLines();
    for (let i = seen; i < lines.length; i++) {
      const m = lines[i].match(RE);
      if (m) out.push({ t: h.now, v: Number(m[1]), unit: m[2] });
    }
    seen = lines.length;
  }
}

export const rtos: Practice = {
  id: 'm3-rtos',
  module: 3,
  order: 7,
  kind: 'case',
  title: 'Метеопост',
  subtitle: 'Кейс 2: датчики, задачи FreeRTOS, прерывания и таймеры',
  difficulty: 3,
  xp: 200,
  minutes: 75,
  tags: ['FreeRTOS', 'очереди', 'аппаратный таймер', 'прерывания', 'DHT22', 'дребезг'],
  story: `Метеомачта «Полярной-5» снова в строю, но её контроллер должен делать несколько дел сразу: каждые две
секунды снимать показания, вести журнал, мигать сигнальным огнём для пилотов — и при этом мгновенно
реагировать на кнопку дежурного, который переключает градусы Цельсия на Фаренгейты для американских коллег.
Один \`loop()\` с \`delay()\` тут не справится. Пора научить ESP32 многозадачности.`,
  goals: [
    'Задача FreeRTOS **«sensor»** раз в 2 с читает DHT22 (GPIO4) и кладёт показания в **очередь**',
    'Задача **«log»** забирает показания из очереди и печатает строку `T=21.4 °C, H=47 %`',
    'Синий огонь на **GPIO25** мигает от **аппаратного таймера**: прерывание каждые 500 мс переключает светодиод',
    'Кнопка на **GPIO14** (к GND, `INPUT_PULLUP`) через **прерывание** переключает единицы °C ↔ °F (`T=70.5 °F, …`); у кнопки есть **дребезг** — подавите его программно',
  ],
  theory: `### Задачи FreeRTOS

Внутри Arduino-ESP32 работает операционная система реального времени **FreeRTOS**. Даже \`loop()\` — это одна из её
задач. Можно создать свои: каждая задача — функция с бесконечным циклом, а \`vTaskDelay()\` отдаёт процессор
другим, пока задача «спит».

\`\`\`cpp
void blinkTask(void *param) {
  for (;;) {
    // работа
    vTaskDelay(pdMS_TO_TICKS(1000));   // уснуть на 1 с, не мешая другим
  }
}

void setup() {
  //          функция    имя      стек  параметр приоритет хэндл
  xTaskCreate(blinkTask, "blink", 4096, NULL,    1,        NULL);
}
\`\`\`

Функция задачи **не должна завершаться** — иначе система аварийно остановится.

### Очередь

Задачи не должны «хватать» общие переменные как попало. Безопасный способ передать данные — **очередь**:
одна задача кладёт, другая забирает (и спит, пока очередь пуста).

\`\`\`cpp
struct Reading { float t; float h; };
QueueHandle_t queue = xQueueCreate(5, sizeof(Reading));   // до 5 элементов

Reading r = {21.4, 47};
xQueueSend(queue, &r, portMAX_DELAY);                     // положить (копия!)

Reading got;
if (xQueueReceive(queue, &got, portMAX_DELAY) == pdTRUE) { /* got заполнен */ }
\`\`\`

### Аппаратный таймер (API ядра 2.x)

У ESP32 четыре 64-битных таймера, тактируемых от 80 МГц. Делитель 80 даёт 1 тик = 1 мкс:

\`\`\`cpp
hw_timer_t *timer = NULL;

void IRAM_ATTR onTimer() {            // обработчик прерывания: коротко и быстро!
  // ...
}

timer = timerBegin(0, 80, true);              // таймер 0, делитель 80, счёт вверх
timerAttachInterrupt(timer, &onTimer, true);
timerAlarmWrite(timer, 500000, true);         // через 500 000 тиков, с автоперезапуском
timerAlarmEnable(timer);
\`\`\`

> В ядре 3.x API другое: \`timerBegin(1000000)\` и \`timerAlarm(timer, 500000, true, 0)\` — симулятор понимает оба.

### Прерывание от кнопки и дребезг

\`\`\`cpp
volatile bool flag = false;           // volatile: меняется в прерывании
void IRAM_ATTR onButton() { flag = true; }

pinMode(14, INPUT_PULLUP);
attachInterrupt(digitalPinToInterrupt(14), onButton, FALLING);   // нажатие = переход 1 → 0
\`\`\`

Механический контакт при нажатии и отпускании несколько раз «подпрыгивает» — прерывание срабатывает
3–6 раз за одно нажатие. Простое лечение — игнорировать срабатывания, пришедшие слишком быстро после
предыдущего (например, ближе 200 мс). Внутри прерывания нельзя вызывать \`delay()\` и \`Serial.print()\`.`,
  hints: [
    'Начните с очереди: `queue = xQueueCreate(5, sizeof(Reading));` в `setup()`, затем две `xTaskCreate(...)`.',
    'Задача sensor: `Reading r; r.t = dht.readTemperature(); r.h = dht.readHumidity(); xQueueSend(queue, &r, portMAX_DELAY); vTaskDelay(pdMS_TO_TICKS(2000));` — всё внутри `for (;;)`.',
    'В обработчике таймера храните состояние огня в `volatile bool` и делайте `digitalWrite(LED_PIN, ledState)`.',
    'Подавление дребезга в обработчике кнопки: `unsigned long now = millis(); if (now - lastPress > 200) { useF = !useF; lastPress = now; }`. Перевод в °F: `t * 1.8 + 32`.',
  ],
  starterCode: `#include <DHT.h>

const int DHT_PIN = 4;
const int LED_PIN = 25;
const int BTN_PIN = 14;

struct Reading {
  float t;
  float h;
};

DHT dht(DHT_PIN, DHT22);
QueueHandle_t queue;
hw_timer_t *timer = NULL;

volatile bool ledState = false;
volatile bool useF = false;

void IRAM_ATTR onTimer() {
  // TODO: переключить сигнальный огонь
}

void IRAM_ATTR onButton() {
  // TODO: переключить °C/°F, подавив дребезг
}

void sensorTask(void *param) {
  for (;;) {
    // TODO: прочитать датчик и положить Reading в очередь
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

void logTask(void *param) {
  for (;;) {
    // TODO: забрать Reading из очереди и напечатать "T=21.4 °C, H=47 %"
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BTN_PIN, INPUT_PULLUP);
  dht.begin();

  // TODO: создать очередь и две задачи
  // TODO: прерывание от кнопки
  // TODO: аппаратный таймер на 500 мс
}

void loop() {
  delay(1000);
}
`,
  starterCircuit: circuit(parts(), wires()),
  circuitLocked: true,
  solution: {
    code: `#include <DHT.h>

const int DHT_PIN = 4;
const int LED_PIN = 25;
const int BTN_PIN = 14;

struct Reading {
  float t;
  float h;
};

DHT dht(DHT_PIN, DHT22);
QueueHandle_t queue;
hw_timer_t *timer = NULL;

volatile bool ledState = false;
volatile bool useF = false;
volatile unsigned long lastPress = 0;

void IRAM_ATTR onTimer() {
  ledState = !ledState;
  digitalWrite(LED_PIN, ledState);
}

void IRAM_ATTR onButton() {
  unsigned long now = millis();
  if (now - lastPress > 200) {     // всё, что ближе 200 мс, — дребезг
    useF = !useF;
    lastPress = now;
  }
}

void sensorTask(void *param) {
  for (;;) {
    Reading r;
    r.t = dht.readTemperature();
    r.h = dht.readHumidity();
    if (!isnan(r.t) && !isnan(r.h)) {
      xQueueSend(queue, &r, portMAX_DELAY);
    }
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

void logTask(void *param) {
  Reading r;
  for (;;) {
    if (xQueueReceive(queue, &r, portMAX_DELAY) == pdTRUE) {
      bool f = useF;
      float t = f ? r.t * 1.8 + 32 : r.t;
      Serial.printf("T=%.1f °%c, H=%.0f %%\\n", t, f ? 'F' : 'C', r.h);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BTN_PIN, INPUT_PULLUP);
  dht.begin();

  queue = xQueueCreate(5, sizeof(Reading));
  xTaskCreate(sensorTask, "sensor", 4096, NULL, 2, NULL);
  xTaskCreate(logTask, "log", 4096, NULL, 1, NULL);

  attachInterrupt(digitalPinToInterrupt(BTN_PIN), onButton, FALLING);

  timer = timerBegin(0, 80, true);              // 1 тик = 1 мкс
  timerAttachInterrupt(timer, &onTimer, true);
  timerAlarmWrite(timer, 500000, true);         // 0.5 с, автоперезапуск
  timerAlarmEnable(timer);
}

void loop() {
  vTaskDelete(NULL);   // loop больше не нужен — работают задачи
}
`,
  },
  checks: [
    {
      id: 'api',
      title: 'Используются задачи, очередь, аппаратный таймер и прерывание',
      run: async (h) => {
        const tasks = (h.code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').match(/\bxTaskCreate(PinnedToCore)?\s*\(/g) ?? []).length;
        h.expect(tasks >= 2, `Создано задач FreeRTOS: ${tasks}, а нужно минимум две — «sensor» и «log» (xTaskCreate)`);
        h.expect(codeUses(h, /\bxQueueCreate\s*\(/) && codeUses(h, /\bxQueueSend(ToBack)?\s*\(/) && codeUses(h, /\bxQueueReceive\s*\(/),
          'Показания должны идти через очередь: xQueueCreate, xQueueSend и xQueueReceive');
        h.expect(codeUses(h, /\btimerBegin\s*\(/) && codeUses(h, /\btimerAttachInterrupt\s*\(/) && codeUses(h, /\btimerAlarm(Write)?\s*\(/),
          'Огонь должен мигать от аппаратного таймера: timerBegin, timerAttachInterrupt, timerAlarmWrite/timerAlarmEnable');
        h.expect(codeUses(h, /\battachInterrupt\s*\(/), 'Кнопку нужно обрабатывать прерыванием: attachInterrupt(digitalPinToInterrupt(14), …, FALLING)');
      },
    },
    {
      id: 'log',
      title: 'Показания печатаются каждые 2 секунды',
      run: async (h) => {
        const got: Reading[] = [];
        await collect(h, 10500, got);
        h.expect(got.length > 0, 'В Serial нет строк вида «T=21.4 °C, H=47 %»');
        h.expect(Math.abs(got[0].v - 21.4) < 0.15 && got[0].unit === 'C', `Первая строка показывает ${got[0].v} °${got[0].unit}, а датчик — 21.4 °C`);
        h.expect(got.length >= 4 && got.length <= 7, `За 10 с напечатано ${got.length} строк с показаниями, а нужно около 5 (раз в 2 с)`);
        const gaps = got.slice(1).map((x, i) => x.t - got[i].t);
        const bad = gaps.find((g) => Math.abs(g - 2000) > 200);
        h.expect(bad === undefined, `Между показаниями ${Math.round(bad ?? 0)} мс, а должно быть 2000 мс`);
      },
    },
    {
      id: 'led',
      title: 'Сигнальный огонь мигает от таймера: 500 мс / 500 мс',
      run: async (h) => {
        await h.wait(8500);
        expectPeriod(h, 25, 400, 8500, 1000, 15, 'Сигнальный огонь (GPIO25)');
        const d = h.dutyOver(25, 1000, 8000);
        h.expect(Math.abs(d - 0.5) < 0.05, `Огонь горит ${Math.round(d * 100)}% времени, а должен — ровно половину`);
      },
    },
    {
      id: 'units',
      title: 'Кнопка переключает °C ↔ °F (с подавлением дребезга)',
      run: async (h) => {
        h.set('dht', 'temperature', 10);
        await h.wait(2500);
        const got: Reading[] = [];
        await h.press('btn', 80);
        const m1 = got.length;
        await collect(h, h.now + 2600, got);
        const after1 = got.slice(m1);
        h.expect(after1.length > 0, 'После нажатия кнопки показания перестали печататься');
        const last1 = after1[after1.length - 1];
        h.expect(last1.unit === 'F', 'Нажали кнопку один раз — а единицы остались °C. Если прерывание срабатывает, проверьте дребезг: за одно нажатие контакт замыкается несколько раз, и чётное число переключений возвращает всё обратно');
        h.expect(Math.abs(last1.v - 50) < 0.2, `10 °C — это 50 °F, а напечатано ${last1.v} °F. Формула: t * 1.8 + 32`);
        await h.wait(300);
        await h.press('btn', 80);
        const m2 = got.length;
        await collect(h, h.now + 2600, got);
        const after2 = got.slice(m2);
        h.expect(after2.length > 0 && after2[after2.length - 1].unit === 'C', 'Второе нажатие должно вернуть °C');
      },
    },
    {
      id: 'live',
      title: 'Новые показания датчика доходят до журнала',
      run: async (h) => {
        await h.wait(3000);
        h.set('dht', 'temperature', -15.5);
        const got: Reading[] = [];
        await collect(h, h.now + 2600, got);
        h.expect(got.some((x) => Math.abs(x.v + 15.5) < 0.15), `Температура упала до -15.5 °C, а журнал за 2.5 с показал: ${got.map((x) => x.v).join(', ') || 'ничего'}`);
      },
    },
  ],
};
