// Описание компонентов: выводы, размеры, свойства и «органы управления».
// Координаты — в условных единицах, шаг выводов 10 (= 2.54 мм).

export interface PinDef {
  name: string;
  x: number;
  y: number;
  label?: string;
  /** номер GPIO для выводов ESP32 */
  gpio?: number;
  /** тип вывода для подсказок */
  kind?: 'gnd' | '3v3' | '5v' | 'gpio' | 'in' | 'out' | 'io' | 'nc' | 'en';
}

export interface PropDef {
  key: string;
  label: string;
  type: 'select' | 'number' | 'text' | 'bool';
  options?: { value: string | number; label: string }[];
  default: string | number | boolean;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** показывать как регулятор во время симуляции */
  live?: boolean;
  /** логарифмическая шкала регулятора */
  log?: boolean;
}

export interface CompDef {
  type: string;
  title: string;
  category: 'Плата' | 'Основное' | 'Датчики' | 'Исполнители' | 'Дисплеи' | 'Связь и отладка';
  description: string;
  /** рамка выделения в локальных координатах [x, y, w, h] */
  box: [number, number, number, number];
  pins: PinDef[];
  props: PropDef[];
  /** группы внутренне соединённых выводов */
  bus?: string[][];
  /** ключевые слова для поиска в палитре */
  keywords?: string[];
}

// ---------------- ESP32 DevKit V1 (30 выводов) ----------------
const ESP_TOP = ['VIN', 'GND.1', 'D13', 'D12', 'D14', 'D27', 'D26', 'D25', 'D33', 'D32', 'D35', 'D34', 'VN', 'VP', 'EN'];
const ESP_BOTTOM = ['3V3', 'GND.2', 'D15', 'D2', 'D4', 'RX2', 'TX2', 'D5', 'D18', 'D19', 'D21', 'RX0', 'TX0', 'D22', 'D23'];
const ESP_GPIO: Record<string, number> = {
  D13: 13, D12: 12, D14: 14, D27: 27, D26: 26, D25: 25, D33: 33, D32: 32, D35: 35, D34: 34, VN: 39, VP: 36,
  D15: 15, D2: 2, D4: 4, RX2: 16, TX2: 17, D5: 5, D18: 18, D19: 19, D21: 21, RX0: 3, TX0: 1, D22: 22, D23: 23,
};

function espPins(): PinDef[] {
  const pins: PinDef[] = [];
  const kindOf = (n: string): PinDef['kind'] =>
    n.startsWith('GND') ? 'gnd' : n === '3V3' ? '3v3' : n === 'VIN' ? '5v' : n === 'EN' ? 'en' : 'gpio';
  const labelOf = (n: string) => (n.startsWith('GND') ? 'GND' : n);
  ESP_TOP.forEach((n, i) => pins.push({ name: n, x: 40 + i * 10, y: 10, gpio: ESP_GPIO[n], kind: kindOf(n), label: labelOf(n) }));
  ESP_BOTTOM.forEach((n, i) => pins.push({ name: n, x: 40 + i * 10, y: 90, gpio: ESP_GPIO[n], kind: kindOf(n), label: labelOf(n) }));
  return pins;
}

// ---------------- макетная плата ----------------
export const BB_COLS = 30;
const BB_ROWS_TOP = ['a', 'b', 'c', 'd', 'e'];
const BB_ROWS_BOT = ['f', 'g', 'h', 'i', 'j'];
export const BB_ROW_Y: Record<string, number> = { tn: 10, tp: 20, a: 50, b: 60, c: 70, d: 80, e: 90, f: 120, g: 130, h: 140, i: 150, j: 160, bp: 190, bn: 200 };

function bbPins(): { pins: PinDef[]; bus: string[][] } {
  const pins: PinDef[] = [];
  const bus: string[][] = [];
  for (let c = 0; c < BB_COLS; c++) {
    const x = 20 + c * 10;
    const top: string[] = [];
    const bot: string[] = [];
    for (const r of BB_ROWS_TOP) { const n = `${r}${c + 1}`; pins.push({ name: n, x, y: BB_ROW_Y[r] }); top.push(n); }
    for (const r of BB_ROWS_BOT) { const n = `${r}${c + 1}`; pins.push({ name: n, x, y: BB_ROW_Y[r] }); bot.push(n); }
    bus.push(top, bot);
  }
  for (const rail of ['tn', 'tp', 'bp', 'bn']) {
    const group: string[] = [];
    for (let c = 0; c < BB_COLS; c++) {
      if (c % 6 === 5) continue;
      const n = `${rail}${c + 1}`;
      pins.push({ name: n, x: 20 + c * 10, y: BB_ROW_Y[rail], kind: rail.endsWith('n') ? 'gnd' : undefined });
      group.push(n);
    }
    bus.push(group);
  }
  return { pins, bus };
}

