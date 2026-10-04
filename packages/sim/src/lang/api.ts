// Метаданные API Arduino-ESP32 и библиотек, которые понимает симулятор.
// Формат значения: '[*][~]тип'
//   * — вызов блокирующий (генератор: delay, HTTP-запрос…)
//   ~ — аргументы «печатаемые»: float печатается с 2 знаками, char — как символ
// Реализации живут в runtime/*, тест проверяет их соответствие этим метаданным.

export const FUNCS: Record<string, string> = {
  // цифровые/аналоговые выводы
  pinMode: 'void', digitalWrite: 'void', digitalRead: 'int', analogRead: 'uint16', analogReadMilliVolts: 'uint32',
  analogReadResolution: 'void', analogSetAttenuation: 'void', analogSetPinAttenuation: 'void', analogSetWidth: 'void',
  analogWrite: 'void', analogWriteResolution: 'void', analogWriteFrequency: 'void', dacWrite: 'void', touchRead: 'uint16',
  hallRead: 'int', neopixelWrite: 'void', rgbLedWrite: 'void',
  // время
  delay: '*void', delayMicroseconds: '*void', millis: 'uint32', micros: 'uint32', yield: '*void',
  pulseIn: '*uint32', pulseInLong: '*uint32', tone: 'void', noTone: 'void', shiftOut: '*void', shiftIn: '*uint8',
  // случайные числа
  random: 'int', randomSeed: 'void', esp_random: 'uint32',
  // прерывания
  attachInterrupt: 'void', attachInterruptArg: 'void', detachInterrupt: 'void', digitalPinToInterrupt: 'int',
  interrupts: 'void', noInterrupts: 'void',
  // LEDC (ШИМ) — API ядра 2.x и 3.x
  ledcSetup: 'double', ledcAttachPin: 'void', ledcDetachPin: 'void', ledcWrite: 'void', ledcRead: 'uint32',
  ledcReadFreq: 'double', ledcWriteTone: 'double', ledcWriteNote: 'double', ledcAttach: 'bool', ledcAttachChannel: 'bool',
  ledcDetach: 'bool', ledcChangeFrequency: 'double', ledcFade: 'bool',
  // аппаратные таймеры
  timerBegin: 'hw_timer_t', timerAttachInterrupt: 'void', timerDetachInterrupt: 'void', timerAlarmWrite: 'void',
  timerAlarmEnable: 'void', timerAlarmDisable: 'void', timerAlarm: 'void', timerStart: 'void', timerStop: 'void',
  timerEnd: 'void', timerRead: 'uint64', timerReadMillis: 'uint64', timerReadMicros: 'uint64', timerReadSeconds: 'double',
  timerWrite: 'void', timerRestart: 'void', timerSetAutoReload: 'void',
  // FreeRTOS
  xTaskCreate: 'int', xTaskCreatePinnedToCore: 'int', vTaskDelay: '*void', vTaskDelayUntil: '*void', vTaskDelete: '*void',
  xTaskGetTickCount: 'uint32', xTaskGetTickCountFromISR: 'uint32', pdMS_TO_TICKS: 'uint32', vTaskSuspend: '*void', vTaskResume: 'void',
  uxTaskGetStackHighWaterMark: 'uint32', xPortGetCoreID: 'int', taskYIELD: '*void', uxTaskPriorityGet: 'uint32',
  vTaskPrioritySet: 'void', pcTaskGetName: 'cstr', xTaskGetCurrentTaskHandle: 'TaskHandle_t',
  xSemaphoreCreateMutex: 'SemaphoreHandle_t', xSemaphoreCreateBinary: 'SemaphoreHandle_t',
  xSemaphoreCreateCounting: 'SemaphoreHandle_t', xSemaphoreTake: '*int', xSemaphoreGive: 'int',
  xSemaphoreGiveFromISR: 'int', xSemaphoreTakeFromISR: 'int', uxSemaphoreGetCount: 'uint32',
  xQueueCreate: 'QueueHandle_t', xQueueSend: '*int', xQueueSendToBack: '*int', xQueueSendToFront: '*int',
  xQueueSendFromISR: 'int', xQueueReceive: '*int', xQueuePeek: '*int', xQueueOverwrite: 'int', xQueueReset: 'int',
  uxQueueMessagesWaiting: 'uint32', uxQueueSpacesAvailable: 'uint32', xQueueReceiveFromISR: 'int',
  portENTER_CRITICAL: 'void', portEXIT_CRITICAL: 'void', portENTER_CRITICAL_ISR: 'void', portEXIT_CRITICAL_ISR: 'void',
  portYIELD_FROM_ISR: 'void', vPortYield: '*void',
  xTaskNotifyGive: 'int', ulTaskNotifyTake: '*uint32', xTaskNotify: 'int', vTaskNotifyGiveFromISR: 'void',
  // строки C
  strcmp: 'int', strncmp: 'int', strcasecmp: 'int', strlen: 'uint32', strstr: 'cstr', strchr: 'cstr', strrchr: 'cstr',
  atoi: 'int', atol: 'int', atof: 'double', strtol: 'int', strtoul: 'uint32', strtof: 'float', strtod: 'double',
  toupper: 'int', tolower: 'int', isdigit: 'bool', isalpha: 'bool', isspace: 'bool', isalnum: 'bool', isupper: 'bool',
  islower: 'bool', ispunct: 'bool', isxdigit: 'bool',
  isDigit: 'bool', isAlpha: 'bool', isAlphaNumeric: 'bool', isSpace: 'bool', isWhitespace: 'bool',
  isUpperCase: 'bool', isLowerCase: 'bool', isPunct: 'bool', isHexadecimalDigit: 'bool', isPrintable: 'bool',
  isControl: 'bool', isAscii: 'bool', isGraph: 'bool', toUpperCase: 'int', toLowerCase: 'int', memcmp: 'int',
  // JSON
  deserializeJson: 'DeserializationError', measureJson: 'uint32', measureJsonPretty: 'uint32',
  // разное
  esp_restart: '*void', ESP_restart: '*void', esp_get_free_heap_size: 'uint32', temperatureRead: 'float',
  REG_WRITE: 'void', REG_READ: 'uint32', REG_SET_BIT: 'void', REG_CLR_BIT: 'void', READ_PERI_REG: 'uint32',
  WRITE_PERI_REG: 'void', SET_PERI_REG_MASK: 'void', CLEAR_PERI_REG_MASK: 'void',
  gpio_set_level: 'int', gpio_get_level: 'int', gpio_set_direction: 'int', gpio_pad_select_gpio: 'void',
  gpio_reset_pin: 'int', gpio_set_pull_mode: 'int',
  setCpuFrequencyMhz: 'bool', getCpuFrequencyMhz: 'uint32', getXtalFrequencyMhz: 'uint32', getApbFrequency: 'uint32',
  configTime: 'void', esp_sleep_enable_timer_wakeup: 'int', esp_deep_sleep_start: '*void', esp_deep_sleep: '*void',
  esp_light_sleep_start: '*int', esp_timer_get_time: 'int64', disableCore0WDT: 'void', disableCore1WDT: 'void',
  enableLoopWDT: 'void', disableLoopWDT: 'void', esp_task_wdt_reset: 'int',
};

