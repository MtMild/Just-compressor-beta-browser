import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS } from '../ui/theme.js';
import { TOOLTIP_DELAY_MS, TOOLTIPS } from '../ui/tooltip.js';
import { valueToNorm, normToValue, formatValue } from '../ui/knob.js';
import { PARAM_SPECS } from '../dsp/params.js';

const parse = (name, c) => {
  const m = /^hsla?\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*[\d.]+)?\s*\)$/.exec(c);
  assert.ok(m, `${name}: unparsable colour ${c}`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
};
const isPurple = ({ h }) => h >= 255 && h <= 295;
const isRed = ({ h, s }) => s >= 40 && (h >= 350 || h <= 10);
const isNeutral = ({ s }) => s < 8;

test('every colour is purple (255-295), red (350-10) or neutral (saturation < 8%)', () => {
  assert.ok(Object.keys(COLORS).length >= 20);
  for (const [name, c] of Object.entries(COLORS)) {
    const k = parse(name, c);
    assert.ok(isPurple(k) || isRed(k) || isNeutral(k), `${name} ${c} is not purple, red or neutral`);
  }
});

test('palette v2 tokens: purple main, red details, neutral greys for the zone and sidechain EQ', () => {
  for (const t of ['red', 'redFill', 'redDim', 'white', 'grey1', 'grey2', 'grey3', 'zoneBg', 'scBg']) assert.ok(COLORS[t], t);
  for (const t of ['red', 'redFill', 'redDim']) assert.ok(isRed(parse(t, COLORS[t])), `${t} must be red`);
  for (const t of ['white', 'grey1', 'grey2', 'grey3', 'zoneBg', 'scBg', 'text', 'textDim']) assert.ok(isNeutral(parse(t, COLORS[t])), `${t} must be neutral`);
  assert.ok(Object.entries(COLORS).filter(([, c]) => isPurple(parse('x', c)) && parse('x', c).s >= 8).length >= 10, 'purple stays the main colour');
  for (const t of ['gr', 'grFill', 'clip']) assert.ok(isRed(parse(t, COLORS[t])), `${t} is a red detail`);
});

test('tooltip delay is 2500 ms and texts are short English sentences', () => {
  assert.equal(TOOLTIP_DELAY_MS, 2500);
  const keys = Object.keys(TOOLTIPS);
  assert.equal(keys.length, 37);
  for (const [k, t] of Object.entries(TOOLTIPS)) {
    assert.ok(t.split(/\s+/).length <= 32, `${k} is too long: ${t}`);
    assert.ok(/^[\x20-\x7E]+$/.test(t), `${k} must be plain English/ASCII`);
  }
  for (const id of ["threshold", "ratio", "knee", "attack", "release", "upward", "bypass", "gain", "autoRelease", "autoThreshold", "autoAttack", "scLevel", "scLpf", "scBand", "scListen", "scSlope", "oversampling", "scale", "settings", "lowLatency", "scSource", "scOn", "unity", "tempoSync"]) assert.ok(TOOLTIPS[id], id);
});

test('knob value mapping round-trips (linear and logarithmic) and clamps', () => {
  for (const id of ['threshold', 'ratio', 'attack', 'release', 'sidechainHpf', 'upAmount']) {
    const spec = PARAM_SPECS[id];
    for (const n of [0, 0.25, 0.5, 1]) {
      const v = normToValue(spec, n);
      assert.ok(v >= spec.min - 1e-9 && v <= spec.max + 1e-9, id);
      assert.ok(Math.abs(valueToNorm(spec, v) - n) < 1e-9, `${id} n=${n}`);
    }
    assert.equal(normToValue(spec, 2), spec.max);
    assert.equal(normToValue(spec, -1), spec.min);
  }
  // release spans 5..2500 ms: log mapping puts the middle near the geometric mean
  assert.ok(Math.abs(normToValue(PARAM_SPECS.release, 0.5) - Math.sqrt(0.1 * 2500)) < 1);
});

test('formatValue gives readable text with units', () => {
  assert.equal(formatValue('threshold', PARAM_SPECS.threshold, -24), '-24.0 dB');
  assert.equal(formatValue('ratio', PARAM_SPECS.ratio, 3), '3.0:1');
  assert.equal(formatValue('attack', PARAM_SPECS.attack, 10), '10 ms');
  assert.equal(formatValue('attack', PARAM_SPECS.attack, 0.5), '0.5 ms');
  assert.equal(formatValue('mix', PARAM_SPECS.mix, 35), '35%');
  assert.equal(formatValue('sidechainHpf', PARAM_SPECS.sidechainHpf, 80), '80 Hz');
  assert.equal(formatValue('scBandQ', PARAM_SPECS.scBandQ, 1), '1.0');
});

import { ringColor } from '../ui/knob.js';
test('the Threshold ring is a level meter: green when quiet, then yellow, orange, red at 0 dB and beyond', () => {
  const hue = (db) => Number(/hsl\((\d+)/.exec(ringColor(db))[1]);
  assert.ok(hue(-60) >= 120 && hue(-40) >= 120, 'green when quiet');
  const seq = [-30, -20, -12, -8, -4, -2, 0, 6].map(hue);
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] <= seq[i - 1], `hue never goes back: ${seq}`);
  assert.ok(hue(-12) > 40 && hue(-12) < 70, 'yellow around -12 dB');
  assert.ok(hue(0) <= 5 && hue(6) <= 5, 'red at 0 dB and above');
});
