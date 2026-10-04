// Учебные «виртуальные» веб-сервисы. Используются симулятором (автопроверка,
// офлайн-режим) и сервером сайта — поведение везде одинаковое.
import type { HttpRequest, HttpResponse } from './types';

export interface ChatMessage {
  id: number;
  sender: string;
  content: string;
  time: string;
}

export interface ChatStore {
  send(room: string, sender: string, content: string): ChatMessage;
  list(room: string, afterId: number, limit?: number): ChatMessage[];
}

export class MemoryChat implements ChatStore {
  rooms = new Map<string, ChatMessage[]>();
  seq = 1;
  constructor(private clock: () => Date = () => new Date()) {}
  send(room: string, sender: string, content: string): ChatMessage {
    const list = this.rooms.get(room) ?? [];
    const m = { id: this.seq++, sender, content, time: this.clock().toISOString() };
    list.push(m);
    if (list.length > 200) list.shift();
    this.rooms.set(room, list);
    return m;
  }
  list(room: string, afterId: number, limit = 50): ChatMessage[] {
    return (this.rooms.get(room) ?? []).filter((m) => m.id > afterId).slice(-limit);
  }
}

export interface ServiceCtx {
  chat: ChatStore;
  now(): Date;
  /** телеметрия, присланная на станцию (для проверок и панели) */
  telemetry?: (room: string, data: unknown) => void;
}

/** Хосты, которые обслуживаются виртуально. */
export const VIRTUAL_HOSTS = [
  'weather.iot', 'goweather.herokuapp.com', 'goweather.xyz', 'chat.iot', 'n8n.levandrovskiy.ru', 'time.iot',
  'api.iot', 'station.iot', 'facts.iot',
];

export function isVirtualHost(host: string): boolean {
  return VIRTUAL_HOSTS.includes(host.toLowerCase());
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function seeded(seed: number) {
  let x = seed || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

const CITY_BASE: Record<string, number> = {
  moscow: 4, москва: 4, 'saint-petersburg': 3, spb: 3, murmansk: -6, norilsk: -18, sochi: 13, kazan: 2,
  novosibirsk: -4, yakutsk: -25, london: 9, paris: 11, tokyo: 14, dubai: 30, barentsburg: -9, polar: -21,
};
const DESCR = ['Sunny', 'Partly cloudy', 'Cloudy', 'Light rain', 'Snow', 'Fog', 'Clear', 'Overcast', 'Blizzard'];
const DESCR_RU: Record<string, string> = {
  Sunny: 'Солнечно', 'Partly cloudy': 'Переменная облачность', Cloudy: 'Облачно', 'Light rain': 'Небольшой дождь',
  Snow: 'Снег', Fog: 'Туман', Clear: 'Ясно', Overcast: 'Пасмурно', Blizzard: 'Метель',
};

export function weatherFor(city: string, date: Date) {
  const key = city.toLowerCase();
  const day = Math.floor(date.getTime() / 86400000);
  const rnd = seeded(hash(key + ':' + day));
  const base = CITY_BASE[key] ?? Math.round(rnd() * 30 - 10);
  const t0 = Math.round(base + rnd() * 6 - 3);
  const days = [0, 1, 2].map((i) => ({
    day: String(i + 1),
    temp: Math.round(base + rnd() * 8 - 4),
    wind: Math.round(2 + rnd() * 18),
  }));
  const descr = DESCR[Math.floor(rnd() * DESCR.length)];
  return {
    city,
    temp: t0,
    feels_like: t0 - Math.round(rnd() * 4),
    humidity: Math.round(40 + rnd() * 55),
    pressure: Math.round(735 + rnd() * 30),
    wind: Math.round(1 + rnd() * 15),
    description: descr,
    description_ru: DESCR_RU[descr],
    forecast: days,
  };
}

const sign = (n: number) => (n > 0 ? `+${n}` : String(n));

const FACTS = [
  'Первым IoT-устройством считают торговый автомат Coca-Cola в Университете Карнеги-Меллон (1982).',
  'Термин «Интернет вещей» придумал Кевин Эштон в 1999 году.',
  'ESP32 содержит два ядра Xtensa LX6 с частотой до 240 МГц.',
  'Протокол MQTT был создан в 1999 году для мониторинга нефтепроводов через спутник.',
  'Первая «интернет-вещь» — тостер Джона Ромки, который включали по сети (1990).',
  'Wi-Fi в диапазоне 2,4 ГГц использует 13 каналов, но не пересекаются только 1, 6 и 11.',
  'Датчик DHT22 нельзя опрашивать чаще одного раза в две секунды.',
  'АЦП ESP32 12-битный: значения от 0 до 4095.',
];

function json(status: number, obj: unknown): HttpResponse {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj) };
}

