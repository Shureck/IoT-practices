// Запуск симуляции в реальном времени и связь со стором верстака.
import { Simulation, compileSketch, type CircuitDoc } from '@esp32lab/sim';
import { useWB } from './store';
import { LiveNet } from './liveNet';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { audio } from './audio';

let sim: Simulation | null = null;
let raf = 0;
let lastReal = 0;
let lastUi = 0;
let nvs = new Map<string, Map<string, unknown>>();

export function currentSim(): Simulation | null { return sim; }

export function compileNow(): boolean {
  const wb = useWB.getState();
  const c = compileSketch(wb.code);
  wb.set({ diagnostics: c.diagnostics, compileOk: c.ok });
  return c.ok;
}

export function startSim(): boolean {
  stopSim();
  const wb = useWB.getState();
  const compiled = compileSketch(wb.code);
  wb.set({ diagnostics: compiled.diagnostics, compileOk: compiled.ok });
  if (!compiled.ok) {
    wb.set({ bottomTab: 'problems', bottomOpen: true });
    return false;
  }
  const user = useApp.getState().user;
  const net = new LiveNet(!!user, (e) => {
    const s = useWB.getState();
    s.set({ netLog: [...s.netLog.slice(-300), e] });
  }, user?.name);
  let burntReported = false;
  sim = new Simulation({
    code: wb.code,
    circuit: JSON.parse(JSON.stringify(wb.circuit)) as CircuitDoc,
    net,
    compiled,
    nvs,
    callbacks: {
      serial: (port, text, baud) => useWB.getState().appendSerial({ text, baud: baud ?? 115200, t: sim?.M.now() ?? 0, port }),
      warn: (msg, hint) => {
        const s = useWB.getState();
        if (s.warnings.some((w) => w.msg === msg)) return;
        s.set({ warnings: [...s.warnings, { msg, hint, t: sim?.M.now() ?? 0 }] });
        if (/сгорел/i.test(msg) && !burntReported) {
          burntReported = true;
          void award('burnt-led');
        }
      },
      panic: (info) => {
        useWB.getState().set({ panic: info, bottomTab: 'serial', bottomOpen: true });
      },
      status: (st) => useWB.getState().set({ status: st }),
      reboot: () => useWB.getState().appendSerial({ text: '\r\nets Jun  8 2016 00:22:57\r\nrst:0xc (SW_CPU_RESET),boot:0x13\r\n', baud: 115200, t: 0, port: 0 }),
    },
  });
  sim.boot();
  wb.set({ running: true, paused: false, simTime: 0, panic: null, warnings: [], netLog: [], status: 'running' });
  audio.resume();
  lastReal = performance.now();
  lastUi = 0;
  raf = requestAnimationFrame(frame);
  if (/digitalWrite\s*\(\s*(2|LED_BUILTIN|LED_PIN)\b/.test(wb.code)) setTimeout(() => void award('first-blink'), 3000);
  return true;
}

async function award(id: string) {
  const app = useApp.getState();
  if (!app.user || app.user.role !== 'student' || app.progress?.achievements.includes(id)) return;
  try {
    const r = await api.awardAchievement(id);
    if (r.new) {
      const a = app.catalog?.achievements.find((x) => x.id === id);
      app.toast({ kind: 'achievement', title: `${a?.icon ?? '🏅'} ${a?.title ?? 'Достижение'}`, text: a?.description });
      void app.loadProgress();
    }
  } catch { /* не критично */ }
}

export { award };

function frame(now: number) {
  if (!sim) return;
  const wb = useWB.getState();
  const dtReal = Math.min(100, now - lastReal);
  lastReal = now;
  if (!wb.paused && sim.M && sim.M.status === 'running') {
    const want = dtReal * 1000 * wb.speed;
    const t0 = sim.M.t;
    const t1 = performance.now();
    sim.advance(want, 14);
    const spent = performance.now() - t1;
    const got = sim.M.t - t0;
    const factor = want > 0 ? got / want : 1;
    if (spent > 13 && factor < 0.95) wb.set({ realFactor: factor });
    else if (wb.realFactor !== 1 && factor >= 0.95) wb.set({ realFactor: 1 });
  } else if (sim.M && sim.M.status !== 'running' && sim.M.restartReq) {
    sim.advance(0);
  }
  if (now - lastUi > 33) {
    lastUi = now;
    const t = sim.M?.now() ?? 0;
    const views = sim.board.views(t);
    wb.set({ views, simTime: t });
    if (!wb.muted) audio.update(views, wb.circuit);
    else audio.silence();
  }
  raf = requestAnimationFrame(frame);
}

export function stopSim() {
  cancelAnimationFrame(raf);
  if (sim) sim.stop();
  sim = null;
  audio.silence();
  const wb = useWB.getState();
  if (wb.running) wb.set({ running: false, paused: false, status: 'idle' });
}

export function resetNvs() { nvs = new Map(); }

/** Схема изменилась во время работы — пересобрать сети, не перезапуская программу. */
export function syncCircuit(c: CircuitDoc) {
  if (!sim) return;
  sim.board.rebuild(JSON.parse(JSON.stringify(c)) as CircuitDoc);
}

/** Действия с компонентами во время симуляции. */
export function partAction(id: string, action: 'press' | 'release' | 'motion' | 'toggle', value?: unknown) {
  if (!sim) return;
  const m = sim.board.models.get(id) as unknown as Record<string, (...a: unknown[]) => void> | undefined;
  if (!m) return;
  if (action === 'press') m.press?.(true);
  else if (action === 'release') m.press?.(false);
  else if (action === 'motion') m.trigger?.();
  else if (action === 'toggle') m.setProp?.(String(value), !(m as unknown as { prop(k: string): unknown }).prop(String(value)));
}

export function setLiveProp(id: string, key: string, value: string | number | boolean) {
  const m = sim?.board.models.get(id) as unknown as { setProp(k: string, v: string | number | boolean): void } | undefined;
  m?.setProp(key, value);
}

export function serialSend(text: string) { sim?.serialInput(text); }

export function webRequest(method: string, path: string, query: Record<string, string>, body = ''): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  if (!sim) return Promise.resolve({ status: 0, headers: {}, body: 'Симуляция не запущена' });
  return sim.webRequest(method, path, query, body);
}

export function modelOf(id: string): unknown { return sim?.board.models.get(id); }