const bb = bbPins();

const LED_COLORS = [
  { value: 'red', label: 'Красный' },
  { value: 'green', label: 'Зелёный' },
  { value: 'yellow', label: 'Жёлтый' },
  { value: 'blue', label: 'Синий' },
  { value: 'white', label: 'Белый' },
  { value: 'orange', label: 'Оранжевый' },
];

export const COMPONENTS: CompDef[] = [
  {
    type: 'esp32', title: 'ESP32 DevKit V1', category: 'Плата',
    description: 'Плата с микроконтроллером ESP32: 240 МГц, Wi-Fi, Bluetooth. Встроенный синий светодиод на GPIO2.',
    box: [0, 0, 220, 100], pins: espPins(), props: [],
    bus: [['GND.1', 'GND.2']],
    keywords: ['esp', 'плата', 'микроконтроллер'],
  },
  {
    type: 'breadboard', title: 'Макетная плата', category: 'Плата',
    description: 'Беспаечная макетка: отверстия в столбике из 5 соединены между собой, длинные линии по краям — шины питания.',
    box: [0, 0, 340, 210], pins: bb.pins, props: [], bus: bb.bus,
    keywords: ['breadboard', 'макетка'],
  },
  {
    type: 'led', title: 'Светодиод', category: 'Основное',
    description: 'Светодиод 5 мм. Длинная ножка — анод (+), короткая — катод (−). Нужен резистор 150–330 Ом!',
    box: [-6, -36, 22, 38],
    pins: [{ name: 'C', x: 0, y: 0, label: 'Катод (−)' }, { name: 'A', x: 10, y: 0, label: 'Анод (+)' }],
    props: [{ key: 'color', label: 'Цвет', type: 'select', options: LED_COLORS, default: 'red' }],
    keywords: ['led', 'диод', 'лампочка'],
  },
  {
    type: 'resistor', title: 'Резистор', category: 'Основное',
    description: 'Ограничивает ток. Полоски кодируют номинал.',
    box: [0, -6, 40, 12],
    pins: [{ name: '1', x: 0, y: 0 }, { name: '2', x: 40, y: 0 }],
    props: [{
      key: 'value', label: 'Сопротивление', type: 'select', default: 220, unit: 'Ом',
      options: [10, 47, 100, 150, 220, 330, 470, 1000, 2200, 4700, 10000, 22000, 47000, 100000, 1000000].map((v) => ({ value: v, label: fmtOhm(v) })),
    }],
    keywords: ['resistor', 'сопротивление'],
  },
  {
    type: 'button', title: 'Кнопка', category: 'Основное',
    description: 'Тактовая кнопка: пока нажата — замыкает два вывода. Удерживайте Shift, чтобы зафиксировать.',
    box: [-4, -24, 28, 26],
    pins: [{ name: '1', x: 0, y: 0 }, { name: '2', x: 20, y: 0 }],
    props: [
      { key: 'color', label: 'Цвет', type: 'select', options: [{ value: 'red', label: 'Красная' }, { value: 'green', label: 'Зелёная' }, { value: 'blue', label: 'Синяя' }, { value: 'yellow', label: 'Жёлтая' }, { value: 'black', label: 'Чёрная' }, { value: 'white', label: 'Белая' }], default: 'red' },
      { key: 'label', label: 'Подпись', type: 'text', default: '' },
      { key: 'bounce', label: 'Дребезг контактов', type: 'bool', default: false },
      { key: 'key', label: 'Клавиша', type: 'text', default: '' },
    ],
    keywords: ['button', 'кнопка', 'switch'],
  },
  {
    type: 'switch', title: 'Переключатель', category: 'Основное',
    description: 'Ползунковый переключатель: средний вывод соединяется с левым или правым.',
    box: [-5, -22, 30, 24],
    pins: [{ name: '1', x: 0, y: 0 }, { name: 'C', x: 10, y: 0, label: 'Общий' }, { name: '2', x: 20, y: 0 }],
    props: [{ key: 'on', label: 'Положение «2»', type: 'bool', default: false, live: true }],
    keywords: ['switch', 'тумблер'],
  },
  {
    type: 'pot', title: 'Потенциометр', category: 'Основное',
    description: 'Переменный резистор — делитель напряжения. Средний вывод подключают к входу АЦП.',
    box: [-10, -40, 40, 42],
    pins: [{ name: 'GND', x: 0, y: 0 }, { name: 'SIG', x: 10, y: 0 }, { name: 'VCC', x: 20, y: 0 }],
    props: [
      { key: 'value', label: 'Сопротивление', type: 'select', default: 10000, options: [{ value: 1000, label: '1 кОм' }, { value: 10000, label: '10 кОм' }, { value: 100000, label: '100 кОм' }] },
      { key: 'position', label: 'Положение', type: 'number', default: 50, min: 0, max: 100, step: 1, unit: '%', live: true },
    ],
    keywords: ['potentiometer', 'потенциометр', 'регулятор', 'крутилка'],
  },
  {
    type: 'ldr', title: 'Фоторезистор', category: 'Датчики',
    description: 'Сопротивление падает при увеличении освещённости (≈10 кОм при 10 лк). Подключайте как делитель с резистором 10 кОм.',
    box: [-5, -26, 20, 28],
    pins: [{ name: '1', x: 0, y: 0 }, { name: '2', x: 10, y: 0 }],
    props: [{ key: 'lux', label: 'Освещённость', type: 'number', default: 300, min: 0.1, max: 20000, step: 1, unit: 'лк', live: true, log: true }],
    keywords: ['ldr', 'photoresistor', 'свет', 'освещённость'],
  },
  {
    type: 'rgb', title: 'RGB-светодиод', category: 'Основное',
    description: 'Три светодиода в одном корпусе с общим катодом (COM → GND). Цвет смешивается ШИМ на каналах R, G, B.',
    box: [-4, -36, 38, 38],
    pins: [{ name: 'R', x: 0, y: 0 }, { name: 'COM', x: 10, y: 0, label: 'Общий катод' }, { name: 'G', x: 20, y: 0 }, { name: 'B', x: 30, y: 0 }],
    props: [{ key: 'common', label: 'Общий вывод', type: 'select', default: 'cathode', options: [{ value: 'cathode', label: 'Катод (→ GND)' }, { value: 'anode', label: 'Анод (→ 3V3)' }] }],
    keywords: ['rgb', 'цвет'],
  },
  {
    type: 'buzzer', title: 'Пищалка', category: 'Исполнители',
    description: 'Активная пищит сама от постоянного напряжения, пассивной нужен сигнал нужной частоты (tone()).',
    box: [-10, -30, 30, 32],
    pins: [{ name: 'PLUS', x: 0, y: 0, label: '+' }, { name: 'MINUS', x: 10, y: 0, label: '−' }],
    props: [{ key: 'kind', label: 'Тип', type: 'select', default: 'passive', options: [{ value: 'passive', label: 'Пассивная' }, { value: 'active', label: 'Активная' }] }],
    keywords: ['buzzer', 'звук', 'пищалка', 'зуммер'],
  },
  {
    type: 'relay', title: 'Модуль реле', category: 'Исполнители',
    description: 'Управляет мощной нагрузкой. IN = HIGH → COM соединяется с NO. NC — нормально замкнутый контакт.',
    box: [0, 0, 90, 50],
    pins: [
      { name: 'VCC', x: 0, y: 10, kind: '5v' }, { name: 'GND', x: 0, y: 20, kind: 'gnd' }, { name: 'IN', x: 0, y: 30, kind: 'in' },
      { name: 'NO', x: 90, y: 10, label: 'NO' }, { name: 'COM', x: 90, y: 20, label: 'COM' }, { name: 'NC', x: 90, y: 30, label: 'NC' },
    ],
    props: [{ key: 'trigger', label: 'Срабатывание', type: 'select', default: 'high', options: [{ value: 'high', label: 'Высоким уровнем' }, { value: 'low', label: 'Низким уровнем' }] }],
    keywords: ['relay', 'реле', 'замок'],
  },
  {
    type: 'motor', title: 'Вентилятор', category: 'Исполнители',
    description: 'Двигатель постоянного тока с крыльчаткой (≈12 Ом). Слишком мощный для вывода GPIO — включайте через реле.',
    box: [-15, -50, 50, 52],
    pins: [{ name: '1', x: 0, y: 0, label: '+' }, { name: '2', x: 20, y: 0, label: '−' }],
    props: [],
    keywords: ['motor', 'fan', 'вентилятор', 'мотор'],
  },
  {
    type: 'lamp', title: 'Лампа', category: 'Исполнители',
    description: 'Лампа накаливания 5 В (≈30 Ом). Включайте через реле от VIN.',
    box: [-10, -40, 40, 42],
    pins: [{ name: '1', x: 0, y: 0 }, { name: '2', x: 20, y: 0 }],
    props: [],
    keywords: ['lamp', 'лампа', 'свет'],
  },
  {
    type: 'lock', title: 'Электрозамок', category: 'Исполнители',
    description: 'Соленоидный замок 5 В: открывается, пока на нём есть напряжение. Подключайте через реле.',
    box: [-15, -46, 50, 48],
    pins: [{ name: '1', x: 0, y: 0, label: '+' }, { name: '2', x: 20, y: 0, label: '−' }],
    props: [],
    keywords: ['lock', 'замок', 'дверь', 'соленоид'],
  },
  {
    type: 'servo', title: 'Сервопривод', category: 'Исполнители',
    description: 'Поворачивается на угол 0–180°. Управляется импульсами 0.5–2.5 мс с частотой 50 Гц.',
    box: [-25, -80, 80, 82],
    pins: [{ name: 'GND', x: 0, y: 0, kind: 'gnd' }, { name: 'V+', x: 10, y: 0, kind: '5v' }, { name: 'PWM', x: 20, y: 0, kind: 'in' }],
    props: [{ key: 'horn', label: 'Насадка', type: 'select', default: 'arm', options: [{ value: 'arm', label: 'Качалка' }, { value: 'barrier', label: 'Шлагбаум' }, { value: 'pointer', label: 'Стрелка' }] }],
    keywords: ['servo', 'серво', 'шлагбаум', 'привод'],
  },
  {
    type: 'dht22', title: 'DHT22 / DHT11', category: 'Датчики',
    description: 'Цифровой датчик температуры и влажности (однопроводный протокол). Читать не чаще раза в 2 с.',
    box: [-5, -60, 40, 62],
    pins: [{ name: 'VCC', x: 0, y: 0, kind: '3v3' }, { name: 'DATA', x: 10, y: 0, kind: 'io' }, { name: 'NC', x: 20, y: 0, kind: 'nc' }, { name: 'GND', x: 30, y: 0, kind: 'gnd' }],
    props: [
      { key: 'model', label: 'Модель', type: 'select', default: 'DHT22', options: [{ value: 'DHT22', label: 'DHT22 (белый)' }, { value: 'DHT11', label: 'DHT11 (синий)' }] },
      { key: 'temperature', label: 'Температура', type: 'number', default: 24, min: -40, max: 80, step: 0.1, unit: '°C', live: true },
      { key: 'humidity', label: 'Влажность', type: 'number', default: 45, min: 0, max: 100, step: 0.5, unit: '%', live: true },
    ],
    keywords: ['dht', 'температура', 'влажность', 'термометр'],
  },
  {
    type: 'hcsr04', title: 'Дальномер HC-SR04', category: 'Датчики',
    description: 'Ультразвуковой датчик расстояния 2–400 см: импульс 10 мкс на TRIG, длительность ответа на ECHO ÷ 58 = см.',
    box: [-35, -50, 100, 52],
    pins: [{ name: 'VCC', x: 0, y: 0, kind: '5v' }, { name: 'TRIG', x: 10, y: 0, kind: 'in' }, { name: 'ECHO', x: 20, y: 0, kind: 'out' }, { name: 'GND', x: 30, y: 0, kind: 'gnd' }],
    props: [{ key: 'distance', label: 'Расстояние', type: 'number', default: 100, min: 1, max: 450, step: 1, unit: 'см', live: true }],
    keywords: ['ultrasonic', 'расстояние', 'дальномер', 'сонар', 'парктроник'],
  },
  {
    type: 'pir', title: 'Датчик движения', category: 'Датчики',
    description: 'PIR-датчик: при движении выдаёт HIGH на OUT несколько секунд.',
    box: [-15, -50, 50, 52],
    pins: [{ name: 'VCC', x: 0, y: 0, kind: '5v' }, { name: 'OUT', x: 10, y: 0, kind: 'out' }, { name: 'GND', x: 20, y: 0, kind: 'gnd' }],
    props: [{ key: 'hold', label: 'Время удержания', type: 'number', default: 3, min: 1, max: 30, step: 1, unit: 'с' }],
    keywords: ['pir', 'движение', 'сигнализация'],
  },
  {
    type: 'mq2', title: 'Датчик газа MQ-2', category: 'Датчики',
    description: 'AO — аналоговый сигнал (больше газа → выше напряжение), DO — LOW при превышении порога.',
    box: [-10, -55, 50, 57],
    pins: [{ name: 'VCC', x: 0, y: 0, kind: '5v' }, { name: 'GND', x: 10, y: 0, kind: 'gnd' }, { name: 'DO', x: 20, y: 0, kind: 'out' }, { name: 'AO', x: 30, y: 0, kind: 'out' }],
    props: [
      { key: 'ppm', label: 'Концентрация газа', type: 'number', default: 200, min: 100, max: 10000, step: 10, unit: 'ppm', live: true, log: true },
      { key: 'threshold', label: 'Порог DO', type: 'number', default: 1000, min: 200, max: 5000, step: 50, unit: 'ppm' },
    ],
    keywords: ['gas', 'газ', 'дым', 'mq'],
  },
  {
    type: 'lcd1602', title: 'Дисплей LCD 1602 I²C', category: 'Дисплеи',
    description: 'Символьный дисплей 16×2 с I²C-переходником (адрес 0x27). Библиотека LiquidCrystal_I2C.',
    box: [0, 0, 190, 70],
    pins: [{ name: 'GND', x: 0, y: 10, kind: 'gnd' }, { name: 'VCC', x: 0, y: 20, kind: '5v' }, { name: 'SDA', x: 0, y: 30, kind: 'io' }, { name: 'SCL', x: 0, y: 40, kind: 'in' }],
    props: [
      { key: 'address', label: 'Адрес I²C', type: 'select', default: 0x27, options: [{ value: 0x27, label: '0x27' }, { value: 0x3f, label: '0x3F' }] },
      { key: 'size', label: 'Размер', type: 'select', default: '16x2', options: [{ value: '16x2', label: '16×2' }, { value: '20x4', label: '20×4' }] },
    ],
    keywords: ['lcd', 'дисплей', 'экран', '1602', 'i2c'],
  },
  {
    type: 'oled', title: 'OLED 128×64', category: 'Дисплеи',
    description: 'Графический OLED-дисплей SSD1306 (I²C, адрес 0x3C). Библиотеки Adafruit_GFX + Adafruit_SSD1306.',
    box: [-15, -70, 60, 72],
    pins: [{ name: 'GND', x: 0, y: 0, kind: 'gnd' }, { name: 'VCC', x: 10, y: 0, kind: '3v3' }, { name: 'SCL', x: 20, y: 0, kind: 'in' }, { name: 'SDA', x: 30, y: 0, kind: 'io' }],
    props: [{ key: 'address', label: 'Адрес I²C', type: 'select', default: 0x3c, options: [{ value: 0x3c, label: '0x3C' }, { value: 0x3d, label: '0x3D' }] }],
    keywords: ['oled', 'ssd1306', 'дисплей', 'экран', 'графика'],
  },
  {
    type: 'neopixel', title: 'Кольцо NeoPixel', category: 'Дисплеи',
    description: 'Адресные RGB-светодиоды WS2812B, управление по одному проводу DIN. Библиотека Adafruit_NeoPixel.',
    box: [-25, -90, 80, 92],
    pins: [{ name: 'VCC', x: 0, y: 0, kind: '5v' }, { name: 'GND', x: 10, y: 0, kind: 'gnd' }, { name: 'DIN', x: 20, y: 0, kind: 'in' }, { name: 'DOUT', x: 30, y: 0, kind: 'out' }],
    props: [{ key: 'count', label: 'Светодиодов', type: 'select', default: 12, options: [{ value: 8, label: '8' }, { value: 12, label: '12' }, { value: 16, label: '16' }, { value: 24, label: '24' }] }],
    keywords: ['neopixel', 'ws2812', 'rgb', 'лента', 'кольцо'],
  },
  {
    type: 'logic', title: 'Логический анализатор', category: 'Связь и отладка',
    description: 'Записывает уровни на 8 каналах — видно, как передаются биты по UART, SPI и I²C. График — во вкладке «Анализатор».',
    box: [-5, -40, 95, 42],
    pins: [...Array.from({ length: 8 }, (_, i) => ({ name: `D${i}`, x: i * 10, y: 0, kind: 'in' as const })), { name: 'GND', x: 80, y: 0, kind: 'gnd' }],
    props: [],
    keywords: ['logic', 'analyzer', 'анализатор', 'осциллограф'],
  },
  {
    type: 'uartbox', title: 'Чёрный ящик (UART)', category: 'Связь и отладка',
    description: 'Загадочное устройство, которое общается по UART. Подключите TX → RX2 (GPIO16), RX → TX2 (GPIO17).',
    box: [-10, -45, 50, 47],
    pins: [{ name: 'VCC', x: 0, y: 0, kind: '3v3' }, { name: 'GND', x: 10, y: 0, kind: 'gnd' }, { name: 'TX', x: 20, y: 0, kind: 'out' }, { name: 'RX', x: 30, y: 0, kind: 'in' }],
    props: [
      { key: 'baud', label: 'Скорость', type: 'select', default: 9600, options: [2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => ({ value: b, label: String(b) })) },
      { key: 'mode', label: 'Режим', type: 'select', default: 'beacon', options: [{ value: 'beacon', label: 'Маяк (шлёт сообщения)' }, { value: 'echo', label: 'Эхо' }, { value: 'cipher', label: 'Шифровка' }, { value: 'gps', label: 'GPS-модуль' }] },
      { key: 'secret', label: 'Секрет', type: 'text', default: 'POLAR' },
    ],
    keywords: ['uart', 'serial', 'ящик', 'gps'],
  },
  {
    type: 'i2cbox', title: 'Модуль-загадка (I²C)', category: 'Связь и отладка',
    description: 'Устройство на шине I²C с регистрами. Найдите его адрес сканером и прочитайте данные.',
    box: [-10, -45, 50, 47],
    pins: [{ name: 'VCC', x: 0, y: 0, kind: '3v3' }, { name: 'GND', x: 10, y: 0, kind: 'gnd' }, { name: 'SDA', x: 20, y: 0, kind: 'io' }, { name: 'SCL', x: 30, y: 0, kind: 'in' }],
    props: [
      { key: 'address', label: 'Адрес I²C', type: 'number', default: 0x42, min: 8, max: 119 },
      { key: 'secret', label: 'Секрет', type: 'text', default: 'IOT5' },
    ],
    keywords: ['i2c', 'регистры', 'загадка'],
  },
];

