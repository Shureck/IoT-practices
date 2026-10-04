// Общие помощники для проверок сетевых практик (модули 4–6).
import type { CheckContext } from '@esp32lab/sim';

/** Дата, от которой отсчитывается виртуальное время проверок (см. harness.ts). */
export const CHECK_DATE = new Date(Date.UTC(2025, 9, 15, 9, 0, 0));

interface WifiState { st: number; ssid: string; ip: { toString(): string } }

/** Состояние Wi-Fi внутри симулятора. */
export function wifi(h: CheckContext): WifiState {
  return (h.sim.M.lib.wifi as WifiState | undefined) ?? { st: 0, ssid: '', ip: { toString: () => '0.0.0.0' } };
}

export const wifiConnected = (h: CheckContext) => wifi(h).st === 3;

/** Дождаться подключения к Wi-Fi или упасть с понятным сообщением. */
export async function needWifi(h: CheckContext, limit = 10000): Promise<void> {
  const ok = await h.waitFor(() => wifiConnected(h), limit, 50);
  h.expect(ok, `За ${limit / 1000} с плата не подключилась к Wi-Fi. Проверьте WiFi.begin("Samsung_IoT", "IOT5iot5") и цикл ожидания WiFi.status() != WL_CONNECTED`);
}

/** Дождаться подключения к MQTT-брокеру. Возвращает clientId. */
export async function needMqtt(h: CheckContext, limit = 10000): Promise<string> {
  const ok = await h.waitFor(() => h.mqttConnected().length > 0, limit, 50);
  h.expect(ok, `За ${limit / 1000} с плата не подключилась к MQTT-брокеру. Нужны setServer("mqtt.iot", 1883) и client.connect(clientId)`);
  return h.mqttConnected()[0];
}

/**
 * Прогнать симуляцию duration мс, отмечая моменты, когда count() увеличивался.
 * Возвращает виртуальные времена (мс) каждого нового события.
 */
export async function track(h: CheckContext, count: () => number, duration: number, step = 50): Promise<number[]> {
  const times: number[] = [];
  let last = count();
  const end = h.now + duration;
  while (h.now < end) {
    await h.wait(step);
    const c = count();
    for (let i = last; i < c; i++) times.push(h.now);
    last = c;
  }
  return times;
}

/** Средний интервал между событиями. */
export function avgInterval(times: number[]): number | null {
  if (times.length < 2) return null;
  return (times[times.length - 1] - times[0]) / (times.length - 1);
}

/** Разобрать JSON или вернуть null. */
export function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Разорвать MQTT-соединение клиента со стороны брокера (как при сбое сети). */
export function dropMqtt(h: CheckContext, clientId: string, graceful = false) {
  const broker = h.net.broker;
  const c = broker.clients.get(clientId);
  if (!c) return;
  c.alive = false;
  broker.clients.delete(clientId);
  if (!graceful && c.will) broker.publish(c.will.topic, new TextEncoder().encode(c.will.payload), c.will.retain, clientId);
  c.handlers.onClose('Связь с брокером потеряна');
}

/** Сообщения чата от платы (sender = esp32) после id. */
export function botReplies(h: CheckContext, room: string, afterId = 0) {
  return h.chatMessages(room).filter((m) => m.id > afterId && m.sender.toLowerCase() === 'esp32');
}

/** Отправить сообщение в чат от имени капитана и вернуть его id. */
export function say(h: CheckContext, room: string, text: string): number {
  h.chatSay(room, 'captain', text);
  const all = h.chatMessages(room);
  return all[all.length - 1].id;
}
