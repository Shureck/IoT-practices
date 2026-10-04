// Панели: сеть, MQTT, чат, браузер (веб-сервер ESP32), проблемы.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Eraser, RotateCw, Send, Wifi, Lock, Globe } from 'lucide-react';
import { DEFAULT_APS, topicMatches } from '@esp32lab/sim';
import { useWB } from '../store';
import { connectPanel, localChat, type PanelMqtt } from '../liveNet';
import { webRequest } from '../simController';
import { Badge, Empty, IconButton, inputCls, inputBase, Button } from '../../components/ui';
import { useApp } from '../../store/app';
import { api } from '../../lib/api';

const KIND: Record<string, { label: string; tone: 'accent' | 'violet' | 'ok' | 'warn' | 'muted' }> = {
  http: { label: 'HTTP', tone: 'accent' }, 'mqtt-pub': { label: 'MQTT ↑', tone: 'violet' }, 'mqtt-in': { label: 'MQTT ↓', tone: 'violet' },
  'mqtt-sub': { label: 'SUB', tone: 'violet' }, 'mqtt-conn': { label: 'MQTT', tone: 'violet' }, wifi: { label: 'Wi-Fi', tone: 'ok' }, web: { label: 'WEB', tone: 'warn' },
};

export function NetworkPanel() {
  const log = useWB((s) => s.netLog);
  const [open, setOpen] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [log.length]);
  return (
    <div className="grid h-full grid-cols-[1fr_240px] max-md:grid-cols-1">
      <div ref={box} className="min-h-0 overflow-auto p-2 font-mono text-[12px]">
        {!log.length && <div className="p-4 text-center font-sans text-sm text-faint">Здесь появятся подключения к Wi-Fi, HTTP-запросы и MQTT-сообщения.</div>}
        {log.map((e, i) => (
          <div key={i} className="rounded px-1.5 py-0.5 hover:bg-panel-2">
            <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === i ? null : i)}>
              <span className="w-16 shrink-0 text-faint">{(e.t / 1e6).toFixed(2)} с</span>
              <Badge tone={KIND[e.kind]?.tone ?? 'muted'} className="w-16 justify-center">{KIND[e.kind]?.label ?? e.kind}</Badge>
              <span className={`truncate ${e.ok === false ? 'text-err' : ''}`}>{e.text}</span>
            </button>
            {open === i && e.detail && <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-bg-2 p-2 text-[11.5px]">{prettyJson(e.detail)}</pre>}
          </div>
        ))}
      </div>
      <div className="overflow-auto border-l border-line p-3 max-md:hidden">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Сети вокруг станции</div>
        {DEFAULT_APS.map((ap) => (
          <div key={ap.ssid} className="mb-1.5 flex items-center gap-2 text-[12.5px]">
            <Wifi size={14} className={ap.rssi > -60 ? 'text-ok' : ap.rssi > -75 ? 'text-warn' : 'text-err'} />
            <span className="flex-1 truncate font-medium">{ap.ssid}</span>
            {ap.pass ? <Lock size={12} className="text-faint" /> : null}
            <span className="font-mono text-[11px] text-faint">{ap.rssi}</span>
          </div>
        ))}
        <div className="mt-3 text-[11.5px] leading-relaxed text-faint">Пароль учебной сети: <code className="font-mono text-muted">Samsung_IoT / IOT5iot5</code>. Сервисы: weather.iot, chat.iot, time.iot, station.iot — см. «Справочник».</div>
      </div>
    </div>
  );
}

