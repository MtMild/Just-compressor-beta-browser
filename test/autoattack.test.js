import test from 'node:test';
import assert from 'node:assert/strict';
import { Compressor } from '../dsp/compressor.js';
import { noise, dc, run, timeToFraction } from './helpers.js';

const SR = 48000, STEP = 4800;
const mk = (o = {}) => { const c = new Compressor(SR); c.setParams({ threshold: -40, ratio: 10, knee: 0, autoGain: false, attack: 10, release: 500, ...o }); return c; };
// DC step of `over` dB above the -40 dB threshold; final reduction = -over * (1 - 1/10)
const t63 = (over, o) => {
  const x = dc(SR / 2, -40 + over, STEP);
  const { gain } = run(mk(o), x, x, 1);
  return timeToFraction(gain, SR, 0.632, -over * 0.9, STEP);
};

test('Auto Attack: a 30 dB overshoot is caught at least 10x faster than a 3 dB overshoot', () => {
  const slow = t63(3, { autoAttack: true }), fast = t63(30, { autoAttack: true });
  assert.ok(slow / fast >= 10, `3 dB: ${slow} ms, 30 dB: ${fast} ms`);
});

test('without Auto Attack the time stays at the knob value for any overshoot', () => {
  for (const over of [3, 30]) assert.ok(Math.abs(t63(over, { autoAttack: false }) - 10) < 1.5, `${over} dB`);
});

test('Auto Attack: the knob is the maximum (tiny overshoot is no slower than the knob)', () => {
  assert.ok(t63(0.5, { autoAttack: true }) <= 12);
});

test('Auto Attack with extreme settings stays finite', () => {
  const x = noise(SR, 2, 0);
  const { outL } = run(mk({ autoAttack: true, attack: 250, threshold: -60 }), x, x, 64);
  for (const v of outL) assert.ok(Number.isFinite(v));
});
