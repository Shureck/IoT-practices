import { describe, expect, it } from 'vitest';
import { PRACTICE_BY_ID } from '@esp32lab/content';
import { CheckPool, CheckTimeout } from '../src/pool';
import { makeApp, registered } from './helpers';

const blink = PRACTICE_BY_ID['m1-blink'];

describe('пул проверок', () => {
  it('зависший поток завершается по таймауту и пересоздаётся', async () => {
    const pool = new CheckPool(1, 1500, 10, new URL('./fixtures/hang-worker.mjs', import.meta.url));
    const started = Date.now();
    await expect(pool.run('p', 'hang', blink.starterCircuit)).rejects.toBeInstanceOf(CheckTimeout);
    expect(Date.now() - started).toBeLessThan(10_000);
    const ok = await pool.run('p', 'fine', blink.starterCircuit);
    expect(ok.results[0].ok).toBe(true);
    // очередь: две задачи подряд на одном потоке
    const [a, b] = await Promise.all([pool.run('p', 'a', blink.starterCircuit), pool.run('p', 'b', blink.starterCircuit)]);
    expect(a.results[0].ok && b.results[0].ok).toBe(true);
    await pool.close();
  });

  it('бесконечный цикл в скетче не ломает проверку', async () => {
    const t = await makeApp({ checkTimeoutMs: 20_000 });
    try {
      const { c } = await registered(t.app);
      const hang = 'void setup() { }\nvoid loop() { while (true) { } }';
      const r = await c.post('/api/check', { practiceId: 'm1-blink', code: hang, circuit: blink.starterCircuit });
      expect(r.status).toBe(200);
      expect(r.body.results.some((x: { ok: boolean }) => !x.ok)).toBe(true);
      const ok = await c.post('/api/check', { practiceId: 'm1-blink', code: blink.solution.code, circuit: blink.starterCircuit });
      expect(ok.body.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
    } finally {
      await t.close();
    }
  });
});
