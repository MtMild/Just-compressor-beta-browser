import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../dsp/params.js';
import { makeScGeom, freqToX, xToFreq, gainToY, yToGain, responseDb, scNodes, scHit, scDragTo, scWheel, scWheelNode, scReset, spectrumLevel } from '../ui/sc-math.js';

const g = makeScGeom(600, 200);
const P = (o = {}) => sanitize(o);
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b} (±${eps})`);

test('frequency and gain mappings round-trip; 20 Hz..20 kHz spans the plot, 0 dB is the middle', () => {
  for (const f of [20, 100, 1000, 20000]) near(xToFreq(g, freqToX(g, f)) / f, 1, 1e-9);
  for (const db of [-24, 0, 12, 24]) near(yToGain(g, gainToY(g, db)), db, 1e-9);
  assert.ok(freqToX(g, 20) < freqToX(g, 20000));
  near(gainToY(g, 0), g.h / 2, 1e-9);
});

test('responseDb matches the filter shapes (same coefficients as the DSP)', () => {
  const sr = 48000;
  near(responseDb(P({ sidechainHpf: 1000 }), 1000, sr), -3.01, 0.5);
  near(responseDb(P({ sidechainHpf: 1000 }), 500, sr), -12.3, 1.5);
  near(responseDb(P({ scLpf: 1000 }), 1000, sr), -3.01, 0.5);
  near(responseDb(P({ scBandFreq: 1000, scBandGain: 12, scBandQ: 1 }), 1000, sr), 12, 0.2);
  near(responseDb(P({ scBandFreq: 1000, scBandGain: 12, scBandQ: 1 }), 10, sr), 0, 0.5);
  for (const f of [30, 300, 3000, 15000]) assert.equal(responseDb(P(), f, sr), 0);
});

test('nodes: dragging each node to its own position returns its parameter', () => {
  for (const o of [{}, { sidechainHpf: 150, scLpf: 8000, scBandFreq: 2500, scBandGain: 6 }]) {
    const p = P(o), n = scNodes(g, p);
    near(scDragTo('hpf', g, p, n.hpf.x, n.hpf.y).sidechainHpf / p.sidechainHpf, 1, 0.01);
    near(scDragTo('lpf', g, p, n.lpf.x, n.lpf.y).scLpf / p.scLpf, 1, 0.01);
    const b = scDragTo('band', g, p, n.band.x, n.band.y);
    near(b.scBandFreq / p.scBandFreq, 1, 0.01); near(b.scBandGain, p.scBandGain, 0.05);
  }
});

test('dragging clamps to the parameter ranges and snaps the LPF to off near 20 kHz', () => {
  const p = P();
  near(scDragTo('hpf', g, p, freqToX(g, 5000), 0).sidechainHpf / 5000, 1, 0.01); // no longer stops at 1 kHz
  near(scDragTo('hpf', g, p, freqToX(g, 15000), 0).sidechainHpf / 15000, 1, 0.01);
  assert.equal(scDragTo('hpf', g, p, freqToX(g, 20), 0).sidechainHpf, 20);
  near(scDragTo('lpf', g, p, freqToX(g, 200), 0).scLpf / 200, 1, 0.01); // nor at 1 kHz
  assert.equal(scDragTo('lpf', g, p, freqToX(g, 19000), 0).scLpf, 20000);
  // they never cross: HPF stops below an active LPF, LPF above an active HPF
  const both = P({ sidechainHpf: 500, scLpf: 4000 });
  near(scDragTo('hpf', g, both, freqToX(g, 9000), 0).sidechainHpf, 4000 / 1.25, 1);
  near(scDragTo('lpf', g, both, freqToX(g, 100), 0).scLpf, 500 * 1.25, 1);
  const b = scDragTo('band', g, p, freqToX(g, 20000), gainToY(g, 24));
  assert.deepEqual([b.scBandFreq, b.scBandGain], [12000, 12]);
});

test('hit test picks the nearest node or null; wheel changes Q within 0.3..8; reset restores defaults', () => {
  const p = P({ scBandGain: 6 }), n = scNodes(g, p);
  assert.equal(scHit(g, p, n.band.x + 2, n.band.y - 2), 'band');
  assert.equal(scHit(g, p, n.hpf.x, n.hpf.y), 'hpf');
  assert.equal(scHit(g, p, n.lpf.x, n.lpf.y), 'lpf');
  assert.equal(scHit(g, p, g.w / 2, 3), null);
  assert.ok(scWheel(p, -100).scBandQ > 1 && scWheel(p, 100).scBandQ < 1);
  assert.equal(scWheel(P({ scBandQ: 8 }), -100).scBandQ, 8);
  assert.equal(scWheel(P({ scBandQ: 0.3 }), 100).scBandQ, 0.3);
  assert.deepEqual(scReset('hpf'), { sidechainHpf: 20, scHpfSlope: 12 });
  assert.deepEqual(scReset('lpf'), { scLpf: 20000, scLpfSlope: 12 });
  assert.deepEqual(scReset('band'), { scBandGain: 0, scBandFreq: 1000, scBandQ: 1 });
});

test('filter slopes follow Butterworth (-3 dB at the cutoff) and never create a resonance peak', () => {
  const sr = 48000, at = (o, f) => responseDb(P(o), f, sr);
  for (const [slope, db500] of [[6, -7.0], [12, -12.3], [24, -24.1], [48, -48.2]]) {
    near(at({ sidechainHpf: 1000, scHpfSlope: slope }, 1000), -3.01, 0.6);
    near(at({ sidechainHpf: 1000, scHpfSlope: slope }, 500), db500, Math.max(1, Math.abs(db500) * 0.06));
    near(at({ scLpf: 1000, scLpfSlope: slope }, 1000), -3.01, 0.6);
    near(at({ scLpf: 1000, scLpfSlope: slope }, 2000), db500, Math.max(1, Math.abs(db500) * 0.12));
    for (let f = 25; f < 20000; f *= 1.07) {
      assert.ok(at({ sidechainHpf: 800, scHpfSlope: slope }, f) <= 0.05, `HPF ${slope} dB/oct peaks at ${f} Hz`);
      assert.ok(at({ scLpf: 3000, scLpfSlope: slope }, f) <= 0.05, `LPF ${slope} dB/oct peaks at ${f} Hz`);
    }
  }
});

test('the wheel over the HPF/LPF nodes steps through the slopes; over the band it changes Q', () => {
  assert.equal(scWheelNode('hpf', P(), -100).scHpfSlope, 24);
  assert.equal(scWheelNode('hpf', P(), 100).scHpfSlope, 6);
  assert.equal(scWheelNode('lpf', P({ scLpfSlope: 48 }), -100).scLpfSlope, 48);
  assert.equal(scWheelNode('lpf', P({ scLpfSlope: 6 }), 100).scLpfSlope, 6);
  assert.ok(scWheelNode('band', P(), -100).scBandQ > 1);
});

test('the gain axis bends smoothly below -12 dB so steep low cuts curve instead of running flat along the bottom', () => {
  let prev = gainToY(g, -12);
  for (const db of [-18, -24, -36, -48, -72, -96]) {
    const y = gainToY(g, db);
    assert.ok(y > prev + 3, `${db} dB is still clearly below the previous point (${y} vs ${prev}): no flat floor`);
    prev = y;
  }
  assert.ok(gainToY(g, -36) < g.h, 'a 36 dB cut is still on the canvas');
  near(gainToY(g, -6) - gainToY(g, 0), gainToY(g, 0) - gainToY(g, 6), 1e-9); // symmetric, linear in the middle
  for (const db of [-60, -30, 18, 30]) near(yToGain(g, gainToY(g, db)), db, 1e-6);
});

test('spectrumLevel interpolates smoothly between wide low-frequency bins (no flat steps) and takes the maximum where bins are dense', () => {
  const data = new Float32Array(4096); for (let k = 0; k < 4096; k++) data[k] = -80 + k * 0.01; // slow ramp
  const nyq = 24000, binHz = nyq / 4096;
  const a = spectrumLevel(data, nyq, 20, 20.5), b = spectrumLevel(data, nyq, 26, 26.5), c = spectrumLevel(data, nyq, 32, 32.5);
  assert.ok(a < b && b < c, `strictly rising: ${a} ${b} ${c}`);
  near(spectrumLevel(data, nyq, 2 * binHz, 2 * binHz), data[2], 1e-6);
  near(spectrumLevel(data, nyq, 2.5 * binHz, 2.5 * binHz), (data[2] + data[3]) / 2, 1e-6);
  const spiky = new Float32Array(4096).fill(-90); spiky[2000] = -10;
  assert.equal(spectrumLevel(spiky, nyq, 2000 * binHz - 400, 2000 * binHz + 400), -10);
  assert.equal(spectrumLevel(new Float32Array(4096).fill(-Infinity), nyq, 100, 110), -100);
});
