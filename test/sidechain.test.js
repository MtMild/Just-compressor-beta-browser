import test from 'node:test';
import assert from 'node:assert/strict';
import { Compressor } from '../dsp/compressor.js';
import { sine, noise, rmsDb, run } from './helpers.js';

const SR = 48000;
const mk = (o = {}, sr = SR) => { const c = new Compressor(sr); c.setParams({ threshold: -20, ratio: 4, knee: 0, autoGain: false, ...o }); return c; };
const meanGr = (c, x) => { const { gain } = run(c, x, x, 128); let s = 0, n = 0; for (let i = Math.floor(gain.length / 2); i < gain.length; i++) { s += gain[i]; n++; } return s / n; };
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b} (±${eps})`);

test('sidechain Level never changes the compression or the main output; it only sets the Listen volume', () => {
  const x = sine(SR * 2, SR, 1000, -12);
  for (const lvl of [-24, 6, 24]) {
    near(meanGr(mk({ scLevel: lvl }), x), meanGr(mk({ scLevel: 0 }), x), 1e-6);
    const a = run(mk({ scLevel: lvl }), x, x, 128).outL, b = run(mk({ scLevel: 0 }), x, x, 128).outL;
    for (let i = 0; i < a.length; i += 97) assert.equal(a[i], b[i]);
  }
  const lo = run(mk({ scListen: true, scLevel: -12 }), x, x, 128).outL, hi = run(mk({ scListen: true, scLevel: 0 }), x, x, 128).outL;
  assert.ok(rmsDb(lo, SR, 2 * SR) < rmsDb(hi, SR, 2 * SR) - 11, 'Listen gets quieter with Level');
});

test('HPF 1000 Hz makes the detector deaf to a 100 Hz sine', () => {
  const x = sine(SR * 2, SR, 100, -10);
  assert.ok(Math.abs(meanGr(mk({ sidechainHpf: 1000 }), x)) < 1);
  assert.ok(Math.abs(meanGr(mk({}), x)) > 6);
});

test('LPF 1000 Hz makes the detector deaf to a 10 kHz sine; 20000 means off', () => {
  const x = sine(SR * 2, SR, 10000, -10);
  assert.ok(Math.abs(meanGr(mk({ scLpf: 1000 }), x)) < 1);
  assert.ok(Math.abs(meanGr(mk({ scLpf: 20000 }), x)) > 6);
});

test('bell +12 dB at 1 kHz acts like lowering the threshold by 12 dB for a 1 kHz tone', () => {
  const x = sine(SR * 2, SR, 1000, -26);
  near(meanGr(mk({ scBandFreq: 1000, scBandGain: 12, scBandQ: 1 }), x), meanGr(mk({ threshold: -32 }), x), 1);
});

test('Listen outputs the filtered detector signal (transparent below 0.5, deaf to filtered-out bands)', () => {
  const x = sine(SR, SR, 1000, -12); // peak 0.25
  const { outL } = run(mk({ scListen: true }), x, x, 128);
  for (let i = 0; i < x.length; i++) assert.ok(Math.abs(outL[i] - x[i]) < 1e-5, `sample ${i}`);
  const low = sine(SR, SR, 100, -12);
  const { outL: f } = run(mk({ scListen: true, sidechainHpf: 1000 }), low, low, 128);
  assert.ok(rmsDb(f, SR / 2, SR) < rmsDb(low, SR / 2, SR) - 30);
});

test('Listen with Level +24 dB on full-scale noise never exceeds +-1', () => {
  const x = noise(SR, 3, 0);
  const { outL, outR } = run(mk({ scListen: true, scLevel: 24 }), x, x, 128);
  for (let i = 0; i < x.length; i++) assert.ok(Math.abs(outL[i]) <= 1 && Math.abs(outR[i]) <= 1);
});

test('extreme filter settings at 44.1 kHz stay finite and silence stays silent', () => {
  const sr = 44100, x = noise(sr, 5, -6), z = new Float32Array(sr / 4);
  const c = mk({ sidechainHpf: 1000, scLpf: 1000, scBandFreq: 12000, scBandGain: 12, scBandQ: 8, scLevel: 24 }, sr);
  const { outL } = run(c, x, x, 64);
  for (const v of outL) assert.ok(Number.isFinite(v));
  const { outL: s } = run(mk({ sidechainHpf: 1000, scLpf: 1000, scBandGain: 12 }, sr), z, z, 64);
  for (const v of s) assert.equal(v, 0);
});

test('a steeper HPF slope removes more of a tone just below the cutoff (no resonance anywhere)', () => {
  const x = sine(SR * 2, SR, 700, -10); // 700 Hz, HPF at 1 kHz
  const g = (slope) => meanGr(mk({ sidechainHpf: 1000, scHpfSlope: slope }), x);
  assert.ok(g(6) <= g(12) - 1, `6 vs 12 dB/oct: ${g(6)} vs ${g(12)}`);
  assert.ok(g(12) <= g(24) - 1.5, `12 vs 24 dB/oct: ${g(12)} vs ${g(24)}`);
  const y = sine(SR * 2, SR, 6000, -10); // LPF at 4 kHz
  const l = (slope) => meanGr(mk({ scLpf: 4000, scLpfSlope: slope }), y);
  assert.ok(l(6) <= l(12) - 1 && l(12) <= l(24) - 1, `${l(6)} ${l(12)} ${l(24)}`);
});

test('48 dB/oct filters stay stable at low sample rates and extreme cutoffs', () => {
  const sr = 16000, x = noise(sr, 5, -6);
  const c = mk({ sidechainHpf: 1000, scHpfSlope: 48, scLpf: 7000, scLpfSlope: 48, scListen: true }, sr);
  const { outL } = run(c, x, x, 64);
  for (const v of outL) assert.ok(Number.isFinite(v) && Math.abs(v) <= 1);
});
