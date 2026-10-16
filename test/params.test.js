import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAM_SPECS, defaults, sanitize } from '../dsp/params.js';
import { dbToLin, linToDb } from '../dsp/util.js';

test('defaults() values are all within their spec ranges', () => {
  const d = defaults();
  for (const [k, spec] of Object.entries(PARAM_SPECS)) {
    if (typeof spec.default === 'number') {
      assert.ok(d[k] >= spec.min && d[k] <= spec.max, k);
    }
  }
  assert.equal(d.style, 'clean');
  assert.equal(d.autoGain, true);
  assert.equal(d.upward, false);
});

test('sanitize clamps numbers to range', () => {
  assert.equal(sanitize({ threshold: 20 }).threshold, 12);
  assert.equal(sanitize({ threshold: 10 }).threshold, 10);
  assert.equal(sanitize({ ratio: 0 }).ratio, 1);
});

test('sanitize replaces NaN with the default', () => {
  assert.equal(sanitize({ ratio: NaN }).ratio, PARAM_SPECS.ratio.default);
});

test('sanitize drops unknown keys and unknown style', () => {
  const p = sanitize({ foo: 1, style: 'nope' });
  assert.equal('foo' in p, false);
  assert.equal(p.style, 'clean');
});

test('linToDb(0) is finite and dbToLin round-trips', () => {
  assert.equal(linToDb(0), -120);
  assert.ok(Math.abs(dbToLin(linToDb(0.5)) - 0.5) < 1e-9);
});

test('v2: release starts at 0.1 ms and the new sidechain/auto params exist with the agreed ranges', () => {
  assert.equal(PARAM_SPECS.release.min, 0.1);
  assert.equal(sanitize({ release: 0.05 }).release, 0.1);
  const d = defaults();
  assert.deepEqual(
    [d.autoThreshold, d.autoAttack, d.scLevel, d.sidechainHpf, d.scLpf, d.scBandFreq, d.scBandGain, d.scBandQ, d.scListen],
    [false, false, 0, 20, 20000, 1000, 0, 1, false],
  );
  assert.equal(sanitize({ scLpf: 5 }).scLpf, 20);
  assert.equal(sanitize({ scBandQ: 20 }).scBandQ, 8);
  assert.equal(sanitize({ scLevel: -99 }).scLevel, -24);
  assert.equal(sanitize({ scBandGain: 30 }).scBandGain, 12);
  assert.equal(sanitize({ scBandFreq: 10 }).scBandFreq, 60);
  assert.equal(sanitize({ scListen: 1 }).scListen, true);
});

test('v2: Stereo Link is gone', () => {
  assert.equal('stereoLink' in PARAM_SPECS, false);
  assert.equal('stereoLink' in sanitize({ stereoLink: 50 }), false);
  assert.equal('stereoLink' in defaults(), false);
});

test('v2.2: HPF and LPF have a slope (6/12/24/48 dB per octave, default 12) and no Q', () => {
  const d = defaults();
  assert.equal(d.scHpfSlope, 12); assert.equal(d.scLpfSlope, 12);
  assert.equal('scHpfQ' in PARAM_SPECS, false); assert.equal('scLpfQ' in PARAM_SPECS, false);
  assert.equal(sanitize({ scHpfSlope: 20 }).scHpfSlope, 24); // snaps to the nearest option
  assert.equal(sanitize({ scLpfSlope: 7 }).scLpfSlope, 6);
  assert.equal(sanitize({ scHpfSlope: 1000 }).scHpfSlope, 48);
  assert.equal(sanitize({ scLpfSlope: NaN }).scLpfSlope, 12);
});

test('Floor can be set up to -6 dB (and down to -90 dB)', () => {
  assert.equal(sanitize({ upFloor: -6 }).upFloor, -6);
  assert.equal(sanitize({ upFloor: 0 }).upFloor, -6);
  assert.equal(sanitize({ upFloor: -200 }).upFloor, -90);
});
