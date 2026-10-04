import type { CheckContext } from '@esp32lab/sim';
import type { Practice } from '../types';
import { circuit, p, w } from '../helpers';

const parts = () => [p('box', 'uartbox', 330, -40, { mode: 'cipher', baud: 9600, secret: 'AURORA' })];

/** Перехватить всё, что ESP32 отправляет в UART (кроме Serial0). */
function spyUart(h: CheckContext): () => string {
  const board = h.sim.board;
  const orig = board.uartTx.bind(board);
  let log = '';
  board.uartTx = (pin: number, bytes: number[], baud: number) => {
    if (pin !== 1) log += new TextDecoder().decode(new Uint8Array(bytes));
    orig(pin, bytes, baud);
  };
  return () => log;
}

function checkWiring(h: CheckContext) {
  const tx = h.gpioAt('box', 'TX');
  const rx = h.gpioAt('box', 'RX');
  h.expect(h.onNet('box', 'VCC', '3V3'), 'Ящик без питания: VCC → 3V3');
  h.expect(h.onGnd('box', 'GND'), 'Ящик без земли: GND → GND');
  if (tx.includes(17) || rx.includes(16)) h.fail('TX и RX нужно перекрестить: TX ящика (он передаёт) → RX2 платы (GPIO16), RX ящика → TX2 (GPIO17)');
  h.expect(tx.includes(16), 'Вывод TX ящика должен идти на RX2 платы (GPIO16)');
  h.expect(rx.includes(17), 'Вывод RX ящика должен идти на TX2 платы (GPIO17)');
}

