// Реальные HTTP-запросы скетчей из симулятора с защитой от SSRF:
// проверка адресов после DNS, подключение именно к проверенному IP,
// ручная обработка редиректов, таймаут и ограничение размера ответа.
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { LookupFunction } from 'node:net';

export interface NetRequest { method: string; url: string; headers: Record<string, string>; body?: string }
export interface NetResponse { status: number; headers: Record<string, string>; body: string; reason?: string }

export const ALLOWED_PORTS = new Set([80, 443, 8080]);
export const MAX_RESPONSE = 512 * 1024;
export const TIMEOUT_MS = 8000;
export const MAX_REDIRECTS = 3;

const blocked = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as [string, number][]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32],
  ['2002::', 16], ['100::', 64], ['2001::', 32],
] as [string, number][]) blocked.addSubnet(a, p, 'ipv6');

/** Адрес публичный (не loopback/частный/link-local/multicast/ULA…)? */
export function isPublicAddress(addr: string): boolean {
  const fam = net.isIP(addr);
  if (fam === 4) return !blocked.check(addr, 'ipv4');
  if (fam !== 6) return false;
  const lower = addr.toLowerCase();
  // IPv4, встроенный в IPv6 (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d)
  const embedded = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) return isPublicAddress(embedded[1]);
  const hexMapped = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (lower.startsWith('::ffff:') || lower.startsWith('64:ff9b:')) return false;
  return !blocked.check(addr, 'ipv6');
}

export class NetBlocked extends Error {}

interface Target { url: URL; address: string; family: number }

/** Проверить URL и разрешить имя; бросает NetBlocked с понятным сообщением. */
export async function validateTarget(raw: string, resolve: (h: string) => Promise<{ address: string; family: number }[]> = defaultResolve): Promise<Target> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new NetBlocked('Некорректный адрес'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new NetBlocked('Разрешены только http и https');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) throw new NetBlocked(`Порт ${port} запрещён (можно 80, 443, 8080)`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new NetBlocked('Не указан хост');
  let addrs: { address: string; family: number }[];
  if (net.isIP(host)) addrs = [{ address: host, family: net.isIP(host) }];
  else {
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new NetBlocked('Запрещённый адрес');
    try { addrs = await resolve(host); } catch { throw new NetBlocked(`Не удалось найти хост ${host}`); }
  }
  if (!addrs.length) throw new NetBlocked(`Не удалось найти хост ${host}`);
  for (const a of addrs) if (!isPublicAddress(a.address)) throw new NetBlocked('Запросы к внутренним адресам запрещены');
  return { url, address: addrs[0].address, family: addrs[0].family };
}

async function defaultResolve(h: string) {
  return dns.lookup(h, { all: true, verbatim: true });
}

const DROP_REQ = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'keep-alive', 'te', 'trailer', 'expect']);

function once(t: Target, req: NetRequest, signal: AbortSignal): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lookup: LookupFunction = (_host, opts, cb) => {
      const o = opts as { all?: boolean };
      if (o?.all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: t.address, family: t.family }]);
      else cb(null, t.address, t.family);
    };
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers ?? {})) {
      const key = k.toLowerCase();
      if (DROP_REQ.has(key) || key.startsWith('proxy-')) continue;
      headers[key] = String(v);
    }
    headers['user-agent'] ??= 'ESP32HTTPClient';
    const body = req.body !== undefined && !['GET', 'HEAD'].includes(req.method) ? Buffer.from(req.body, 'utf8') : null;
    if (body) headers['content-length'] = String(body.length);
    const mod = t.url.protocol === 'https:' ? https : http;
    const r = mod.request({
      protocol: t.url.protocol,
      hostname: t.url.hostname.replace(/^\[|\]$/g, ''),
      port: t.url.port || undefined,
      path: t.url.pathname + t.url.search,
      method: req.method,
      headers,
      lookup,
      signal,
      agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_RESPONSE) {
          res.destroy();
          reject(new NetBlocked('Ответ больше 512 КБ'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function flatHeaders(h: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (v !== undefined) out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  return out;
}

/** Выполнить реальный запрос. Ошибки сети и запреты → status −1 и reason. */
export async function safeFetch(req: NetRequest, resolve?: (h: string) => Promise<{ address: string; family: number }[]>): Promise<NetResponse> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    let current: NetRequest = { ...req, method: req.method.toUpperCase() };
    for (let hop = 0; ; hop++) {
      const target = await validateTarget(current.url, resolve);
      const res = await once(target, current, ac.signal);
      const loc = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
        if (hop >= MAX_REDIRECTS) return { status: -1, headers: {}, body: '', reason: 'Слишком много перенаправлений' };
        const next = new URL(loc, target.url).toString();
        const keepBody = res.status === 307 || res.status === 308;
        let headers = current.headers;
        if (new URL(next).origin !== target.url.origin) {
          headers = Object.fromEntries(Object.entries(headers ?? {}).filter(([k]) => !['authorization', 'cookie'].includes(k.toLowerCase())));
        }
        current = keepBody ? { ...current, url: next, headers } : { method: current.method === 'HEAD' ? 'HEAD' : 'GET', url: next, headers };
        continue;
      }
      return { status: res.status, headers: flatHeaders(res.headers), body: current.method === 'HEAD' ? '' : res.body.toString('utf8') };
    }
  } catch (e) {
    if (e instanceof NetBlocked) return { status: -1, headers: {}, body: '', reason: e.message };
    if (ac.signal.aborted) return { status: -1, headers: {}, body: '', reason: 'Превышено время ожидания (8 с)' };
    return { status: -1, headers: {}, body: '', reason: 'Ошибка соединения' };
  } finally {
    clearTimeout(timer);
  }
}
