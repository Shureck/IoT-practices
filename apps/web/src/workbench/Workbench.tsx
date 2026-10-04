// Верстак: схема + код + консоль + задание.
import { useEffect, useState, type ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  Play, Square, RotateCcw, Pause, Volume2, VolumeX, Terminal, LineChart, Activity, Network, Radio, MessageSquare,
  Globe, AlertCircle, Cpu, ChevronDown, ChevronUp, Download, Gauge,
} from 'lucide-react';
import { useWB, type BottomTab } from './store';
import { CircuitEditor } from './CircuitEditor';
import { CodeEditor } from './CodeEditor';
import { Palette, Inspector } from './Sidebar';
import { TaskPanel } from './TaskPanel';
import { SerialPanel, PlotterPanel } from './panels/SerialPanel';
import { AnalyzerPanel } from './panels/AnalyzerPanel';
import { NetworkPanel, MqttPanel, ChatPanel, BrowserPanel, ProblemsPanel } from './panels/NetPanels';
import { BoardPanel } from './panels/BoardPanel';
import { partAction, startSim, stopSim } from './simController';
import { Badge, Button, IconButton, Tabs } from '../components/ui';
import { toWokwi, download as downloadFile } from '../lib/wokwi';
import { useApp } from '../store/app';

function Handle({ dir = 'v' }: { dir?: 'v' | 'h' }) {
  return (
    <PanelResizeHandle className={`group relative ${dir === 'v' ? 'w-1.5' : 'h-1.5'} bg-bg transition hover:bg-accent/30 data-[resize-handle-state=drag]:bg-accent/50`}>
      <div className={`absolute ${dir === 'v' ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2'} bg-line`} />
    </PanelResizeHandle>
  );
}

