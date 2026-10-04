// Интерфейсы сетевого слоя симулятора.

export interface WifiAp {
  ssid: string;
  /** null — открытая сеть */
  pass: string | null;
  rssi: number;
  channel: number;
  bssid: string;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface MqttWill {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
}

export interface MqttOptions {
  host: string;
  port: number;
  clientId: string;
  user?: string;
  pass?: string;
  will?: MqttWill;
  keepAlive: number;
  clean: boolean;
}

export interface MqttHandlers {
  onMessage(topic: string, payload: Uint8Array, retained: boolean): void;
  onClose(reason: string): void;
}

export interface MqttSession {
  publish(topic: string, payload: Uint8Array | string, retain: boolean, qos: number): boolean;
  subscribe(topic: string, qos: number): boolean;
  unsubscribe(topic: string): boolean;
  close(graceful: boolean): void;
  readonly connected: boolean;
}

export type MqttConnectResult = { ok: true; session: MqttSession } | { ok: false; code: number; message: string };

export interface NetLogEntry {
  kind: 'http' | 'mqtt-pub' | 'mqtt-sub' | 'mqtt-in' | 'mqtt-conn' | 'wifi' | 'web';
  text: string;
  detail?: string;
  t: number;
  ok?: boolean;
}

export interface NetAdapter {
  aps(): WifiAp[];
  http(req: HttpRequest): Promise<HttpResponse>;
  mqttConnect(opts: MqttOptions, handlers: MqttHandlers): Promise<MqttConnectResult>;
  log?(e: NetLogEntry): void;
  /** имя пользователя для подстановки в топики/чат */
  user?: string;
}

export const DEFAULT_APS: WifiAp[] = [
  { ssid: 'Samsung_IoT', pass: 'IOT5iot5', rssi: -48, channel: 6, bssid: '24:0A:C4:11:22:33' },
  { ssid: 'Polar-Station', pass: 'aurora2025', rssi: -61, channel: 11, bssid: '24:0A:C4:44:55:66' },
  { ssid: 'Wokwi-GUEST', pass: null, rssi: -55, channel: 6, bssid: '24:0A:C4:00:00:01' },
  { ssid: 'MIREA_Guest', pass: null, rssi: -77, channel: 1, bssid: '24:0A:C4:77:88:99' },
  { ssid: 'TP-Link_4F2A', pass: 'qwerty123', rssi: -83, channel: 3, bssid: '50:C7:BF:4F:2A:10' },
];
