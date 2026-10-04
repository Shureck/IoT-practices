import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, Cpu, Zap, Radio, CheckCircle2, GraduationCap, Wrench, Activity, Globe2 } from 'lucide-react';
import { DEFS, createRouter, rotPoint, type Part, type Wire } from '@esp32lab/sim';
import { MODULES } from '@esp32lab/content/modules';
import { PartView } from '../workbench/parts';
import { Junction, WireShape } from '../workbench/Wire';
import { useApp } from '../store/app';
import { highlightCpp } from '../lib/markdown';

const demoParts: Part[] = [
  { id: 'esp', type: 'esp32', x: 0, y: 60, rot: 0, props: {} },
  { id: 'led', type: 'led', x: 50, y: 0, rot: 0, props: { color: 'red' } },
  { id: 'r1', type: 'resistor', x: 80, y: 10, rot: 0, props: { value: 220 } },
  { id: 'srv', type: 'servo', x: 180, y: 260, rot: 0, props: { horn: 'barrier' } },
];

const W = (id: string, a: string, b: string, color: string): Wire => {
  const [pa, pina] = a.split(':');
  const [pb, pinb] = b.split(':');
  return { id, a: { part: pa, pin: pina }, b: { part: pb, pin: pinb }, pts: [], color };
};

const demoWires: Wire[] = [
  W('w1', 'esp:D32', 'r1:2', '#22c55e'),
  W('w2', 'r1:1', 'led:A', '#22c55e'),
  W('w3', 'led:C', 'esp:GND.1', '#111827'),
  W('w4', 'srv:PWM', 'esp:D23', '#f97316'),
  W('w5', 'srv:V+', 'esp:3V3', '#ef4444'),
  W('w6', 'srv:GND', 'esp:GND.2', '#111827'),
];

function Demo() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 500);
    return () => clearInterval(id);
  }, []);
  const { routes, junctions, box } = useMemo(() => {
    const router = createRouter({ parts: demoParts, wires: demoWires });
    const paths = router.paths;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const grow = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const p of demoParts) { const [bx, by, bw, bh] = DEFS[p.type].box; grow(...rotPoint(bx, by, p.rot, p.x, p.y)); grow(...rotPoint(bx + bw, by + bh, p.rot, p.x, p.y)); }
    for (const path of paths.values()) for (const [x, y] of path) grow(x, y);
    x1 += 60; // рычаг шлагбаума выходит за корпус сервопривода
    return { routes: paths, junctions: router.junctions, box: `${x0 - 14} ${y0 - 14} ${x1 - x0 + 28} ${y1 - y0 + 28}` };
  }, []);
  const on = t % 2 === 0;
  const views: Record<string, Record<string, unknown>> = {
    esp: { led: on ? 1 : 0, power: true },
    led: { b: on ? 1 : 0 },
    srv: { angle: t % 8 < 4 ? 90 : 0 },
  };
  return (
    <svg viewBox={box} className="w-full drop-shadow-2xl">
      {demoParts.map((p) => (
        <g key={p.id} transform={`translate(${p.x},${p.y}) rotate(${p.rot})`}><PartView part={p} view={views[p.id]} running /></g>
      ))}
      {demoWires.map((w) => <WireShape key={w.id} path={routes.get(w.id) ?? []} color={w.color} />)}
      {junctions.map((j) => <Junction key={`${j.x},${j.y}`} x={j.x} y={j.y} color={demoWires.find((w) => w.id === j.wire)?.color ?? '#fff'} />)}
    </svg>
  );
}

const SNIPPET = `void loop() {
  digitalWrite(LED, HIGH);
  delay(500);
  digitalWrite(LED, LOW);
  delay(500);
}`;

