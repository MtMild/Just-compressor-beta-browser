import test from 'node:test';
import assert from 'node:assert/strict';
import { Compressor } from '../dsp/compressor.js';
import { OversampledCompressor } from '../dsp/oversample.js';
import { sanitize, PARAM_SPECS } from '../dsp/params.js';
import { noise, sine, rmsDb } from './helpers.js';

const SR = 48000;
const feed = (c, x, key = null, from = 0, to = x.length, out = null, block = 128) => {
  const o = out || new Float32Array(x.length), r = new Float32Array(block);
  for (let i = from; i < to; i += block) {
    const m = Math.min(block, to - i), L = x.subarray(i, i + m);
    c.process(L, L, o.subarray(i, i + m), r.subarray(0, m), m, key ? key.subarray(i, i + m) : null, key ? key.subarray(i, i + m) : null);
  }
  return o;
};

test('the sidechain filters can sit anywhere on the graph: HPF 20 Hz-20 kHz, LPF 20 Hz-20 kHz; External is a switch', () => {
  assert.equal(PARAM_SPECS.sidechainHpf.max, 20000); assert.equal(PARAM_SPECS.scLpf.min, 20);
  assert.equal(sanitize({ sidechainHpf: 9000, scLpf: 80 }).sidechainHpf, 9000); assert.equal(sanitize({ sidechainHpf: 9000, scLpf: 80 }).scLpf, 80);
  assert.equal(sanitize({}).scExternal, false);
});

const gr = (c, x, key) => { feed(c, x, key); return c.meters.gainDb; };
const mk = (o = {}, C = Compressor) => { const c = new C(SR); c.setParams({ threshold: -24, ratio: 6, knee: 0, autoGain: false, ...o }); return c; };

test('External sidechain: the detector listens to the key signal instead of the main input', () => {
  const quiet = sine(SR * 2, SR, 1000, -50), loud = sine(SR * 2, SR, 1000, -6), silent = new Float32Array(SR * 2);
  assert.ok(gr(mk({ scExternal: true }), quiet, loud) < -6, 'a loud key compresses a quiet main signal');
  assert.ok(gr(mk({ scExternal: true }), loud, silent) > -0.1, 'a silent key leaves a loud main signal alone');
  assert.ok(gr(mk({ scExternal: true }), loud, null) > -0.1, 'External without any key signal hears silence');
  assert.ok(gr(mk({ scExternal: false }), quiet, loud) > -0.1, 'Internal ignores the key');
  assert.ok(gr(mk({ scExternal: false }), loud, silent) < -6, 'Internal still hears the main input');
});

test('External: the sidechain filters and Listen apply to the key; Listen plays the key, not the main signal', () => {
  const low = sine(SR * 2, SR, 100, -6), high = sine(SR * 2, SR, 5000, -6), main = sine(SR * 2, SR, 1000, -40);
  assert.ok(Math.abs(gr(mk({ scExternal: true, sidechainHpf: 1000 }), main, low)) < 1, 'HPF removes a low key');
  assert.ok(gr(mk({ scExternal: true, sidechainHpf: 1000 }), main, high) < -6, 'HPF keeps a high key');
  const out = feed(mk({ scExternal: true, scListen: true }), main, high);
  assert.ok(rmsDb(out, SR, 2 * SR) > -12, `Listen plays the key (${rmsDb(out, SR, 2 * SR).toFixed(1)} dB)`);
});

test('External works with oversampling too', () => {
  const quiet = sine(SR * 2, SR, 1000, -50), loud = sine(SR * 2, SR, 1000, -6);
  for (const f of [1, 2, 4]) assert.ok(gr(mk({ scExternal: true, oversampling: f }, OversampledCompressor), quiet, loud) < -6, `${f}x`);
});

test('Auto Attack time does not jitter from sample to sample (it follows the recent overshoot, smoothed)', () => {
  const c = mk({ autoAttack: true, attack: 40, threshold: -40, ratio: 4 }), x = noise(SR * 4, 9, -10), o = new Float32Array(128), r = new Float32Array(128);
  for (let i = 0; i < x.length; i++) x[i] *= 0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * 7 * i / SR)); // a 14 Hz pulsing level, like fast material
  const seen = [];
  for (let i = 0; i < x.length; i += 128) { c.process(x.subarray(i, i + 128), x.subarray(i, i + 128), o, r, 128); if (i > SR) seen.push(c.meters.autoAttackMs); }
  let worst = 1; for (let i = 1; i < seen.length; i++) worst = Math.max(worst, seen[i] / seen[i - 1], seen[i - 1] / seen[i]);
  assert.ok(worst < 1.05, `largest change between two readings one 128-sample block apart: x${worst.toFixed(2)}`);
});

const settle = (c, x, from, to) => { const o = new Float32Array(128), r = new Float32Array(128), t = []; for (let i = from; i < to; i += 128) { c.process(x.subarray(i, i + 128), x.subarray(i, i + 128), o, r, 128); t.push(c.meters.thresholdDb); } return t; };

