import test from 'node:test';
import assert from 'node:assert/strict';
import { Compressor } from '../dsp/compressor.js';
import { sine, noise, run } from './helpers.js';

const SR = 48000;
const mk = (o = {}) => { const c = new Compressor(SR); c.setParams({ threshold: -24, ratio: 4, knee: 0, autoGain: false, ...o }); return c; };
const lastGr = (c, x) => { const { gain } = run(c, x, x, 128); let s = 0, n = 0; for (let i = gain.length - 3 * (SR / 128); i < gain.length; i++) { s += gain[i]; n++; } return s / n; };

test('Auto Threshold keeps gain reduction steady when the same material is 12 dB louder', () => {
  const quiet = sine(SR * 10, SR, 440, -24), loud = sine(SR * 10, SR, 440, -12);
  const on = Math.abs(lastGr(mk({ autoThreshold: true }), quiet) - lastGr(mk({ autoThreshold: true }), loud));
  const off = Math.abs(lastGr(mk(), quiet) - lastGr(mk(), loud));
  assert.ok(on < 2, `auto on: GR differs by ${on} dB`);
  assert.ok(off > 5, `auto off: GR differs by only ${off} dB`);
});

test('meters.thresholdDb is the knob value when off and follows the level when on', () => {
  const quiet = sine(SR * 10, SR, 440, -24), loud = sine(SR * 10, SR, 440, -12);
  const off = mk(); run(off, loud, loud, 128);
  assert.equal(off.meters.thresholdDb, -24);
  const q = mk({ autoThreshold: true }); run(q, quiet, quiet, 128);
  const l = mk({ autoThreshold: true }); run(l, loud, loud, 128);
  assert.ok(Math.abs(q.meters.thresholdDb - -33) < 1.2, `quiet ${q.meters.thresholdDb}`);
  assert.ok(Math.abs(l.meters.thresholdDb - -21) < 1.2, `loud ${l.meters.thresholdDb}`);
});

test('silence, very quiet and full-scale input: finite output, threshold stays in -60..0, frozen in silence', () => {
  const c = mk({ autoThreshold: true });
  const z = new Float32Array(SR * 5);
  run(c, z, z, 128); const frozen = c.meters.thresholdDb;
  const q = noise(SR * 2, 4, -80), l = noise(SR * 2, 6, 0);
  let seen = [frozen];
  for (const x of [q, l]) { const { outL } = run(c, x, x, 128); for (const v of outL) assert.ok(Number.isFinite(v)); seen.push(c.meters.thresholdDb); }
  for (const t of seen) assert.ok(t >= -60 && t <= 0, `threshold ${t}`);
  const c2 = mk({ autoThreshold: true }); run(c2, z.subarray(0, SR * 2), z.subarray(0, SR * 2), 128);
  assert.equal(c2.meters.thresholdDb, frozen);
  assert.equal(frozen, -24);
});
