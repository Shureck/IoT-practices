// Пул потоков для автопроверок: симуляция — тяжёлая синхронная работа,
// поэтому она не должна блокировать цикл событий сервера.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { CircuitDoc } from '@esp32lab/sim';
import type { CheckOutcome, WorkerReply } from './check-worker';

export class CheckTimeout extends Error {}
export class PoolBusy extends Error {}

interface Job {
  id: number;
  practiceId: string;
  code: string;
  circuit: CircuitDoc;
  resolve: (o: CheckOutcome) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker;
  job: Job | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Где взять код потока: собранный dist/check-worker.mjs или исходник .ts через tsx (check-worker-dev.mjs). */
function workerSpec(): { url: URL; execArgv: string[] } {
  const here = import.meta.url;
  const built = new URL('./check-worker.mjs', here);
  if (here.endsWith('.mjs') && fs.existsSync(fileURLToPath(built))) return { url: built, execArgv: [] };
  return { url: new URL('./check-worker-dev.mjs', here), execArgv: [] };
}

export class CheckPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private seq = 1;
  private closed = false;
  private spec: { url: URL; execArgv: string[] };

  constructor(private size: number, private timeoutMs: number, private maxQueue = 200, workerUrl?: URL) {
    this.spec = workerUrl ? { url: workerUrl, execArgv: [] } : workerSpec();
    for (let i = 0; i < Math.max(1, size); i++) this.slots.push(this.spawn());
  }

  private spawn(): Slot {
    const worker = new Worker(this.spec.url, { execArgv: this.spec.execArgv });
    const slot: Slot = { worker, job: null, timer: null };
    worker.on('message', (msg: WorkerReply) => {
      const job = slot.job;
      if (!job || msg.id !== job.id) return;
      this.finish(slot);
      if (msg.ok) job.resolve(msg.outcome);
      else job.reject(new Error(msg.error));
      this.pump();
    });
    worker.on('error', (err) => this.crash(slot, err));
    worker.on('exit', (code) => {
      if (!this.closed && this.slots.includes(slot)) this.crash(slot, new Error(`Поток проверки завершился (код ${code})`));
    });
    worker.unref();
    return slot;
  }

  private finish(slot: Slot) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.job = null;
  }

  /** Поток упал или завис — заменить новым. */
  private replace(slot: Slot) {
    const i = this.slots.indexOf(slot);
    if (i < 0) return;
    this.slots.splice(i, 1);
    slot.worker.removeAllListeners('exit');
    void slot.worker.terminate();
    if (!this.closed) this.slots.push(this.spawn());
  }

  private crash(slot: Slot, err: Error) {
    const job = slot.job;
    this.finish(slot);
    this.replace(slot);
    job?.reject(err);
    this.pump();
  }

  private pump() {
    for (const slot of this.slots) {
      if (slot.job) continue;
      const job = this.queue.shift();
      if (!job) return;
      slot.job = job;
      slot.timer = setTimeout(() => {
        this.finish(slot);
        this.replace(slot);
        job.reject(new CheckTimeout('timeout'));
        this.pump();
      }, this.timeoutMs);
      slot.worker.postMessage({ id: job.id, practiceId: job.practiceId, code: job.code, circuit: job.circuit });
    }
  }

  run(practiceId: string, code: string, circuit: CircuitDoc): Promise<CheckOutcome> {
    if (this.closed) return Promise.reject(new Error('pool closed'));
    if (this.queue.length >= this.maxQueue) return Promise.reject(new PoolBusy('busy'));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.seq++, practiceId, code, circuit, resolve, reject });
      this.pump();
    });
  }

  async close() {
    this.closed = true;
    for (const j of this.queue.splice(0)) j.reject(new Error('pool closed'));
    await Promise.all(this.slots.map((s) => {
      const job = s.job;
      this.finish(s);
      job?.reject(new Error('pool closed'));
      s.worker.removeAllListeners('exit');
      return s.worker.terminate();
    }));
    this.slots = [];
  }
}