/** Функции, которые транслятор разбирает сам (особая семантика). */
export const SPECIAL_FUNCS = new Set([
  'min', 'max', 'abs', 'constrain', 'map', 'sq', 'sqrt', 'pow', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'exp', 'log', 'log10', 'floor', 'ceil', 'round', 'fabs', 'fmod', 'isnan', 'isinf', 'trunc', 'fmin', 'fmax', 'hypot',
  'cbrt', 'lround', 'radians', 'degrees', 'sprintf', 'snprintf', 'strcpy', 'strncpy', 'strcat', 'strncat', 'itoa',
  'ltoa', 'utoa', 'dtostrf', 'memset', 'memcpy', 'F', 'PSTR', 'bitRead', 'bitWrite', 'bitSet', 'bitClear', 'bit',
  'highByte', 'lowByte', 'serializeJson', 'serializeJsonPretty', 'sizeof', 'BIT', 'swap', 'makeWord',
]);

export const CONSTS: Record<string, [number | string, string]> = {
  HIGH: [1, 'int'], LOW: [0, 'int'],
  INPUT: [1, 'int'], OUTPUT: [3, 'int'], PULLUP: [4, 'int'], INPUT_PULLUP: [5, 'int'], PULLDOWN: [8, 'int'],
  INPUT_PULLDOWN: [9, 'int'], OPEN_DRAIN: [16, 'int'], OUTPUT_OPEN_DRAIN: [19, 'int'], ANALOG: [192, 'int'],
  RISING: [1, 'int'], FALLING: [2, 'int'], CHANGE: [3, 'int'], ONLOW: [4, 'int'], ONHIGH: [5, 'int'],
  LED_BUILTIN: [2, 'uint8'], BUILTIN_LED: [2, 'uint8'],
  A0: [36, 'uint8'], A3: [39, 'uint8'], A4: [32, 'uint8'], A5: [33, 'uint8'], A6: [34, 'uint8'], A7: [35, 'uint8'],
  A10: [4, 'uint8'], A11: [0, 'uint8'], A12: [2, 'uint8'], A13: [15, 'uint8'], A14: [13, 'uint8'], A15: [12, 'uint8'],
  A16: [14, 'uint8'], A17: [27, 'uint8'], A18: [25, 'uint8'], A19: [26, 'uint8'], DAC1: [25, 'uint8'], DAC2: [26, 'uint8'],
  T0: [4, 'uint8'], T1: [0, 'uint8'], T2: [2, 'uint8'], T3: [15, 'uint8'], T4: [13, 'uint8'], T5: [12, 'uint8'],
  T6: [14, 'uint8'], T7: [27, 'uint8'], T8: [33, 'uint8'], T9: [32, 'uint8'],
  SDA: [21, 'uint8'], SCL: [22, 'uint8'], SS: [5, 'uint8'], MOSI: [23, 'uint8'], MISO: [19, 'uint8'], SCK: [18, 'uint8'],
  TX: [1, 'uint8'], RX: [3, 'uint8'], TX2: [17, 'uint8'], RX2: [16, 'uint8'],
  HEX: [16, 'int'], DEC: [10, 'int'], OCT: [8, 'int'], BIN: [2, 'int'],
  PI: [Math.PI, 'double'], HALF_PI: [Math.PI / 2, 'double'], TWO_PI: [Math.PI * 2, 'double'],
  DEG_TO_RAD: [Math.PI / 180, 'double'], RAD_TO_DEG: [180 / Math.PI, 'double'], EULER: [Math.E, 'double'],
  M_PI: [Math.PI, 'double'], M_E: [Math.E, 'double'],
  LSBFIRST: [0, 'int'], MSBFIRST: [1, 'int'],
  SERIAL_5N1: [0x8000010, 'uint32'], SERIAL_6N1: [0x8000014, 'uint32'], SERIAL_7N1: [0x8000018, 'uint32'],
  SERIAL_8N1: [0x800001c, 'uint32'], SERIAL_8N2: [0x800003c, 'uint32'], SERIAL_8E1: [0x800001e, 'uint32'],
  SERIAL_8O1: [0x800001f, 'uint32'], SERIAL_7E1: [0x800001a, 'uint32'],
  DHT11: [11, 'uint8'], DHT12: [12, 'uint8'], DHT21: [21, 'uint8'], DHT22: [22, 'uint8'], AM2301: [21, 'uint8'],
  NEO_GRB: [0x52, 'uint16'], NEO_RGB: [0x06, 'uint16'], NEO_RGBW: [0x1b, 'uint16'], NEO_GRBW: [0xd8, 'uint16'],
  NEO_BRG: [0x58, 'uint16'], NEO_KHZ800: [0, 'uint16'], NEO_KHZ400: [0x100, 'uint16'],
  SSD1306_SWITCHCAPVCC: [2, 'uint8'], SSD1306_EXTERNALVCC: [1, 'uint8'], SSD1306_WHITE: [1, 'uint16'],
  SSD1306_BLACK: [0, 'uint16'], SSD1306_INVERSE: [2, 'uint16'], WHITE: [1, 'uint16'], BLACK: [0, 'uint16'],
  INVERSE: [2, 'uint16'],
  WL_IDLE_STATUS: [0, 'int'], WL_NO_SSID_AVAIL: [1, 'int'], WL_SCAN_COMPLETED: [2, 'int'], WL_CONNECTED: [3, 'int'],
  WL_CONNECT_FAILED: [4, 'int'], WL_CONNECTION_LOST: [5, 'int'], WL_DISCONNECTED: [6, 'int'], WL_NO_SHIELD: [255, 'int'],
  WIFI_OFF: [0, 'int'], WIFI_STA: [1, 'int'], WIFI_AP: [2, 'int'], WIFI_AP_STA: [3, 'int'],
  WIFI_MODE_NULL: [0, 'int'], WIFI_MODE_STA: [1, 'int'], WIFI_MODE_AP: [2, 'int'], WIFI_MODE_APSTA: [3, 'int'],
  WIFI_AUTH_OPEN: [0, 'int'], WIFI_AUTH_WEP: [1, 'int'], WIFI_AUTH_WPA_PSK: [2, 'int'], WIFI_AUTH_WPA2_PSK: [3, 'int'],
  WIFI_AUTH_WPA_WPA2_PSK: [4, 'int'], WIFI_AUTH_WPA2_ENTERPRISE: [5, 'int'], WIFI_AUTH_WPA3_PSK: [6, 'int'],
  WIFI_POWER_19_5dBm: [78, 'int'], WIFI_POWER_8_5dBm: [34, 'int'],
  HTTP_CODE_OK: [200, 'int'], HTTP_CODE_CREATED: [201, 'int'], HTTP_CODE_NO_CONTENT: [204, 'int'],
  HTTP_CODE_MOVED_PERMANENTLY: [301, 'int'], HTTP_CODE_FOUND: [302, 'int'], HTTP_CODE_BAD_REQUEST: [400, 'int'],
  HTTP_CODE_UNAUTHORIZED: [401, 'int'], HTTP_CODE_FORBIDDEN: [403, 'int'], HTTP_CODE_NOT_FOUND: [404, 'int'],
  HTTP_CODE_INTERNAL_SERVER_ERROR: [500, 'int'],
  HTTPC_ERROR_CONNECTION_REFUSED: [-1, 'int'], HTTPC_ERROR_SEND_HEADER_FAILED: [-2, 'int'],
  HTTPC_ERROR_CONNECTION_LOST: [-5, 'int'], HTTPC_ERROR_NOT_CONNECTED: [-4, 'int'], HTTPC_ERROR_READ_TIMEOUT: [-11, 'int'],
  HTTPC_STRICT_FOLLOW_REDIRECTS: [1, 'int'], HTTPC_FORCE_FOLLOW_REDIRECTS: [2, 'int'],
  HTTP_ANY: [0, 'int'], HTTP_GET: [1, 'int'], HTTP_HEAD: [2, 'int'], HTTP_POST: [3, 'int'], HTTP_PUT: [4, 'int'],
  HTTP_PATCH: [5, 'int'], HTTP_DELETE: [6, 'int'], HTTP_OPTIONS: [7, 'int'],
  MQTT_CONNECTION_TIMEOUT: [-4, 'int'], MQTT_CONNECTION_LOST: [-3, 'int'], MQTT_CONNECT_FAILED: [-2, 'int'],
  MQTT_DISCONNECTED: [-1, 'int'], MQTT_CONNECTED: [0, 'int'], MQTT_CONNECT_BAD_PROTOCOL: [1, 'int'],
  MQTT_CONNECT_BAD_CLIENT_ID: [2, 'int'], MQTT_CONNECT_UNAVAILABLE: [3, 'int'], MQTT_CONNECT_BAD_CREDENTIALS: [4, 'int'],
  MQTT_CONNECT_UNAUTHORIZED: [5, 'int'], MQTT_MAX_PACKET_SIZE: [256, 'int'], MQTT_KEEPALIVE: [15, 'int'],
  portMAX_DELAY: [0xffffffff, 'uint32'], portTICK_PERIOD_MS: [1, 'uint32'], portTICK_RATE_MS: [1, 'uint32'],
  configTICK_RATE_HZ: [1000, 'uint32'],
  pdTRUE: [1, 'int'], pdFALSE: [0, 'int'], pdPASS: [1, 'int'], pdFAIL: [0, 'int'], errQUEUE_FULL: [0, 'int'],
  errQUEUE_EMPTY: [0, 'int'], tskIDLE_PRIORITY: [0, 'int'], configMAX_PRIORITIES: [25, 'int'],
  configMINIMAL_STACK_SIZE: [768, 'int'], APP_CPU_NUM: [1, 'int'], PRO_CPU_NUM: [0, 'int'],
  tskNO_AFFINITY: [0x7fffffff, 'int'], ARDUINO_RUNNING_CORE: [1, 'int'], CONFIG_ARDUINO_RUNNING_CORE: [1, 'int'],
  portMUX_INITIALIZER_UNLOCKED: [0, 'int'],
  INT_MAX: [2147483647, 'int'], INT_MIN: [-2147483648, 'int'], LONG_MAX: [2147483647, 'int'],
  LONG_MIN: [-2147483648, 'int'], UINT_MAX: [4294967295, 'uint32'], ULONG_MAX: [4294967295, 'uint32'],
  INT8_MAX: [127, 'int'], INT8_MIN: [-128, 'int'], UINT8_MAX: [255, 'int'], INT16_MAX: [32767, 'int'],
  INT16_MIN: [-32768, 'int'], UINT16_MAX: [65535, 'int'], INT32_MAX: [2147483647, 'int'], INT32_MIN: [-2147483648, 'int'],
  UINT32_MAX: [4294967295, 'uint32'], NAN: [NaN, 'float'], INFINITY: [Infinity, 'float'],
  FLT_MAX: [3.4028234663852886e38, 'float'], FLT_MIN: [1.1754943508222875e-38, 'float'],
  GPIO_OUT_REG: [0x3ff44004, 'uint32'], GPIO_OUT_W1TS_REG: [0x3ff44008, 'uint32'], GPIO_OUT_W1TC_REG: [0x3ff4400c, 'uint32'],
  GPIO_OUT1_REG: [0x3ff44010, 'uint32'], GPIO_OUT1_W1TS_REG: [0x3ff44014, 'uint32'], GPIO_OUT1_W1TC_REG: [0x3ff44018, 'uint32'],
  GPIO_ENABLE_REG: [0x3ff44020, 'uint32'], GPIO_ENABLE_W1TS_REG: [0x3ff44024, 'uint32'],
  GPIO_ENABLE_W1TC_REG: [0x3ff44028, 'uint32'], GPIO_ENABLE1_REG: [0x3ff4402c, 'uint32'],
  GPIO_ENABLE1_W1TS_REG: [0x3ff44030, 'uint32'], GPIO_ENABLE1_W1TC_REG: [0x3ff44034, 'uint32'],
  GPIO_IN_REG: [0x3ff4403c, 'uint32'], GPIO_IN1_REG: [0x3ff44040, 'uint32'],
  GPIO_MODE_DISABLE: [0, 'int'], GPIO_MODE_INPUT: [1, 'int'], GPIO_MODE_OUTPUT: [2, 'int'],
  GPIO_MODE_INPUT_OUTPUT: [3, 'int'], GPIO_PULLUP_ONLY: [0, 'int'], GPIO_PULLDOWN_ONLY: [1, 'int'],
  GPIO_FLOATING: [3, 'int'],
  ESP_OK: [0, 'int'], ESP_FAIL: [-1, 'int'],
  ADC_0db: [0, 'int'], ADC_2_5db: [1, 'int'], ADC_6db: [2, 'int'], ADC_11db: [3, 'int'],
  ADC_ATTEN_DB_0: [0, 'int'], ADC_ATTEN_DB_11: [3, 'int'], ADC_ATTEN_DB_12: [3, 'int'],
  NOTE_C: [0, 'int'], NOTE_D: [2, 'int'], NOTE_E: [4, 'int'], NOTE_F: [5, 'int'], NOTE_G: [7, 'int'], NOTE_A: [9, 'int'],
  NOTE_B: [11, 'int'],
  LCD_5x8DOTS: [0, 'int'], LCD_5x10DOTS: [4, 'int'],
  DHTPIN: [4, 'int'],
};
for (let b = 0; b < 32; b++) CONSTS[`BIT${b}`] = [2 ** b, 'uint32'];
for (let g = 0; g < 40; g++) CONSTS[`GPIO_NUM_${g}`] = [g, 'int'];
CONSTS.GPIO_NUM_NC = [-1, 'int'];

