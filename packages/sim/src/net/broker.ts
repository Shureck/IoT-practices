// MQTT-брокер в памяти (для автопроверки и офлайн-режима).
import type { MqttConnectResult, MqttHandlers, MqttOptions, MqttSession } from './types';

export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return i < t.length || i === t.length;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

export function validTopic(topic: string, isFilter: boolean): boolean {
  if (!topic || topic.length > 65535) return false;
  if (!isFilter && /[+#]/.test(topic)) return false;
  if (isFilter) {
    const parts = topic.split('/');
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.includes('#') && (p !== '#' || i !== parts.length - 1)) return false;
      if (p.includes('+') && p !== '+') return false;
    }
  }
  return true;
}

interface Client {
  id: string;
  subs: Map<string, number>;
  handlers: MqttHandlers;
  will?: MqttOptions['will'];
  alive: boolean;
}

export interface BrokerMessage {
  topic: string;
  payload: string;
  retain: boolean;
  from: string;
  t: number;
}

export class MemoryBroker {
  clients = new Map<string, Client>();
  retained = new Map<string, Uint8Array>();
  /** журнал всех опубликованных сообщений (для проверок) */
  log: BrokerMessage[] = [];
  listeners = new Set<(m: BrokerMessage) => void>();
  /** допустимые учётные данные; пусто — без авторизации */
  users: Record<string, string> = {};
  clock: () => number = () => Date.now();

  connect(opts: MqttOptions, handlers: MqttHandlers): MqttConnectResult {
    if (!opts.clientId) return { ok: false, code: 2, message: 'Пустой clientId' };
    if (Object.keys(this.users).length && this.users[opts.user ?? ''] !== opts.pass) {
      return { ok: false, code: 4, message: 'Неверный логин или пароль' };
    }
    const old = this.clients.get(opts.clientId);
    if (old) {
      // брокер отключает старый клиент с тем же id
      old.alive = false;
      this.clients.delete(opts.clientId);
      old.handlers.onClose('Подключился другой клиент с таким же clientId');
    }
    const client: Client = { id: opts.clientId, subs: new Map(), handlers, will: opts.will, alive: true };
    this.clients.set(opts.clientId, client);
    const broker = this;
    const session: MqttSession = {
      get connected() { return client.alive; },
      publish(topic, payload, retain) {
        if (!client.alive || !validTopic(topic, false)) return false;
        broker.publish(topic, typeof payload === 'string' ? new TextEncoder().encode(payload) : payload, retain, client.id);
        return true;
      },
      subscribe(topic, qos) {
        if (!client.alive || !validTopic(topic, true)) return false;
        client.subs.set(topic, qos);
        for (const [t, p] of broker.retained) {
          if (topicMatches(topic, t)) handlers.onMessage(t, p, true);
        }
        return true;
      },
      unsubscribe(topic) {
        client.subs.delete(topic);
        return client.alive;
      },
      close(graceful) {
        if (!client.alive) return;
        client.alive = false;
        broker.clients.delete(client.id);
        if (!graceful && client.will) broker.publish(client.will.topic, new TextEncoder().encode(client.will.payload), client.will.retain, client.id);
      },
    };
    return { ok: true, session };
  }

  publish(topic: string, payload: Uint8Array, retain: boolean, from = 'panel'): void {
    if (retain) {
      if (payload.length === 0) this.retained.delete(topic);
      else this.retained.set(topic, payload);
    }
    const msg: BrokerMessage = { topic, payload: new TextDecoder().decode(payload), retain, from, t: this.clock() };
    this.log.push(msg);
    if (this.log.length > 2000) this.log.shift();
    for (const l of this.listeners) l(msg);
    for (const c of [...this.clients.values()]) {
      for (const f of c.subs.keys()) {
        if (topicMatches(f, topic)) {
          if (c.alive) c.handlers.onMessage(topic, payload, false);
          break;
        }
      }
    }
  }
}
