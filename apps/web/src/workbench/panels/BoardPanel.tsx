// Настоящая плата: компиляция arduino-cli на сервере, прошивка через Web Serial (esptool-js), монитор порта платы.
import { useEffect, useRef, useState } from 'react';
import { Cpu, Download, Plug, Unplug, Zap, Hammer, Send, RotateCcw, Eraser, ScrollText, Terminal } from 'lucide-react';
import { ESPLoader, Transport } from 'esptool-js';
import { useWB } from '../store';
import { api, type CompileResponse } from '../../lib/api';
import { useApp } from '../../store/app';
import { Badge, Button, Progress, inputCls, inputBase } from '../../components/ui';
import { award } from '../simController';

type Step = 'idle' | 'compiling' | 'compiled' | 'connecting' | 'flashing' | 'done' | 'error';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SerialPortLike = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serialApi = (): any => (navigator as any).serial;
const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Порт платы: уже разрешённый (если он один) или выбор в диалоге браузера. */
async function pickPort(known: SerialPortLike | null): Promise<SerialPortLike> {
  if (known) return known;
  const granted: SerialPortLike[] = await serialApi().getPorts();
  if (granted.length === 1) return granted[0];
  return serialApi().requestPort({ filters: [] });
}

export function BoardPanel() {
  const code = useWB((s) => s.code);
  const user = useApp((s) => s.user);
  const [step, setStep] = useState<Step>('idle');
  const [result, setResult] = useState<CompileResponse | null>(null);
  const [compiledCode, setCompiledCode] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [monitor, setMonitor] = useState('');
  const [monOn, setMonOn] = useState(false);
  const [baud, setBaud] = useState(115200);
  const [view, setView] = useState<'log' | 'monitor'>('log');
  const [input, setInput] = useState('');
  const portRef = useRef<SerialPortLike>(null); // порт монитора, пока он открыт
  const lastPort = useRef<SerialPortLike>(null); // последний порт, с которым работали (без повторного выбора)
  const readerStop = useRef(false);
  const outBox = useRef<HTMLPreElement>(null);
  const supported = !!serialApi();
  const busy = step === 'compiling' || step === 'connecting' || step === 'flashing';
  const stale = !!result?.ok && compiledCode !== code;

  useEffect(() => () => { void closeMonitor(); }, []);
  useEffect(() => { if (outBox.current) outBox.current.scrollTop = outBox.current.scrollHeight; }, [monitor, log, view]);

  const compile = async (): Promise<CompileResponse | null> => {
    setStep('compiling'); setError(''); setView('log');
    setLog('Компиляция на сервере (arduino-cli, ядро ESP32 2.0.17)…\n');
    try {
      const r = await api.compile(code);
      setResult(r);
      setCompiledCode(code);
      setLog(r.log);
      setStep(r.ok ? 'compiled' : 'error');
      if (!r.ok) setError('Компилятор нашёл ошибки — смотрите лог справа.');
      return r.ok ? r : null;
    } catch (e) {
      setStep('error');
      setError((e as Error).message);
      return null;
    }
  };

  /** Одна кнопка: скомпилировать (если код менялся), прошить и открыть монитор на том же порту. */
  const flash = async () => {
    const r = result?.ok && !stale ? result : await compile();
    if (!r?.binaries) return;
    await closeMonitor();
    setError(''); setView('log'); setProgress(0);
    let transport: Transport | null = null;
    try {
      setStep('connecting');
      const port = await pickPort(lastPort.current);
      lastPort.current = port;
      transport = new Transport(port, false);
      const term = { clean() { /* ничего */ }, writeLine: (s: string) => setLog((l) => l + s + '\n'), write: (s: string) => setLog((l) => l + s) };
      const loader = new ESPLoader({ transport, baudrate: 460800, terminal: term } as never);
      setLog((l) => l + '\n--- Подключение к плате (если не получается — зажмите кнопку BOOT) ---\n');
      const chip = await loader.main();
      setLog((l) => l + `Чип: ${chip}\n`);
      setStep('flashing');
      const files = r.binaries.map((b) => ({ data: b64ToBytes(b.data), address: b.offset }));
      const total = files.reduce((a, f) => a + f.data.length, 0);
      const done: number[] = files.map(() => 0);
      await loader.writeFlash({
        fileArray: files,
        flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep',
        eraseAll: false, compress: true,
        reportProgress: (i: number, written: number) => { done[i] = written; setProgress(done.reduce((a, x) => a + x, 0) / total); },
      } as never);
      await loader.after('hard_reset' as never);
      await transport.disconnect();
      setStep('done');
      setProgress(1);
      void award('real-board');
      useApp.getState().toast({ kind: 'ok', title: 'Плата прошита!', text: 'Монитор платы открыт — справа вывод Serial.' });
      // сразу слушаем плату на том же порту, без повторного выбора
      await sleep(300);
      void openMonitor();
    } catch (e) {
      try { await transport?.disconnect(); } catch { /* уже закрыт */ }
      setStep('error');
      const msg = (e as Error).message ?? String(e);
      if (/No port selected|cancel/i.test(msg)) setError('Порт не выбран.');
      else {
        lastPort.current = null; // в следующий раз предложим выбрать порт заново
        setError(`Ошибка прошивки: ${msg}. Проверьте кабель (нужен кабель с данными) и попробуйте зажать BOOT во время подключения.`);
      }
    }
  };

  const openMonitor = async (rate: number = baud) => {
    try {
      const port = await pickPort(lastPort.current);
      lastPort.current = port;
      await port.open({ baudRate: rate });
      portRef.current = port;
      setMonOn(true);
      setView('monitor');
      readerStop.current = false;
      const decoder = new TextDecoder();
      while (port.readable && !readerStop.current) {
        const reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done || readerStop.current) break;
            setMonitor((m) => (m + decoder.decode(value, { stream: true })).slice(-100000));
          }
        } catch { /* порт отключён */ } finally { reader.releaseLock(); }
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (!/No port selected|cancel/i.test(msg)) setError(`Монитор: ${msg}`);
    } finally {
      if (portRef.current === null) setMonOn(false);
    }
  };

  async function closeMonitor() {
    readerStop.current = true;
    const port = portRef.current;
    portRef.current = null;
    setMonOn(false);
    try { await port?.readable?.cancel?.(); } catch { /* уже закрыт */ }
    try { await port?.close(); } catch { /* уже закрыт */ }
  }

  /** Перезагрузка платы через линии RTS/DTR (как кнопка EN), не закрывая монитор. */
  const resetBoard = async () => {
    const port = portRef.current;
    if (!port?.setSignals) return;
    try {
      await port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await sleep(120);
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      setMonitor((m) => m + '\n--- перезагрузка платы ---\n');
    } catch (e) { setError(`Перезагрузка: ${(e as Error).message}`); }
  };

  const changeBaud = async (b: number) => {
    setBaud(b);
    if (!monOn) return;
    await closeMonitor();
    await sleep(150);
    // переоткрываем с новой скоростью
    void openMonitor(b);
  };

  const sendToBoard = async () => {
    const port = portRef.current;
    if (!port?.writable) return;
    const w = port.writable.getWriter();
    await w.write(new TextEncoder().encode(input + '\n'));
    w.releaseLock();
    setInput('');
  };

  const downloadBin = () => {
    const app = result?.binaries?.find((b) => b.name === 'app' || b.name === 'merged');
    if (!app) return;
    const blob = new Blob([b64ToBytes(app.data) as BlobPart], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = app.name === 'merged' ? 'firmware-merged.bin' : 'firmware-app-0x10000.bin';
    a.click();
  };

  const stage = step === 'compiling' ? 'Компиляция…' : step === 'connecting' ? 'Подключение к плате…' : step === 'flashing' ? `Запись: ${Math.round(progress * 100)} %` : '';

  return (
    <div className="grid h-full grid-cols-[320px_1fr] max-md:grid-cols-1">
      <div className="space-y-3 overflow-auto border-r border-line p-3 text-[13px]">
        <div className="flex items-center gap-2 font-semibold"><Cpu size={16} className="text-accent" /> Настоящая ESP32</div>
        <p className="text-muted">Скетч собирается настоящим компилятором Arduino на сервере и прошивается в плату по USB прямо из браузера.</p>
        {!user && <div className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">Войдите, чтобы пользоваться компилятором и прошивкой.</div>}
        {!supported && <div className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">Прошивка и монитор платы работают в Chrome, Edge или Opera на компьютере (Web Serial). Компилировать и скачать .bin можно в любом браузере.</div>}

        <div className="space-y-2">
          <Button className="w-full" variant="primary" icon={<Zap size={15} />} loading={busy} disabled={!user || !supported || busy} onClick={() => void flash()}>
            Прошить плату
          </Button>
          {busy && <div className="text-xs text-muted">{stage}</div>}
          {step === 'flashing' && <Progress value={progress} />}
          <div className="flex gap-1.5">
            <Button className="flex-1" size="sm" variant="ghost" icon={<Hammer size={14} />} disabled={!user || busy} onClick={() => void compile()}>Только собрать</Button>
            {result?.ok && <Button className="flex-1" size="sm" variant="ghost" icon={<Download size={14} />} onClick={downloadBin}>Скачать .bin</Button>}
          </div>
          {result && (
            <div className="flex flex-wrap items-center gap-1.5">
              {result.ok ? <Badge tone="ok">собрано за {((result.ms ?? 0) / 1000).toFixed(1)} с</Badge> : <Badge tone="err">ошибки компиляции</Badge>}
              {stale && <Badge tone="warn">код изменён — будет пересобран</Badge>}
              {step === 'done' && <Badge tone="ok">плата прошита</Badge>}
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-line p-2.5">
          <div className="flex items-center gap-2 text-[12px] font-semibold"><Terminal size={14} className="text-accent" /> Монитор платы</div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant={monOn ? 'ghost' : 'primary'} icon={monOn ? <Unplug size={14} /> : <Plug size={14} />} disabled={!supported || busy} onClick={() => void (monOn ? closeMonitor() : openMonitor())}>
              {monOn ? 'Отключить' : 'Подключить'}
            </Button>
            <select className={`${inputBase} h-8 w-28 px-1.5 text-xs`} value={baud} onChange={(e) => void changeBaud(Number(e.target.value))} title="Скорость — как в Serial.begin()">
              {BAUDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          {monOn && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => void resetBoard()} title="Как кнопка EN на плате">Перезагрузить</Button>
              <Button size="sm" variant="ghost" icon={<Eraser size={14} />} onClick={() => setMonitor('')}>Очистить</Button>
            </div>
          )}
          <div className="text-[11px] text-faint">После прошивки монитор подключается сам. «Каракули» в выводе — значит скорость не совпадает с <code>Serial.begin()</code>.</div>
        </div>

        {error && <div className="rounded-lg border border-err/40 bg-err/10 p-2 text-xs text-err">{error}</div>}
        <div className="rounded-lg border border-line bg-panel-2 p-2 text-[11.5px] leading-relaxed text-muted">
          💡 Нужен кабель USB <b>с данными</b> (не только зарядный). Если плата не появляется в списке — установите драйвер CP210x или CH340.
          Если прошивка «зависает» на подключении — зажмите кнопку <b>BOOT</b>, пока не начнётся запись.
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-1 border-b border-line px-2 py-1">
          <button className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${view === 'log' ? 'bg-panel-2 font-semibold' : 'text-muted'}`} onClick={() => setView('log')}><ScrollText size={13} /> Лог сборки и прошивки</button>
          <button className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${view === 'monitor' ? 'bg-panel-2 font-semibold' : 'text-muted'}`} onClick={() => setView('monitor')}>
            <Terminal size={13} /> Монитор платы {monOn && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
          </button>
        </div>
        <pre ref={outBox} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[12px] leading-relaxed">
          {view === 'monitor'
            ? (monitor || <span className="text-faint">{monOn ? 'Ждём данных с платы…' : 'Монитор не подключён — нажмите «Подключить» слева.'}</span>)
            : (log || <span className="text-faint">Здесь появится лог компиляции и прошивки.</span>)}
        </pre>
        {monOn && view === 'monitor' && (
          <div className="flex gap-1.5 border-t border-line p-1.5">
            <input className={`${inputCls} h-8 font-mono text-xs`} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void sendToBoard(); }} placeholder="Отправить на плату… (Enter)" />
            <Button size="sm" icon={<Send size={14} />} onClick={() => void sendToBoard()}>Отправить</Button>
          </div>
        )}
      </div>
    </div>
  );
}
