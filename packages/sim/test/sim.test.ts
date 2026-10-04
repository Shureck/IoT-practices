import { describe, expect, it } from 'vitest';
import { Harness, CheckContext, compileSketch, type CircuitDoc, type CheckSpec } from '../src/index';

const esp = { id: 'esp', type: 'esp32', x: 0, y: 0, rot: 0, props: {} };

async function ctx(code: string, circuit: CircuitDoc = { parts: [esp], wires: [] }) {
  const compiled = compileSketch(code);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return new CheckContext(code, circuit, compiled, { seed: 1 });
}

describe('язык', () => {
  it('арифметика как в C++', async () => {
    const h = await ctx(String.raw`
void setup() {
  Serial.begin(115200);
  Serial.println(5 / 3);
  Serial.println(pow(5, 3));
  Serial.println(5 % 3);
  Serial.println(5 < 3);
  int a = 4; a += 5;
  Serial.println(a > 4 && a < 10 || !(a % 2 == 1));
  String langs[] = {"C", "C++", "Python"};
  Serial.println(langs[2] == "Python");
  auto summ = [](int a[], int n=4) { int sum = 0; for (int i = 0; i < n; i++) sum += a[i]; return sum; };
  int d1[] = {1,2,3,4}; int d2[] = {6,7,4};
  Serial.println(summ(d1)); Serial.println(summ(d2, 3));
  byte b = 255; b++; Serial.println(b);
  char c = 'A'; Serial.println(c); Serial.println(c + 1);
  float f = 10 / 4; Serial.println(f);
  float g = 10 / 4.0; Serial.println(g, 3);
  Serial.println(String("x=") + 5 + ", y=" + 2.5);
  char buf[32]; sprintf(buf, "%d-%05.1f-%s", 7, 3.14159, "ok"); Serial.println(buf);
  Serial.println(255, HEX); Serial.println(5, BIN);
  int big = 2147483647; big++; Serial.println(big);
  unsigned long u = 0; u--; Serial.println(u);
  Serial.println(map(512, 0, 1023, 0, 255));
  Serial.printf("%s=%d\n", "t", 42);
}
void loop() {}`);
    await h.wait(10);
    expect(h.serialLines()).toEqual([
      '1', '125.00', '2', '0', '1', '1', '10', '17', '0', 'A', '66', '2.00', '2.500', 'x=5, y=2.50',
      '7-003.1-ok', 'FF', '101', '-2147483648', '4294967295', '128', 't=42',
    ]);
  });

  it('структуры, классы, enum, static', async () => {
    const h = await ctx(String.raw`
struct Point { int x; int y; };
class Counter {
  int n = 0;
public:
  Counter(int start) : n(start) {}
  void inc() { n++; }
  int get() { return n; }
};
enum Mode { IDLE, RUN = 5, STOP };
Counter cnt(10);
Point pts[2];
int next() { static int k = 0; return ++k; }
void setup() {
  Serial.begin(9600);
  Point p = {3, 4};
  pts[0] = p; p.x = 100;
  Serial.println(pts[0].x);
  cnt.inc(); cnt.inc();
  Serial.println(cnt.get());
  Serial.println(STOP);
  next(); next();
  Serial.println(next());
  Mode m = RUN;
  switch (m) { case IDLE: Serial.println("idle"); break; case RUN: Serial.println("run"); break; default: break; }
}
void loop() {}`);
    await h.wait(10);
    expect(h.serialLines()).toEqual(['3', '12', '6', '3', 'run']);
  });

  it('ошибки компиляции понятны', () => {
    const r = compileSketch('void setup() { int x = 5 Serial.println(x); }\nvoid loop() {}');
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].message).toContain('Пропущена «;»');
    const r2 = compileSketch('void setup() { pinMode(2, OUTPUT); digitalwrite(2, HIGH); }\nvoid loop() {}');
    expect(r2.diagnostics[0].hint).toContain('digitalWrite');
    const r3 = compileSketch('void setup() { Serial.println("T: " + 5); }\nvoid loop() {}');
    expect(r3.diagnostics[0].message).toContain('сдвиг указателя');
  });

  it('деление на ноль и выход за границы — авария как на ESP32', async () => {
    const h = await ctx('int a[3]; void setup() { Serial.begin(115200); for (int i = 0; i <= 3; i++) a[i] = i; }\nvoid loop() {}');
    await h.sim.runUntil(5);
    expect(h.sim.M.status).toBe('crashed');
    expect(h.sim.M.panicInfo?.message).toContain('границы массива');
  });
});

