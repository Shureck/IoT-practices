// Регрессии, найденные при написании практик модулей 1–2.
import { describe, expect, it } from 'vitest';
import { CheckContext, compileSketch, type CircuitDoc } from '../src/index';

const esp = { id: 'esp', type: 'esp32', x: 0, y: 0, rot: 0, props: {} };

function ctx(code: string, circuit: CircuitDoc = { parts: [esp], wires: [] }) {
  const compiled = compileSketch(code);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return new CheckContext(code, circuit, compiled, { seed: 1 });
}

describe('компилятор', () => {
  it('константная свёртка умножения именованных констант', async () => {
    const h = ctx(`
const int UNIT = 200;
const unsigned int U = 3;
void setup() {
  Serial.begin(115200);
  Serial.println(3 * UNIT);
  Serial.println(U * 7);
}
void loop() {}`);
    await h.wait(10);
    expect(h.serialLines()).toEqual(['600', '21']);
  });
});
