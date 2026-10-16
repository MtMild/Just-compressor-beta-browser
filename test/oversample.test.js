import test from 'node:test';
import assert from 'node:assert/strict';
import { Oversampler, osLatency, OversampledCompressor } from '../dsp/oversample.js';
import { Compressor } from '../dsp/compressor.js';
import { sanitize, PARAM_SPECS } from '../dsp/params.js';
import { sine, noise, run, rmsDb } from './helpers.js';

const SR = 48000;
const mag = (x, f, from = 0) => { let re = 0, im = 0, n = 0; for (let i = from; i < x.length; i++, n++) { const a = 2 * Math.PI * f * i / SR; re += x[i] * Math.cos(a); im += x[i] * Math.sin(a); } return 20 * Math.log10(2 * Math.hypot(re, im) / n + 1e-12); };
const roundTrip = (os, x) => { const up = new Float32Array(x.length * os.factor), out = new Float32Array(x.length); os.up(x, up, x.length); os.down(up, out, x.length); return out; };

test('oversampling is a parameter with the options Off, 2x, 4x and 8x', () => {
  assert.deepEqual(PARAM_SPECS.oversampling.options, [1, 2, 4, 8]);
  assert.equal(sanitize({}).oversampling, 1);
  assert.equal(sanitize({ oversampling: 3 }).oversampling, 2);
  assert.equal(sanitize({ oversampling: 100 }).oversampling, 8);
});

test('up + down is transparent: flat passband, and the delay is exactly osLatency(factor) samples', () => {
  for (const f of [2, 4, 8]) {
    const os = new Oversampler(f), lat = osLatency(f);
    for (const [hz, tol] of [[1000, 0.05], [10000, 0.1], [17000, 0.5]]) {
      const x = sine(SR, SR, hz, -6), y = roundTrip(new Oversampler(f), x);
      assert.ok(Math.abs(mag(y, hz, 4000) - mag(x, hz, 4000)) < tol, `${f}x ${hz} Hz`);
    }
    const imp = new Float32Array(512); imp[100] = 1;
    const y = roundTrip(os, imp);
    let pk = 0; for (let i = 0; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(y[pk])) pk = i;
    assert.equal(pk, 100 + lat, `${f}x latency`);
  }
  assert.deepEqual([1, 2, 4, 8].map(osLatency), [0, 24, 28, 30]);
});

test('images above the Nyquist frequency are removed by the upsampler (more than 60 dB)', () => {
  const os = new Oversampler(2), x = sine(SR, SR, 15000, -6), up = new Float32Array(2 * SR);
  os.up(x, up, SR);
  const hi = (f) => { let re = 0, im = 0; for (let i = 4000; i < up.length; i++) { const a = 2 * Math.PI * f * i / (2 * SR); re += up[i] * Math.cos(a); im += up[i] * Math.sin(a); } return 20 * Math.log10(2 * Math.hypot(re, im) / (up.length - 4000) + 1e-12); };
  assert.ok(hi(15000) - hi(33000) > 60, `${hi(15000)} vs ${hi(33000)}`);
});

const mk = (o = {}) => { const c = new OversampledCompressor(SR); c.setParams({ threshold: -20, ratio: 4, knee: 0, autoGain: false, ...o }); return c; };

test('Off is bit-identical to the plain compressor and adds no latency', () => {
  const x = noise(SR / 2, 7, -10), a = new Compressor(SR); a.setParams({ threshold: -20, ratio: 4, knee: 0, autoGain: false });
  const ra = run(a, x, x, 128), rb = run(mk(), x, x, 128);
  for (let i = 0; i < x.length; i += 13) assert.equal(ra.outL[i], rb.outL[i]);
  assert.equal(mk().latencySamples, 0);
});

test('with 2x/4x/8x the static compression is the same and the latency is reported', () => {
  const x = sine(SR * 2, SR, 1000, -8);
  const gr = (o) => { const { gain } = run(mk(o), x, x, 128); let s = 0, n = 0; for (let i = gain.length >> 1; i < gain.length; i++) { s += gain[i]; n++; } return s / n; };
  const g1 = gr({});
  for (const f of [2, 4, 8]) { assert.ok(Math.abs(gr({ oversampling: f }) - g1) < 0.3, `${f}x`); assert.equal(mk({ oversampling: f }).latencySamples, osLatency(f)); }
  assert.equal(mk({ oversampling: 2, lookahead: 5 }).latencySamples, osLatency(2) + Math.round(0.005 * SR));
});

test('oversampling cuts aliasing from the saturating styles (3rd harmonic of 15 kHz folds to 3 kHz)', () => {
  const x = sine(SR * 2, SR, 15000, -2);
  const al = (f) => { const o = run(mk({ style: 'varimu', threshold: -30, ratio: 6, oversampling: f }), x, x, 128).outL; return mag(o, 3000, 12000); };
  const off = al(1), x4 = al(4);
  assert.ok(x4 < off - 12, `Off ${off.toFixed(1)} dB, 4x ${x4.toFixed(1)} dB`);
});

test('switching oversampling while running stays finite and keeps the meters', () => {
  const c = mk(), x = noise(SR, 3, -10);
  for (let i = 0; i < x.length; i += 128) {
    if (i === 12800) c.setParams({ oversampling: 4 }); if (i === 25600) c.setParams({ oversampling: 8 }); if (i === 38400) c.setParams({ oversampling: 1 });
    const o = new Float32Array(128); c.process(x.subarray(i, i + 128), x.subarray(i, i + 128), o, new Float32Array(128), 128);
    for (const v of o) assert.ok(Number.isFinite(v));
  }
  assert.ok(Number.isFinite(c.meters.gainDb) && c.meters.gainDb < 0);
});