describe('время и выводы', () => {
  it('blink из лекции 1: период 2 с', async () => {
    const h = await ctx(String.raw`
int LED_BUILTIN = 2;
void setup() { pinMode (LED_BUILTIN, OUTPUT); }
void loop() { digitalWrite(LED_BUILTIN, HIGH); delay(1000); digitalWrite(LED_BUILTIN, LOW); delay(1000); }`);
    await h.wait(10000);
    expect(h.period(2, 0, 10000)).toBeCloseTo(2000, 0);
    expect(h.dutyOver(2, 0, 10000)).toBeCloseTo(0.5, 1);
  });

  it('millis без delay', async () => {
    const h = await ctx(String.raw`
unsigned long last = 0; bool st = false;
void setup() { pinMode(2, OUTPUT); }
void loop() { if (millis() - last >= 250) { last = millis(); st = !st; digitalWrite(2, st); } }`);
    await h.wait(3000);
    const p = h.period(2, 0, 3000)!;
    expect(Math.abs(p - 500)).toBeLessThan(5);
  });
});

describe('схема', () => {
  const ledCircuit: CircuitDoc = {
    parts: [
      esp,
      { id: 'r1', type: 'resistor', x: 300, y: 300, rot: 0, props: { value: 220 } },
      { id: 'led1', type: 'led', x: 400, y: 300, rot: 0, props: { color: 'red' } },
      { id: 'btn', type: 'button', x: 500, y: 300, rot: 0, props: {} },
    ],
    wires: [
      { id: 'w1', a: { part: 'esp', pin: 'D25' }, b: { part: 'r1', pin: '1' }, pts: [], color: 'green' },
      { id: 'w2', a: { part: 'r1', pin: '2' }, b: { part: 'led1', pin: 'A' }, pts: [], color: 'green' },
      { id: 'w3', a: { part: 'led1', pin: 'C' }, b: { part: 'esp', pin: 'GND.1' }, pts: [], color: 'black' },
      { id: 'w4', a: { part: 'esp', pin: 'D14' }, b: { part: 'btn', pin: '1' }, pts: [], color: 'yellow' },
      { id: 'w5', a: { part: 'btn', pin: '2' }, b: { part: 'esp', pin: '3V3' }, pts: [], color: 'red' },
    ],
  };

  it('кнопка с INPUT_PULLDOWN управляет светодиодом', async () => {
    const h = await ctx(String.raw`
void setup() { pinMode(25, OUTPUT); pinMode(14, INPUT_PULLDOWN); Serial.begin(115200); }
void loop() { int s = digitalRead(14); digitalWrite(25, s); delay(10); }`, ledCircuit);
    await h.wait(100);
    expect(h.ledOn('led1')).toBe(false);
    h.hold('btn', true);
    await h.wait(50);
    expect(h.ledOn('led1')).toBe(true);
    expect(h.gpio(25).voltage).toBeGreaterThan(3);
    h.hold('btn', false);
    await h.wait(50);
    expect(h.ledOn('led1')).toBe(false);
  });

  it('прерывание по кнопке', async () => {
    const h = await ctx(String.raw`
volatile int presses = 0;
void IRAM_ATTR onPress() { presses++; }
void setup() { Serial.begin(115200); pinMode(14, INPUT_PULLDOWN); attachInterrupt(digitalPinToInterrupt(14), onPress, RISING); }
void loop() { static int shown = -1; if (presses != shown) { shown = presses; Serial.println(shown); } delay(5); }`, ledCircuit);
    await h.wait(100);
    await h.press('btn', 100);
    await h.wait(100);
    await h.press('btn', 100);
    await h.wait(100);
    expect(h.serialLines()).toEqual(['0', '1', '2']);
  });

  it('ШИМ через LEDC меняет яркость', async () => {
    const h = await ctx(String.raw`
void setup() { ledcSetup(0, 5000, 8); ledcAttachPin(25, 0); ledcWrite(0, 64); }
void loop() {}`, ledCircuit);
    await h.wait(100);
    const half = h.led('led1');
    expect(half).toBeGreaterThan(0.05);
    expect(half).toBeLessThan(0.5);
  });

  it('светодиод без резистора от 5 В сгорает', async () => {
    const c: CircuitDoc = {
      parts: [esp, { id: 'led1', type: 'led', x: 400, y: 300, rot: 0, props: { color: 'red' } }],
      wires: [
        { id: 'w1', a: { part: 'esp', pin: 'VIN' }, b: { part: 'led1', pin: 'A' }, pts: [], color: 'red' },
        { id: 'w2', a: { part: 'led1', pin: 'C' }, b: { part: 'esp', pin: 'GND.2' }, pts: [], color: 'black' },
      ],
    };
    const h = await ctx('void setup(){}\nvoid loop(){}', c);
    await h.wait(10);
    expect(h.model<{ burnt: boolean }>('led1').burnt).toBe(true);
  });

  it('АЦП читает потенциометр', async () => {
    const c: CircuitDoc = {
      parts: [esp, { id: 'pot', type: 'pot', x: 300, y: 300, rot: 0, props: { position: 25 } }],
      wires: [
        { id: 'w1', a: { part: 'pot', pin: 'GND' }, b: { part: 'esp', pin: 'GND.1' }, pts: [], color: 'black' },
        { id: 'w2', a: { part: 'pot', pin: 'VCC' }, b: { part: 'esp', pin: '3V3' }, pts: [], color: 'red' },
        { id: 'w3', a: { part: 'pot', pin: 'SIG' }, b: { part: 'esp', pin: 'D34' }, pts: [], color: 'blue' },
      ],
    };
    const h = await ctx('void setup(){ Serial.begin(115200); }\nvoid loop(){ Serial.println(analogRead(34)); delay(100); }', c);
    await h.wait(150);
    const v = h.numbers()[0];
    expect(Math.abs(v - 1024)).toBeLessThan(10);
    h.set('pot', 'position', 100);
    const m = h.mark();
    await h.wait(150);
    expect(h.numbers(h.serialSince(m))[0]).toBeGreaterThan(4080);
  });

  it('HC-SR04 и pulseIn из лекции 2', async () => {
    const c: CircuitDoc = {
      parts: [esp, { id: 'us', type: 'hcsr04', x: 300, y: 300, rot: 0, props: { distance: 120 } }],
      wires: [
        { id: 'w1', a: { part: 'us', pin: 'VCC' }, b: { part: 'esp', pin: 'VIN' }, pts: [], color: 'red' },
        { id: 'w2', a: { part: 'us', pin: 'GND' }, b: { part: 'esp', pin: 'GND.1' }, pts: [], color: 'black' },
        { id: 'w3', a: { part: 'us', pin: 'TRIG' }, b: { part: 'esp', pin: 'D2' }, pts: [], color: 'blue' },
        { id: 'w4', a: { part: 'us', pin: 'ECHO' }, b: { part: 'esp', pin: 'D4' }, pts: [], color: 'green' },
      ],
    };
    const h = await ctx(String.raw`
#define PIN_TRIG 2
#define PIN_ECHO 4
void setup() { Serial.begin(115200); pinMode(PIN_TRIG, OUTPUT); pinMode(PIN_ECHO, INPUT); }
void loop() {
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10); digitalWrite(PIN_TRIG, LOW);
  int duration = pulseIn(PIN_ECHO, HIGH);
  Serial.print("Distance in CM: "); Serial.println(duration / 58);
  delay(1000);
}`, c);
    await h.wait(500);
    expect(h.serialLines()[0]).toBe('Distance in CM: 120');
  });

  it('DHT22 и LCD по I2C', async () => {
    const c: CircuitDoc = {
      parts: [esp,
        { id: 'dht', type: 'dht22', x: 300, y: 300, rot: 0, props: { temperature: 23.4, humidity: 61 } },
        { id: 'lcd', type: 'lcd1602', x: 300, y: 400, rot: 0, props: {} }],
      wires: [
        { id: 'w1', a: { part: 'dht', pin: 'VCC' }, b: { part: 'esp', pin: '3V3' }, pts: [], color: 'red' },
        { id: 'w2', a: { part: 'dht', pin: 'GND' }, b: { part: 'esp', pin: 'GND.1' }, pts: [], color: 'black' },
        { id: 'w3', a: { part: 'dht', pin: 'DATA' }, b: { part: 'esp', pin: 'D4' }, pts: [], color: 'green' },
        { id: 'w4', a: { part: 'lcd', pin: 'VCC' }, b: { part: 'esp', pin: 'VIN' }, pts: [], color: 'red' },
        { id: 'w5', a: { part: 'lcd', pin: 'GND' }, b: { part: 'esp', pin: 'GND.2' }, pts: [], color: 'black' },
        { id: 'w6', a: { part: 'lcd', pin: 'SDA' }, b: { part: 'esp', pin: 'D21' }, pts: [], color: 'blue' },
        { id: 'w7', a: { part: 'lcd', pin: 'SCL' }, b: { part: 'esp', pin: 'D22' }, pts: [], color: 'yellow' },
      ],
    };
    const h = await ctx(String.raw`
#include <DHT.h>
#include <LiquidCrystal_I2C.h>
DHT dht(4, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup() { dht.begin(); lcd.init(); lcd.backlight(); }
void loop() {
  float t = dht.readTemperature(); float hum = dht.readHumidity();
  lcd.setCursor(0, 0); lcd.print("T: "); lcd.print(t, 1); lcd.print(" C");
  lcd.setCursor(0, 1); lcd.print("H: "); lcd.print(hum, 0); lcd.print(" %");
  delay(2000);
}`, c);
    await h.wait(100);
    expect(h.lcd('lcd')).toEqual(['T: 23.4 C', 'H: 61 %']);
  });
});