/** Обработать запрос к виртуальному сервису. null — хост не виртуальный. */
export function virtualHttp(req: HttpRequest, ctx: ServiceCtx): HttpResponse | null {
  let url: URL;
  try { url = new URL(req.url); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (!isVirtualHost(host)) return null;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;
  let body: Record<string, unknown> = {};
  if (req.body) {
    try { body = JSON.parse(req.body); } catch {
      // form-urlencoded
      for (const [k, v] of new URLSearchParams(req.body)) body[k] = v;
    }
  }
  const param = (k: string) => q.get(k) ?? (body[k] !== undefined ? String(body[k]) : null);

  // ---- погода (формат goweather из лекции) ----
  if (host === 'goweather.herokuapp.com' || host === 'goweather.xyz' || (host === 'weather.iot' && path.startsWith('/weather/'))) {
    const city = decodeURIComponent(path.split('/')[2] ?? 'Moscow');
    const w = weatherFor(city, ctx.now());
    return json(200, {
      temperature: `${sign(w.temp)} °C`,
      wind: `${w.wind} km/h`,
      description: w.description,
      forecast: w.forecast.map((f) => ({ day: f.day, temperature: `${sign(f.temp)} °C`, wind: `${f.wind} km/h` })),
    });
  }
  if (host === 'weather.iot') {
    // числовой формат: /api?city=Moscow
    if (path === '/api' || path === '/' || path === '/current') {
      const city = param('city') ?? 'Moscow';
      return json(200, weatherFor(city, ctx.now()));
    }
    return json(404, { error: 'not found', hint: 'GET /api?city=Moscow или /weather/Moscow' });
  }

  // ---- чат (как в лекции 4) ----
  if (host === 'chat.iot' || host === 'n8n.levandrovskiy.ru') {
    const room = param('chat_name') ?? param('room') ?? 'general';
    if (path === '/send_message' || path === '/send') {
      const sender = param('sender') ?? 'esp32';
      const content = param('content') ?? param('text') ?? '';
      if (!content) return json(400, { status: 'error', error: 'content is empty' });
      const m = ctx.chat.send(room, sender, content);
      return json(200, { status: 'ok', id: m.id });
    }
    if (path === '/get_messages' || path === '/messages') {
      const after = Number(param('after_id') ?? param('after') ?? 0) || 0;
      const limit = Math.min(50, Number(param('limit') ?? 20) || 20);
      const msgs = ctx.chat.list(room, after, limit);
      return json(200, { chat_name: room, messages: msgs, last_id: msgs.length ? msgs[msgs.length - 1].id : after });
    }
    if (path === '/last_message' || path === '/last') {
      const msgs = ctx.chat.list(room, 0, 1);
      return json(200, msgs[0] ?? { id: 0, sender: '', content: '', time: '' });
    }
    if (path === '/docs' || path === '/') {
      return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'GET /send_message?chat_name=&sender=&content=\nGET /get_messages?chat_name=&after_id=\nGET /last_message?chat_name=' };
    }
    return json(404, { error: 'not found' });
  }

  // ---- время ----
  if (host === 'time.iot') {
    const d = ctx.now();
    const tz = Number(param('tz') ?? 3);
    const local = new Date(d.getTime() + tz * 3600000);
    return json(200, {
      unix: Math.floor(d.getTime() / 1000), iso: d.toISOString(), tz,
      year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(),
      hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds(),
      weekday: local.getUTCDay(),
    });
  }

  // ---- факты ----
  if (host === 'facts.iot') {
    const i = Math.floor((ctx.now().getTime() / 1000) % FACTS.length);
    return json(200, { id: i + 1, fact: FACTS[i], total: FACTS.length });
  }

  // ---- учебный API: эхо, счётчик ----
  if (host === 'api.iot') {
    if (path === '/echo') {
      return json(200, { method: req.method, path, query: Object.fromEntries(q), headers: req.headers, body: req.body ?? '' });
    }
    if (path === '/ip') return json(200, { ip: '93.184.216.34' });
    if (path === '/status/404') return json(404, { error: 'Not Found' });
    if (path === '/status/500') return json(500, { error: 'Internal Server Error' });
    return json(404, { error: 'not found', endpoints: ['/echo', '/ip', '/status/404'] });
  }

  // ---- центр управления станцией ----
  if (host === 'station.iot') {
    const room = param('station') ?? param('id') ?? 'polar';
    if (path === '/telemetry' && req.method === 'POST') {
      const temp = body.temperature ?? body.temp;
      if (temp === undefined) return json(400, { accepted: false, error: 'В JSON нет поля "temperature"' });
      if (typeof temp !== 'number') return json(400, { accepted: false, error: 'Поле "temperature" должно быть числом, а не строкой' });
      ctx.telemetry?.(room, body);
      return json(200, { accepted: true, message: 'Телеметрия принята центром управления', received: body });
    }
    if (path === '/mission') {
      return json(200, { station: 'Полярная-5', mission: 'Восстановить метеостанцию', code: 'AURORA', next: 'POST /telemetry' });
    }
    return json(404, { error: 'not found', endpoints: ['GET /mission', 'POST /telemetry'] });
  }
  return null;
}