/** Глобальные объекты ядра: имя -> класс. */
export const GLOBAL_OBJECTS: Record<string, { cls: string; header?: string }> = {
  Serial: { cls: 'HardwareSerial' },
  Serial1: { cls: 'HardwareSerial' },
  Serial2: { cls: 'HardwareSerial' },
  WiFi: { cls: 'WiFiClass', header: 'WiFi.h' },
  Wire: { cls: 'TwoWire', header: 'Wire.h' },
  SPI: { cls: 'SPIClass', header: 'SPI.h' },
  ESP: { cls: 'EspClass' },
  GPIO: { cls: 'GpioRegs' },
};

export interface ClassMeta {
  methods: Record<string, string>;
  fields?: Record<string, string>;
  /** статические методы: Adafruit_NeoPixel::Color */
  statics?: Record<string, string>;
  /** приводится к bool в условиях */
  truthy?: boolean;
}

const PRINT: Record<string, string> = { print: '~uint32', println: '~uint32', write: 'uint32', printf: 'uint32', flush: 'void' };

export const CLASSES: Record<string, ClassMeta> = {
  HardwareSerial: {
    methods: {
      ...PRINT, begin: 'void', end: 'void', available: 'int', read: 'int', peek: 'int', readString: '*String',
      readStringUntil: '*String', readBytes: '*uint32', readBytesUntil: '*uint32', parseInt: '*int', parseFloat: '*float',
      setTimeout: 'void', availableForWrite: 'int', find: '*bool', setRxBufferSize: 'uint32', updateBaudRate: 'void',
      baudRate: 'uint32', setDebugOutput: 'void', onReceive: 'void',
    },
    truthy: true,
  },
  WiFiClass: {
    methods: {
      begin: 'int', status: 'int', localIP: 'IPAddress', macAddress: 'String', SSID: 'String', RSSI: 'int',
      BSSIDstr: 'String', encryptionType: 'int', scanNetworks: '*int', scanComplete: 'int', scanDelete: 'void',
      disconnect: 'bool', mode: 'bool', getMode: 'int', softAP: 'bool', softAPConfig: 'bool', softAPIP: 'IPAddress',
      softAPgetStationNum: 'int', softAPdisconnect: 'bool', softAPmacAddress: 'String', config: 'bool',
      setHostname: 'bool', getHostname: 'cstr', reconnect: 'bool', setAutoReconnect: 'bool', setAutoConnect: 'bool',
      isConnected: 'bool', gatewayIP: 'IPAddress', subnetMask: 'IPAddress', dnsIP: 'IPAddress', channel: 'int',
      hostByName: '*int', persistent: 'void', setSleep: 'bool', waitForConnectResult: '*uint8', setTxPower: 'bool',
      onEvent: 'int',
    },
  },
  IPAddress: { methods: { toString: 'String', fromString: 'bool' }, truthy: true },
  HTTPClient: {
    methods: {
      begin: 'bool', GET: '*int', POST: '*int', PUT: '*int', PATCH: '*int', DELETE: '*int', sendRequest: '*int',
      getString: 'String', getSize: 'int', addHeader: 'void', setTimeout: 'void', setConnectTimeout: 'void', end: 'void',
      errorToString: 'String', setAuthorization: 'void', header: 'String', hasHeader: 'bool', collectHeaders: 'void',
      setReuse: 'void', setFollowRedirects: 'void', setUserAgent: 'void', connected: 'bool', getLocation: 'String',
    },
  },
  WiFiClient: {
    methods: { ...PRINT, connect: '*int', connected: 'uint8', stop: 'void', available: 'int', read: 'int', readStringUntil: '*String', readString: '*String', setInsecure: 'void', setCACert: 'void', setTimeout: 'void' },
    truthy: true,
  },
  WiFiClientSecure: {
    methods: { ...PRINT, connect: '*int', connected: 'uint8', stop: 'void', available: 'int', read: 'int', readStringUntil: '*String', readString: '*String', setInsecure: 'void', setCACert: 'void', setTimeout: 'void' },
    truthy: true,
  },
  PubSubClient: {
    methods: {
      setServer: 'PubSubClient', setCallback: 'PubSubClient', setClient: 'PubSubClient', connect: '*bool',
      connected: 'bool', publish: 'bool', publish_P: 'bool', subscribe: 'bool', unsubscribe: 'bool', loop: '*bool',
      state: 'int', disconnect: 'void', setBufferSize: 'bool', getBufferSize: 'uint16', setKeepAlive: 'PubSubClient',
      setSocketTimeout: 'PubSubClient',
    },
  },
  WebServer: {
    methods: {
      on: 'void', onNotFound: 'void', begin: 'void', handleClient: '*void', send: 'void', send_P: 'void',
      sendHeader: 'void', arg: 'String', hasArg: 'bool', args: 'int', argName: 'String', uri: 'String', method: 'int',
      close: 'void', stop: 'void', setContentLength: 'void', sendContent: 'void', header: 'String', hasHeader: 'bool',
      redirect: 'void',
    },
  },
  DHT: {
    methods: { begin: 'void', readTemperature: 'float', readHumidity: 'float', computeHeatIndex: 'float', convertCtoF: 'float', convertFtoC: 'float', read: 'bool' },
  },
  Servo: {
    methods: { attach: 'int', detach: 'void', write: 'void', writeMicroseconds: 'void', read: 'int', readMicroseconds: 'int', attached: 'bool', setPeriodHertz: 'void' },
  },
  LiquidCrystal_I2C: {
    methods: {
      ...PRINT, init: 'void', begin: 'void', clear: 'void', home: 'void', setCursor: 'void', backlight: 'void',
      noBacklight: 'void', setBacklight: 'void', display: 'void', noDisplay: 'void', cursor: 'void', noCursor: 'void',
      blink: 'void', noBlink: 'void', scrollDisplayLeft: 'void', scrollDisplayRight: 'void', createChar: 'void',
      leftToRight: 'void', rightToLeft: 'void', autoscroll: 'void', noAutoscroll: 'void', printstr: 'void',
      cursor_on: 'void', cursor_off: 'void', blink_on: 'void', blink_off: 'void', load_custom_character: 'void',
    },
  },
  Adafruit_SSD1306: {
    methods: {
      ...PRINT, begin: 'bool', clearDisplay: 'void', display: 'void', setTextSize: 'void', setTextColor: 'void',
      setCursor: 'void', drawPixel: 'void', drawLine: 'void', drawFastHLine: 'void', drawFastVLine: 'void',
      drawRect: 'void', fillRect: 'void', drawCircle: 'void', fillCircle: 'void', drawRoundRect: 'void',
      fillRoundRect: 'void', drawTriangle: 'void', fillTriangle: 'void', drawBitmap: 'void', invertDisplay: 'void',
      setRotation: 'void', width: 'int16', height: 'int16', getCursorX: 'int16', getCursorY: 'int16',
      setTextWrap: 'void', dim: 'void', startscrollright: 'void', startscrollleft: 'void', stopscroll: 'void',
      cp437: 'void', fillScreen: 'void', drawChar: 'void', getPixel: 'bool', setFont: 'void',
    },
  },
  Adafruit_NeoPixel: {
    methods: {
      begin: 'void', show: 'void', setPixelColor: 'void', getPixelColor: 'uint32', clear: 'void', setBrightness: 'void',
      getBrightness: 'uint8', numPixels: 'uint16', Color: 'uint32', ColorHSV: 'uint32', gamma32: 'uint32', gamma8: 'uint8',
      fill: 'void', updateLength: 'void', setPin: 'void', canShow: 'bool', rainbow: 'void',
    },
    statics: { Color: 'uint32', ColorHSV: 'uint32', gamma32: 'uint32', gamma8: 'uint8' },
  },
  Preferences: {
    methods: {
      begin: 'bool', end: 'void', clear: 'bool', remove: 'bool', isKey: 'bool', freeEntries: 'uint32',
      putInt: 'uint32', getInt: 'int', putUInt: 'uint32', getUInt: 'uint32', putLong: 'uint32', getLong: 'int',
      putULong: 'uint32', getULong: 'uint32', putShort: 'uint32', getShort: 'int16', putUShort: 'uint32',
      getUShort: 'uint16', putChar: 'uint32', getChar: 'int8', putUChar: 'uint32', getUChar: 'uint8',
      putFloat: 'uint32', getFloat: 'float', putDouble: 'uint32', getDouble: 'double', putBool: 'uint32',
      getBool: 'bool', putString: 'uint32', getString: 'String', putBytes: 'uint32', getBytes: 'uint32',
      getBytesLength: 'uint32',
    },
  },
  TwoWire: {
    methods: {
      begin: 'bool', beginTransmission: 'void', write: 'uint32', endTransmission: 'uint8', requestFrom: 'uint8',
      available: 'int', read: 'int', peek: 'int', setClock: 'void', end: 'bool', setPins: 'bool', getClock: 'uint32',
      setTimeOut: 'void',
    },
  },
  SPIClass: {
    methods: {
      begin: 'void', end: 'void', transfer: 'uint8', transfer16: 'uint16', transfer32: 'uint32', beginTransaction: 'void',
      endTransaction: 'void', setFrequency: 'void', setDataMode: 'void', setBitOrder: 'void', setClockDivider: 'void',
      write: 'void', write16: 'void', write32: 'void', transferBytes: 'void', writeBytes: 'void',
    },
  },
  SPISettings: { methods: {} },
  EspClass: {
    methods: {
      restart: '*void', getFreeHeap: 'uint32', getHeapSize: 'uint32', getMinFreeHeap: 'uint32', getMaxAllocHeap: 'uint32',
      getChipModel: 'cstr', getChipRevision: 'uint8', getCpuFreqMHz: 'uint32', getChipCores: 'uint8',
      getEfuseMac: 'uint64', getFlashChipSize: 'uint32', getFlashChipSpeed: 'uint32', getSdkVersion: 'cstr',
      getCycleCount: 'uint32', deepSleep: '*void', getSketchSize: 'uint32', getFreeSketchSpace: 'uint32',
      getPsramSize: 'uint32', getFreePsram: 'uint32',
    },
  },
  GpioRegs: {
    methods: {},
    fields: {
      out: 'uint32', out_w1ts: 'uint32', out_w1tc: 'uint32', enable: 'uint32', enable_w1ts: 'uint32',
      enable_w1tc: 'uint32', in: 'uint32', in1: 'GpioReg1', out1: 'GpioReg1', out1_w1ts: 'GpioReg1',
      out1_w1tc: 'GpioReg1', enable1: 'GpioReg1', enable1_w1ts: 'GpioReg1', enable1_w1tc: 'GpioReg1',
    },
  },
  GpioReg1: { methods: {}, fields: { val: 'uint32', data: 'uint32' } },
  Ticker: { methods: { attach: 'void', attach_ms: 'void', once: 'void', once_ms: 'void', detach: 'void', active: 'bool' } },
  DeserializationError: { methods: { c_str: 'cstr', code: 'int', f_str: 'cstr' }, truthy: true },
  hw_timer_t: { methods: {} },
  TaskHandle_t: { methods: {} },
  SemaphoreHandle_t: { methods: {} },
  QueueHandle_t: { methods: {} },
  TimerHandle_t: { methods: {} },
  EventGroupHandle_t: { methods: {} },
  portMUX_TYPE: { methods: {} },
  JsonPair: { methods: { key: 'String', value: 'json' } },
};