test('Auto Threshold follows a change of the program level within a few seconds and then stays steady', () => {
  const n = noise(SR * 20, 5, 0), x = new Float32Array(n.length);
  for (let i = 0; i < x.length; i++) x[i] = n[i] * (i < 8 * SR ? 0.3 : 0.06); // 14 dB quieter after 8 s
  const c = mk({ autoThreshold: true });
  const a = settle(c, x, 0, 8 * SR), b = settle(c, x, 8 * SR, 20 * SR);
  const before = a.at(-1), per = b.length / 12; // 12 s after the change
  const after = (s) => b[Math.round(s * per) - 1];
  assert.ok(before - after(4) > 10, `4 s later the threshold has moved ${(before - after(4)).toFixed(1)} dB of the ~14 dB`);
  const steady = b.slice(Math.round(8 * per)), mean = steady.reduce((s, v) => s + v, 0) / steady.length;
  assert.ok(Math.max(...steady.map((v) => Math.abs(v - mean))) < 0.8, 'steady material gives a steady threshold');
});

test('Side Chain switch: off = the detector hears the plain main input (no filters, no external key); on by default', () => {
  assert.equal(sanitize({}).scOn, true);
  const low = sine(SR * 2, SR, 100, -6), quiet = sine(SR * 2, SR, 1000, -50), loud = sine(SR * 2, SR, 1000, -6);
  assert.ok(Math.abs(gr(mk({ sidechainHpf: 1000 }), low, null)) < 1, 'on: the HPF makes the detector deaf to the low tone');
  assert.ok(gr(mk({ sidechainHpf: 1000, scOn: false }), low, null) < -6, 'off: the same tone is heard, the HPF is bypassed');
  assert.ok(gr(mk({ scExternal: true, scOn: false }), quiet, loud) > -0.1, 'off: the external key is ignored');
  assert.ok(gr(mk({ scExternal: true, scOn: false }), loud, quiet) < -6, 'off: the main input is what the detector hears');
  assert.ok(gr(mk({ scExternal: true, scOn: false, oversampling: 2 }, OversampledCompressor), quiet, loud) > -0.1, 'off with oversampling too');
});

// pitch of a sine from interpolated zero-crossing times in a window (precise to well under 0.1 %)
const freqAt = (x, t0, win = 0.05) => {
  const times = [];
  for (let i = Math.round(t0 * SR) + 1; i < Math.round((t0 + win) * SR); i++) if (x[i - 1] < 0 !== x[i] < 0) times.push(i - 1 + x[i - 1] / (x[i - 1] - x[i]));
  return times.length < 3 ? NaN : (times.length - 1) / 2 / ((times.at(-1) - times[0]) / SR);
};

test('changing Look-ahead (or switching Upward, which adds 2 ms) never changes the pitch while it moves', () => {
  for (const [f, label, change] of [[1000, 'lookahead 0 -> 10 ms', { lookahead: 10 }], [1234, 'lookahead 10 -> 0 ms', { lookahead: 0 }], [1000, 'Upward on (min 2 ms look-ahead)', { upward: true, upAmount: 2 }]]) {
    const x = sine(SR * 2, SR, f, -12), c = mk({ threshold: 0, lookahead: label.includes('-> 0') ? 10 : 0 }), y = new Float32Array(x.length);
    feed(c, x, null, 0, SR, y);
    c.setParams(change);
    feed(c, x, null, SR, 2 * SR, y);
    let worst = 0;
    for (let t = 1.0; t < 1.9; t += 0.01) worst = Math.max(worst, Math.abs(freqAt(y, t) / f - 1));
    assert.ok(worst < 0.005, `${label}: pitch moved by ${(worst * 100).toFixed(2)} %`);
    let jump = 0; for (let i = SR + 1; i < 2 * SR; i++) jump = Math.max(jump, Math.abs(y[i] - y[i - 1]));
    assert.ok(jump < 0.15, `${label}: no click (largest step ${jump.toFixed(3)})`);
  }
});

test('Unity Gain (1:1): the loudness stays that of the input whatever Gain / Auto Gain say, so only the effect of the compression is heard', () => {
  const x = noise(SR * 5, 6, -12);
  const out = (o) => { const c = mk({ threshold: -30, ratio: 6, ...o }), y = new Float32Array(x.length); feed(c, x, null, 0, x.length, y); return y; };
  const dB = (y) => rmsDb(y, 3 * SR, 5 * SR) - rmsDb(x, 3 * SR, 5 * SR);
  assert.ok(dB(out({ autoGain: false })) < -6, 'without Unity heavy compression is much quieter');
  for (const o of [{ autoGain: false }, { autoGain: true, gain: 5 }, { autoGain: false, gain: -9 }]) assert.ok(Math.abs(dB(out({ ...o, unity: true }))) < 0.8, `Unity ${JSON.stringify(o)}: ${dB(out({ ...o, unity: true })).toFixed(2)} dB`);
  const a = out({ unity: true, gain: 0, autoGain: false }), b = out({ unity: true, gain: 7, autoGain: true });
  for (let i = 0; i < x.length; i += 97) assert.equal(a[i], b[i]); // the Gain knob and Auto Gain have no say in it
  assert.equal(sanitize({}).unity, false);
  assert.equal('delta' in PARAM_SPECS, false, 'Delta was removed');
});

test('threshold 0 never reduces a signal at or below 0 dB, in any style', async () => {
  const { computeGainDb } = await import('../dsp/gain.js');
  const { effectiveParams, STYLES } = await import('../dsp/styles.js');
  const { defaults: defaultParams } = await import('../dsp/params.js');
  for (const style of Object.keys(STYLES)) for (const knee of [0, 8, 30]) {
    const e = effectiveParams({ ...defaultParams(), style, knee, threshold: 0, ratio: 10 });
    for (let x = -60; x <= -0.01; x += 0.5) assert.ok(computeGainDb(x, e) > -0.01, `${style} knee ${knee} at ${x}`);
  }
});
