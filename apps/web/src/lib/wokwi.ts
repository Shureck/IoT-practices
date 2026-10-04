// Экспорт схемы в формат diagram.json симулятора Wokwi (используется на лекциях).
import { propValue, type CircuitDoc, type Part } from '@esp32lab/sim';

interface Map { type: string; pins?: Record<string, string>; attrs?: (p: Part) => Record<string, string> }

const MAP: Record<string, Map> = {
  esp32: { type: 'wokwi-esp32-devkit-v1' },
  breadboard: { type: 'wokwi-breadboard-half' },
  led: { type: 'wokwi-led', attrs: (p) => ({ color: String(propValue(p, 'color')) }) },
  resistor: { type: 'wokwi-resistor', attrs: (p) => ({ value: String(propValue(p, 'value')) }) },
  button: { type: 'wokwi-pushbutton', pins: { 1: '1.l', 2: '2.l' }, attrs: (p) => ({ color: String(propValue(p, 'color')) }) },
  switch: { type: 'wokwi-slide-switch', pins: { 1: '1', C: '2', 2: '3' } },
  pot: { type: 'wokwi-potentiometer' },
  rgb: { type: 'wokwi-rgb-led', attrs: (p): Record<string, string> => (propValue(p, 'common') === 'anode' ? { common: 'anode' } : {}) },
  buzzer: { type: 'wokwi-buzzer', pins: { PLUS: '2', MINUS: '1' } },
  relay: { type: 'wokwi-relay-module' },
  servo: { type: 'wokwi-servo', attrs: (p) => ({ horn: propValue(p, 'horn') === 'barrier' ? 'single' : 'single' }) },
  dht22: { type: 'wokwi-dht22', pins: { DATA: 'SDA' }, attrs: (p) => ({ temperature: String(propValue(p, 'temperature')), humidity: String(propValue(p, 'humidity')) }) },
  hcsr04: { type: 'wokwi-hc-sr04', attrs: (p) => ({ distance: String(propValue(p, 'distance')) }) },
  pir: { type: 'wokwi-pir-motion-sensor' },
  mq2: { type: 'wokwi-gas-sensor', pins: { DO: 'DOUT', AO: 'AOUT' } },
  lcd1602: { type: 'wokwi-lcd1602', attrs: () => ({ pins: 'i2c' }) },
  oled: { type: 'board-ssd1306' },
  neopixel: { type: 'wokwi-led-ring', attrs: (p) => ({ pixels: String(propValue(p, 'count')) }) },
  logic: { type: 'wokwi-logic-analyzer' },
  ldr: { type: 'wokwi-photoresistor-sensor' },
};

const COLOR_NAMES: Record<string, string> = {
  '#22c55e': 'green', '#ef4444': 'red', '#111827': 'black', '#3b82f6': 'blue', '#eab308': 'gold', '#f97316': 'orange',
  '#a855f7': 'purple', '#e5e7eb': 'white', '#06b6d4': 'cyan',
};

export function toWokwi(doc: CircuitDoc): { json: string; skipped: string[] } {
  const skipped: string[] = [];
  const parts = doc.parts.flatMap((p) => {
    const m = MAP[p.type];
    if (!m || p.type === 'ldr') { skipped.push(p.type); return []; }
    return [{ type: m.type, id: p.id, top: p.y, left: p.x, rotate: p.rot || undefined, attrs: m.attrs?.(p) ?? {} }];
  });
  const ok = new Set(parts.map((p) => p.id));
  const pin = (partId: string, name: string) => {
    const t = doc.parts.find((p) => p.id === partId)?.type ?? '';
    return `${partId}:${MAP[t]?.pins?.[name] ?? name}`;
  };
  const connections = doc.wires
    .filter((w) => ok.has(w.a.part) && ok.has(w.b.part))
    .map((w) => [pin(w.a.part, w.a.pin), pin(w.b.part, w.b.pin), COLOR_NAMES[w.color] ?? 'green', []]);
  const json = JSON.stringify({ version: 1, author: 'ESP32 Lab', editor: 'wokwi', parts, connections, dependencies: {} }, null, 2);
  return { json, skipped: [...new Set(skipped)] };
}

export function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
}
