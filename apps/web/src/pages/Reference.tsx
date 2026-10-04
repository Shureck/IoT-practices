import { useMemo, useState } from 'react';
import { COMPONENTS, DEFS, type Part } from '@esp32lab/sim';
import { API_GROUPS } from '../lib/apiDocs';
import { highlightCpp } from '../lib/markdown';
import { PartIcon, PartView } from '../workbench/parts';
import { Badge, Tabs, inputCls } from '../components/ui';

interface PinInfo { gpio: number; tags: string[]; note?: string }
const PINS: PinInfo[] = [
  { gpio: 0, tags: ['ADC2', 'Touch'], note: 'Кнопка BOOT, «стяжка» загрузки — лучше не использовать' },
  { gpio: 1, tags: ['TX0'], note: 'Serial (USB) — занят' },
  { gpio: 2, tags: ['ADC2', 'Touch', 'LED'], note: 'Встроенный синий светодиод' },
  { gpio: 3, tags: ['RX0'], note: 'Serial (USB) — занят' },
  { gpio: 4, tags: ['ADC2', 'Touch'] },
  { gpio: 5, tags: ['SPI SS'], note: 'При загрузке выдаёт ШИМ' },
  { gpio: 12, tags: ['ADC2', 'Touch'], note: 'Стяжка напряжения flash — при загрузке должен быть LOW' },
  { gpio: 13, tags: ['ADC2', 'Touch'] },
  { gpio: 14, tags: ['ADC2', 'Touch'] },
  { gpio: 15, tags: ['ADC2', 'Touch'] },
  { gpio: 16, tags: ['RX2'], note: 'Serial2 RX по умолчанию' },
  { gpio: 17, tags: ['TX2'], note: 'Serial2 TX по умолчанию' },
  { gpio: 18, tags: ['SPI SCK'] },
  { gpio: 19, tags: ['SPI MISO'] },
  { gpio: 21, tags: ['I²C SDA'] },
  { gpio: 22, tags: ['I²C SCL'] },
  { gpio: 23, tags: ['SPI MOSI'] },
  { gpio: 25, tags: ['ADC2', 'DAC1'] },
  { gpio: 26, tags: ['ADC2', 'DAC2'] },
  { gpio: 27, tags: ['ADC2', 'Touch'] },
  { gpio: 32, tags: ['ADC1', 'Touch'] },
  { gpio: 33, tags: ['ADC1', 'Touch'] },
  { gpio: 34, tags: ['ADC1', 'только вход'], note: 'Нет подтяжек' },
  { gpio: 35, tags: ['ADC1', 'только вход'], note: 'Нет подтяжек' },
  { gpio: 36, tags: ['ADC1', 'только вход'], note: 'VP, нет подтяжек' },
  { gpio: 39, tags: ['ADC1', 'только вход'], note: 'VN, нет подтяжек' },
];

const SERVICES = [
  { url: 'http://weather.iot/api?city=Moscow', text: 'Погода числами: temp, humidity, wind, description, forecast[]' },
  { url: 'http://weather.iot/weather/Moscow', text: 'Погода в формате из лекции (goweather.herokuapp.com тоже работает)' },
  { url: 'http://chat.iot/send_message?chat_name=polar&sender=esp32&content=Привет', text: 'Отправить сообщение в чат (можно POST с JSON)' },
  { url: 'http://chat.iot/get_messages?chat_name=polar&after_id=0', text: 'Новые сообщения чата после after_id; в ответе last_id' },
  { url: 'http://time.iot/now?tz=3', text: 'Текущее время: unix, hour, minute…' },
  { url: 'http://station.iot/telemetry', text: 'POST JSON {"temperature": число, …} — центр управления станцией' },
  { url: 'http://api.iot/echo', text: 'Возвращает ваш запрос: метод, заголовки, тело — для отладки' },
  { url: 'http://facts.iot', text: 'Случайный факт об IoT' },
];

const MISTAKES = [
  ['Светодиод не горит', 'Нет pinMode(pin, OUTPUT); светодиод вставлен наоборот (длинная ножка — к «+»); забыт резистор (сгорел).'],
  ['Кнопка срабатывает сама', 'Вход «висит в воздухе». Используйте INPUT_PULLUP (кнопка на GND) или INPUT_PULLDOWN (кнопка на 3V3).'],
  ['В мониторе «каракули»', 'Скорость монитора не совпадает с Serial.begin(…).'],
  ['analogRead всегда 0', 'Вывод не подключён к АЦП или используется АЦП2 при включённом Wi-Fi — берите GPIO32–39.'],
  ['"T: " + 5 печатает мусор', 'Строка в кавычках + число — это арифметика указателей. Пишите String("T: ") + 5.'],
  ['Float получился целым', '5 / 2 = 2: делятся целые. Пишите 5.0 / 2 или (float)a / b.'],
  ['MQTT отваливается', 'client.loop() вызывается редко из-за длинных delay(). Используйте millis().'],
  ['Сообщение MQTT не уходит', 'Пакет больше 256 байт — увеличьте client.setBufferSize(512).'],
];

const TAG_TONE: Record<string, 'accent' | 'violet' | 'ok' | 'warn' | 'muted'> = { ADC1: 'ok', ADC2: 'warn', Touch: 'violet', 'только вход': 'muted' };

