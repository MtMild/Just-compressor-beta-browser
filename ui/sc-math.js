import { Biquad } from '../dsp/filters.js';
import { SLOPE_OPTIONS, makeStages, configureCut } from '../dsp/filters.js';
import { clamp } from '../dsp/util.js';

const CROSS = 1.25; // minimum ratio between the LPF and HPF frequencies when dragging
const HIT_R = 12, F_MIN = 20, F_MAX = 20000, GAIN_RANGE = 24;

export function makeScGeom(w, h) { return { w, h, padL: 10, padR: 10, plotW: w - 20 }; }
export const freqToX = (g, f) => g.padL + (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * g.plotW;
export const xToFreq = (g, x) => F_MIN * Math.pow(F_MAX / F_MIN, (x - g.padL) / g.plotW);
// Linear within +-12 dB, then a logarithmic bend with no clamp: a steep low cut keeps curving down and leaves through the bottom edge instead of running flat along it.
const LIN = 12, BEND = 8;
const squash = (db) => { const a = Math.abs(db); return a <= LIN ? db : Math.sign(db) * (LIN + BEND * Math.log(1 + (a - LIN) / BEND)); };
const unsquash = (v) => { const a = Math.abs(v); return a <= LIN ? v : Math.sign(v) * (LIN + BEND * (Math.exp((a - LIN) / BEND) - 1)); };
export const gainToY = (g, db) => g.h / 2 - (squash(db) / GAIN_RANGE) * (g.h / 2 - 12);
export const yToGain = (g, y) => unsquash(((g.h / 2 - y) / (g.h / 2 - 12)) * GAIN_RANGE);

const hpS = makeStages(), lpS = makeStages(), bp = new Biquad();
// Combined detector-EQ response in dB: HP + LP cascades (Butterworth, same coefficients as the DSP) + peaking band, each only when on.
// makeResponse sets the filters up once and returns a cheap f -> dB function (use it for whole curves; the stage objects are shared, so use the result before the next call).
export function makeResponse(p, sr) {
  const hpN = p.sidechainHpf > 20.5 ? configureCut(hpS, 'hp', p.sidechainHpf, sr, p.scHpfSlope) : 0;
  const lpN = p.scLpf < 19999 ? configureCut(lpS, 'lp', p.scLpf, sr, p.scLpfSlope) : 0;
  const band = Math.abs(p.scBandGain) > 0.05;
  if (band) bp.setPeaking(p.scBandFreq, p.scBandGain, p.scBandQ, sr);
  return (f) => {
    let db = 0;
    for (let k = 0; k < hpN; k++) db += hpS[k].magnitudeDb(f, sr);
    for (let k = 0; k < lpN; k++) db += lpS[k].magnitudeDb(f, sr);
    if (band) db += bp.magnitudeDb(f, sr);
    return db;
  };
}
export const responseDb = (p, f, sr) => makeResponse(p, sr)(f);

export function scNodes(g, p, sr = 48000) {
  return {
    hpf: { x: freqToX(g, p.sidechainHpf), y: gainToY(g, responseDb(p, p.sidechainHpf, sr)) },
    band: { x: freqToX(g, p.scBandFreq), y: gainToY(g, p.scBandGain) },
    lpf: { x: freqToX(g, p.scLpf), y: gainToY(g, responseDb(p, Math.min(p.scLpf, sr * 0.45), sr)) },
  };
}

export function scHit(g, p, x, y, sr = 48000) {
  const n = scNodes(g, p, sr);
  let best = null, bestD = HIT_R;
  for (const id of ['band', 'hpf', 'lpf']) { const d = Math.hypot(x - n[id].x, y - n[id].y); if (d <= bestD) { best = id; bestD = d; } }
  return best;
}

export function scDragTo(id, g, p, x, y) {
  const f = xToFreq(g, x);
  switch (id) {
    // both filters can be dragged along the whole graph; they stop short of each other (HPF below LPF, with a little distance)
    case 'hpf': return { sidechainHpf: clamp(f, 20, p.scLpf < 19999 ? Math.max(20, p.scLpf / CROSS) : 20000) };
    case 'lpf': return { scLpf: f >= 18000 ? 20000 : clamp(f, p.sidechainHpf > 20.5 ? Math.min(20000, p.sidechainHpf * CROSS) : 20, 20000) };
    case 'band': return { scBandFreq: clamp(f, 60, 12000), scBandGain: clamp(yToGain(g, y), -12, 12) };
    default: return {};
  }
}

export const scWheel = (p, deltaY) => ({ scBandQ: clamp(p.scBandQ * (deltaY < 0 ? 1.15 : 1 / 1.15), 0.3, 8) });
// Wheel over a node: HPF/LPF step through the slopes (wheel up = steeper), the band changes its Q (wheel up = narrower).
export function scWheelNode(id, p, deltaY) {
  const step = (cur) => SLOPE_OPTIONS[clamp(SLOPE_OPTIONS.indexOf(cur) + (deltaY < 0 ? 1 : -1), 0, SLOPE_OPTIONS.length - 1)];
  if (id === 'hpf') return { scHpfSlope: step(p.scHpfSlope) };
  if (id === 'lpf') return { scLpfSlope: step(p.scLpfSlope) };
  return scWheel(p, deltaY);
}

export function scReset(id) {
  if (id === 'hpf') return { sidechainHpf: 20, scHpfSlope: 12 };
  if (id === 'lpf') return { scLpf: 20000, scLpfSlope: 12 };
  if (id === 'band') return { scBandGain: 0, scBandFreq: 1000, scBandQ: 1 };
  return {};
}

// Spectrum level (dB) over the frequency span [fLo, fHi] of one pixel column. Where bins are wider than a pixel (the lows) the level is
// interpolated linearly between bin centres, so the low end is a smooth slope instead of flat steps; where many bins share a pixel the maximum is taken.
export function spectrumLevel(data, nyq, fLo, fHi) {
  const bins = data.length, at = (i) => Math.max(-100, data[clamp(i, 0, bins - 1)]);
  const b0 = (fLo / nyq) * bins, b1 = (fHi / nyq) * bins;
  if (b1 - b0 <= 1) { const bc = (b0 + b1) / 2, i = Math.floor(bc), t = bc - i; return at(i) + (at(i + 1) - at(i)) * t; }
  let m = -100; for (let k = Math.floor(b0); k <= Math.ceil(b1); k++) m = Math.max(m, at(k));
  return m;
}
