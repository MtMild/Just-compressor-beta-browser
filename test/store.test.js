import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../ui/store.js';
import { PRESETS } from '../dsp/presets.js';

const mk = () => { let t = 0; const calls = []; const s = createStore({ now: () => t, onChange: (p, keys) => calls.push(keys) }); return { s, calls, tick: (ms) => { t += ms; } }; };

test('set clamps through sanitize and notifies', () => {
  const { s, calls } = mk();
  s.set('threshold', 20);
  assert.equal(s.params.threshold, 12);
  assert.deepEqual(calls.at(-1), ['threshold']);
});

test('undo coalesces rapid changes of the same key and separates different keys', () => {
  const { s, tick } = mk();
  s.set('ratio', 5); tick(100); s.set('ratio', 6); tick(100); s.set('ratio', 7); // one step
  tick(100); s.set('threshold', -40);                                           // second step
  s.undo(); assert.equal(s.params.threshold, -24); assert.equal(s.params.ratio, 7);
  s.undo(); assert.equal(s.params.ratio, 3);
  assert.equal(s.canUndo, false);
  s.redo(); assert.equal(s.params.ratio, 7); assert.equal(s.canRedo, true);
  s.redo(); assert.equal(s.params.threshold, -40);
});

test('the same key after a pause is a new undo step; a new change clears redo', () => {
  const { s, tick } = mk();
  s.set('ratio', 5); tick(1000); s.set('ratio', 8);
  s.undo(); assert.equal(s.params.ratio, 5);
  s.set('knee', 3); assert.equal(s.canRedo, false);
});

test('loadPreset resets unlisted params, tracks name and modified flag, wraps next/prev', () => {
  const { s } = mk();
  s.set('gain', 5);
  s.loadPreset(2);
  assert.equal(s.presetName, 'Kick Punch');
  const p = s.params;
  assert.deepEqual([p.style, p.threshold, p.ratio, p.attack, p.release, p.gain, p.upward], ['punch', -20, 5, 30, 60, 0, false]);
  assert.equal(s.modified, false);
  s.set('threshold', -30); assert.equal(s.modified, true);
  s.loadPreset(9); s.nextPreset(); assert.equal(s.presetIndex, 0);
  s.prevPreset(); assert.equal(s.presetIndex, PRESETS.length - 1);
});

test('A/B: B starts as a copy of A, slots keep their own settings, Copy overwrites the other', () => {
  const { s } = mk();
  s.set('threshold', -30);
  s.ab.switch('B'); assert.equal(s.ab.current, 'B'); assert.equal(s.params.threshold, -30);
  s.set('threshold', -10);
  s.ab.switch('A'); assert.equal(s.params.threshold, -30);
  s.ab.switch('B'); assert.equal(s.params.threshold, -10);
  s.ab.copyToOther(); s.ab.switch('A'); assert.equal(s.params.threshold, -10);
});

test('choosing the Upward style turns the Upward switch on; leaving the style keeps it', () => {
  const { s } = mk();
  s.set('style', 'upward'); assert.equal(s.params.upward, true);
  s.set('style', 'clean'); assert.equal(s.params.upward, true);
});

test('Upward is on exactly when Amount is above 1:1 (the header lamp only shows state); the Upward style picks Amount 1.5', () => {
  const { s } = mk();
  assert.equal(s.params.upward, false); assert.equal(s.params.upAmount, 1);
  s.set('upAmount', 2); assert.equal(s.params.upward, true);
  s.set('upAmount', 1); assert.equal(s.params.upward, true, 'lowering Amount does not switch Upward off');
  s.set('upward', false); assert.equal(s.params.upward, false); const before = { ...s.params }; s.set('upward', true); assert.deepEqual({ ...s.params, upward: false }, { ...before, upward: false }, 'the switch changes no knob');
  s.set('style', 'upward'); assert.equal(s.params.upward, true); assert.equal(s.params.upAmount, 1.5);
});

test('oversampling is a global setting: presets and A/B switching keep it', () => {
  const { s } = mk();
  s.set('oversampling', 4); s.loadPreset(2); assert.equal(s.params.oversampling, 4);
  s.ab.switch('B'); assert.equal(s.params.oversampling, 4);
  s.set('oversampling', 2); s.ab.switch('A'); assert.equal(s.params.oversampling, 2);
});

test('Listen is a monitoring state like Bypass: presets and A/B switching keep it as it is', () => {
  const { s } = mk();
  s.set('scListen', true); s.set('bypass', true);
  s.loadPreset(2);
  assert.equal(s.params.scListen, true); assert.equal(s.params.bypass, true);
  s.ab.switch('B'); s.set('scListen', false);
  s.ab.switch('A');
  assert.equal(s.params.scListen, false, 'switching A/B must not change monitoring');
  s.set('scListen', true); s.ab.switch('B');
  assert.equal(s.params.scListen, true);
});
