export const dbToLin = (db) => Math.pow(10, db / 20);
export function sine(n, sr, freq, ampDb, start = 0) {
  const a = dbToLin(ampDb), out = new Float32Array(n);
  for (let i = start; i < n; i++) out[i] = a * Math.sin(2 * Math.PI * freq * i / sr);
  return out;
}
export function noise(n, seed = 1, ampDb = 0) {
  let s = seed >>> 0; const a = dbToLin(ampDb), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = a * ((s / 4294967296) * 2 - 1); }
  return out;
}
export function dc(n, ampDb, start = 0, end = n) {
  const a = dbToLin(ampDb), out = new Float32Array(n);
  for (let i = start; i < end; i++) out[i] = a;
  return out;
}
export function rmsDb(buf, from = 0, to = buf.length) {
  let s = 0; for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return 10 * Math.log10(s / (to - from) + 1e-20);
}
export function peakDb(buf, from = 0, to = buf.length) {
  let m = 0; for (let i = from; i < to; i++) m = Math.max(m, Math.abs(buf[i]));
  return 20 * Math.log10(m + 1e-10);
}
// Runs a compressor over L/R in blocks; returns {outL,outR,gain} (gain = meters.gainDb after each block)
export function run(comp, L, R = L, block = 1) {
  const n = L.length, outL = new Float32Array(n), outR = new Float32Array(n), gain = new Float32Array(Math.ceil(n / block));
  for (let i = 0, b = 0; i < n; i += block, b++) {
    const m = Math.min(block, n - i);
    comp.process(L.subarray(i, i + m), R.subarray(i, i + m), outL.subarray(i, i + m), outR.subarray(i, i + m), m);
    gain[b] = comp.meters.gainDb;
  }
  return { outL, outR, gain };
}
// first time (ms) at which |gain| reaches frac * |final|
export function timeToFraction(gain, sr, frac, final, from = 0) {
  for (let i = from; i < gain.length; i++) if (Math.abs(gain[i]) >= frac * Math.abs(final)) return (i - from) * 1000 / sr;
  return Infinity;
}