export const blackbox: Practice = {
  id: 'm3-blackbox',
  module: 3,
  order: 5,
  kind: 'homework',
  title: 'Чёрный ящик',
  subtitle: 'Взламываем шифр старого прибора по UART',
  difficulty: 3,
  xp: 120,
  minutes: 45,
  tags: ['UART', 'Serial2', 'строки', 'шифр Цезаря', 'сборка схемы'],
  story: `В радиорубке стоит опечатанный блок управления антенной. На корпусе — четыре контакта и надпись
«UART 9600». Подключишься — блок начнёт бормотать какое-то слово, повторяя его раз в секунду. Старший
инженер перед отъездом успел сказать: «Он шифрует пароль. Спроси у него ключ — он скажет. Верни пароль
расшифрованным, и блок откроется». Пора поговорить с машиной на её языке.`,
  goals: [
    'Подключить ящик к **UART2**: питание от **3V3**, TX ящика → **RX2 (GPIO16)**, RX ящика → **TX2 (GPIO17)**',
    'Открыть порт: `Serial2.begin(9600, SERIAL_8N1, 16, 17)` и читать от ящика строки',
    'Отправить ящику строку `KEY?` и получить ответ вида `KEY=3`',
    'Расшифровать слово (сдвиг букв **назад** на ключ, шифр Цезаря) и напечатать его в Serial',
    'Отправить расшифрованное слово ящику и напечатать в Serial его ответ (`ACCESS GRANTED`)',
  ],
  theory: `### UART

UART — **асинхронный** последовательный интерфейс: общего тактового провода нет, поэтому обе стороны заранее
договариваются о **скорости** (бод = бит в секунду). Каждый байт уходит **кадром**:

\`\`\`
линия покоя = 1 │ старт (0) │ D0 D1 D2 D3 D4 D5 D6 D7 │ стоп (1) │
\`\`\`

Биты данных идут **младшим вперёд**. \`SERIAL_8N1\` — 8 бит данных, без бита чётности (*N*one), 1 стоп-бит.
При 9600 бод один бит длится 1/9600 с ≈ 104 мкс, а кадр из 10 бит — около 1 мс.

Провода **перекрещиваются**: то, что одно устройство передаёт (TX), другое принимает (RX).

\`\`\`
ESP32 TX2 (17) ──────► RX  ящик
ESP32 RX2 (16) ◄────── TX  ящик
ESP32 GND ──────────── GND
\`\`\`

### Serial2

У ESP32 три аппаратных UART. \`Serial\` (UART0) занят USB-переходником, а \`Serial2\` свободен:

\`\`\`cpp
Serial2.begin(9600, SERIAL_8N1, 16, 17);   // скорость, формат, RX, TX

Serial2.println("HELLO");                  // отправить строку (+ \\r\\n)
if (Serial2.available()) {
  String line = Serial2.readStringUntil('\\n');
  line.trim();                             // убрать \\r и пробелы
}
\`\`\`

Если скорости не совпадут, вместо текста придёт «мусор» — попробуйте ради интереса.`,
  hints: [
    'Сначала просто печатайте в Serial всё, что приходит из Serial2 — так вы увидите, что бормочет ящик.',
    'Ящик шлёт зашифрованное слово постоянно. Ответ на `KEY?` придёт отдельной строкой, начинающейся с `KEY=`: число после `=` — `line.substring(4).toInt()`.',
    'Расшифровка буквы: `c = \'A\' + (c - \'A\' - key + 26) % 26;` — для каждого символа строки (`line[i]`, `line.setCharAt(i, c)`).',
    'Удобная логика: пришла строка → если это `KEY=…`, запомнить ключ; если `ACCESS…` — напечатать; иначе, если ключа ещё нет, отправить `KEY?`, а если есть — расшифровать и отправить ответ.',
  ],
  starterCode: `// Блок управления антенной: UART, 9600 бод
const int RX2_PIN = 16;
const int TX2_PIN = 17;

void setup() {
  Serial.begin(115200);
  // TODO: откройте Serial2 на 9600 бод с выводами RX2_PIN, TX2_PIN
  Serial.println("Подключаюсь к блоку...");
}

void loop() {
  // TODO: читайте строки из Serial2
  // TODO: запросите ключ ("KEY?"), расшифруйте пароль, отправьте его обратно
}
`,
  starterCircuit: circuit(parts()),
  palette: ['uartbox', 'logic'],
  solution: {
    code: `const int RX2_PIN = 16;
const int TX2_PIN = 17;

int key = -1;
bool unlocked = false;

String decrypt(String s, int k) {
  for (int i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c >= 'A' && c <= 'Z') {
      c = 'A' + (c - 'A' - k + 26) % 26;
      s.setCharAt(i, c);
    }
  }
  return s;
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, RX2_PIN, TX2_PIN);
  Serial.println("Подключаюсь к блоку...");
}

void loop() {
  if (!Serial2.available()) return;
  String line = Serial2.readStringUntil('\\n');
  line.trim();
  if (line.length() == 0) return;
  Serial.print("Блок: ");
  Serial.println(line);

  if (line.startsWith("KEY=")) {
    key = line.substring(4).toInt();
    Serial.print("Ключ: ");
    Serial.println(key);
  } else if (line.startsWith("ACCESS")) {
    unlocked = true;
  } else if (unlocked) {
    // блок уже открыт — дальше просто слушаем
  } else if (key < 0) {
    Serial2.println("KEY?");
  } else {
    String secret = decrypt(line, key);
    Serial.print("Пароль: ");
    Serial.println(secret);
    Serial2.println(secret);
  }
}
`,
    circuit: circuit(parts(), [
      w('box:VCC', 'esp:3V3', 'red'),
      w('box:GND', 'esp:GND.2', 'black'),
      w('box:TX', 'esp:RX2', 'green'),
      w('box:RX', 'esp:TX2', 'blue'),
    ]),
  },
  checks: [
    {
      id: 'wiring',
      title: 'Ящик подключён к UART2 крест-накрест и запитан',
      run: async (h) => checkWiring(h),
    },
    {
      id: 'key',
      title: 'Программа запрашивает у ящика ключ',
      run: async (h) => {
        const sent = spyUart(h);
        await h.wait(4000);
        h.expect(sent().length > 0, 'ESP32 ничего не отправил ящику. Serial2.begin(9600, SERIAL_8N1, 16, 17) вызван? Отправка — Serial2.println("KEY?")');
        h.expect(/KEY\?/.test(sent()), `Ящик не получил запрос KEY? — пришло только: «${sent().trim().slice(0, 60)}»`);
      },
    },
    {
      id: 'secret',
      title: 'Пароль расшифрован и напечатан в Serial',
      run: async (h) => {
        await h.wait(6000);
        h.expect(h.serial.includes('AURORA'), 'В Serial нет расшифрованного пароля. Сдвигайте каждую букву назад на ключ из ответа KEY=…');
      },
    },
    {
      id: 'granted',
      title: 'Ящик ответил ACCESS GRANTED',
      run: async (h) => {
        await h.wait(6000);
        h.expect(h.serial.includes('ACCESS GRANTED'), 'В Serial нет ответа ящика «ACCESS GRANTED». Отправьте ящику расшифрованный пароль через Serial2.println() и напечатайте, что он ответит');
      },
    },
    {
      id: 'other',
      title: 'Работает и с другим паролем',
      run: async (h) => {
        h.set('box', 'secret', 'NORTHERNLIGHTS');
        await h.wait(6000);
        h.expect(h.serial.includes('NORTHERNLIGHTS'), 'Ящику сменили пароль, а программа его не расшифровала — пароль нужно получать от ящика, а не вписывать в код');
        h.expect(h.serial.includes('ACCESS GRANTED'), 'С новым паролем ящик так и не ответил ACCESS GRANTED');
      },
    },
  ],
};
