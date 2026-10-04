import type { Practice } from '../types';
import { bare, codeUses } from '../helpers';
import { needWifi, wifi } from './c-helpers';

const OPEN_RE = /откр|open|без парол|🔓|free|свобод/i;

export const wifiLab: Practice = {
  id: 'm4-wifi',
  module: 4,
  order: 1,
  kind: 'lab',
  title: 'Выход в эфир',
  subtitle: 'Сканируем Wi-Fi и подключаемся к сети',
  difficulty: 1,
  xp: 60,
  minutes: 20,
  tags: ['Wi-Fi', 'STA и AP', 'RSSI', 'WiFi.scanNetworks'],
  story: `Антенну на мачте поставили обратно, и роутер в радиорубке снова мигает зелёным. Но какие сети вообще
слышны на станции и насколько сильный сигнал добивает до лаборатории? Сначала «прослушай эфир», а потом подключи
плату к сети станции **Samsung_IoT** — без этого Большая земля нас не услышит.`,
  goals: [
    'Просканировать эфир `WiFi.scanNetworks()` и напечатать каждую сеть: **имя (SSID)**, **RSSI** в дБм и пометку `открытая` / `закрытая`',
    'Подключиться к сети `Samsung_IoT` с паролем `IOT5iot5`, печатая точку каждые 500 мс, пока идёт подключение',
    'После подключения напечатать **IP-адрес** платы и **уровень сигнала** `WiFi.RSSI()`',
  ],
  theory: `### Два режима Wi-Fi

У ESP32 есть два основных режима:

* **STA (station, клиент)** — плата подключается к существующему роутеру, как телефон. Так мы выходим в интернет.
* **AP (access point, точка доступа)** — плата сама раздаёт Wi-Fi, к ней подключаются телефон или ноутбук.
  Интернета при этом нет, но можно открыть веб-страницу на самой плате.

\`\`\`cpp
#include <WiFi.h>

// режим клиента (STA)
WiFi.mode(WIFI_STA);
WiFi.begin("Samsung_IoT", "IOT5iot5");
while (WiFi.status() != WL_CONNECTED) {
  delay(500);
  Serial.print(".");
}
Serial.println(WiFi.localIP());

// режим точки доступа (AP)
WiFi.softAP("ESP32-Polar", "12345678");
Serial.println(WiFi.softAPIP());   // обычно 192.168.4.1
\`\`\`

Подключение занимает секунду-две, поэтому ждём в цикле, пока \`WiFi.status()\` не станет \`WL_CONNECTED\`.

### Сканирование эфира

\`\`\`cpp
int n = WiFi.scanNetworks();        // ~2 секунды, возвращает число сетей
for (int i = 0; i < n; i++) {
  String name = WiFi.SSID(i);       // имя сети
  int rssi = WiFi.RSSI(i);          // уровень сигнала, дБм
  bool open = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
}
\`\`\`

### RSSI — сила сигнала

RSSI измеряется в **дБм** и всегда отрицательный: чем ближе к нулю, тем лучше.

| RSSI | Качество |
|---|---|
| −30…−50 дБм | отличный сигнал, роутер рядом |
| −50…−67 дБм | хороший: видео, звонки |
| −67…−80 дБм | слабый: хватит для датчиков, но возможны обрывы |
| ниже −80 дБм | на грани: соединение нестабильно |

Каждые −3 дБ — это вдвое меньше мощности, −10 дБ — в 10 раз меньше.

### Что ослабляет сигнал

| Препятствие | Ослабление |
|---|---|
| Деревянная дверь, гипсокартон | малое (3–4 дБ) |
| Обычное стекло | 2–4 дБ |
| Кирпичная стена | 6–10 дБ |
| Бетонная стена, перекрытие | 10–20 дБ |
| Металл (сейф, обшивка, лифт) | 20 дБ и больше, почти полностью |
| Вода, аквариум, человеческое тело | сильное: 2,4 ГГц хорошо поглощается водой |
| Микроволновка, Bluetooth, соседние сети на том же канале | помехи |

### Каналы 2,4 ГГц

ESP32 работает только в диапазоне **2,4 ГГц** (5 ГГц не поддерживает!). В нём 13 каналов по 20 МГц,
но они пересекаются: не мешают друг другу только **1, 6 и 11**. Если две сети висят на одном канале — они
делят эфир и обе работают медленнее.`,
  hints: [
    'Сначала сканирование: `int n = WiFi.scanNetworks();`, затем цикл `for` от 0 до n.',
    'Внутри цикла: `WiFi.SSID(i)`, `WiFi.RSSI(i)` и `WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "открытая" : "закрытая"`.',
    'Подключение: `WiFi.begin(ssid, password);` и `while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }`',
    'После цикла: `Serial.println(WiFi.localIP());` и `Serial.println(WiFi.RSSI());`',
  ],
  starterCode: `#include <WiFi.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  Serial.println("Сканирую эфир...");
  // TODO: просканируйте сети и напечатайте для каждой:
  //       номер, SSID, RSSI (дБм) и "открытая"/"закрытая"

  // TODO: подключитесь к сети ssid/password,
  //       печатая "." каждые 500 мс, пока нет соединения

  // TODO: напечатайте IP-адрес и RSSI текущего подключения
}

void loop() {
}
`,
  starterCircuit: bare(),
  circuitLocked: true,
  solution: {
    code: `#include <WiFi.h>

const char* ssid = "Samsung_IoT";
const char* password = "IOT5iot5";

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  Serial.println("Сканирую эфир...");
  int n = WiFi.scanNetworks();
  Serial.print("Найдено сетей: ");
  Serial.println(n);
  for (int i = 0; i < n; i++) {
    bool open = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
    Serial.printf("%d. %s  %d dBm  %s\\n", i + 1, WiFi.SSID(i).c_str(), WiFi.RSSI(i), open ? "открытая" : "закрытая");
  }

  Serial.print("Подключаюсь к ");
  Serial.print(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP-адрес: ");
  Serial.println(WiFi.localIP());
  Serial.print("Сигнал: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
}

void loop() {
}
`,
  },
  checks: [
    {
      id: 'scan',
      title: 'Список сетей: SSID, RSSI и открытая/закрытая',
      run: async (h) => {
        await h.wait(4000);
        const aps = h.net.aps();
        const lines = h.serialLines();
        const lineFor = (ssid: string) => lines.find((l) => l.includes(ssid) && /-\d{2}/.test(l));
        const found = aps.filter((a) => lineFor(a.ssid));
        h.expect(codeUses(h, /scanNetworks\s*\(/), 'Для сканирования вызовите WiFi.scanNetworks()');
        h.expect(found.length >= 3, `В Serial найдено ${found.length} сетей с уровнем сигнала, а вокруг их ${aps.length}. Печатайте для каждой сети WiFi.SSID(i) и WiFi.RSSI(i) в одной строке`);
        const open = aps.find((a) => a.pass === null && lineFor(a.ssid));
        const closed = aps.find((a) => a.pass !== null && lineFor(a.ssid));
        h.expect(!!open && OPEN_RE.test(lineFor(open.ssid)!), `Сеть «${open?.ssid ?? 'Wokwi-GUEST'}» без пароля — пометьте её словом «открытая» (сравните WiFi.encryptionType(i) с WIFI_AUTH_OPEN)`);
        h.expect(!!closed && !OPEN_RE.test(lineFor(closed.ssid)!), `Сеть «${closed?.ssid ?? 'Samsung_IoT'}» защищена паролем, а помечена как открытая`);
      },
    },
    {
      id: 'connect',
      title: 'Подключение к Samsung_IoT с ожиданием в цикле',
      run: async (h) => {
        // момент вызова WiFi.begin() — с него и до подключения должны печататься точки
        let beginMark = -1;
        const ok = await h.waitFor(() => {
          if (beginMark < 0 && wifi(h).ssid) beginMark = h.mark();
          return wifi(h).st === 3;
        }, 12000, 20);
        h.expect(beginMark >= 0, 'Плата даже не пытается подключиться: вызовите WiFi.begin(ssid, password)');
        h.expect(ok, 'За 12 с плата не подключилась к Wi-Fi. Проверьте имя сети и пароль: Samsung_IoT / IOT5iot5');
        h.expect(wifi(h).ssid === 'Samsung_IoT', `Плата подключилась к «${wifi(h).ssid}», а нужна сеть Samsung_IoT`);
        const during = h.serialSince(beginMark).replace(/\d+(\.\d+)+/g, '');
        h.expect(during.includes('.'), 'Пока идёт подключение, печатайте точку каждые 500 мс — так видно, что плата не зависла');
      },
    },
    {
      id: 'ip',
      title: 'Напечатаны IP-адрес и уровень сигнала',
      run: async (h) => {
        await needWifi(h, 12000);
        const mark = h.mark();
        await h.wait(1500);
        const out = h.serialSince(mark);
        const ip = wifi(h).ip.toString();
        h.expect(out.includes(ip), `После подключения не напечатан IP-адрес платы (${ip}). Используйте Serial.println(WiFi.localIP());`);
        const rssi = h.numbers(out).filter((x) => x < -20 && x > -100);
        h.expect(rssi.length > 0, 'После подключения напечатайте уровень сигнала WiFi.RSSI() — отрицательное число в дБм');
        h.expect(rssi.some((x) => Math.abs(x - -48) <= 10), `Напечатанный RSSI (${rssi[0]} дБм) не похож на сигнал сети Samsung_IoT (около −48 дБм) — печатайте WiFi.RSSI() без номера сети`);
      },
    },
  ],
};
