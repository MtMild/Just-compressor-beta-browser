import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGeom, dbToY, yToDb, inToX, xToIn, handles, dragTo, hitTest, RANGES, zoomWindow, WINDOW_MIN_S, WINDOW_MAX_S, WINDOW_DEFAULT_S, gridSteps } from '../ui/display-math.js';
import { sanitize } from '../dsp/params.js';

const g = makeGeom(800, 320, 72);
const P = (o = {}) => sanitize({ threshold: -24, ratio: 4, knee: 8, upWindow: 12, upAmount: 2, ...o });
const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('dB <-> pixel mappings round-trip and 0 dB is at the top line', () => {
  near(dbToY(g, 0), g.top, 1e-9);
  for (const db of [-60, -24, -6]) { near(yToDb(g, dbToY(g, db)), db, 1e-9); near(xToIn(g, inToX(g, db)), db, 1e-9); }
  assert.ok(dbToY(g, -72) <= g.h);
});

test('handles exist for threshold, knee, ratio; the Window handle only when Upward is on', () => {
  const h = handles(g, P());
  assert.deepEqual(Object.keys(h).sort(), ['knee', 'ratio', 'threshold']);
  assert.deepEqual(Object.keys(handles(g, P({ upward: true }))).sort(), ['knee', 'ratio', 'threshold', 'upWindow']);
});

test('dragging a handle to its own position returns the current value', () => {
  for (const o of [{}, { upward: true }, { threshold: -40, ratio: 8, knee: 3, upWindow: 5 }]) {
    const p = P(o), h = handles(g, p);
    near(dragTo('threshold', g, p, h.threshold.x, h.threshold.y).threshold, p.threshold);
    if (p.upward) near(dragTo('upWindow', g, p, h.upWindow.x, h.upWindow.y).upWindow, p.upWindow);
    near(dragTo('knee', g, p, h.knee.x, h.knee.y).knee, p.knee);
    near(dragTo('ratio', g, p, h.ratio.x, h.ratio.y).ratio, p.ratio, 0.05);
  }
});

test('dragging maps pixels to parameter values and clamps', () => {
  const p = P();
  near(dragTo('threshold', g, p, 100, dbToY(g, -30)).threshold, -30);
  assert.equal(dragTo('threshold', g, p, 100, dbToY(g, 20)).threshold, 12, 'the threshold can go into the plus');
  near(dragTo('threshold', g, p, 100, dbToY(g, 5)).threshold, 5);
  near(dragTo('knee', g, p, inToX(g, p.threshold + 5), 50).knee, 10);
  assert.equal(dragTo('knee', g, p, inToX(g, p.threshold - 10), 50).knee, 0);
  near(dragTo('ratio', g, P({ threshold: -20 }), 0, dbToY(g, -15)).ratio, 4);
  assert.equal(dragTo('ratio', g, P({ threshold: -20 }), 0, dbToY(g, -50)).ratio, 100);
  assert.equal(dragTo('ratio', g, P({ threshold: -20 }), 0, dbToY(g, 0)).ratio, 1);
  near(dragTo('upWindow', g, p, 0, dbToY(g, -40)).upWindow, 16);
  assert.equal(dragTo('upWindow', g, p, 0, dbToY(g, -90)).upWindow, 30);
});

test('hitTest picks the closest handle, falls back to the threshold line, else null', () => {
  const p = P({ upward: true }), h = handles(g, p);
  assert.equal(hitTest(g, p, h.knee.x, h.knee.y + 2), 'knee');
  assert.equal(hitTest(g, p, h.ratio.x + 3, h.ratio.y), 'ratio');
  assert.equal(hitTest(g, p, h.upWindow.x, h.upWindow.y), 'upWindow');
  assert.equal(hitTest(g, p, inToX(g, -40), dbToY(g, p.threshold) + 4), 'threshold');
  assert.equal(hitTest(g, p, g.plotW * 0.9, dbToY(g, p.threshold) + 4), null, 'the threshold line is only drawn (and grabbed) over the curve zone');
  assert.equal(hitTest(g, p, g.plotW * 0.9, dbToY(g, -60)), null);
});

