// Регрессионные тесты к исправлениям, найденным при написании практик модулей 4–6.
import { describe, expect, it } from 'vitest';
import { CheckContext, compileSketch, type CircuitDoc } from '../src/index';

const esp = { id: 'esp', type: 'esp32', x: 0, y: 0, rot: 0, props: {} };

function ctx(code: string, circuit: CircuitDoc = { parts: [esp], wires: [] }) {
  const compiled = compileSketch(code);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return new CheckContext(code, circuit, compiled, { seed: 1 });
}

const ledCircuit: CircuitDoc = {
  parts: [
    esp,
    { id: 'r1', type: 'resistor', x: 260, y: -30, rot: 0, props: { value: 220 } },
    { id: 'led', type: 'led', x: 330, y: -30, rot: 0, props: { color: 'yellow' } },
  ],
  wires: [
    { id: 'a', a: { part: 'esp', pin: 'D25' }, b: { part: 'r1', pin: '1' }, pts: [], color: 'green' },
    { id: 'b', a: { part: 'r1', pin: '2' }, b: { part: 'led', pin: 'A' }, pts: [], color: 'green' },
    { id: 'c', a: { part: 'led', pin: 'C' }, b: { part: 'esp', pin: 'GND.1' }, pts: [], color: 'black' },
  ],
};

describe('исправления (модули 4–6)', () => {
  it('ШИМ с нулевой скважностью не считается перегрузкой вывода', async () => {
    const h = ctx('void setup(){ ledcAttach(25, 5000, 8); ledcWrite(25, 0); }\nvoid loop(){}', ledCircuit);
    await h.wait(300);
    expect(h.led('led')).toBe(0);
    expect(h.warnings().filter((w) => w.includes('перегружен'))).toEqual([]);
  });

  it('PubSubClient.publish(topic, char[]) публикует C-строку до нулевого байта', async () => {
    const h = ctx(String.raw`
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
WiFiClient wc; PubSubClient mqtt(wc);
void setup() {
  WiFi.begin("Samsung_IoT", "IOT5iot5");
  while (WiFi.status() != WL_CONNECTED) delay(100);
  mqtt.setServer("mqtt.iot", 1883);
  mqtt.connect("esp-buf");
  DynamicJsonDocument doc(64);
  doc["t"] = 12.5;
  char buf[64];
  serializeJson(doc, buf);
  mqtt.publish("a/json", buf);
  mqtt.publish("a/retained", buf, true);
  byte raw[] = {65, 0, 66};
  mqtt.publish("a/bytes", raw, 3);
}
void loop() { mqtt.loop(); }`);
    await h.wait(3000);
    expect(h.mqttLog('a/json')[0]?.payload).toBe('{"t":12.5}');
    expect(h.mqttLog('a/retained')[0]?.retain).toBe(true);
    expect(new TextDecoder().decode(h.retained.get('a/retained'))).toBe('{"t":12.5}');
    expect(h.mqttLog('a/bytes')[0]?.payload).toBe('A\u0000B');
  });
});
