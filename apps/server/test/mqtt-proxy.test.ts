import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { makeApp, type TestApp } from './helpers';

let upstream: WebSocketServer;
let t: TestApp;
let port: number;
const seenPaths: string[] = [];

beforeAll(async () => {
  upstream = new WebSocketServer({ port: 0, handleProtocols: (protocols) => (protocols.has('mqtt') ? 'mqtt' : false) });
  upstream.on('connection', (sock, req) => {
    seenPaths.push(req.url ?? '');
    sock.on('message', (data, isBinary) => sock.send(data, { binary: isBinary }));
  });
  await new Promise((r) => upstream.once('listening', r));
  const up = (upstream.address() as AddressInfo).port;
  t = await makeApp({ mqttWsUrl: `ws://127.0.0.1:${up}` });
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  port = (t.app.server.address() as AddressInfo).port;
});
afterAll(async () => {
  await t?.close();
  await new Promise((r) => upstream.close(r));
});

describe('WebSocket-прокси /mqtt', () => {
  it('пересылает бинарные кадры и подпротокол mqtt', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/mqtt`, 'mqtt');
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    expect(ws.protocol).toBe('mqtt');
    const echoed = new Promise<Buffer>((resolve) => ws.once('message', (d) => resolve(d as Buffer)));
    ws.send(Buffer.from([0x10, 0x02, 0x00, 0x04]));
    expect([...(await echoed)]).toEqual([0x10, 0x02, 0x00, 0x04]);
    ws.close();
    expect(seenPaths.length).toBe(1);
  });

  it('JSON-API продолжает работать рядом с прокси', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"a@b.c","password":"x"}' });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'Неверный email или пароль' });
  });
});
