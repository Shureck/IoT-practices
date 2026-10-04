// Сеть симулятора в браузере: HTTP — через сервер (виртуальные сервисы и прокси),
// MQTT — через WebSocket к брокеру сайта (или публичному). Без входа — всё локально.
import mqtt, { type MqttClient } from 'mqtt';
import {
  DEFAULT_APS, MemoryBroker, MemoryChat, MockNet, virtualHttp, type HttpRequest, type HttpResponse, type MqttConnectResult,
  type MqttHandlers, type MqttOptions, type MqttSession, type NetAdapter, type NetLogEntry,
} from '@esp32lab/sim';
import { api } from '../lib/api';

/** Общие для страницы офлайн-брокер и чат (панели MQTT/чата видят то же, что и симуляция). */
export const localBroker = new MemoryBroker();
export const localChat = new MemoryChat();

const PUBLIC_BROKERS: Record<string, string> = {
  'broker.hivemq.com': 'wss://broker.hivemq.com:8884/mqtt',
  'test.mosquitto.org': 'wss://test.mosquitto.org:8081',
  'broker.emqx.io': 'wss://broker.emqx.io:8084/mqtt',
};

export function siteMqttUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/mqtt`;
}

export class LiveNet implements NetAdapter {
  private mock: MockNet;
  constructor(private online: boolean, private onLog: (e: NetLogEntry) => void, public user?: string) {
    this.mock = new MockNet({ broker: localBroker, chat: localChat });
  }

  aps() { return DEFAULT_APS; }

  log(e: NetLogEntry) { this.onLog(e); }

  async http(req: HttpRequest): Promise<HttpResponse> {
    if (!this.online) {
      const local = virtualHttp(req, { chat: localChat, now: () => new Date() });
      return local ?? { status: -1, headers: {}, body: '' };
    }
    try {
      return await api.netHttp(req);
    } catch {
      const local = virtualHttp(req, { chat: localChat, now: () => new Date() });
      return local ?? { status: -1, headers: {}, body: '' };
    }
  }

  async mqttConnect(opts: MqttOptions, handlers: MqttHandlers): Promise<MqttConnectResult> {
    if (!this.online) return this.mock.mqttConnect(opts, handlers);
    const url = PUBLIC_BROKERS[opts.host.toLowerCase()] ?? siteMqttUrl();
    return new Promise((resolve) => {
      let settled = false;
      const client: MqttClient = mqtt.connect(url, {
        clientId: opts.clientId,
        username: opts.user,
        password: opts.pass,
        keepalive: opts.keepAlive,
        clean: opts.clean,
        reconnectPeriod: 0,
        connectTimeout: 6000,
        will: opts.will ? { topic: opts.will.topic, payload: new TextEncoder().encode(opts.will.payload) as unknown as Buffer, qos: Math.min(2, opts.will.qos) as 0 | 1 | 2, retain: opts.will.retain } : undefined,
      });
      let alive = true;
      const session: MqttSession = {
        get connected() { return alive && client.connected; },
        publish(topic, payload, retain, qos) {
          if (!client.connected) return false;
          client.publish(topic, typeof payload === 'string' ? payload : (payload as unknown as Buffer), { retain, qos: Math.min(2, qos) as 0 | 1 | 2 });
          return true;
        },
        subscribe(topic, qos) {
          if (!client.connected) return false;
          client.subscribe(topic, { qos: Math.min(2, qos) as 0 | 1 | 2 });
          return true;
        },
        unsubscribe(topic) { client.unsubscribe(topic); return true; },
        close(graceful) {
          alive = false;
          client.end(!graceful);
        },
      };
      client.on('connect', () => {
        if (settled) return;
        settled = true;
        resolve({ ok: true, session });
      });
      client.on('message', (topic, payload, packet) => {
        handlers.onMessage(topic, new Uint8Array(payload), !!packet.retain);
      });
      client.on('close', () => {
        if (!settled) {
          settled = true;
          // брокер сайта недоступен — переходим на локальный
          resolve(this.mock.mqttConnect(opts, handlers) as unknown as MqttConnectResult);
          return;
        }
        if (alive) { alive = false; handlers.onClose('соединение закрыто'); }
      });
      client.on('error', (err) => {
        if (!settled) {
          settled = true;
          client.end(true);
          const code = /auth|not authorized/i.test(err.message) ? 5 : -2;
          resolve({ ok: false, code, message: err.message });
        }
      });
    });
  }
}

/** Подключение панели MQTT (тот же брокер, что у симуляции). */
export interface PanelMqtt {
  publish(topic: string, payload: string, retain: boolean): void;
  subscribe(filter: string): void;
  close(): void;
}

export function connectPanel(online: boolean, onMessage: (topic: string, payload: string, retained: boolean) => void, onStatus: (s: string) => void): PanelMqtt {
  if (!online) {
    const listener = (m: { topic: string; payload: string; retain: boolean }) => onMessage(m.topic, m.payload, m.retain);
    localBroker.listeners.add(listener);
    onStatus('локальный брокер');
    return {
      publish: (t, p, r) => localBroker.publish(t, new TextEncoder().encode(p), r, 'panel'),
      subscribe: () => { /* видим все сообщения */ },
      close: () => { localBroker.listeners.delete(listener); },
    };
  }
  const client = mqtt.connect(siteMqttUrl(), { clientId: `panel-${Math.random().toString(16).slice(2, 10)}`, reconnectPeriod: 3000 });
  client.on('connect', () => onStatus('подключено'));
  client.on('close', () => onStatus('нет соединения'));
  client.on('message', (t, p, packet) => onMessage(t, new TextDecoder().decode(p), !!packet.retain));
  return {
    publish: (t, p, r) => client.publish(t, p, { retain: r }),
    subscribe: (f) => client.subscribe(f),
    close: () => client.end(true),
  };
}
