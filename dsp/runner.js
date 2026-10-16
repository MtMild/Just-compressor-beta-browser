import { OversampledCompressor } from './oversample.js';

const REPORT_S = 0.016;
const db = (v) => (v <= 1e-6 ? -120 : 20 * Math.log10(v));

// Wraps the Compressor and reports meters about every 16 ms through `post`. Shared by the AudioWorklet and the fallback node.
export class Runner {
  constructor(sampleRate, post) {
    this.sr = sampleRate; this.post = post;
    this.comp = new OversampledCompressor(sampleRate);
    this.scratch = new Float32Array(128);
    this.frames = 0; this.blockIn = 0; this.blockOut = 0;
  }

  setParams(p) { this.comp.setParams(p); }

  // oR may be null for a mono output; a scratch buffer is used then.
  // kL/kR: the key (external sidechain) channels when the host provides them
  process(L, R, oL, oR, n, kL = null, kR = null) {
    if (!oR) { if (this.scratch.length < n) this.scratch = new Float32Array(n); oR = this.scratch; }
    this.comp.process(L, R, oL, oR, n, kL, kR);
    for (let i = 0; i < n; i++) {
      const a = Math.max(Math.abs(L[i]), Math.abs(R[i])), b = Math.max(Math.abs(oL[i]), Math.abs(oR[i]));
      if (a > this.blockIn) this.blockIn = a;
      if (b > this.blockOut) this.blockOut = b;
    }
    this.frames += n;
    if (this.frames >= REPORT_S * this.sr) {
      const m = this.comp.meters;
      this.post({ type: 'meters', gainDb: m.gainDb, inPeakDb: m.inPeakDb, outPeakDb: m.outPeakDb, thresholdDb: m.thresholdDb, latencySamples: this.comp.latencySamples, autoGainDb: this.comp.autoGainDb, autoAttackMs: m.autoAttackMs, autoReleaseMs: m.autoReleaseMs, inDb: db(this.blockIn), outDb: db(this.blockOut) });
      this.frames = 0; this.blockIn = 0; this.blockOut = 0;
    }
  }
}