const FEATURES = [
  { icon: <Cpu size={20} />, title: 'Настоящий Arduino C++', text: 'Пишите на том же языке, что в Arduino IDE: setup/loop, String, классы, прерывания, FreeRTOS. Понятные ошибки на русском.' },
  { icon: <Wrench size={20} />, title: 'Схемы как в жизни', text: '25 компонентов, макетка, провода. Светодиод без резистора сгорит, вход без подтяжки «висит», реле щёлкает.' },
  { icon: <Globe2 size={20} />, title: 'Wi-Fi, HTTP и MQTT', text: 'Учебные сервисы погоды и чата, общий MQTT-брокер, веб-сервер на ESP32 с встроенным браузером.' },
  { icon: <Activity size={20} />, title: 'Приборы инженера', text: 'Монитор порта, плоттер, логический анализатор с декодером UART — видно каждый бит.' },
  { icon: <Zap size={20} />, title: 'Прошивка настоящей платы', text: 'Тот же скетч компилируется arduino-cli на сервере и прошивается в ESP32 по USB прямо из браузера.' },
  { icon: <CheckCircle2 size={20} />, title: 'Автопроверка', text: 'Каждая практика проверяется автоматически, а преподаватель видит прогресс группы и ставит оценки.' },
];

export default function Landing() {
  const user = useApp((s) => s.user);
  if (user) return <Navigate to="/course" replace />;
  return (
    <div className="relative">
      <div className="bg-grid absolute inset-x-0 top-0 h-[640px] opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <section className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-14 lg:grid-cols-[1.05fr_1fr]">
        <div className="anim-rise">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
            <Radio size={13} className="text-accent" /> Курс «Интернет вещей» · ESP32 · Arduino
          </div>
          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            Лаборатория <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">ESP32</span><br />прямо в браузере
          </h1>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-muted">
            Собирайте схемы, пишите код на Arduino C++ и запускайте его на виртуальной ESP32. 35 практик по пяти лекциям —
            от первого светодиода до телеметрии по MQTT. А когда всё заработает — прошейте настоящую плату.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/register" className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-ink shadow-lg shadow-accent/25 transition hover:brightness-110">
              Начать курс <ArrowRight size={17} />
            </Link>
            <Link to="/sandbox" className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-panel px-5 font-medium transition hover:border-line-strong">
              Открыть песочницу
            </Link>
          </div>
          <div className="mt-5 flex items-center gap-2 text-[13px] text-faint">
            <GraduationCap size={15} /> Преподаватель? <Link to="/register?teacher=1" className="text-accent hover:underline">Создайте группу</Link> и следите за успехами студентов.
          </div>
        </div>
        <div className="anim-rise relative rounded-2xl border border-line bg-panel/80 p-4 shadow-2xl backdrop-blur" style={{ animationDelay: '0.1s' }}>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-err/70" /><span className="h-2.5 w-2.5 rounded-full bg-warn/70" /><span className="h-2.5 w-2.5 rounded-full bg-ok/70" />
            <span className="ml-2 font-mono text-xs text-faint">blink.ino — симуляция идёт</span>
          </div>
          <div className="rounded-xl" style={{ background: 'var(--canvas)' }}><Demo /></div>
          <pre className="md mt-3 overflow-x-auto rounded-xl border border-line bg-[var(--code-bg)] p-3 font-mono text-[12.5px] leading-relaxed" dangerouslySetInnerHTML={{ __html: highlightCpp(SNIPPET) }} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-panel p-5 transition hover:border-line-strong">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/12 text-accent">{f.icon}</div>
              <div className="font-semibold">{f.title}</div>
              <div className="mt-1 text-[14px] leading-relaxed text-muted">{f.text}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <h2 className="mb-2 text-2xl font-bold tracking-tight">Сюжет курса: станция «Полярная-5»</h2>
        <p className="mb-6 max-w-3xl text-muted">После шторма автоматика арктической станции отключилась. Каждый модуль — новая подсистема, которую вы оживите сами.</p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <div key={m.id} className="relative overflow-hidden rounded-2xl border border-line bg-panel p-5">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-15 blur-xl" style={{ background: m.color }} />
              <div className="flex items-center gap-3">
                <span className="text-3xl">{m.icon}</span>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: m.color }}>{m.lecture ? `Лекция ${m.lecture}` : 'Финал'}</div>
                  <div className="font-semibold">{m.title}</div>
                </div>
              </div>
              <div className="mt-2 text-[13.5px] text-muted">{m.subtitle}</div>
            </div>
          ))}
        </div>
      </section>
      <footer className="border-t border-line py-6 text-center text-xs text-faint">ESP32 Lab · учебная лаборатория микроконтроллеров</footer>
    </div>
  );
}