/** Методы JSON-значений (JsonDocument/JsonObject/JsonArray/JsonVariant). */
export const JSON_METHODS: Record<string, string> = {
  containsKey: 'bool', size: 'uint32', add: 'json', createNestedObject: 'json', createNestedArray: 'json',
  clear: 'void', remove: 'void', isNull: 'bool', set: 'bool', memoryUsage: 'uint32', overflowed: 'bool',
  shrinkToFit: 'void', garbageCollect: 'bool', nesting: 'int', capacity: 'uint32', to: 'json', getMember: 'json',
  getElement: 'json', c_str: 'cstr', isEmpty: 'bool',
};

/** Имена типов JSON, которые на уровне транслятора — это одно значение json. */
export const JSON_TYPES = new Set([
  'DynamicJsonDocument', 'StaticJsonDocument', 'JsonDocument', 'JsonObject', 'JsonArray', 'JsonVariant',
  'JsonObjectConst', 'JsonArrayConst', 'JsonVariantConst', 'JsonString',
]);
export const JSON_DOC_TYPES = new Set(['DynamicJsonDocument', 'StaticJsonDocument', 'JsonDocument']);

/** Встроенные заголовки, не требующие библиотек (для проверки #include). */
export const KNOWN_HEADERS = new Set([
  'Arduino.h', 'WiFi.h', 'HTTPClient.h', 'WebServer.h', 'ArduinoJson.h', 'PubSubClient.h', 'Wire.h', 'SPI.h',
  'DHT.h', 'DHT_U.h', 'Adafruit_Sensor.h', 'ESP32Servo.h', 'Servo.h', 'LiquidCrystal_I2C.h', 'Adafruit_NeoPixel.h',
  'Adafruit_GFX.h', 'Adafruit_SSD1306.h', 'Preferences.h', 'Ticker.h', 'HardwareSerial.h', 'WiFiClient.h',
  'WiFiClientSecure.h', 'esp_system.h', 'esp_wifi.h', 'freertos/FreeRTOS.h', 'freertos/task.h', 'freertos/queue.h',
  'freertos/semphr.h', 'driver/gpio.h', 'driver/ledc.h', 'soc/gpio_reg.h', 'soc/soc.h', 'soc/gpio_struct.h',
  'esp32-hal-ledc.h', 'esp32-hal-timer.h', 'stdio.h', 'stdlib.h', 'string.h', 'math.h', 'stdint.h', 'cstdint',
  'cstring', 'cmath', 'cstdio', 'time.h', 'Print.h', 'Stream.h', 'esp_sleep.h', 'esp_task_wdt.h', 'WiFiMulti.h',
  'ctype.h', 'limits.h', 'float.h', 'esp_timer.h', 'rom/gpio.h', 'esp32-hal.h', 'WString.h', 'pgmspace.h',
  'avr/pgmspace.h', 'Esp.h', 'esp_random.h',
]);

/** Подсказки для заголовков, которые не поддерживаются. */
export const HEADER_HINTS: Record<string, string> = {
  'LiquidCrystal.h': 'Используйте дисплей с I²C-переходником: #include <LiquidCrystal_I2C.h>',
  'ESP8266WiFi.h': 'Это библиотека для ESP8266. Для ESP32 — #include <WiFi.h>',
  'ESP8266HTTPClient.h': 'Для ESP32 — #include <HTTPClient.h>',
  'ESP8266WebServer.h': 'Для ESP32 — #include <WebServer.h>',
  'EEPROM.h': 'В симуляторе вместо EEPROM используйте Preferences: #include <Preferences.h>',
  'SoftwareSerial.h': 'У ESP32 есть три аппаратных UART: используйте Serial2.begin(9600, SERIAL_8N1, RX, TX)',
  'avr/io.h': 'Регистры AVR (Arduino Uno) не подходят для ESP32',
};