describe('сеть', () => {
  it('Wi-Fi + HTTP + JSON (лекция 4)', async () => {
    const h = await ctx(String.raw`
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
void setup() {
  Serial.begin(9600);
  WiFi.begin("Samsung_IoT", "IOT5iot5");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println();
  Serial.println(WiFi.localIP());
  HTTPClient http;
  http.begin("https://goweather.herokuapp.com/weather/Moscow");
  int code = http.GET();
  Serial.println(code);
  String payload = http.getString();
  DynamicJsonDocument data(1024);
  deserializeJson(data, payload);
  const char* d = data["description"];
  JsonArray forecast = data["forecast"];
  Serial.println(forecast.size());
  Serial.println(d != NULL);
  int t = data["nope"] | -99;
  Serial.println(t);
}
void loop() {}`);
    await h.wait(5000);
    const lines = h.serialLines();
    expect(lines).toContain('200');
    expect(lines).toContain('3');
    expect(lines).toContain('-99');
    expect(lines.some((l) => /^192\.168\.1\.\d+$/.test(l))).toBe(true);
  });

  it('MQTT публикация и подписка', async () => {
    const h = await ctx(String.raw`
#include <WiFi.h>
#include <PubSubClient.h>
WiFiClient wc; PubSubClient mqtt(wc);
void cb(char* topic, byte* payload, unsigned int len) {
  String msg; for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];
  Serial.println(String(topic) + "=" + msg);
}
void setup() {
  Serial.begin(115200);
  WiFi.begin("Samsung_IoT", "IOT5iot5");
  while (WiFi.status() != WL_CONNECTED) delay(100);
  mqtt.setServer("mqtt.iot", 1883); mqtt.setCallback(cb);
  if (mqtt.connect("esp-1")) { mqtt.subscribe("home/cmd/#"); mqtt.publish("home/hello", "hi", true); }
}
void loop() { mqtt.loop(); delay(10); }`);
    await h.wait(3000);
    expect(h.mqttLog('home/hello')[0]?.payload).toBe('hi');
    h.mqttPublish('home/cmd/led', 'on');
    await h.wait(200);
    expect(h.serialLines()).toContain('home/cmd/led=on');
  });
});

describe('Harness', () => {
  it('прогоняет проверки', async () => {
    const checks: CheckSpec[] = [
      { id: 'a', title: 'мигает', run: async (h) => { await h.wait(4000); h.expect(h.period(2, 0, 4000) !== null, 'не мигает'); } },
      { id: 'b', title: 'пишет hello', run: async (h) => { await h.wait(100); h.expect(h.serial.includes('hello'), 'нет hello'); } },
    ];
    const r = await Harness.run('void setup(){pinMode(2,OUTPUT);Serial.begin(115200);Serial.println("hello");}\nvoid loop(){digitalWrite(2,!digitalRead(2));delay(500);}', { parts: [esp], wires: [] }, checks);
    expect(r.results.map((x) => x.ok)).toEqual([true, true]);
  });
});
