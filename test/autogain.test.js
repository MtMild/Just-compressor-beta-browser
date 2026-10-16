import test from 'node:test';
import assert from 'node:assert/strict';
import { Compressor } from '../dsp/compressor.js';
import { noise, rmsDb } from './helpers.js';

const SR = 48000;
const feed = (c, x, from, to, out) => { for (let i = from; i < to; i += 128) { const L = x.subarray(i, Math.min(i + 128, to)); c.process(L, L, out.subarray(i, i + L.length), new Float32Array(L.length), L.length); } };

test('Auto Gain follows a change of the settings within about a second (not several seconds)', () => {
  const x = noise(SR * 8, 4, -14), y = new Float32Array(x.length), c = new Compressor(SR);
  c.setParams({ threshold: -10, ratio: 2, autoGain: true });
  feed(c, x, 0, 3 * SR, y);
  c.setParams({ threshold: -40, ratio: 8 }); // much heavier compression
  feed(c, x, 3 * SR, 8 * SR, y);
  const err = (a, b) => Math.abs(rmsDb(y, a * SR, b * SR) - rmsDb(x, a * SR, b * SR));
  assert.ok(err(4.2, 5.2) < 1.0, `1.2-2.2 s after the change: ${err(4.2, 5.2).toFixed(2)} dB off`);
  assert.ok(err(6.5, 8) < 1.0, `settled: ${err(6.5, 8).toFixed(2)} dB off`);
});

test('Auto Gain reports the makeup it applies', () => {
  const x = noise(SR * 6, 4, -14), y = new Float32Array(x.length), c = new Compressor(SR);
  c.setParams({ threshold: -40, ratio: 8, autoGain: true });
  feed(c, x, 0, x.length, y);
  assert.ok(c.autoGainDb > 3 && c.autoGainDb < 24, `${c.autoGainDb}`);
  c.setParams({ autoGain: false }); assert.equal(c.autoGainDb, 0);
});
