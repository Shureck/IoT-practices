// Сеть без интернета: виртуальные сервисы + брокер в памяти.
import { MemoryBroker } from './broker';
import { MemoryChat, virtualHttp, type ChatStore } from './services';
import {
  DEFAULT_APS, type HttpRequest, type HttpResponse, type MqttConnectResult, type MqttHandlers, type MqttOptions,
  type NetAdapter, type NetLogEntry, type WifiAp,
} from './types';

export interface MockNetOptions {
  aps?: WifiAp[];
  broker?: MemoryBroker;
  chat?: ChatStore;
  now?: () => Date;
  /** свои обработчики HTTP (для проверок) — вызываются первыми */
  routes?: ((req: HttpRequest) => HttpResponse | null)[];
  log?: (e: NetLogEntry) => void;
  user?: string;
}

export class MockNet implements NetAdapter {
  broker: MemoryBroker;
  chat: ChatStore;
  requests: HttpRequest[] = [];
  telemetry: { room: string; data: unknown }[] = [];
  user?: string;
  constructor(private o: MockNetOptions = {}) {
    this.broker = o.broker ?? new MemoryBroker();
    this.chat = o.chat ?? new MemoryChat(o.now);
    this.user = o.user;
  }

  aps(): WifiAp[] { return this.o.aps ?? DEFAULT_APS; }

  log(e: NetLogEntry): void { this.o.log?.(e); }

  async http(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    for (const r of this.o.routes ?? []) {
      const res = r(req);
      if (res) return res;
    }
    const res = virtualHttp(req, {
      chat: this.chat,
      now: this.o.now ?? (() => new Date()),
      telemetry: (room, data) => this.telemetry.push({ room, data }),
    });
    if (res) return res;
    // интернета нет
    return { status: -1, headers: {}, body: '' };
  }

  async mqttConnect(opts: MqttOptions, handlers: MqttHandlers): Promise<MqttConnectResult> {
    return this.broker.connect(opts, handlers);
  }
}
