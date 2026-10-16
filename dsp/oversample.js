import { sanitize } from './params.js';
import { Compressor } from './compressor.js';

// Oversampling by a cascade of 2x linear-phase half-band stages (Kaiser-windowed sinc). The first stage has the steep
// transition (images start just above the audio band), the later ones work at higher rates and can be short.
const STAGE_K = [12, 4, 4]; // a stage has 4K+1 taps; its delay is 2K samples at its own output rate
const KAISER_BETA = 8;
const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const bessel0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; } return s; };

function halfband(K) { // taps at odd offsets from the centre c = 2K (even offsets are zero), centre 0.5; sum = 1
  const L = 4 * K + 1, c = 2 * K, h = new Float64Array(L), i0 = bessel0(KAISER_BETA);
  for (let j = 0; j < L; j++) { const r = (j - c) / c; h[j] = 0.5 * sinc((j - c) / 2) * (bessel0(KAISER_BETA * Math.sqrt(Math.max(0, 1 - r * r))) / i0); }
  return h;
}

// Latency in samples at the base rate for a given factor (up + down).
export const osLatency = (factor) => { let lat = 0; for (let s = 0, f = 1; f < factor; s++, f *= 2) lat += (2 * STAGE_K[s]) / f; return lat; };

class Up2 {
  constructor(K) {
    this.K = K; this.n = 2 * K; this.hist = new Float64Array(this.n); this.pos = 0;
    const h = halfband(K); this.g = new Float64Array(this.n);
    for (let k = 0; k < this.n; k++) this.g[k] = 2 * h[2 * k + 1]; // x2 restores the amplitude lost by zero-stuffing
  }

  process(x, out, n) {
    const { hist, g, K } = this, N = this.n;
    let pos = this.pos;
    for (let i = 0; i < n; i++) {
      hist[pos] = x[i];
      let s = 0;
      for (let k = 0, p = pos; k < N; k++, p = p === 0 ? N - 1 : p - 1) s += g[k] * hist[p];
      out[2 * i] = hist[(pos - K + N) % N]; // centre tap: a pure delay of K input samples
      out[2 * i + 1] = s;
      pos = pos === N - 1 ? 0 : pos + 1;
    }
    this.pos = pos;
  }
}

class Down2 {
  constructor(K) {
    this.K = K; this.L = 4 * K + 1; this.c = 2 * K; this.hist = new Float64Array(this.L); this.pos = 0; this.h = halfband(K);
  }

  push(v) { this.hist[this.pos] = v; this.pos = this.pos === this.L - 1 ? 0 : this.pos + 1; }
  at(j) { return this.hist[(this.pos - 1 - j + this.L * 2) % this.L]; } // j samples back from the newest

  process(w, out, n) { // n output samples, 2n input samples
    const { h, L, c } = this;
    for (let i = 0; i < n; i++) {
      this.push(w[2 * i]);
      let s = h[c] * this.at(c);
      for (let j = 1; j < L - 1; j += 2) s += h[j] * this.at(j);
      out[i] = s;
      this.push(w[2 * i + 1]);
    }
  }
}

// One channel: up(x -> factor * n samples) and down(factor * n samples -> n samples).
export class Oversampler {
  constructor(factor) {
    this.factor = factor; this.ups = []; this.downs = []; this.tmp = [];
    for (let s = 0, f = 1; f < factor; s++, f *= 2) { this.ups.push(new Up2(STAGE_K[s])); this.downs.push(new Down2(STAGE_K[s])); this.tmp.push(new Float32Array(0)); }
  }

  _buf(s, len) { if (this.tmp[s].length < len) this.tmp[s] = new Float32Array(len); return this.tmp[s]; }

  up(x, out, n) {
    let cur = x, len = n;
    for (let s = 0; s < this.ups.length; s++) {
      const dst = s === this.ups.length - 1 ? out : this._buf(s, len * 2);
      this.ups[s].process(cur, dst, len); cur = dst; len *= 2;
    }
  }

  down(inp, out, n) {
    let cur = inp, len = n * this.factor;
    for (let s = this.downs.length - 1; s >= 0; s--) {
      len /= 2;
      const dst = s === 0 ? out : this._buf(s, len);
      this.downs[s].process(cur, dst, len); cur = dst;
    }
  }
}

// The compressor running at factor x the sample rate inside an up/down sampler pair. Off (1x) bypasses the samplers completely.
export class OversampledCompressor {
  constructor(sampleRate) {
    this.sr = sampleRate; this.p = sanitize({}); this.factor = 1;
    this.core = new Compressor(sampleRate); this.os = null;
    this.buf = Array.from({ length: 6 }, () => new Float32Array(0));
  }

  setParams(partial) {
    this.p = sanitize({ ...this.p, ...partial });
    const f = this.p.oversampling;
    if (f !== this.factor) {
      const old = this.core, core = new Compressor(this.sr * f);
      core.setParams(this.p);
      for (const k of ['byp', 'lis', 'thrOffset', 'autoOffset', 'pIn', 'pOut', 'gIn', 'gOut', 'autoFast', 'dens', 'autoRelMs', 'curAttMs', 'trim', 'trimTarget', 'inPeak', 'outPeak', 'gainDbNow']) core[k] = old[k]; // keep slow state across the switch
      core.gF = [...old.gF]; core.gS = [...old.gS];
      this.core = core; this.factor = f; this.os = f > 1 ? [new Oversampler(f), new Oversampler(f), new Oversampler(f), new Oversampler(f)] : null; // L, R, key L, key R
    } else this.core.setParams(this.p);
  }

  get latencySamples() { return Math.round(this.core.latencySamples / this.factor) + osLatency(this.factor); }
  get meters() { return this.core.meters; }
  get autoGainDb() { return this.core.autoGainDb; }

  process(inL, inR, outL, outR, n, keyL = null, keyR = null) {
    if (this.factor === 1) { this.core.process(inL, inR, outL, outR, n, keyL, keyR); return; }
    const m = n * this.factor, b = this.buf, ext = this.p.scOn && this.p.scExternal && keyL;
    for (let i = 0; i < 6; i++) if (b[i].length < m) b[i] = new Float32Array(m);
    this.os[0].up(inL, b[0], n); this.os[1].up(inR, b[1], n);
    if (ext) { this.os[2].up(keyL, b[4], n); this.os[3].up(keyR || keyL, b[5], n); }
    this.core.process(b[0], b[1], b[2], b[3], m, ext ? b[4] : null, ext ? b[5] : null);
    this.os[0].down(b[2], outL, n); this.os[1].down(b[3], outR, n);
  }
}
