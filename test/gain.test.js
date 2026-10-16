import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGainDb } from '../dsp/gain.js';
import { sanitize } from '../dsp/params.js';

const P = (o) => sanitize({ threshold: -20, ratio: 4, knee: 0, ...o });
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('hard knee: no gain change at or below threshold', () => {
  near(computeGainDb(-30, P()), 0);
  near(computeGainDb(-20, P()), 0);
});

test('hard knee: 0 dB input at -20 thr, 4:1 gives -15 dB', () => {
  near(computeGainDb(0, P()), -15);
});

test('soft knee: -0.9375 dB at the threshold and continuous at knee edges', () => {
  const p = P({ knee: 10 });
  near(computeGainDb(-20, p), -0.9375);
  near(computeGainDb(-25.0001, p), 0, 0.001);
  near(computeGainDb(-24.9999, p), 0, 0.001);
  near(computeGainDb(-15.0001, p), -3.75, 0.001);
  near(computeGainDb(-14.9999, p), -3.75, 0.001);
});

test('range caps the reduction', () => {
  near(computeGainDb(0, P({ range: 6 })), -6);
});

test('ratio 1 never changes gain', () => {
  for (const x of [-60, -20, 0]) near(computeGainDb(x, P({ ratio: 1 })), 0);
});
