// Справочник функций Arduino/ESP32 на русском (автодополнение и страница «Справочник»).

export interface ApiDoc {
  sig: string;
  text: string;
  example?: string;
}

export interface ApiGroup {
  title: string;
  icon: string;
  items: Record<string, ApiDoc>;
}

export const API_GROUPS: ApiGroup[] = [
  {
    title: 'Цифровые выводы', icon: '🔌',
    items: {
      pinMode: { sig: 'pinMode(pin, mode)', text: 'Настраивает вывод: OUTPUT — выход, INPUT — вход, INPUT_PULLUP / INPUT_PULLDOWN — вход со встроенной подтяжкой к 3,3 В / к земле.', example: 'pinMode(2, OUTPUT);\npinMode(14, INPUT_PULLUP);' },
      digitalWrite: { sig: 'digitalWrite(pin, HIGH|LOW)', text: 'Подаёт на выход 3,3 В (HIGH) или 0 В (LOW). Вывод должен быть настроен как OUTPUT.', example: 'digitalWrite(2, HIGH);' },
      digitalRead: { sig: 'int digitalRead(pin)', text: 'Читает логический уровень на входе: HIGH (1) или LOW (0). Без подтяжки неподключённый вход «висит» и даёт случайные значения.', example: 'if (digitalRead(14) == LOW) { /* кнопка нажата */ }' },
      attachInterrupt: { sig: 'attachInterrupt(digitalPinToInterrupt(pin), isr, RISING|FALLING|CHANGE)', text: 'Вызывает функцию-обработчик при изменении уровня на выводе. Обработчик должен быть коротким, без delay(); общие переменные объявляйте volatile.', example: 'volatile int count = 0;\nvoid IRAM_ATTR onPress() { count++; }\nattachInterrupt(digitalPinToInterrupt(14), onPress, FALLING);' },
      detachInterrupt: { sig: 'detachInterrupt(pin)', text: 'Отключает прерывание на выводе.' },
    },
  },
  {
    title: 'Аналоговые входы и ШИМ', icon: '📈',
    items: {
      analogRead: { sig: 'uint16_t analogRead(pin)', text: 'Читает напряжение 0…3,3 В как число 0…4095 (12 бит). Выводы АЦП1: 32–39; АЦП2 (0, 2, 4, 12–15, 25–27) не работает вместе с Wi-Fi.', example: 'int raw = analogRead(34);\nfloat v = raw * 3.3 / 4095.0;' },
      analogReadMilliVolts: { sig: 'uint32_t analogReadMilliVolts(pin)', text: 'Напряжение на входе в милливольтах.' },
      analogReadResolution: { sig: 'analogReadResolution(bits)', text: 'Разрешение АЦП: 9–12 бит.' },
      analogWrite: { sig: 'analogWrite(pin, 0…255)', text: 'ШИМ-сигнал с заполнением value/255 (частота 1 кГц). Удобный способ менять яркость светодиода.' },
      ledcSetup: { sig: 'ledcSetup(channel, freq, resolution)', text: 'Ядро 2.x: настраивает канал ШИМ (0–15): частоту в Гц и разрешение в битах (1–20). freq × 2^bits не должно превышать 80 МГц.', example: 'ledcSetup(0, 5000, 8);\nledcAttachPin(25, 0);\nledcWrite(0, 128); // 50 %' },
      ledcAttachPin: { sig: 'ledcAttachPin(pin, channel)', text: 'Ядро 2.x: подключает вывод к каналу ШИМ.' },
      ledcWrite: { sig: 'ledcWrite(channel, duty)', text: 'Задаёт заполнение ШИМ: 0…2^bits − 1. В ядре 3.x первым аргументом передаётся номер вывода.' },
      ledcAttach: { sig: 'ledcAttach(pin, freq, resolution)', text: 'Ядро 3.x: подключает вывод к ШИМ одной командой.' },
      ledcWriteTone: { sig: 'ledcWriteTone(channel, freq)', text: 'Меандр заданной частоты (для пассивной пищалки).' },
      tone: { sig: 'tone(pin, freq, [duration])', text: 'Звук на пассивной пищалке. Без duration звучит до noTone(pin).', example: 'tone(27, 1000, 200);' },
      noTone: { sig: 'noTone(pin)', text: 'Выключает звук.' },
      dacWrite: { sig: 'dacWrite(25|26, 0…255)', text: 'Настоящее аналоговое напряжение 0…3,3 В на ЦАП (только GPIO25 и GPIO26).' },
      map: { sig: 'long map(x, inMin, inMax, outMin, outMax)', text: 'Пересчитывает число из одного диапазона в другой (целочисленно).', example: 'int pwm = map(analogRead(34), 0, 4095, 0, 255);' },
      constrain: { sig: 'constrain(x, low, high)', text: 'Ограничивает значение диапазоном.' },
    },
  },
  {
    title: 'Время', icon: '⏱️',
    items: {
      delay: { sig: 'delay(ms)', text: 'Пауза в миллисекундах. Пока идёт delay, loop() стоит — для нескольких одновременных дел используйте millis().' },
      delayMicroseconds: { sig: 'delayMicroseconds(us)', text: 'Короткая пауза в микросекундах (например, импульс 10 мкс для HC-SR04).' },
      millis: { sig: 'unsigned long millis()', text: 'Миллисекунды с момента включения. Основа «неблокирующих» таймеров.', example: 'if (millis() - last >= 1000) {\n  last = millis();\n  // раз в секунду\n}' },
      micros: { sig: 'unsigned long micros()', text: 'Микросекунды с момента включения.' },
      pulseIn: { sig: 'unsigned long pulseIn(pin, HIGH|LOW, [timeout])', text: 'Измеряет длительность импульса в мкс (по умолчанию ждёт до 1 с).', example: 'long t = pulseIn(4, HIGH);\nint cm = t / 58;' },
      timerBegin: { sig: 'hw_timer_t* timerBegin(num, divider, countUp)', text: 'Ядро 2.x: аппаратный таймер (0–3). Делитель 80 → 1 тик = 1 мкс. В ядре 3.x: timerBegin(частота_Гц).', example: 'hw_timer_t *timer = timerBegin(0, 80, true);\ntimerAttachInterrupt(timer, &onTimer, true);\ntimerAlarmWrite(timer, 500000, true); // 0,5 с\ntimerAlarmEnable(timer);' },
      timerAttachInterrupt: { sig: 'timerAttachInterrupt(timer, isr, edge)', text: 'Обработчик срабатывания таймера.' },
      timerAlarmWrite: { sig: 'timerAlarmWrite(timer, ticks, autoreload)', text: 'Через сколько тиков срабатывать и повторять ли.' },
      timerAlarmEnable: { sig: 'timerAlarmEnable(timer)', text: 'Запускает срабатывания таймера.' },
    },
  },
  {
    title: 'Serial (UART)', icon: '💬',
    items: {
      'HardwareSerial.begin': { sig: 'Serial.begin(baud)', text: 'Открывает порт. Скорость должна совпадать со скоростью монитора порта (обычно 115200).' },
      'HardwareSerial.print': { sig: 'Serial.print(value, [format])', text: 'Печатает значение без перевода строки. float — с 2 знаками (или Serial.print(x, 3)); целые — DEC/HEX/BIN.' },
      'HardwareSerial.println': { sig: 'Serial.println(value)', text: 'Печатает значение и переводит строку.' },
      'HardwareSerial.printf': { sig: 'Serial.printf(fmt, ...)', text: 'Форматированный вывод: %d, %u, %.2f, %s (для String — .c_str()), %x.', example: 'Serial.printf("T=%.1f°C, H=%d%%\\n", t, h);' },
      'HardwareSerial.available': { sig: 'int Serial.available()', text: 'Сколько байт пришло и ждёт чтения.' },
      'HardwareSerial.readStringUntil': { sig: 'String Serial.readStringUntil(\'\\n\')', text: 'Читает строку до символа (или до тайм-аута 1 с).' },
      'Serial2.begin': { sig: 'Serial2.begin(baud, SERIAL_8N1, RX, TX)', text: 'Второй аппаратный UART. По умолчанию RX = 16, TX = 17. Соединяйте TX одного устройства с RX другого.' },
    },
  },
  {
    title: 'Строки', icon: '🔤',
    items: {
      'String': { sig: 'String s = "текст";', text: 'Удобная строка Arduino: склейка через +, методы length(), indexOf(), substring(), toInt(), toFloat(), trim(), equals().', example: 'String msg = "T=" + String(t, 1) + " C";' },
      sprintf: { sig: 'sprintf(buf, fmt, ...)', text: 'Форматирует текст в массив char. Следите за размером буфера!', example: 'char buf[32];\nsprintf(buf, "%02d:%02d", h, m);' },
      strcmp: { sig: 'int strcmp(a, b)', text: 'Сравнивает две C-строки: 0 — равны. Для const char* нельзя использовать ==.' },
      atoi: { sig: 'int atoi(str)', text: 'Строку в целое число.' },
    },
  },
  {
    title: 'Wi-Fi и HTTP', icon: '📶',
    items: {
      'WiFiClass.begin': { sig: 'WiFi.begin(ssid, password)', text: 'Подключение к точке доступа. Дождитесь WiFi.status() == WL_CONNECTED.', example: 'WiFi.begin("Samsung_IoT", "IOT5iot5");\nwhile (WiFi.status() != WL_CONNECTED) {\n  delay(500);\n  Serial.print(".");\n}\nSerial.println(WiFi.localIP());' },
      'WiFiClass.scanNetworks': { sig: 'int WiFi.scanNetworks()', text: 'Сканирует эфир; дальше WiFi.SSID(i), WiFi.RSSI(i).' },
      'WiFiClass.softAP': { sig: 'WiFi.softAP(ssid, pass)', text: 'Режим точки доступа: ESP32 сам создаёт сеть (IP 192.168.4.1).' },
      'HTTPClient.begin': { sig: 'http.begin(url)', text: 'Подготовка запроса. Затем http.GET() или http.POST(body) возвращает код ответа.', example: 'HTTPClient http;\nhttp.begin("http://weather.iot/api?city=Moscow");\nint code = http.GET();\nif (code == 200) Serial.println(http.getString());\nhttp.end();' },
      'HTTPClient.addHeader': { sig: 'http.addHeader(name, value)', text: 'Заголовок запроса, например Content-Type: application/json.' },
      deserializeJson: { sig: 'DeserializationError deserializeJson(doc, input)', text: 'Разбирает JSON в документ ArduinoJson. Доступ: doc["key"], doc["arr"][0]["x"]; значение по умолчанию: doc["x"] | 0.', example: 'JsonDocument doc;\nif (!deserializeJson(doc, payload)) {\n  float t = doc["temp"];\n}' },
      serializeJson: { sig: 'serializeJson(doc, output)', text: 'Превращает документ в JSON-строку (String, массив char или Serial).' },
      'WebServer.on': { sig: 'server.on(path, handler)', text: 'Веб-сервер на ESP32: обработчик пути. В loop() обязательно server.handleClient().', example: 'WebServer server(80);\nserver.on("/", []() { server.send(200, "text/html", "<h1>Привет</h1>"); });\nserver.begin();' },
    },
  },
  {
    title: 'MQTT (PubSubClient)', icon: '🛰️',
    items: {
      'PubSubClient.setServer': { sig: 'mqtt.setServer(host, 1883)', text: 'Адрес брокера. В симуляторе: mqtt.iot (или broker.hivemq.com).' },
      'PubSubClient.connect': { sig: 'bool mqtt.connect(clientId, [user, pass], [willTopic, qos, retain, willMsg])', text: 'Подключение к брокеру. clientId должен быть уникальным. LWT — «завещание», публикуется брокером при обрыве связи.' },
      'PubSubClient.publish': { sig: 'bool mqtt.publish(topic, payload, [retain])', text: 'Публикация сообщения. Размер пакета ограничен буфером 256 байт (setBufferSize).' },
      'PubSubClient.subscribe': { sig: 'bool mqtt.subscribe(filter)', text: 'Подписка: + — один уровень, # — все уровни ниже (только в конце).' },
      'PubSubClient.loop': { sig: 'bool mqtt.loop()', text: 'Обрабатывает входящие сообщения и поддерживает соединение — вызывайте в каждом loop().' },
      'PubSubClient.setCallback': { sig: 'mqtt.setCallback(fn)', text: 'Функция void cb(char* topic, byte* payload, unsigned int length) для входящих сообщений.' },
    },
  },
  {
    title: 'Датчики и модули', icon: '🌡️',
    items: {
      'DHT.readTemperature': { sig: 'float dht.readTemperature()', text: 'Температура (°C) с DHT11/DHT22. nan — датчик не отвечает. Чаще раза в 2 с не опрашивать.', example: '#include <DHT.h>\nDHT dht(4, DHT22);\ndht.begin();\nfloat t = dht.readTemperature();' },
      'DHT.readHumidity': { sig: 'float dht.readHumidity()', text: 'Относительная влажность, %.' },
      'Servo.write': { sig: 'servo.write(angle)', text: 'Поворот сервопривода на угол 0–180° (библиотека ESP32Servo; сначала servo.attach(pin)).' },
      'LiquidCrystal_I2C.print': { sig: 'lcd.print(value)', text: 'Вывод на символьный дисплей. Перед этим lcd.init(); lcd.backlight(); lcd.setCursor(col, row);' },
      'Adafruit_NeoPixel.setPixelColor': { sig: 'strip.setPixelColor(i, r, g, b)', text: 'Цвет светодиода ленты; применить — strip.show().' },
      'Preferences.putInt': { sig: 'prefs.putInt(key, value)', text: 'Сохраняет число во флеш (переживает перезагрузку). Сначала prefs.begin("имя").' },
    },
  },
  {
    title: 'FreeRTOS', icon: '🧵',
    items: {
      xTaskCreate: { sig: 'xTaskCreate(fn, "имя", stack, param, priority, &handle)', text: 'Запускает функцию как отдельную задачу. Задача — бесконечный цикл с vTaskDelay внутри.', example: 'void blink(void *p) {\n  for (;;) {\n    digitalWrite(2, !digitalRead(2));\n    vTaskDelay(pdMS_TO_TICKS(500));\n  }\n}\nxTaskCreate(blink, "blink", 2048, NULL, 1, NULL);' },
      vTaskDelay: { sig: 'vTaskDelay(ticks)', text: 'Пауза задачи (1 тик = 1 мс); другие задачи в это время работают.' },
      xQueueCreate: { sig: 'QueueHandle_t xQueueCreate(len, itemSize)', text: 'Очередь для передачи данных между задачами: xQueueSend / xQueueReceive.' },
      xSemaphoreCreateMutex: { sig: 'SemaphoreHandle_t xSemaphoreCreateMutex()', text: 'Мьютекс для защиты общего ресурса: xSemaphoreTake / xSemaphoreGive.' },
    },
  },
];

export const API_DOCS: Record<string, ApiDoc> = Object.assign({}, ...API_GROUPS.map((g) => g.items));
