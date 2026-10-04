// Сетевые библиотеки: WiFi, IPAddress, HTTPClient, WiFiClient, PubSubClient, WebServer.
import { Machine, type GenFn } from './machine';
import { Panic, cs, printText } from './rt';
import { JsonDocument, jsonNull, jsonOf } from './json';
import { utf8Bytes } from './font';
import type { HttpResponse, MqttSession } from '../net/types';

const WL = { IDLE: 0, NO_SSID: 1, SCAN_DONE: 2, CONNECTED: 3, FAILED: 4, LOST: 5, DISCONNECTED: 6 };

export interface WebRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: string;
  resolve: (r: HttpResponse) => void;
}

export function createNetLibs(M: Machine) {
  class IPAddress {
    o: number[];
    constructor(a: unknown = 0, b?: number, c?: number, d?: number) {
      if (typeof a === 'number' && b === undefined) this.o = [a & 255, (a >> 8) & 255, (a >> 16) & 255, (a >>> 24) & 255];
      else if (typeof a === 'string') this.o = IPAddress.parse(a) ?? [0, 0, 0, 0];
      else this.o = [Number(a) & 255, (b ?? 0) & 255, (c ?? 0) & 255, (d ?? 0) & 255];
    }
    static parse(s: string): number[] | null {
      const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s.trim());
      if (!m) return null;
      const o = m.slice(1).map(Number);
      return o.every((x) => x <= 255) ? o : null;
    }
    static from(s: unknown) { return new IPAddress(cs(s)); }
    fromString(s: unknown) { const p = IPAddress.parse(cs(s)); if (p) this.o = p; return !!p; }
    toString() { return this.o.join('.'); }
    octet(i: number) { return this.o[i] ?? 0; }
    valueOf() { return (this.o[0] | (this.o[1] << 8) | (this.o[2] << 16) | (this.o[3] << 24)) >>> 0; }
    __bool() { return this.valueOf() !== 0; }
  }

  const log = (kind: Parameters<NonNullable<NonNullable<Machine['net']>['log']>>[0]['kind'], text: string, ok?: boolean, detail?: string) =>
    M.net?.log?.({ kind, text, ok, detail, t: M.now() });

  // ======================= WiFi =======================
  class WiFiClass {
    st = WL.DISCONNECTED;
    modeV = 0;
    ssid = '';
    ip = new IPAddress(0, 0, 0, 0);
    rssi = 0;
    channelV = 0;
    bssid = '';
    hostname = 'esp32-arduino';
    scan: { ssid: string; rssi: number; auth: number; ch: number; bssid: string }[] = [];
    apOn = false;
    apSsid = '';
    apIp = new IPAddress(192, 168, 4, 1);
    staticIp: IPAddress | null = null;
    ev: number | null = null;
    autoReconnect = true;

    private aps() { return M.net?.aps() ?? []; }

    mode(m: number) { this.modeV = m; if (m & 1) M.wifiOn = true; return true; }
    getMode() { return this.modeV; }

    begin(ssid?: unknown, pass?: unknown) {
      const s = cs(ssid);
      const p = pass === undefined || pass === null ? null : cs(pass);
      if (!s) { M.warnOnce('wifi-nossid', 'WiFi.begin() без имени сети'); return this.st; }
      this.modeV |= 1;
      M.wifiOn = true;
      this.ssid = s;
      if (this.ev !== null) M.cancel(this.ev);
      this.st = WL.DISCONNECTED;
      log('wifi', `Подключение к «${s}»…`);
      const ap = this.aps().find((a) => a.ssid === s);
      if (!ap) {
        const similar = this.aps().find((a) => a.ssid.toLowerCase() === s.toLowerCase());
        this.ev = M.schedule(M.now() + 3_000_000, () => {
          this.st = WL.NO_SSID;
          log('wifi', `Сеть «${s}» не найдена`, false);
          M.warnOnce(`wifi-ssid-${s}`, `Wi-Fi сеть «${s}» не найдена`, similar ? `Регистр важен: сеть называется «${similar.ssid}»` : 'Проверьте имя сети (вкладка «Сеть» → доступные сети)');
        });
        return this.st;
      }
      const passOk = ap.pass === null ? true : p === ap.pass;
      if (!passOk) {
        this.ev = M.schedule(M.now() + 2_500_000, () => {
          this.st = WL.FAILED;
          log('wifi', `Неверный пароль для «${s}»`, false);
          M.warnOnce(`wifi-pass-${s}`, `Не удалось подключиться к «${s}»: неверный пароль`, ap.pass ? 'Пароль чувствителен к регистру' : undefined);
        });
        return this.st;
      }
      const delayUs = 900_000 + Math.max(0, -ap.rssi - 40) * 15_000 + M.rand() * 400_000;
      this.ev = M.schedule(M.now() + delayUs, () => {
        this.st = WL.CONNECTED;
        this.rssi = ap.rssi + Math.round((M.rand() - 0.5) * 6);
        this.channelV = ap.channel;
        this.bssid = ap.bssid;
        this.ip = this.staticIp ?? new IPAddress(192, 168, 1, 100 + Math.floor(M.rand() * 100));
        log('wifi', `Подключено к «${s}», IP ${this.ip}`, true);
      });
      return this.st;
    }
    status() { M.ops += 2; return this.st; }
    isConnected() { return this.st === WL.CONNECTED; }
    *waitForConnectResult(timeoutMs = 10000) {
      const deadline = M.now() + timeoutMs * 1000;
      while ((this.st === WL.DISCONNECTED || this.st === WL.IDLE) && M.now() < deadline) yield* M.sleep(50_000);
      return this.st;
    }
    disconnect() {
      if (this.ev !== null) M.cancel(this.ev);
      if (this.st === WL.CONNECTED) log('wifi', 'Отключено от сети');
      this.st = WL.DISCONNECTED;
      this.ip = new IPAddress(0, 0, 0, 0);
      return true;
    }
    reconnect() { this.begin(this.ssid, this.aps().find((a) => a.ssid === this.ssid)?.pass ?? ''); return true; }
    setAutoReconnect(v: boolean) { this.autoReconnect = !!v; return true; }
    setAutoConnect() { return true; }
    persistent() { /* ничего */ }
    setSleep() { return true; }
    setTxPower() { return true; }
    onEvent() { return 0; }
    config(ip: unknown) { if (ip instanceof IPAddress) this.staticIp = ip; return true; }
    setHostname(h: unknown) { this.hostname = cs(h); return true; }
    getHostname() { return this.hostname; }
    localIP() { return this.st === WL.CONNECTED ? this.ip : new IPAddress(0, 0, 0, 0); }
    gatewayIP() { return this.st === WL.CONNECTED ? new IPAddress(this.ip.o[0], this.ip.o[1], this.ip.o[2], 1) : new IPAddress(); }
    subnetMask() { return new IPAddress(255, 255, 255, 0); }
    dnsIP() { return this.gatewayIP(); }
    macAddress() { return '3C:71:BF:11:22:33'; }
    softAPmacAddress() { return '3C:71:BF:11:22:34'; }
    channel() { return this.channelV; }
    BSSIDstr(i?: number) { return i === undefined ? this.bssid : this.scan[i]?.bssid ?? ''; }
    SSID(i?: number) { return i === undefined ? (this.st === WL.CONNECTED ? this.ssid : '') : this.scan[i]?.ssid ?? ''; }
    RSSI(i?: number) {
      if (i !== undefined) return this.scan[i]?.rssi ?? 0;
      if (this.st !== WL.CONNECTED) return 0;
      return this.rssi + Math.round((M.rand() - 0.5) * 4);
    }
    encryptionType(i: number) { return this.scan[i]?.auth ?? 0; }
    *scanNetworks() {
      this.modeV |= 1;
      M.wifiOn = true;
      log('wifi', 'Сканирование сетей…');
      yield* M.sleep(2_200_000);
      this.scan = this.aps()
        .map((a) => ({ ssid: a.ssid, rssi: a.rssi + Math.round((M.rand() - 0.5) * 8), auth: a.pass === null ? 0 : 3, ch: a.channel, bssid: a.bssid }))
        .sort((a, b) => b.rssi - a.rssi);
      log('wifi', `Найдено сетей: ${this.scan.length}`, true);
      return this.scan.length;
    }
    scanComplete() { return this.scan.length; }
    scanDelete() { this.scan = []; }
    softAP(ssid: unknown, _pass?: unknown) {
      this.apOn = true;
      this.apSsid = cs(ssid);
      this.modeV |= 2;
      M.wifiOn = true;
      log('wifi', `Точка доступа «${this.apSsid}» запущена, IP ${this.apIp}`, true);
      return true;
    }
    softAPConfig(ip: unknown) { if (ip instanceof IPAddress) this.apIp = ip; return true; }
    softAPIP() { return this.apIp; }
    softAPgetStationNum() { return M.lib.webClients ? 1 : 0; }
    softAPdisconnect() { this.apOn = false; return true; }
    *hostByName(host: unknown, out: unknown) {
      yield* M.sleep(20_000);
      const ip = new IPAddress(93, 184, (cs(host).length * 7) & 255, 34);
      if (out && typeof out === 'object' && 'o' in (out as object)) (out as IPAddress).o = ip.o;
      return this.st === WL.CONNECTED ? 1 : 0;
    }
  }
  const WiFi = new WiFiClass();
  M.lib.wifi = WiFi;
  const online = () => WiFi.st === WL.CONNECTED;

  // ======================= WiFiClient =======================
  class WiFiClient {
    __bool() { return false; }
    *connect(host: unknown, port: number) {
      M.warnOnce('tcp-raw', `Прямое TCP-соединение (${cs(host)}:${port}) не поддерживается симулятором`, 'Для веб-запросов используйте HTTPClient, для MQTT — PubSubClient');
      yield* M.sleep(1000);
      return 0;
    }
    connected() { return 0; }
    stop() { /* ничего */ }
    available() { return 0; }
    read() { return -1; }
    *readStringUntil() { return ''; }
    *readString() { return ''; }
    print(v: unknown) { return printText(v).length; }
    println(v?: unknown) { return printText(v ?? '').length + 2; }
    printf() { return 0; }
    write() { return 0; }
    flush() { /* ничего */ }
    setInsecure() { /* ничего */ }
    setCACert() { /* ничего */ }
    setTimeout() { /* ничего */ }
  }
  class WiFiClientSecure extends WiFiClient {}

  // ======================= HTTPClient =======================
  const HTTP_ERR: Record<number, string> = {
    [-1]: 'connection refused', [-2]: 'send header failed', [-3]: 'send payload failed', [-4]: 'not connected',
    [-5]: 'connection lost', [-6]: 'no stream', [-7]: 'no HTTP server', [-8]: 'too less ram', [-9]: 'Transfer-Encoding not supported',
    [-10]: 'Stream write error', [-11]: 'read Timeout',
  };

  class HTTPClient {
    url = '';
    headers: Record<string, string> = {};
    timeoutMs = 5000;
    resp: HttpResponse | null = null;
    begin(a: unknown, b?: unknown) {
      const u = cs(b !== undefined && typeof a === 'object' ? b : a);
      this.resp = null;
      this.headers = {};
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      } catch {
        M.warnOnce(`http-url-${u}`, `Некорректный адрес «${u}»`, 'Адрес должен начинаться с http:// или https://');
        return false;
      }
      this.url = u;
      return true;
    }
    addHeader(k: unknown, v: unknown) { this.headers[cs(k)] = cs(v); }
    setAuthorization(user: unknown, pass?: unknown) {
      this.headers.Authorization = pass === undefined ? `Basic ${cs(user)}` : `Basic ${btoa(`${cs(user)}:${cs(pass)}`)}`;
    }
    setTimeout(ms: number) { this.timeoutMs = ms; }
    setConnectTimeout() { /* ничего */ }
    setReuse() { /* ничего */ }
    setFollowRedirects() { /* ничего */ }
    setUserAgent(ua: unknown) { this.headers['User-Agent'] = cs(ua); }
    collectHeaders() { /* все заголовки сохраняются */ }
    connected() { return !!this.resp; }
    *GET() { return yield* this.sendRequest('GET'); }
    *POST(body: unknown, len?: number) { return yield* this.sendRequest('POST', body, len); }
    *PUT(body: unknown, len?: number) { return yield* this.sendRequest('PUT', body, len); }
    *PATCH(body: unknown, len?: number) { return yield* this.sendRequest('PATCH', body, len); }
    *DELETE() { return yield* this.sendRequest('DELETE'); }
    *sendRequest(method: unknown, body?: unknown, len?: number) {
      const m = cs(method).toUpperCase();
      if (!this.url) { M.warnOnce('http-begin', 'HTTP-запрос без http.begin(url)'); return -1; }
      if (!online()) {
        M.warnOnce('http-offline', 'HTTP-запрос без подключения к Wi-Fi', 'Дождитесь WiFi.status() == WL_CONNECTED перед запросом');
        log('http', `${m} ${this.url} — нет Wi-Fi`, false);
        return -1;
      }
      let payload: string | undefined;
      if (body !== undefined && body !== null) {
        if (Array.isArray(body) && len !== undefined) payload = String.fromCharCode(...(body as number[]).slice(0, len));
        else payload = cs(body);
      }
      if (!M.net) return -1;
      const started = M.now();
      let res: HttpResponse;
      try {
        res = yield* M.await(M.net.http({ method: m, url: this.url, headers: { ...this.headers }, body: payload }));
      } catch (e) {
        log('http', `${m} ${this.url} — ошибка: ${(e as Error).message}`, false);
        return -1;
      }
      // сеть занимает время и в виртуальном мире
      const spent = M.now() - started;
      if (spent < 60_000) yield* M.sleep(60_000 + M.rand() * 80_000 - spent);
      if (res.status < 0) {
        log('http', `${m} ${this.url} — нет соединения`, false);
        M.warnOnce(`http-fail-${this.url}`, `Сервер ${hostOf(this.url)} недоступен`, 'В учебных заданиях используйте адреса из справочника (weather.iot, chat.iot, …)');
        return res.status;
      }
      this.resp = res;
      log('http', `${m} ${this.url} → ${res.status}`, res.status < 400, res.body.slice(0, 2000));
      return res.status;
    }
    getString() {
      if (!this.resp) return '';
      return this.resp.body;
    }
    getSize() { return this.resp ? utf8Bytes(this.resp.body).length : -1; }
    getLocation() { return this.resp?.headers.location ?? ''; }
    header(name: unknown) {
      const n = cs(name).toLowerCase();
      for (const [k, v] of Object.entries(this.resp?.headers ?? {})) if (k.toLowerCase() === n) return v;
      return '';
    }
    hasHeader(name: unknown) { return this.header(name) !== ''; }
    end() { this.resp = null; }
    errorToString(code: number) { return HTTP_ERR[code] ?? ''; }
    getStream() { const body = this.resp?.body ?? ''; return { readAll: () => body }; }
  }
  const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };

  // ======================= PubSubClient (MQTT) =======================
  class PubSubClient {
    host = '';
    port = 1883;
    cb: GenFn | null = null;
    session: MqttSession | null = null;
    st = -1;
    inbox: { topic: string; payload: Uint8Array }[] = [];
    bufSize = 256;
    keepAlive = 15;
    lastLoop = 0;
    clientId = '';
    constructor(_client?: unknown) {}
    setServer(host: unknown, port = 1883) {
      this.host = host && typeof host === 'object' && 'o' in (host as object) ? String(host) : cs(host);
      this.port = port;
      return this;
    }
    setCallback(cb: GenFn) { this.cb = cb; return this; }
    setClient() { return this; }
    setBufferSize(n: number) { this.bufSize = n; return true; }
    getBufferSize() { return this.bufSize; }
    setKeepAlive(s: number) { this.keepAlive = s; return this; }
    setSocketTimeout() { return this; }
    *connect(id: unknown, ...rest: unknown[]) {
      const clientId = cs(id);
      let user: string | undefined;
      let pass: string | undefined;
      let will: { topic: string; payload: string; qos: number; retain: boolean } | undefined;
      let clean = true;
      if (rest.length === 2) { user = cs(rest[0]); pass = cs(rest[1]); }
      else if (rest.length === 4) will = { topic: cs(rest[0]), qos: Number(rest[1]), retain: !!rest[2], payload: cs(rest[3]) };
      else if (rest.length >= 6) {
        user = rest[0] === null ? undefined : cs(rest[0]);
        pass = rest[1] === null ? undefined : cs(rest[1]);
        will = { topic: cs(rest[2]), qos: Number(rest[3]), retain: !!rest[4], payload: cs(rest[5]) };
        if (rest.length >= 7) clean = !!rest[6];
      }
      if (!this.host) { M.warnOnce('mqtt-server', 'MQTT: не задан сервер', 'Вызовите client.setServer("mqtt.iot", 1883) в setup()'); this.st = -2; return false; }
      if (!online()) { M.warnOnce('mqtt-offline', 'MQTT: нет подключения к Wi-Fi'); this.st = -2; return false; }
      if (!M.net) { this.st = -2; return false; }
      this.session?.close(true);
      this.session = null;
      this.clientId = clientId;
      const r = yield* M.await(M.net.mqttConnect(
        { host: this.host, port: this.port, clientId, user, pass, will, keepAlive: this.keepAlive, clean },
        {
          onMessage: (topic, payload) => { this.inbox.push({ topic, payload }); if (this.inbox.length > 100) this.inbox.shift(); },
          onClose: (reason) => {
            if (this.st === 0) { this.st = -3; log('mqtt-conn', `MQTT: соединение потеряно (${reason})`, false); }
          },
        },
      ));
      yield* M.sleep(30_000);
      if (!r.ok) {
        this.st = r.code;
        log('mqtt-conn', `MQTT: отказ брокера ${this.host} (код ${r.code}: ${r.message})`, false);
        return false;
      }
      this.session = r.session;
      this.st = 0;
      this.lastLoop = M.now();
      log('mqtt-conn', `MQTT: подключено к ${this.host}:${this.port} как «${clientId}»`, true);
      return true;
    }
    connected() { return !!this.session?.connected && this.st === 0; }
    state() { return this.st; }
    disconnect() {
      this.session?.close(true);
      this.session = null;
      this.st = -1;
    }
    publish(topic: unknown, payload: unknown, a?: unknown, b?: unknown) {
      if (!this.connected()) {
        M.warnOnce('mqtt-pub-off', 'MQTT publish без подключения к брокеру', 'Проверьте client.connected() и переподключайтесь в loop()');
        return false;
      }
      let bytes: number[];
      let retain = false;
      if (Array.isArray(payload) && typeof a === 'number') {
        // publish(topic, const uint8_t* payload, length[, retain])
        bytes = (payload as number[]).slice(0, a).map((x) => x & 255);
        retain = !!b;
      } else if (Array.isArray(payload)) {
        // publish(topic, char buf[][, retain]) — C-строка до нулевого байта
        const arr = payload as number[];
        const z = arr.indexOf(0);
        bytes = (z < 0 ? arr : arr.slice(0, z)).map((x) => x & 255);
        retain = !!a;
      } else {
        bytes = utf8Bytes(payload === null || payload === undefined ? '' : cs(payload));
        retain = !!a;
      }
      const t = cs(topic);
      const size = bytes.length + t.length + 7;
      if (size > this.bufSize) {
        M.warnOnce('mqtt-buf', `MQTT: сообщение (${size} байт) больше буфера ${this.bufSize} — publish вернул false`, `Увеличьте буфер: client.setBufferSize(${Math.ceil(size / 256) * 256});`);
        return false;
      }
      const ok = this.session!.publish(t, new Uint8Array(bytes), retain, 0);
      log('mqtt-pub', `→ ${t}: ${new TextDecoder().decode(new Uint8Array(bytes))}${retain ? ' (retain)' : ''}`, ok);
      M.ops += 40;
      return ok;
    }
    publish_P(topic: unknown, payload: unknown, retain?: unknown) { return this.publish(topic, payload, retain); }
    subscribe(topic: unknown, qos = 0) {
      if (!this.connected()) { M.warnOnce('mqtt-sub-off', 'MQTT subscribe без подключения'); return false; }
      const t = cs(topic);
      const ok = this.session!.subscribe(t, qos);
      log('mqtt-sub', `Подписка: ${t}`, ok);
      if (!ok) M.warnOnce(`mqtt-sub-bad-${t}`, `Неверный фильтр топика «${t}»`, 'Символ # допустим только в конце, + — вместо целого уровня');
      return ok;
    }
    unsubscribe(topic: unknown) { return this.session?.unsubscribe(cs(topic)) ?? false; }
    *loop() {
      M.ops += 20;
      if (!this.session) return false;
      const now = M.now();
      if (this.st === 0 && now - this.lastLoop > this.keepAlive * 1.5e6) {
        this.session.close(false);
        this.st = -4;
        log('mqtt-conn', `MQTT: брокер разорвал соединение — loop() не вызывался ${((now - this.lastLoop) / 1e6).toFixed(0)} с`, false);
        M.warnOnce('mqtt-keepalive', 'MQTT-соединение разорвано: client.loop() вызывается слишком редко', `Вызывайте client.loop() часто (keepalive ${this.keepAlive} с), не используйте длинные delay()`);
        return false;
      }
      this.lastLoop = now;
      if (!this.connected()) return false;
      while (this.inbox.length) {
        const m = this.inbox.shift()!;
        log('mqtt-in', `← ${m.topic}: ${new TextDecoder().decode(m.payload)}`, true);
        if (m.payload.length + m.topic.length + 7 > this.bufSize) {
          M.warnOnce('mqtt-inbuf', `Входящее MQTT-сообщение больше буфера ${this.bufSize} байт и отброшено`, 'Увеличьте client.setBufferSize(…)');
          continue;
        }
        if (this.cb) yield* this.cb(m.topic, Array.from(m.payload), m.payload.length);
      }
      return true;
    }
  }

  // ======================= WebServer =======================
  class WebServer {
    routes: { path: string; method: number; fn: GenFn }[] = [];
    notFound: GenFn | null = null;
    started = false;
    cur: WebRequest | null = null;
    resp: { status: number; type: string; body: string; headers: Record<string, string> } | null = null;
    extraHeaders: Record<string, string> = {};
    constructor(public port = 80) {}
    on(path: unknown, a: unknown, b?: unknown) {
      if (typeof a === 'function') this.routes.push({ path: cs(path), method: 0, fn: a as GenFn });
      else this.routes.push({ path: cs(path), method: Number(a), fn: b as GenFn });
    }
    onNotFound(fn: GenFn) { this.notFound = fn; }
    begin() {
      this.started = true;
      M.lib.webServer = this;
      log('web', `Веб-сервер запущен на порту ${this.port}`, true);
    }
    close() { this.started = false; }
    stop() { this.started = false; }
    *handleClient() {
      M.ops += 10;
      const q = (M.lib.webQueue as WebRequest[] | undefined) ?? [];
      if (!q.length) return;
      const req = q.shift()!;
      this.cur = req;
      this.resp = null;
      this.extraHeaders = {};
      const methodNum = ({ GET: 1, HEAD: 2, POST: 3, PUT: 4, PATCH: 5, DELETE: 6, OPTIONS: 7 } as Record<string, number>)[req.method] ?? 1;
      const route = this.routes.find((r) => r.path === req.path && (r.method === 0 || r.method === methodNum));
      try {
        if (route) yield* route.fn();
        else if (this.notFound) yield* this.notFound();
        else this.send(404, 'text/plain', 'Not found: ' + req.path);
      } finally {
        const r = this.resp ?? { status: 500, type: 'text/plain', body: 'Обработчик не вызвал server.send()', headers: {} };
        if (!this.resp) M.warnOnce('web-nosend', `Обработчик пути ${req.path} не вызвал server.send()`, 'В конце обработчика отправьте ответ: server.send(200, "text/html", page);');
        log('web', `${req.method} ${req.path} → ${r.status}`, r.status < 400);
        req.resolve({ status: r.status, headers: { 'content-type': r.type, ...r.headers }, body: r.body });
        this.cur = null;
      }
    }
    send(code: number, type?: unknown, content?: unknown) {
      this.resp = { status: code, type: type === undefined ? 'text/html' : cs(type), body: content === undefined ? '' : cs(content), headers: this.extraHeaders };
    }
    send_P(code: number, type: unknown, content: unknown) { this.send(code, type, content); }
    sendHeader(k: unknown, v: unknown) { this.extraHeaders[cs(k)] = cs(v); }
    setContentLength() { /* ничего */ }
    sendContent(s: unknown) { if (this.resp) this.resp.body += cs(s); }
    redirect(url: unknown) { this.sendHeader('Location', url); this.send(302, 'text/plain', ''); }
    arg(name: unknown) {
      if (!this.cur) return '';
      if (typeof name === 'number') return Object.values(this.cur.query)[name] ?? '';
      const n = cs(name);
      if (n === 'plain') return this.cur.body;
      return this.cur.query[n] ?? '';
    }
    argName(i: number) { return this.cur ? Object.keys(this.cur.query)[i] ?? '' : ''; }
    hasArg(name: unknown) { const n = cs(name); return !!this.cur && (n in this.cur.query || (n === 'plain' && !!this.cur.body)); }
    args() { return this.cur ? Object.keys(this.cur.query).length : 0; }
    uri() { return this.cur?.path ?? ''; }
    method() { return this.cur ? ({ GET: 1, POST: 3, PUT: 4, DELETE: 6 } as Record<string, number>)[this.cur.method] ?? 1 : 0; }
    header() { return ''; }
    hasHeader() { return false; }
  }

  return {
    WiFi, WiFiClass, IPAddress, HTTPClient, WiFiClient, WiFiClientSecure, PubSubClient, WebServer,
    JsonDocument, DynamicJsonDocument: JsonDocument, StaticJsonDocument: JsonDocument, jsonOf, jsonNull,
    DeserializationErrorCheck: Panic,
  };
}
