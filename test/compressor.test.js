import test from 'node:test';
import assert from 'node:assert/strict';
import { Compressor } from '../dsp/compressor.js';
import { sine, noise, dc, rmsDb, peakDb, run, timeToFraction } from './helpers.js';

const SR = 48000;
const base = { threshold: -20, ratio: 4, knee: 0, autoGain: false, release: 120, attack: 10 };
const mk = (o = {}, sr = SR) => { const c = new Compressor(sr); c.setParams({ ...base, ...o }); return c; };
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b} (±${eps})`);

test('static level: 1 kHz sine at -8 dBFS, thr -20, 4:1 -> about -9 dB', () => {
  const x = sine(SR * 2, SR, 1000, -8);
  const { outL } = run(mk(), x, x, 128);
  near(rmsDb(outL, SR, SR * 2) - rmsDb(x, SR, SR * 2), -9, 0.3);
});

test('attack: DC step reaches 63% of final reduction in ~attack time', () => {
  const x = dc(SR, -10, 4800); // -10 dB vs thr -30 @10:1 => -18 dB final
  const c = mk({ threshold: -30, ratio: 10, release: 500 });
  const { gain } = run(c, x);
  near(timeToFraction(gain, SR, 0.632, -18, 4800), 10, 1.5);
});

test('release: gain recovers 63% in ~release time', () => {
  const x = dc(SR * 2, -10, 0, SR);
  const c = mk({ threshold: -30, ratio: 10, release: 100 });
  const { gain } = run(c, x);
  const final = gain[SR - 1];
  // recovery to 36.8% of |final| remaining
  let t = Infinity;
  for (let i = SR; i < gain.length; i++) if (Math.abs(gain[i]) <= 0.368 * Math.abs(final)) { t = (i - SR) * 1000 / SR; break; }
  near(t, 100, 15);
});

test('lookahead: transient is attenuated before it hits', () => {
  const n = SR / 2, on = 4800;
  const x = sine(n, SR, 1000, -10, on);
  const win = 24; // 0.5 ms
  const withLa = run(mk({ threshold: -30, ratio: 10, attack: 1, lookahead: 5 }), x, x, 1).outL;
  const noLa = run(mk({ threshold: -30, ratio: 10, attack: 1, lookahead: 0 }), x, x, 1).outL;
  const la = Math.round(0.005 * SR);
  const steady = peakDb(withLa, n - 2400, n);
  const first = peakDb(withLa, on + la, on + la + win);
  const firstNoLa = peakDb(noLa, on, on + win);
  assert.ok(first - steady < 1.5, `with look-ahead first-peak is ${first - steady} dB over steady`);
  assert.ok(firstNoLa - steady > 3, `without look-ahead overshoot is ${firstNoLa - steady} dB`);
  assert.equal(mk({ lookahead: 5 }).latencySamples, la);
});

test('mix 0 returns the delayed dry signal exactly; bypass too after the fade', () => {
  const x = noise(SR / 2, 3, -6), la = Math.round(0.002 * SR);
  const a = run(mk({ mix: 0, lookahead: 2 }), x).outL;
  for (let i = la; i < x.length; i++) assert.equal(a[i], x[i - la]);
  const c = mk({ lookahead: 2 }); c.setParams({ bypass: true });
  const b = run(c, x).outL;
  for (let i = SR / 4; i < x.length; i++) assert.equal(b[i], x[i - la]);
});

test('auto gain keeps output RMS within 1 dB of input on stationary material', () => {
  const s = sine(SR * 10, SR, 440, -12), nz = noise(SR * 10, 5, -30);
  const x = s.map((v, i) => v + nz[i]);
  const { outL } = run(mk({ threshold: -30, autoGain: true }), x, x, 256);
  near(rmsDb(outL, SR * 7, SR * 10) - rmsDb(x, SR * 7, SR * 10), 0, 1);
});

test('same timing in ms at 44.1, 48 and 96 kHz', () => {
  const times = [44100, 48000, 96000].map((sr) => {
    const c = mk({ threshold: -30, ratio: 10, release: 500 }, sr);
    const { gain } = run(c, dc(sr, -10, Math.round(sr * 0.1)));
    return timeToFraction(gain, sr, 0.632, -18, Math.round(sr * 0.1));
  });
  for (const t of times) near(t, 10, 1.5);
});

test('tiny blocks, empty blocks and mono input do not throw', () => {
  const c = mk(), x = noise(64, 9, -6), o1 = new Float32Array(64), o2 = new Float32Array(64);
  assert.doesNotThrow(() => { c.process(x.subarray(0, 1), x.subarray(0, 1), o1.subarray(0, 1), o2.subarray(0, 1), 1); });
  assert.doesNotThrow(() => { c.process(x, x, o1, o2, 0); });
  assert.doesNotThrow(() => { c.process(x, x, o1, o2, 64); });
});

test('silence in -> silence out (no NaN)', () => {
  const z = new Float32Array(SR / 4);
  const { outL, outR } = run(mk({ autoGain: true }), z, z, 128);
  for (let i = 0; i < z.length; i++) { assert.equal(outL[i], 0); assert.equal(outR[i], 0); }
});

test('extreme settings on full-scale noise stay finite', () => {
  const x = noise(SR, 7, 0), y = noise(SR, 8, 0);
  const c = mk({ attack: 0.1, ratio: 100, lookahead: 10, threshold: 0, autoGain: true, autoRelease: true, sidechainHpf: 1000 });
  const { outL, outR } = run(c, x, y, 64);
  for (let i = 0; i < x.length; i++) assert.ok(Number.isFinite(outL[i]) && Number.isFinite(outR[i]));
});