export default function Reference() {
  const [tab, setTab] = useState<'pins' | 'api' | 'parts' | 'net' | 'faq'>('api');
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return API_GROUPS.map((g) => ({ ...g, entries: Object.entries(g.items).filter(([k, d]) => !ql || k.toLowerCase().includes(ql) || d.text.toLowerCase().includes(ql) || d.sig.toLowerCase().includes(ql)) })).filter((g) => g.entries.length);
  }, [q]);
  const esp: Part = { id: 'esp', type: 'esp32', x: 0, y: 0, rot: 0, props: {} };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Справочник инженера</h1>
      <p className="mt-1 text-muted">Всё под рукой: функции, распиновка, компоненты и учебные сервисы.</p>
      <Tabs className="mt-4 border-b border-line" value={tab} onChange={setTab} tabs={[
        { id: 'api', label: 'Функции' }, { id: 'pins', label: 'Распиновка ESP32' }, { id: 'parts', label: 'Компоненты' },
        { id: 'net', label: 'Сеть и сервисы' }, { id: 'faq', label: 'Частые ошибки' },
      ]} />
      <div className="mt-5">
        {tab === 'api' && (
          <>
            <input className={`${inputCls} mb-4 max-w-md`} placeholder="Поиск: digitalWrite, millis, MQTT…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="space-y-6">
              {groups.map((g) => (
                <section key={g.title}>
                  <h2 className="mb-2 text-lg font-semibold">{g.icon} {g.title}</h2>
                  <div className="grid gap-2 md:grid-cols-2">
                    {g.entries.map(([k, d]) => (
                      <div key={k} className="rounded-xl border border-line bg-panel p-3.5">
                        <code className="font-mono text-[13px] font-semibold text-accent">{d.sig}</code>
                        <div className="mt-1 text-[13.5px] text-muted">{d.text}</div>
                        {d.example && <pre className="md mt-2 overflow-x-auto rounded-lg border border-line bg-[var(--code-bg)] p-2.5 font-mono text-[12px]" dangerouslySetInnerHTML={{ __html: highlightCpp(d.example) }} />}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
        {tab === 'pins' && (
          <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl border border-line p-4" style={{ background: 'var(--canvas)' }}>
              <svg viewBox="-20 -20 260 140" className="w-full"><PartView part={esp} running={false} view={{ power: true }} /></svg>
              <div className="mt-2 text-[13px] text-muted">Питание: <b>3V3</b> — 3,3 В (датчики), <b>VIN</b> — 5 В от USB (реле, сервоприводы, HC-SR04), <b>GND</b> — земля. Логические уровни ESP32 — 3,3 В.</div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-line">
              <table className="w-full text-[13px]">
                <thead className="bg-panel-2"><tr><th className="px-3 py-2 text-left">GPIO</th><th className="px-3 py-2 text-left">Возможности</th><th className="px-3 py-2 text-left">Заметка</th></tr></thead>
                <tbody>
                  {PINS.map((p) => (
                    <tr key={p.gpio} className="border-t border-line">
                      <td className="px-3 py-1.5 font-mono font-semibold">{p.gpio}</td>
                      <td className="px-3 py-1.5"><div className="flex flex-wrap gap-1">{p.tags.map((t) => <Badge key={t} tone={TAG_TONE[t] ?? 'accent'}>{t}</Badge>)}</div></td>
                      <td className="px-3 py-1.5 text-muted">{p.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab === 'parts' && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COMPONENTS.map((c) => (
              <div key={c.type} className="rounded-xl border border-line bg-panel p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg p-1" style={{ background: 'var(--canvas)' }}><PartIcon type={c.type} size={56} /></div>
                  <div><div className="font-semibold">{c.title}</div><div className="text-xs text-faint">{c.category}</div></div>
                </div>
                <div className="mt-2 text-[13px] text-muted">{c.description}</div>
                {c.type !== 'breadboard' && c.type !== 'esp32' && (
                  <div className="mt-2 flex flex-wrap gap-1">{DEFS[c.type].pins.map((p) => <Badge key={p.name}>{p.label ?? p.name}</Badge>)}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {tab === 'net' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-panel p-4 text-[14px]">
              <div className="font-semibold">Wi-Fi</div>
              <div className="mt-1 text-muted">Учебная сеть <code className="font-mono">Samsung_IoT</code>, пароль <code className="font-mono">IOT5iot5</code>. Ещё: <code className="font-mono">Polar-Station / aurora2025</code>, открытая <code className="font-mono">Wokwi-GUEST</code>.</div>
              <div className="mt-3 font-semibold">MQTT</div>
              <div className="mt-1 text-muted">Брокер <code className="font-mono">mqtt.iot</code>, порт 1883 — общий для всех студентов, сообщения видны во вкладке «MQTT». Настоящие платы подключаются к брокеру по адресу сервера сайта, порт 1883. Также работают <code className="font-mono">broker.hivemq.com</code> и <code className="font-mono">test.mosquitto.org</code>.</div>
            </div>
            <div className="overflow-hidden rounded-xl border border-line">
              {SERVICES.map((s) => (
                <div key={s.url} className="border-b border-line px-4 py-2.5 last:border-0">
                  <code className="break-all font-mono text-[12.5px] text-accent">{s.url}</code>
                  <div className="text-[13px] text-muted">{s.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'faq' && (
          <div className="grid gap-2 md:grid-cols-2">
            {MISTAKES.map(([t, d]) => (
              <div key={t} className="rounded-xl border border-line bg-panel p-4">
                <div className="font-semibold">❓ {t}</div>
                <div className="mt-1 text-[13.5px] text-muted">{d}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
