import test from 'node:test';
import assert from 'node:assert/strict';
import { Compressor } from '../dsp/compressor.js';
import { sine, noise, rmsDb, run } from './helpers.js';

const SR = 48000;
const material = () => { const s = sine(SR * 10, SR, 440, -10), nz = noise(SR * 10, 21, -26); return s.map((v, i) => v + nz[i]); };
const mk = (o) => { const c = new Compressor(SR); c.setParams({ threshold: -30, ratio: 6, knee: 0, autoGain: false, ...o }); return c; };

test('loudnessMatch: bypassed output loudness equals compressed output loudness', () => {
  const x = material();
  const compressed = run(mk({}), x, x, 256).outL;
  const original = run(mk({ bypass: true, loudnessMatch: true }), x, x, 256).outL;
  const diff = rmsDb(original, SR * 7, SR * 10) - rmsDb(compressed, SR * 7, SR * 10);
  assert.ok(Math.abs(diff) < 1, `diff ${diff} dB`);
  const raw = run(mk({ bypass: true }), x, x, 256).outL; // sanity: without matching they differ clearly
  assert.ok(Math.abs(rmsDb(raw, SR * 7, SR * 10) - rmsDb(compressed, SR * 7, SR * 10)) > 3);
});

test('loudnessMatch accounts for Auto Gain being on', () => {
  const x = material();
  const compressed = run(mk({ autoGain: true, gain: 3 }), x, x, 256).outL;
  const original = run(mk({ autoGain: true, gain: 3, bypass: true, loudnessMatch: true }), x, x, 256).outL;
  assert.ok(Math.abs(rmsDb(original, SR * 7, SR * 10) - rmsDb(compressed, SR * 7, SR * 10)) < 1);
});