function prettyJson(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

// ---------------- MQTT ----------------
interface Msg { topic: string; payload: string; retained: boolean; t: number }

export function MqttPanel() {
  const user = useApp((s) => s.user);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [status, setStatus] = useState('…');
  const [filter, setFilter] = useState('#');
  const [topic, setTopic] = useState('station/polar5/cmd');
  const [payload, setPayload] = useState('');
  const [retain, setRetain] = useState(false);
  const conn = useRef<PanelMqtt | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conn.current = connectPanel(!!user, (t, p, r) => setMsgs((m) => [...m.slice(-400), { topic: t, payload: p, retained: r, t: Date.now() }]), setStatus);
    conn.current.subscribe('#');
    return () => conn.current?.close();
  }, [user]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs.length]);

  const shown = useMemo(() => msgs.filter((m) => { try { return topicMatches(filter || '#', m.topic); } catch { return true; } }), [msgs, filter]);
  const topics = useMemo(() => {
    const last = new Map<string, string>();
    for (const m of msgs) last.set(m.topic, m.payload);
    return [...last.entries()].sort();
  }, [msgs]);

  return (
    <div className="grid h-full grid-cols-[1fr_260px] max-md:grid-cols-1">
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-2 py-1">
          <Badge tone={status === 'подключено' || status === 'локальный брокер' ? 'ok' : 'warn'}>{status}</Badge>
          <input className={`${inputBase} h-7 w-48 font-mono text-xs`} value={filter} onChange={(e) => setFilter(e.target.value)} title="Фильтр топиков (+ и #)" />
          <IconButton title="Очистить" onClick={() => setMsgs([])}><Eraser size={14} /></IconButton>
          <span className="ml-auto text-[11px] text-faint">{user ? 'брокер сайта (mqtt.iot)' : 'войдите, чтобы использовать общий брокер'}</span>
        </div>
        <div ref={box} className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[12px]">
          {!shown.length && <div className="p-4 text-center font-sans text-sm text-faint">Сообщения появятся, когда программа или вы опубликуете что-нибудь.</div>}
          {shown.map((m, i) => (
            <div key={i} className="flex gap-2 rounded px-1.5 py-0.5 hover:bg-panel-2">
              <span className="shrink-0 text-faint">{new Date(m.t).toLocaleTimeString()}</span>
              <span className="shrink-0 text-accent-2">{m.topic}</span>
              <span className="break-all">{m.payload}</span>
              {m.retained && <Badge>retain</Badge>}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 border-t border-line px-2 py-1.5">
          <input className={`${inputBase} h-8 w-56 font-mono text-xs`} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="топик" />
          <input className={`${inputCls} h-8 font-mono text-xs`} value={payload} onChange={(e) => setPayload(e.target.value)} placeholder="сообщение"
            onKeyDown={(e) => { if (e.key === 'Enter' && topic) { conn.current?.publish(topic, payload, retain); setPayload(''); } }} />
          <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={retain} onChange={(e) => setRetain(e.target.checked)} />retain</label>
          <IconButton title="Опубликовать" onClick={() => { if (topic) { conn.current?.publish(topic, payload, retain); setPayload(''); } }}><Send size={15} /></IconButton>
        </div>
      </div>
      <div className="overflow-auto border-l border-line p-2 max-md:hidden">
        <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-faint">Топики</div>
        {topics.map(([t, p]) => (
          <button key={t} className="block w-full rounded px-1.5 py-1 text-left hover:bg-panel-2" onClick={() => setTopic(t)}>
            <div className="truncate font-mono text-[11.5px] text-accent-2">{t}</div>
            <div className="truncate font-mono text-[11px] text-muted">{p}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- чат ----------------
interface ChatMsg { id: number; sender: string; content: string; time: string }

export function ChatPanel() {
  const user = useApp((s) => s.user);
  const [room, setRoom] = useState('polar');
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const last = useRef(0);

  useEffect(() => {
    setMsgs([]);
    last.current = 0;
    let stop = false;
    const tick = async () => {
      try {
        const list = user ? (await api.chat(room, last.current)).messages : localChat.list(room, last.current, 50);
        if (list.length && !stop) {
          last.current = list[list.length - 1].id;
          setMsgs((m) => [...m, ...list].slice(-300));
        }
      } catch { /* повторим */ }
      if (!stop) setTimeout(tick, 1000);
    };
    void tick();
    return () => { stop = true; };
  }, [room, user]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    if (user) await api.chatSend(room, t).catch(() => undefined);
    else localChat.send(room, 'капитан', t);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1 text-xs text-muted">
        Комната <input className={`${inputBase} h-7 w-32 font-mono text-xs`} value={room} onChange={(e) => setRoom(e.target.value.replace(/[^\w-]/g, ''))} />
        <span className="text-faint">ESP32 читает: <code className="font-mono">chat.iot/get_messages?chat_name={room}</code></span>
      </div>
      <div ref={box} className="min-h-0 flex-1 space-y-1.5 overflow-auto p-3">
        {!msgs.length && <div className="text-center text-sm text-faint">Напишите «Включи свет» — программа на ESP32 прочитает команду из чата.</div>}
        {msgs.map((m) => {
          const mine = m.sender !== 'esp32';
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-[13px] ${mine ? 'rounded-br-sm bg-accent/15' : 'rounded-bl-sm border border-line bg-panel-2'}`}>
                <div className="text-[10.5px] font-semibold text-faint">{m.sender} · {new Date(m.time).toLocaleTimeString()}</div>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 border-t border-line px-2 py-1.5">
        {['Включи свет', 'Выключи свет', 'Включи вентилятор', 'Погода'].map((q) => (
          <button key={q} className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent hover:text-accent max-lg:hidden" onClick={() => setText(q)}>{q}</button>
        ))}
        <input className={`${inputCls} h-8 text-sm`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} placeholder="Сообщение в чат станции…" />
        <IconButton title="Отправить" onClick={() => void send()}><Send size={15} /></IconButton>
      </div>
    </div>
  );
}

// ---------------- браузер ----------------
export function BrowserPanel() {
  const running = useWB((s) => s.running);
  const [path, setPath] = useState('/');
  const [res, setRes] = useState<{ status: number; type: string; body: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const go = async (p: string, method = 'GET', body = '') => {
    const url = new URL(p, 'http://esp32.local');
    setPath(url.pathname + url.search);
    setLoading(true);
    const r = await webRequest(method, url.pathname, Object.fromEntries(url.searchParams), body);
    setLoading(false);
    setRes({ status: r.status, type: r.headers['content-type'] ?? 'text/plain', body: r.body });
  };

  // ссылки и формы внутри страницы ESP32 → запросы к симуляции
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { esp32lab?: string; href?: string; method?: string; body?: string };
      if (d?.esp32lab === 'nav' && d.href) void go(d.href, d.method ?? 'GET', d.body ?? '');
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });

  const inject = `<script>
document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;var h=a.getAttribute('href');if(!h||/^https?:/.test(h)&&!/esp32\\.local/.test(h))return;e.preventDefault();parent.postMessage({esp32lab:'nav',href:h},'*');});
document.addEventListener('submit',function(e){e.preventDefault();var f=e.target;var q=new URLSearchParams(new FormData(f)).toString();var m=(f.method||'GET').toUpperCase();var act=f.getAttribute('action')||location.pathname||'/';parent.postMessage({esp32lab:'nav',href:m==='GET'?act+(q?'?'+q:''):act,method:m,body:q},'*');});
window.fetch=function(u,o){return new Promise(function(res){parent.postMessage({esp32lab:'nav',href:String(u),method:(o&&o.method)||'GET'},'*');});};
</script>`;

  const isHtml = res?.type.includes('html');
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <IconButton title="Обновить" onClick={() => void go(path)} disabled={!running}><RotateCw size={14} /></IconButton>
        <div className="flex flex-1 items-center rounded-lg border border-line bg-bg-2 px-2">
          <Globe size={13} className="text-faint" />
          <span className="ml-1.5 font-mono text-xs text-faint">http://esp32.local</span>
          <input className="h-8 flex-1 bg-transparent font-mono text-xs outline-none" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void go(path); }} />
        </div>
        <Button size="sm" variant="primary" disabled={!running} loading={loading} onClick={() => void go(path)} icon={<ArrowRight size={14} />}>Открыть</Button>
      </div>
      <div className="min-h-0 flex-1 bg-white">
        {!running && <div className="flex h-full items-center justify-center bg-panel"><Empty icon="🌐" title="Браузер для веб-сервера ESP32" text="Запустите скетч с WebServer, затем откройте страницу. Ссылки и формы на странице работают." /></div>}
        {running && res && (isHtml
          ? <iframe ref={frame} title="ESP32" className="h-full w-full" sandbox="allow-scripts allow-forms" srcDoc={inject + res.body} />
          : <pre className="h-full overflow-auto bg-panel p-3 font-mono text-xs text-text">{`HTTP ${res.status || '—'} · ${res.type}\n\n`}{prettyJson(res.body)}</pre>)}
      </div>
    </div>
  );
}

// ---------------- проблемы ----------------
export function ProblemsPanel() {
  const diags = useWB((s) => s.diagnostics);
  const warnings = useWB((s) => s.warnings);
  const panic = useWB((s) => s.panic);
  if (!diags.length && !warnings.length && !panic) return <Empty icon="✨" title="Проблем не найдено" text="Ошибки компиляции и предупреждения симулятора появятся здесь." />;
  return (
    <div className="h-full overflow-auto p-2 text-[13px]">
      {panic && (
        <div className="mb-1 rounded-lg border border-err/40 bg-err/10 px-3 py-2">
          <div className="font-semibold text-err">Авария ESP32: {panic.kind}</div>
          <div>{panic.message} — строка {panic.line}</div>
          {panic.hint && <div className="text-muted">💡 {panic.hint}</div>}
        </div>
      )}
      {diags.map((d, i) => (
        <button key={`d${i}`} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel-2" onClick={() => window.dispatchEvent(new CustomEvent('esp32lab:goto-line', { detail: d.line }))}>
          <Badge tone={d.severity === 'error' ? 'err' : 'warn'}>{d.severity === 'error' ? 'ошибка' : 'внимание'}</Badge>
          <span className="shrink-0 font-mono text-xs text-faint">стр. {d.line}</span>
          <span>{d.message}{d.hint && <span className="block text-muted">💡 {d.hint}</span>}</span>
        </button>
      ))}
      {warnings.map((w, i) => (
        <div key={`w${i}`} className="flex items-start gap-2 rounded-md px-2 py-1.5">
          <Badge tone="warn">симулятор</Badge>
          <span className="shrink-0 font-mono text-xs text-faint">{(w.t / 1e6).toFixed(2)} с</span>
          <span>{w.msg}{w.hint && <span className="block text-muted">💡 {w.hint}</span>}</span>
        </div>
      ))}
    </div>
  );
}
