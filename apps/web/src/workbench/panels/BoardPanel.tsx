// Настоящая плата: компиляция arduino-cli на сервере, прошивка через Web Serial, монитор порта.
import { useEffect, useRef, useState } from 'react';
import { Cpu, Download, Plug, Unplug, Zap, Hammer, Send } from 'lucide-react';
import { ESPLoader, Transport } from 'esptool-js';
import { useWB } from '../store';
import { api, type CompileResponse } from '../../lib/api';
import { useApp } from '../../store/app';
import { Badge, Button, Progress, inputCls } from '../../components/ui';
import { award } from '../simController';

type Step = 'idle' | 'compiling' | 'compiled' | 'flashing' | 'done' | 'error';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serialApi = (): any => (navigator as any).serial;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function BoardPanel() {
  const code = useWB((s) => s.code);
  const user = useApp((s) => s.user);
  const [step, setStep] = useState<Step>('idle');
  const [result, setResult] = useState<CompileResponse | null>(null);
  const [log, setLog] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [monitor, setMonitor] = useState('');
  const [monOn, setMonOn] = useState(false);
  const [input, setInput] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const portRef = useRef<any>(null);
  const readerStop = useRef(false);
  const monBox = useRef<HTMLPreElement>(null);
  const supported = !!serialApi();

  useEffect(() => () => { void closeMonitor(); }, []);
  useEffect(() => { if (monBox.current) monBox.current.scrollTop = monBox.current.scrollHeight; }, [monitor]);

  const compile = async () => {
    setStep('compiling'); setError(''); setLog(''); setResult(null);
    try {
      const r = await api.compile(code);
      setResult(r);
      setLog(r.log);
      setStep(r.ok ? 'compiled' : 'error');
      if (!r.ok) setError('Компилятор нашёл ошибки — смотрите лог ниже.');
    } catch (e) {
      setStep('error');
      setError((e as Error).message);
    }
  };

  const flash = async () => {
    if (!result?.binaries) return;
    await closeMonitor();
    setStep('flashing'); setProgress(0); setError('');
    let transport: Transport | null = null;
    try {
      const port = await serialApi().requestPort({ filters: [] });
      transport = new Transport(port, false);
      const term = { clean() { /* ничего */ }, writeLine: (s: string) => setLog((l) => l + s + '\n'), write: (s: string) => setLog((l) => l + s) };
      const loader = new ESPLoader({ transport, baudrate: 460800, terminal: term } as never);
      setLog((l) => l + '\n--- Подключение к плате (если не получается — зажмите кнопку BOOT) ---\n');
      const chip = await loader.main();
      setLog((l) => l + `Чип: ${chip}\n`);
      const files = result.binaries.map((b) => ({ data: b64ToBytes(b.data), address: b.offset }));
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
      useApp.getState().toast({ kind: 'ok', title: 'Плата прошита!', text: 'Откройте монитор платы, чтобы увидеть вывод Serial.' });
    } catch (e) {
      try { await transport?.disconnect(); } catch { /* уже закрыт */ }
      setStep('error');
      const msg = (e as Error).message ?? String(e);
      setError(/No port selected|cancel/i.test(msg) ? 'Порт не выбран.' : `Ошибка прошивки: ${msg}`);
    }
  };

  const openMonitor = async () => {
    try {
      const port = await serialApi().requestPort({ filters: [] });
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      setMonOn(true);
      readerStop.current = false;
      const decoder = new TextDecoder();
      while (port.readable && !readerStop.current) {
        const reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done || readerStop.current) break;
            setMonitor((m) => (m + decoder.decode(value)).slice(-100000));
          }
        } catch { /* порт отключён */ } finally { reader.releaseLock(); }
      }
    } catch (e) {
      setError(`Монитор: ${(e as Error).message}`);
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

  return (
    <div className="grid h-full grid-cols-[320px_1fr] max-md:grid-cols-1">
      <div className="space-y-3 overflow-auto border-r border-line p-3 text-[13px]">
        <div className="flex items-center gap-2 font-semibold"><Cpu size={16} className="text-accent" /> Настоящая ESP32</div>
        <p className="text-muted">Скетч компилируется настоящим компилятором Arduino (ядро ESP32 2.0.17) на сервере и прошивается в плату по USB прямо из браузера.</p>
        {!user && <div className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">Войдите, чтобы пользоваться компилятором.</div>}
        <div className="space-y-2">
          <Button className="w-full" variant="primary" icon={<Hammer size={15} />} loading={step === 'compiling'} disabled={!user} onClick={() => void compile()}>
            1. Скомпилировать
          </Button>
          <Button className="w-full" icon={<Zap size={15} />} loading={step === 'flashing'} disabled={!result?.ok || !supported} onClick={() => void flash()}>
            2. Прошить плату
          </Button>
          {step === 'flashing' && <Progress value={progress} />}
          <Button className="w-full" variant="ghost" icon={monOn ? <Unplug size={15} /> : <Plug size={15} />} disabled={!supported} onClick={() => void (monOn ? closeMonitor() : openMonitor())}>
            {monOn ? 'Закрыть монитор платы' : '3. Монитор платы (115200)'}
          </Button>
          {result?.ok && <Button className="w-full" variant="ghost" size="sm" icon={<Download size={14} />} onClick={downloadBin}>Скачать прошивку .bin</Button>}
        </div>
        {result && <div className="flex flex-wrap gap-1.5">{result.ok ? <Badge tone="ok">успешно за {((result.ms ?? 0) / 1000).toFixed(1)} с</Badge> : <Badge tone="err">ошибки</Badge>}</div>}
        {error && <div className="rounded-lg border border-err/40 bg-err/10 p-2 text-xs text-err">{error}</div>}
        {!supported && <div className="rounded-lg border border-line bg-panel-2 p-2 text-xs text-muted">Прошивка из браузера работает в Chrome, Edge и Opera на компьютере (Web Serial API).</div>}
        <div className="rounded-lg border border-line bg-panel-2 p-2 text-[11.5px] leading-relaxed text-muted">
          💡 Подключите плату кабелем USB с данными. Если плата не определяется — установите драйвер CP210x или CH340.
          Если прошивка «зависает» на подключении — зажмите кнопку <b>BOOT</b> на плате.
        </div>
      </div>
      <div className="flex min-h-0 flex-col">
        <pre ref={monBox} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[12px] leading-relaxed">
          {monOn || monitor ? monitor || 'Ждём данных с платы…' : log || <span className="text-faint">Здесь появится лог компиляции и прошивки.</span>}
        </pre>
        {monOn && (
          <div className="flex gap-1.5 border-t border-line p-1.5">
            <input className={`${inputCls} h-8 font-mono text-xs`} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void sendToBoard(); }} placeholder="Отправить на плату…" />
            <Button size="sm" icon={<Send size={14} />} onClick={() => void sendToBoard()}>Отправить</Button>
          </div>
        )}
      </div>
    </div>
  );
}