export const DEFS: Record<string, CompDef> = Object.fromEntries(COMPONENTS.map((c) => [c.type, c]));

export function fmtOhm(v: number): string {
  if (v >= 1e6) return `${v / 1e6} МОм`;
  if (v >= 1000) return `${v / 1000} кОм`;
  return `${v} Ом`;
}

// ---------------- документ схемы ----------------
export interface Part {
  id: string;
  type: string;
  x: number;
  y: number;
  /** поворот в градусах: 0, 90, 180, 270 */
  rot: number;
  props: Record<string, string | number | boolean>;
  /** нельзя удалить/сдвинуть (часть готовой схемы практики) */
  locked?: boolean;
}

export interface PinRef { part: string; pin: string }

export interface Wire {
  id: string;
  a: PinRef;
  b: PinRef;
  /** промежуточные точки изгиба */
  pts: [number, number][];
  color: string;
}

export interface CircuitDoc {
  parts: Part[];
  wires: Wire[];
}

export function propValue(p: Part, key: string): string | number | boolean {
  if (key in p.props) return p.props[key];
  const def = DEFS[p.type]?.props.find((d) => d.key === key);
  return def ? def.default : '';
}

/** Мировые координаты вывода с учётом поворота. */
export function pinPos(p: Part, pinName: string): [number, number] | null {
  const def = DEFS[p.type];
  const pin = def?.pins.find((x) => x.name === pinName);
  if (!pin) return null;
  return rotPoint(pin.x, pin.y, p.rot, p.x, p.y);
}

export function rotPoint(x: number, y: number, rot: number, ox: number, oy: number): [number, number] {
  switch (((rot % 360) + 360) % 360) {
    case 90: return [ox - y, oy + x];
    case 180: return [ox - x, oy - y];
    case 270: return [ox + y, oy - x];
    default: return [ox + x, oy + y];
  }
}

export function emptyCircuit(): CircuitDoc {
  return { parts: [{ id: 'esp', type: 'esp32', x: 0, y: 0, rot: 0, props: {}, locked: true }], wires: [] };
}
