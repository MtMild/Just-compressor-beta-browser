import test from 'node:test';
import assert from 'node:assert/strict';
import { Compressor } from '../dsp/compressor.js';
import { noise, sine } from './helpers.js';

const SR = 48000;
const mk = (o = {}) => { const c = new Compressor(SR); c.setParams({ threshold: -30, ratio: 6, knee: 6, autoGain: false, ...o }); return c; };
const feed = (c, x) => { const o = new Float32Array(128), r = new Float32Array(128); for (let i = 0; i < x.length; i += 128) c.process(x.subarray(i, i + 128), x.subarray(i, i + 128), o, r, 128); };
const sparse = () => { const x = new Float32Array(SR * 8); for (let k = 0; k < 4; k++) x.set(sine(Math.round(0.05 * SR), SR, 200, -6), k * 2 * SR + SR / 2); return x; };

test('meters report the release in effect: the knob value, or what Auto Release currently uses', () => {
  const c = mk({ release: 200 }); feed(c, sparse());
  assert.equal(c.meters.autoReleaseMs, 200);
  assert.equal(c.meters.autoAttackMs, 10);
});

test('Auto Release adapts to the material: short for rare hits, long for dense, constantly compressed sound', () => {
  const a = mk({ autoRelease: true, release: 120 }); feed(a, sparse());
  const b = mk({ autoRelease: true, release: 120 }); feed(b, noise(SR * 8, 3, -8));
  assert.ok(a.meters.autoReleaseMs < 120, `sparse ${a.meters.autoReleaseMs}`);
  assert.ok(b.meters.autoReleaseMs > 400, `dense ${b.meters.autoReleaseMs}`);
  assert.ok(a.meters.autoReleaseMs >= 25 && b.meters.autoReleaseMs <= 820, 'stays in its range');
});

test('Auto Attack reports a faster attack than the knob while a loud sound is being caught', () => {
  const c = mk({ autoAttack: true, attack: 50, threshold: -40 }); feed(c, noise(SR, 3, -3));
  assert.ok(c.meters.autoAttackMs < 25 && c.meters.autoAttackMs >= 0.1, `${c.meters.autoAttackMs}`);
});