test('curve zone is 55% of the plot width', () => {
  const g2 = makeGeom(800, 460, 36);
  assert.ok(Math.abs(g2.curveW - 0.55 * g2.plotW) < 1e-9);
});

test('the dB scale options run from 6 to 60 dB', () => {
  assert.deepEqual(RANGES, [6, 12, 18, 24, 36, 48, 60]);
});

test('wheel zoom of the envelope is continuous (no fixed steps), only affects time, and is limited at both ends', () => {
  const a = zoomWindow(WINDOW_DEFAULT_S, 40), b = zoomWindow(WINDOW_DEFAULT_S, 80);
  assert.ok(a > WINDOW_DEFAULT_S && b > a, 'a bigger wheel move gives a bigger change');
  assert.ok(zoomWindow(WINDOW_DEFAULT_S, -40) < WINDOW_DEFAULT_S, 'wheel up shows less time (zoom in)');
  assert.equal(zoomWindow(5, -1e6), WINDOW_MIN_S); assert.equal(zoomWindow(5, 1e6), WINDOW_MAX_S);
  assert.ok(Math.abs(zoomWindow(zoomWindow(8, 100), -100) - 8) < 1e-9, 'wheel up and down cancel out');
});

test('grid: labelled lines plus unlabelled lines every dB (every 2 dB on the widest scales)', () => {
  assert.deepEqual(gridSteps(36), { major: 6, minor: 1 });
  assert.deepEqual(gridSteps(24), { major: 3, minor: 1 });
  assert.deepEqual(gridSteps(60), { major: 6, minor: 2 });
  assert.deepEqual(gridSteps(6), { major: 1, minor: 1 });
});

test('when zoomed in, handles of a threshold below the visible range stay on the plot (never off screen)', () => {
  const gz = makeGeom(800, 400, 6), h = handles(gz, P({ threshold: -40 }));
  assert.ok(h.threshold.y <= gz.h - 8 && h.threshold.y >= gz.top);
  assert.equal(hitTest(gz, P({ threshold: -40 }), 100, h.threshold.y), 'threshold');
});

test('0 dB sits low enough to leave headroom above it for signal that goes into the plus', () => {
  assert.ok(g.top >= 48);
});

import { envelopePath } from '../ui/display-math.js';
const recorder = () => { const calls = []; return { calls, ...Object.fromEntries(['beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath'].map((n) => [n, (...a) => calls.push([n, ...a])])) }; };

test('envelope fill is ONE closed shape that follows the bottom edge (no stray moveTo that would close it with a diagonal)', () => {
  const pts = [[0, 100], [10, 40], [20, 90], [30, 20]], c = recorder();
  envelopePath(c, pts, 40, 300, true);
  const names = c.calls.map((k) => k[0]);
  assert.equal(names.filter((n) => n === 'moveTo').length, 1, 'a single sub-path');
  assert.deepEqual(c.calls[1], ['moveTo', 0, 300]); assert.deepEqual(c.calls[2], ['lineTo', 0, 100]);
  assert.deepEqual(c.calls.at(-2), ['lineTo', 40, 300]); assert.equal(names.at(-1), 'closePath');
  const l = recorder(); envelopePath(l, pts, 40, 300, false); // the outline: starts at the first point and is not closed
  assert.deepEqual(l.calls[1], ['moveTo', 0, 100]); assert.ok(!l.calls.some((k) => k[0] === 'closePath'));
});

test('the transfer curve starts at the left border of the display', () => {
  assert.equal(makeGeom(900, 400, 36).curveX0, 0);
  assert.equal(inToX(makeGeom(900, 400, 36), -36), 0);
});