function fmtTime(us: number) {
  const s = us / 1e6;
  if (s < 60) return `${s.toFixed(2)} с`;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function Toolbar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const running = useWB((s) => s.running);
  const paused = useWB((s) => s.paused);
  const speed = useWB((s) => s.speed);
  const simTime = useWB((s) => s.simTime);
  const status = useWB((s) => s.status);
  const realFactor = useWB((s) => s.realFactor);
  const muted = useWB((s) => s.muted);
  const compileOk = useWB((s) => s.compileOk);
  const code = useWB((s) => s.code);
  const title = useWB((s) => s.title);
  const set = useWB((s) => s.set);

  const download = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(title || 'sketch').replace(/[^\wа-яё-]+/gi, '_')}.ino`;
    a.click();
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-panel px-2">
      {left}
      <div className="mx-1 h-6 w-px bg-line" />
      {!running ? (
        <Button variant="primary" icon={<Play size={15} fill="currentColor" />} onClick={() => startSim()} title="Запустить (F5)">Запуск</Button>
      ) : (
        <Button variant="danger" icon={<Square size={13} fill="currentColor" />} onClick={() => stopSim()} title="Остановить (Shift+F5)">Стоп</Button>
      )}
      <IconButton title="Перезапустить" disabled={!running} onClick={() => startSim()}><RotateCcw size={15} /></IconButton>
      <IconButton title={paused ? 'Продолжить' : 'Пауза'} disabled={!running} active={paused} onClick={() => set({ paused: !paused })}><Pause size={15} /></IconButton>
      <div className="flex items-center gap-1 rounded-lg border border-line px-1.5" title="Скорость симуляции">
        <Gauge size={14} className="text-faint" />
        <select className="h-7 bg-transparent text-xs outline-none" value={speed} onChange={(e) => set({ speed: Number(e.target.value) })}>
          {[0.1, 0.25, 0.5, 1, 2, 5, 10].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>
      <div className="ml-1 hidden items-center gap-2 sm:flex">
        <span className="font-mono text-xs tabular-nums text-muted">{fmtTime(simTime)}</span>
        {running && status === 'running' && <span className="h-2 w-2 rounded-full bg-ok pulse-soft" />}
        {status === 'crashed' && <Badge tone="err">авария</Badge>}
        {status === 'halted' && running && <Badge>остановлена</Badge>}
        {running && realFactor < 0.9 && <Badge tone="warn" className="max-lg:hidden">медленнее реального ×{realFactor.toFixed(2)}</Badge>}
        {!compileOk && <Badge tone="err">ошибки в коде</Badge>}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <IconButton title={muted ? 'Включить звук' : 'Выключить звук'} onClick={() => set({ muted: !muted })}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</IconButton>
        <IconButton title="Скачать скетч .ino" onClick={download}><Download size={15} /></IconButton>
        <IconButton title="Экспорт схемы для Wokwi (diagram.json)" onClick={() => {
          const r = toWokwi(useWB.getState().circuit);
          downloadFile('diagram.json', r.json);
          useApp.getState().toast({ kind: 'info', title: 'diagram.json скачан', text: `Создайте проект ESP32 на wokwi.com и замените содержимое вкладки diagram.json.${r.skipped.length ? ` Не перенесены: ${r.skipped.join(', ')}.` : ''}` });
        }}><span className="font-mono text-[10px] font-bold">W</span></IconButton>
        {right}
      </div>
    </div>
  );
}

const BOTTOM: { id: BottomTab; label: string; icon: ReactNode }[] = [
  { id: 'serial', label: 'Монитор порта', icon: <Terminal size={13} /> },
  { id: 'plotter', label: 'Плоттер', icon: <LineChart size={13} /> },
  { id: 'analyzer', label: 'Анализатор', icon: <Activity size={13} /> },
  { id: 'network', label: 'Сеть', icon: <Network size={13} /> },
  { id: 'mqtt', label: 'MQTT', icon: <Radio size={13} /> },
  { id: 'chat', label: 'Чат', icon: <MessageSquare size={13} /> },
  { id: 'browser', label: 'Браузер', icon: <Globe size={13} /> },
  { id: 'problems', label: 'Проблемы', icon: <AlertCircle size={13} /> },
  { id: 'board', label: 'Плата', icon: <Cpu size={13} /> },
];

function BottomPanel() {
  const tab = useWB((s) => s.bottomTab);
  const open = useWB((s) => s.bottomOpen);
  const diags = useWB((s) => s.diagnostics);
  const warnings = useWB((s) => s.warnings);
  const set = useWB((s) => s.set);
  const errs = diags.filter((d) => d.severity === 'error').length;
  const warns = diags.length - errs + warnings.length;
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center border-b border-line pr-1">
        <Tabs
          className="min-w-0 flex-1 px-1 py-0.5"
          value={tab}
          onChange={(v) => set({ bottomTab: v, bottomOpen: true })}
          tabs={BOTTOM.map((b) => ({
            id: b.id,
            label: <span className="flex items-center gap-1.5" title={b.label}>{b.icon}{tab === b.id && <span>{b.label}</span>}</span>,
            badge: b.id === 'problems' && (errs || warns) ? <Badge tone={errs ? 'err' : 'warn'}>{errs || warns}</Badge> : undefined,
          }))}
        />
        <IconButton title={open ? 'Свернуть' : 'Развернуть'} onClick={() => set({ bottomOpen: !open })}>{open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</IconButton>
      </div>
      {open && (
        <div className="min-h-0 flex-1">
          {tab === 'serial' && <SerialPanel />}
          {tab === 'plotter' && <PlotterPanel />}
          {tab === 'analyzer' && <AnalyzerPanel />}
          {tab === 'network' && <NetworkPanel />}
          {tab === 'mqtt' && <MqttPanel />}
          {tab === 'chat' && <ChatPanel />}
          {tab === 'browser' && <BrowserPanel />}
          {tab === 'problems' && <ProblemsPanel />}
          {tab === 'board' && <BoardPanel />}
        </div>
      )}
    </div>
  );
}

function SideTabs() {
  const mode = useWB((s) => s.mode);
  const sel = useWB((s) => s.sel);
  const hasTask = useWB((s) => !!s.practice && s.practice.kind !== 'quiz');
  const [tab, setTab] = useState<'task' | 'parts' | 'props'>(hasTask ? 'task' : 'parts');
  useEffect(() => { if (sel) setTab((t) => (t === 'task' ? t : 'props')); }, [sel]);
  return (
    <div className="flex h-full flex-col bg-panel">
      <Tabs
        className="border-b border-line px-1 py-0.5"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'task', label: 'Задание', hidden: !hasTask },
          { id: 'parts', label: 'Компоненты' },
          { id: 'props', label: 'Свойства' },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'task' && <TaskPanel />}
        {tab === 'parts' && <Palette />}
        {tab === 'props' && <Inspector />}
      </div>
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      return el.closest('.cm-editor') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    };
    const pressed = new Set<string>();
    const down = (e: KeyboardEvent) => {
      const s = useWB.getState();
      if (e.key === 'F5') { e.preventDefault(); if (e.shiftKey) stopSim(); else startSim(); return; }
      if (isTyping(e)) return;
      // клавиши кнопок на схеме
      if (s.running && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
        const btn = s.circuit.parts.find((p) => p.type === 'button' && String(p.props.key ?? '').toLowerCase() === e.key.toLowerCase());
        if (btn) { if (!pressed.has(btn.id)) { pressed.add(btn.id); partAction(btn.id, 'press'); } e.preventDefault(); return; }
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') { s.set({ draft: null, sel: null }); return; }
      if (s.readOnly) return;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); s.undoOnce(); return; }
      if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); s.redoOnce(); return; }
      if (s.circuitLocked) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { s.removeSelection(); return; }
      if (e.key.toLowerCase() === 'r' && !ctrl) { s.rotateSelection(); return; }
      if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); s.duplicateSelection(); }
    };
    const up = (e: KeyboardEvent) => {
      const s = useWB.getState();
      const btn = s.circuit.parts.find((p) => p.type === 'button' && String(p.props.key ?? '').toLowerCase() === e.key.toLowerCase());
      if (btn && pressed.has(btn.id)) { pressed.delete(btn.id); partAction(btn.id, 'release'); }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < 900);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return narrow;
}

export function Workbench({ toolbarLeft, toolbarRight }: { toolbarLeft?: ReactNode; toolbarRight?: ReactNode }) {
  useShortcuts();
  const narrow = useNarrow();
  const mode = useWB((s) => s.mode);
  const [mTab, setMTab] = useState<'task' | 'circuit' | 'code' | 'console' | 'parts'>(mode === 'practice' ? 'task' : 'circuit');
  useEffect(() => () => stopSim(), []);

  if (narrow) {
    return (
      <div className="flex h-full flex-col">
        <Toolbar left={toolbarLeft} right={toolbarRight} />
        <Tabs className="border-b border-line bg-panel px-1" value={mTab} onChange={setMTab} tabs={[
          { id: 'task', label: 'Задание', hidden: mode !== 'practice' },
          { id: 'circuit', label: 'Схема' },
          { id: 'code', label: 'Код' },
          { id: 'console', label: 'Консоль' },
          { id: 'parts', label: 'Детали' },
        ]} />
        <div className="min-h-0 flex-1">
          {mTab === 'task' && <div className="h-full overflow-auto bg-panel"><TaskPanel /></div>}
          {mTab === 'circuit' && <CircuitEditor />}
          {mTab === 'code' && <CodeEditor />}
          {mTab === 'console' && <BottomPanel />}
          {mTab === 'parts' && <div className="grid h-full grid-rows-[1fr_auto] bg-panel"><Palette /><div className="max-h-[40%] overflow-auto border-t border-line"><Inspector /></div></div>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar left={toolbarLeft} right={toolbarRight} />
      <PanelGroup direction="horizontal" autoSaveId={`wb-h-${mode}`} className="min-h-0 flex-1">
        <Panel defaultSize={mode === 'practice' ? 26 : 16} minSize={12} maxSize={40}>
          <SideTabs />
        </Panel>
        <Handle />
        <Panel defaultSize={mode === 'practice' ? 42 : 48} minSize={25}>
          <PanelGroup direction="vertical" autoSaveId={`wb-v-${mode}`}>
            <Panel defaultSize={64} minSize={20}><CircuitEditor /></Panel>
            <Handle dir="h" />
            <Panel defaultSize={36} minSize={8}><BottomPanel /></Panel>
          </PanelGroup>
        </Panel>
        <Handle />
        <Panel defaultSize={32} minSize={18}>
          <CodeEditor />
        </Panel>
      </PanelGroup>
    </div>
  );
}
