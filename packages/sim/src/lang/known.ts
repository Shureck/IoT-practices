// Известные имена типов для парсера.

/** Однословные примитивы -> каноническое имя. */
export const PRIMITIVE_WORDS: Record<string, string> = {
  void: 'void',
  bool: 'bool',
  boolean: 'bool',
  char: 'char',
  byte: 'uint8',
  uint8_t: 'uint8',
  int8_t: 'int8',
  short: 'int16',
  int16_t: 'int16',
  uint16_t: 'uint16',
  word: 'uint16',
  int: 'int32',
  int32_t: 'int32',
  uint32_t: 'uint32',
  size_t: 'uint32',
  int64_t: 'int64',
  uint64_t: 'uint64',
  float: 'float',
  double: 'double',
  auto: 'auto',
  String: 'String',
  BaseType_t: 'int32',
  UBaseType_t: 'uint32',
  TickType_t: 'uint32',
  esp_err_t: 'int32',
  wl_status_t: 'int32',
  time_t: 'int32',
  wifi_mode_t: 'int32',
};

/** Слова, которые могут входить в составной примитивный тип. */
export const TYPE_MODIFIERS = new Set(['unsigned', 'signed', 'long', 'short']);

/** Квалификаторы, которые просто пропускаем. */
export const IGNORED_QUALIFIERS = new Set([
  'volatile', 'inline', 'constexpr', 'extern', 'register', 'IRAM_ATTR', 'ICACHE_RAM_ATTR', 'virtual',
  'explicit', 'mutable', 'PROGMEM', 'RTC_DATA_ATTR', 'DRAM_ATTR', 'typename', 'override', 'final', 'noexcept',
]);

/** Классы и непрозрачные типы библиотек, которые знает симулятор. */
export const LIB_TYPES = new Set([
  'DHT', 'Servo', 'LiquidCrystal_I2C', 'Adafruit_SSD1306', 'Adafruit_NeoPixel', 'HTTPClient', 'WiFiClient',
  'WiFiClientSecure', 'PubSubClient', 'WebServer', 'DynamicJsonDocument', 'StaticJsonDocument', 'JsonDocument',
  'JsonObject', 'JsonArray', 'JsonVariant', 'JsonObjectConst', 'JsonArrayConst', 'JsonVariantConst', 'IPAddress',
  'HardwareSerial', 'Preferences', 'TwoWire', 'SPIClass', 'Ticker', 'Stream', 'Print',
  'hw_timer_t', 'TaskHandle_t', 'SemaphoreHandle_t', 'QueueHandle_t', 'TimerHandle_t', 'portMUX_TYPE',
  'EventGroupHandle_t', 'WiFiClass', 'HTTPMethod', 'DeserializationError', 'Adafruit_GFX', 'SPISettings',
  'JsonPair', 'GpioRegs', 'GpioReg1', 'EspClass', 'JsonString',
]);

/** Типы-«хэндлы», которые объявляют указателем: hw_timer_t *timer = NULL; */
export const HANDLE_TYPES = new Set(['hw_timer_t', 'TaskHandle_t', 'SemaphoreHandle_t', 'QueueHandle_t', 'TimerHandle_t', 'EventGroupHandle_t', 'portMUX_TYPE']);

/** Заголовок, в котором объявлен библиотечный тип (для подсказок про #include). */
export const TYPE_HEADER: Record<string, string[]> = {
  DHT: ['DHT.h', 'DHT_U.h'],
  Servo: ['ESP32Servo.h', 'Servo.h'],
  LiquidCrystal_I2C: ['LiquidCrystal_I2C.h'],
  Adafruit_SSD1306: ['Adafruit_SSD1306.h'],
  Adafruit_NeoPixel: ['Adafruit_NeoPixel.h'],
  HTTPClient: ['HTTPClient.h'],
  WiFiClient: ['WiFi.h', 'WiFiClient.h', 'PubSubClient.h', 'HTTPClient.h'],
  WiFiClientSecure: ['WiFiClientSecure.h'],
  PubSubClient: ['PubSubClient.h'],
  WebServer: ['WebServer.h'],
  DynamicJsonDocument: ['ArduinoJson.h'],
  StaticJsonDocument: ['ArduinoJson.h'],
  JsonDocument: ['ArduinoJson.h'],
  JsonObject: ['ArduinoJson.h'],
  JsonArray: ['ArduinoJson.h'],
  JsonVariant: ['ArduinoJson.h'],
  Preferences: ['Preferences.h'],
  Ticker: ['Ticker.h'],
};
