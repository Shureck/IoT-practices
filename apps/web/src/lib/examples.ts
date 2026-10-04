// Готовые примеры для песочницы.
import type { CircuitDoc, Part, Wire } from '@esp32lab/sim';

const esp: Part = { id: 'esp', type: 'esp32', x: 0, y: 0, rot: 0, props: {} };
const w = (a: string, b: string, color = '#22c55e'): Wire => {
  const [pa, pina] = a.split(':');
  const [pb, pinb] = b.split(':');
  return { id: `w_${a}_${b}`.replace(/\W/g, '_'), a: { part: pa, pin: pina }, b: { part: pb, pin: pinb }, pts: [], color };
};
const part = (id: string, type: string, x: number, y: number, props: Part['props'] = {}): Part => ({ id, type, x, y, rot: 0, props });

export interface Example { id: string; title: string; description: string; code: string; circuit: CircuitDoc }

export const EMPTY_SKETCH = `void setup() {
  Serial.begin(115200);
  Serial.println("Привет, станция!");
}

void loop() {

}
`;

export const EXAMPLES: Example[] = [
  {
    id: 'blink', title: 'Мигалка', description: 'Встроенный светодиод GPIO2',
    code: `const int LED = 2;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, HIGH);
  delay(500);
  digitalWrite(LED, LOW);
  delay(500);
}
`,
    circuit: { parts: [esp], wires: [] },
  },
  {
    id: 'button-led', title: 'Кнопка и светодиод', description: 'INPUT_PULLUP, светодиод через резистор',
    code: `const int LED = 25;
const int BTN = 14;

void setup() {
  pinMode(LED, OUTPUT);
  pinMode(BTN, INPUT_PULLUP);   // кнопка замыкает на GND
}

void loop() {
  bool pressed = digitalRead(BTN) == LOW;
  digitalWrite(LED, pressed);
  delay(10);
}
`,
    circuit: {
      parts: [esp, part('r1', 'resistor', 250, -40, { value: 220 }), part('led1', 'led', 320, -40, { color: 'red' }), part('btn', 'button', 300, 150, { color: 'blue', key: 'b' })],
      wires: [w('esp:D25', 'r1:1'), w('r1:2', 'led1:A'), w('led1:C', 'esp:GND.1', '#111827'), w('esp:D14', 'btn:1', '#eab308'), w('btn:2', 'esp:GND.2', '#111827')],
    },
  },
  {
    id: 'dht-lcd', title: 'Метеостанция', description: 'DHT22 + дисплей LCD 1602 I²C',
    code: `#include <DHT.h>
#include <LiquidCrystal_I2C.h>

DHT dht(4, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  dht.begin();
  lcd.init();
  lcd.backlight();
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  lcd.setCursor(0, 0);
  lcd.print("T: "); lcd.print(t, 1); lcd.print(" C   ");
  lcd.setCursor(0, 1);
  lcd.print("H: "); lcd.print(h, 0); lcd.print(" %   ");
  delay(2000);
}
`,
    circuit: {
      parts: [esp, part('dht', 'dht22', 260, -40), part('lcd', 'lcd1602', 300, 60)],
      wires: [w('dht:VCC', 'esp:3V3', '#ef4444'), w('dht:GND', 'esp:GND.2', '#111827'), w('dht:DATA', 'esp:D4'),
        w('lcd:VCC', 'esp:VIN', '#ef4444'), w('lcd:GND', 'esp:GND.1', '#111827'), w('lcd:SDA', 'esp:D21', '#3b82f6'), w('lcd:SCL', 'esp:D22', '#eab308')],
    },
  },
  {
    id: 'servo-pot', title: 'Сервопривод и потенциометр', description: 'АЦП → угол сервопривода',
    code: `#include <ESP32Servo.h>

Servo servo;

void setup() {
  servo.attach(18);
}

void loop() {
  int raw = analogRead(34);
  int angle = map(raw, 0, 4095, 0, 180);
  servo.write(angle);
  delay(20);
}
`,
    circuit: {
      parts: [esp, part('pot', 'pot', 300, -40, { position: 30 }), part('srv', 'servo', 330, 200, { horn: 'pointer' })],
      wires: [w('pot:GND', 'esp:GND.1', '#111827'), w('pot:VCC', 'esp:3V3', '#ef4444'), w('pot:SIG', 'esp:D34', '#a855f7'),
        w('srv:GND', 'esp:GND.2', '#111827'), w('srv:V+', 'esp:VIN', '#ef4444'), w('srv:PWM', 'esp:D18', '#f97316')],
    },
  },
  {
    id: 'mqtt', title: 'MQTT-телеметрия', description: 'Wi-Fi + PubSubClient, вкладка «MQTT»',
    code: `#include <WiFi.h>
#include <PubSubClient.h>

WiFiClient net;
PubSubClient mqtt(net);

void onMessage(char* topic, byte* payload, unsigned int len) {
  String msg;
  for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];
  Serial.println(String("← ") + topic + ": " + msg);
  digitalWrite(2, msg == "on");
}

void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  WiFi.begin("Samsung_IoT", "IOT5iot5");
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.println("\\nWi-Fi OK");
  mqtt.setServer("mqtt.iot", 1883);
  mqtt.setCallback(onMessage);
}

void loop() {
  if (!mqtt.connected()) {
    String id = "esp32-" + String(random(10000));
    if (mqtt.connect(id.c_str())) mqtt.subscribe("sandbox/led");
    else { delay(1000); return; }
  }
  mqtt.loop();
  static unsigned long last = 0;
  if (millis() - last > 3000) {
    last = millis();
    mqtt.publish("sandbox/uptime", String(millis() / 1000).c_str());
  }
}
`,
    circuit: { parts: [esp], wires: [] },
  },
  {
    id: 'webserver', title: 'Веб-сервер', description: 'Страница управления на ESP32, вкладка «Браузер»',
    code: `#include <WiFi.h>
#include <WebServer.h>

WebServer server(80);
bool led = false;

void page() {
  String html = "<h1>Станция</h1><p>Свет: " + String(led ? "включён" : "выключен") + "</p>";
  html += "<a href='/toggle'><button>Переключить</button></a>";
  server.send(200, "text/html", html);
}

void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  WiFi.begin("Samsung_IoT", "IOT5iot5");
  while (WiFi.status() != WL_CONNECTED) delay(300);
  Serial.println(WiFi.localIP());
  server.on("/", page);
  server.on("/toggle", []() { led = !led; digitalWrite(2, led); page(); });
  server.begin();
}

void loop() {
  server.handleClient();
}
`,
    circuit: { parts: [esp], wires: [] },
  },
  {
    id: 'neopixel', title: 'Радуга NeoPixel', description: 'Адресные светодиоды WS2812',
    code: `#include <Adafruit_NeoPixel.h>

Adafruit_NeoPixel ring(12, 5, NEO_GRB + NEO_KHZ800);
long hue = 0;

void setup() {
  ring.begin();
  ring.setBrightness(80);
}

void loop() {
  for (int i = 0; i < ring.numPixels(); i++) {
    ring.setPixelColor(i, ring.ColorHSV(hue + i * 65536L / ring.numPixels()));
  }
  ring.show();
  hue += 512;
  delay(20);
}
`,
    circuit: {
      parts: [esp, part('ring', 'neopixel', 300, 20)],
      wires: [w('ring:VCC', 'esp:VIN', '#ef4444'), w('ring:GND', 'esp:GND.2', '#111827'), w('ring:DIN', 'esp:D5')],
    },
  },
];
