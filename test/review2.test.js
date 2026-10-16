import test from 'node:test';
import assert from 'node:assert/strict';
import { Compressor } from '../dsp/compressor.js';
import { sine, noise, run } from './helpers.js';

const mk = (sr, o = {}) => { const c = new Compressor(sr); c.setParams({ threshold: -24, ratio: 4, knee: 0, autoGain: false, ...o }); return c; };

test('filters above Nyquist cannot blow up: a 16 kHz context with the band at 12 kHz stays finite and recovers', () => {
  const sr = 16000, x = noise(sr, 3, -10), c = mk(sr, { scBandFreq: 12000, scBandGain: 12, scBandQ: 4, scLpf: 15000, sidechainHpf: 900 });
  for (const v of run(c, x, x, 64).outL) assert.ok(Number.isFinite(v), 'finite with out-of-range filter frequencies');
  c.setParams({ scBandFreq: 1000, scLpf: 20000 });
  const { outL } = run(c, x, x, 64);
  let e = 0; for (let i = sr / 2; i < sr; i++) { assert.ok(Number.isFinite(outL[i])); e += outL[i] * outL[i]; }
  assert.ok(e > 1, 'audio comes back after moving the filter back');
});

test('Auto Threshold does not drift during a pause: the first half second after resuming is not crushed', () => {
  const sr = 48000, music = sine(sr * 8, sr, 440, -15), quiet = new Float32Array(sr * 20), again = sine(sr, sr, 440, -15);
  const c = mk(sr, { autoThreshold: true });
  const g1 = run(c, music, music, 128).gain; let steady = 0; for (let i = g1.length - 400; i < g1.length; i++) steady += g1[i] / 400;
  run(c, quiet, quiet, 128);
  const g2 = run(c, again, again, 128).gain; let worst = 0; for (let i = 0; i < (sr / 2) / 128; i++) worst = Math.min(worst, g2[i]);
  assert.ok(worst >= steady - 6, `steady ${steady.toFixed(1)} dB, worst after the pause ${worst.toFixed(1)} dB`);
  assert.ok(c.meters.thresholdDb > -60, 'effective threshold stays off the floor');
});

test('Listen switches smoothly (no click) in both directions', () => {
  const sr = 48000, n = sr, x = sine(n, sr, 100, -6), c = mk(sr, { sidechainHpf: 1000 });
  const out = new Float32Array(n), tmp = new Float32Array(n);
  for (let i = 0; i < n; i += 128) {
    if (i === 128 * 150) c.setParams({ scListen: true });
    if (i === 128 * 280) c.setParams({ scListen: false });
    c.process(x.subarray(i, i + 128), x.subarray(i, i + 128), out.subarray(i, i + 128), tmp.subarray(i, i + 128), Math.min(128, n - i));
  }
  let m = 0; for (let i = 128 * 140; i < 128 * 300; i++) m = Math.max(m, Math.abs(out[i] - out[i - 1]));
  assert.ok(m < 0.03, `max sample-to-sample jump around the toggles: ${m}`);
});
