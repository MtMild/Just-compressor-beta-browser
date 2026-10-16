import test from 'node:test';
import assert from 'node:assert/strict';
import { formatGr, formatOut, createReadout } from '../ui/meters.js';

test('formatGr: one decimal, explicit sign for boost, 0.0 near zero', () => {
  assert.equal(formatGr(-6.234), '-6.2');
  assert.equal(formatGr(-0.01), '0.0');
  assert.equal(formatGr(0), '0.0');
  assert.equal(formatGr(3.14), '+3.1');
  assert.equal(formatGr(-12), '-12.0');
});

test('formatOut: one decimal, -inf below -99 dB', () => {
  assert.equal(formatOut(-1.34), '-1.3');
  assert.equal(formatOut(-120), '-inf');
  assert.equal(formatOut(0), '0.0');
});

test('readout updates at most every interval and shows the extreme of the window, so digits do not flicker', () => {
  const r = createReadout(250, Math.min, -0);
  assert.equal(r.push(-3, 0), -3); // first value shows immediately
  assert.equal(r.push(-9, 50), -3); assert.equal(r.push(-5, 200), -3); // held
  assert.equal(r.push(-4, 260), -9); // window closed: deepest value of the window
  assert.equal(r.push(-1, 300), -9);
  assert.equal(r.push(-2, 520), -2); // new window (-1, -2): deepest is -2
});

test('output readout takes the loudest value in the window', () => {
  const r = createReadout(250, Math.max, -120);
  r.push(-20, 0); r.push(-6, 100); r.push(-30, 200);
  assert.equal(r.push(-30, 300), -6);
});
