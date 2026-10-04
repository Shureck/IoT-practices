// Звук пищалок (WebAudio).
import type { CircuitDoc } from '@esp32lab/sim';

class AudioEngine {
  ctx: AudioContext | null = null;
  voices = new Map<string, { osc: OscillatorNode; gain: GainNode; freq: number }>();

  resume() {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* нет звука */ }
  }

  update(views: Record<string, Record<string, unknown>>, circuit: CircuitDoc) {
    if (!this.ctx) return;
    const active = new Set<string>();
    for (const p of circuit.parts) {
      if (p.type !== 'buzzer') continue;
      const f = Number(views[p.id]?.freq ?? 0);
      if (f > 0) {
        active.add(p.id);
        let v = this.voices.get(p.id);
        if (!v) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'square';
          gain.gain.value = 0;
          osc.connect(gain).connect(this.ctx.destination);
          osc.start();
          v = { osc, gain, freq: 0 };
          this.voices.set(p.id, v);
        }
        if (v.freq !== f) { v.osc.frequency.setTargetAtTime(Math.min(8000, f), this.ctx.currentTime, 0.005); v.freq = f; }
        v.gain.gain.setTargetAtTime(0.035, this.ctx.currentTime, 0.01);
      }
    }
    for (const [id, v] of this.voices) {
      if (!active.has(id)) v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
    }
  }

  silence() {
    if (!this.ctx) return;
    for (const v of this.voices.values()) {
      try { v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01); v.osc.stop(this.ctx.currentTime + 0.1); } catch { /* уже остановлен */ }
    }
    this.voices.clear();
  }
}

export const audio = new AudioEngine();
