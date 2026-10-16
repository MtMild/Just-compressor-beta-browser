import test from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, styleDefaults } from '../dsp/styles.js';
import { PRESETS } from '../dsp/presets.js';
import { STYLE_IDS, sanitize } from '../dsp/params.js';
import { Compressor } from '../dsp/compressor.js';
import { sine, run } from './helpers.js';

const SR = 48000;

test('STYLES has exactly the 9 ids with labels', () => {
  assert.deepEqual(Object.keys(STYLES).sort(), [...STYLE_IDS].sort());
  assert.equal(STYLE_IDS.length, 9);
  for (const s of Object.values(STYLES)) assert.ok(typeof s.label === 'string' && s.label.length > 0);
  assert.equal(STYLES.upward.upwardDefault, true);
  for (const id of STYLE_IDS) if (id !== 'upward') assert.equal(STYLES[id].upwardDefault, false);
});

test('PRESETS: 10 presets named as in the spec, in range, Upward off', () => {
  assert.deepEqual(PRESETS.map((p) => p.name), [
    'Vocal Control', 'Vocal Smash', 'Kick Punch', 'Snare Crack', 'Bass Tighten',
    'Drum Bus Glue', 'Parallel Drum Crush', 'Mix Bus Glue', 'Mastering Gentle', 'Acoustic Guitar Even',
  ]);
  for (const { name, params } of PRESETS) {
    const clean = sanitize(params);
    for (const [k, v] of Object.entries(params)) assert.equal(clean[k], v, `${name}.${k} out of range`);
    assert.ok(!params.upward, `${name} must have Upward off`);
    assert.ok(STYLE_IDS.includes(params.style), name);
  }
  const by = Object.fromEntries(PRESETS.map((p) => [p.name, p.params]));
  assert.deepEqual([by['Kick Punch'].style, by['Kick Punch'].threshold, by['Kick Punch'].ratio, by['Kick Punch'].attack, by['Kick Punch'].release], ['punch', -20, 5, 30, 60]);
  assert.equal(by['Parallel Drum Crush'].mix, 35);
  assert.equal(by['Bass Tighten'].sidechainHpf, 80);
  assert.equal(by['Mix Bus Glue'].ratio, 1.5);
});

function clickTrainGain(style) {
  const n = SR, x = new Float32Array(n);
  for (let c = 0; c < 10; c++) x.set(sine(240, SR, 1000, -6), c * 4800 + 2400);
  const comp = new Compressor(SR);
  comp.setParams({ threshold: -24, ratio: 4, knee: 6, attack: 10, release: 150, autoGain: false, style });
  return run(comp, x, x, 1).gain;
}
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

test('styles shape gain reduction differently on a click train', () => {
  const clean = clickTrainGain('clean');
  for (const id of ['opto', 'pump', 'bus']) {
    assert.ok(maxDiff(clean, clickTrainGain(id)) > 0.5, `${id} should differ from clean`);
  }
});

test('every style produces finite output and defaults helper is consistent', () => {
  for (const id of STYLE_IDS) {
    const g = clickTrainGain(id);
    for (const v of g) assert.ok(Number.isFinite(v), id);
    assert.equal(styleDefaults(id).upward, STYLES[id].upwardDefault);
  }
});
