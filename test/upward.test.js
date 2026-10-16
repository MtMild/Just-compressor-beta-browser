import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGainDb } from '../dsp/gain.js';
import { sanitize } from '../dsp/params.js';
import { Compressor } from '../dsp/compressor.js';
import { sine, noise, dc, rmsDb, peakDb, run } from './helpers.js';

const SR = 48000;
const U = (o = {}) => sanitize({ threshold: -20, ratio: 4, knee: 0, upward: true, upWindow: 12, upAmount: 2, upMaxBoost: 24, upFloor: -90, ...o });
const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const out = (x, p) => x + computeGainDb(x, p);

test('below T_up the output-vs-input slope is 1/upAmount', () => {
  const p = U();
  near((out(-60, p) - out(-50, p)) / -10, 0.5);
  near((out(-46, U({ upAmount: 3 })) - out(-40, U({ upAmount: 3 }))) / -6, 1 / 3);
});

test('dead zone between T_up and threshold is 1:1', () => {
  for (const x of [-31, -26, -21]) near(computeGainDb(x, U()), 0);
});

test('boost never exceeds Max Boost', () => {
  assert.equal(computeGainDb(-80, U({ upAmount: 3, upMaxBoost: 12 })), 12);
});

test('boost fades to zero at and below the Floor', () => {
  const p = U({ upFloor: -60 });
  near(computeGainDb(-60, p), 0, 1e-9);
  near(computeGainDb(-90, p), 0, 1e-9);
  assert.ok(computeGainDb(-50, p) > 5);
});

test('upward off (or upAmount 1) equals plain downward values', () => {
  near(computeGainDb(0, U({ upward: false })), -15);
  for (let x = -90; x <= 0; x += 3) {
    assert.equal(computeGainDb(x, U({ upward: false })), computeGainDb(x, U({ upAmount: 1 })));
  }
});

test('silence stays silent with upward on (no boost, no NaN)', () => {
  const c = new Compressor(SR); c.setParams({ upward: true, autoGain: true, threshold: -20 });
  const z = new Float32Array(SR / 4);
  const { outL } = run(c, z, z, 128);
  for (const v of outL) assert.equal(v, 0);
});

test('quiet->loud step: boost retracts fast and look-ahead prevents overshoot', () => {
  const n = SR * 2, at = SR; // -50 dBFS for 1 s, then -6 dBFS
  const x = new Float32Array(n);
  x.set(dc(SR, -50), 0); x.set(dc(SR, -6), SR);
  const cfg = { threshold: -20, ratio: 4, knee: 0, autoGain: false, upward: true, upWindow: 12, upAmount: 2, upMaxBoost: 12, upFloor: -80, release: 120 };
  // boost is up before the step
  const c1 = new Compressor(SR); c1.setParams({ ...cfg, attack: 10 });
  const r1 = run(c1, x, x, 1);
  assert.ok(r1.gain[at - 1] > 5, `boost before step: ${r1.gain[at - 1]}`);
  assert.ok(r1.gain[at + Math.round(0.05 * SR)] < -1, 'boost fully retracted (now reducing) within 50 ms');
  // peak after the step with look-ahead vs. downward-only
  const up = new Compressor(SR); up.setParams({ ...cfg, attack: 1, lookahead: 5 });
  const dn = new Compressor(SR); dn.setParams({ ...cfg, attack: 1, lookahead: 5, upward: false });
  const pu = peakDb(run(up, x, x, 1).outL, at, n), pd = peakDb(run(dn, x, x, 1).outL, at, n);
  assert.ok(pu <= pd + 0.5, `upward peak ${pu} vs downward-only ${pd}`);
});

test('auto gain with upward on keeps output RMS within 1 dB of input', () => {
  const s = sine(SR * 10, SR, 440, -42), nz = noise(SR * 10, 11, -52);
  const x = s.map((v, i) => v + nz[i]);
  const c = new Compressor(SR);
  c.setParams({ threshold: -20, ratio: 4, knee: 0, upward: true, upWindow: 12, upAmount: 2, upMaxBoost: 12, upFloor: -80, autoGain: true });
  const { outL } = run(c, x, x, 256);
  assert.ok(Math.abs(rmsDb(outL, SR * 7, SR * 10) - rmsDb(x, SR * 7, SR * 10)) <= 1);
});
