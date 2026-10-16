import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES, noteToMs } from '../dsp/tempo.js';
import { Compressor } from '../dsp/compressor.js';
import { sanitize, PARAM_SPECS } from '../dsp/params.js';
import { noise } from './helpers.js';

const SR = 48000;

test('note values: 1/4 at 120 BPM is 500 ms; dotted is 1.5x, triplet 2/3; the list is ordered from short to long', () => {
  const ms = (label, bpm = 120) => noteToMs(NOTES.findIndex((n) => n.label === label), bpm);
  assert.equal(ms('1/4'), 500); assert.equal(ms('1/8'), 250); assert.equal(ms('1/16'), 125);
  assert.ok(Math.abs(ms('1/4D') - 750) < 1e-9 && Math.abs(ms('1/4T') - 500 * 2 / 3) < 1e-9);
  assert.equal(ms('1/4', 60), 1000); assert.equal(ms('1/4', 240), 250);
  for (let i = 1; i < NOTES.length; i++) assert.ok(NOTES[i].beats > NOTES[i - 1].beats, NOTES[i].label);
  assert.equal(noteToMs(NOTES.length - 1, 20), 2500, 'never longer than the Release knob allows'); // 1 bar at 20 BPM would be 12 s
  assert.equal(noteToMs(0, 300) >= 0.1, true);
});

test('tempo sync parameters: off by default, BPM 20-300, a note index that snaps to the list', () => {
  const d = sanitize({});
  assert.equal(d.tempoSync, false); assert.equal(d.bpm, 120); assert.equal(typeof d.releaseNote, 'number');
  assert.equal(PARAM_SPECS.bpm.min, 20); assert.equal(PARAM_SPECS.bpm.max, 300);
  assert.equal(sanitize({ bpm: 1000 }).bpm, 300); assert.equal(sanitize({ bpm: 5 }).bpm, 20);
  assert.equal(sanitize({ releaseNote: 99 }).releaseNote, NOTES.length - 1); assert.equal(sanitize({ releaseNote: 2.4 }).releaseNote, 2);
});

const run = (o) => { const c = new Compressor(SR); c.setParams({ threshold: -30, ratio: 6, knee: 6, autoGain: false, ...o }); const x = noise(SR * 3, 4, -12), y = new Float32Array(x.length), r = new Float32Array(128);
  for (let i = 0; i < x.length; i += 128) { const L = x.subarray(i, i + 128); c.process(L, L, y.subarray(i, i + 128), r, 128); } return { y, c }; };

test('with Tempo Sync the release follows the project tempo exactly like the same release typed in', () => {
  const i = NOTES.findIndex((n) => n.label === '1/8');
  const a = run({ tempoSync: true, releaseNote: i, bpm: 120, release: 40 }), b = run({ tempoSync: false, release: 250, attack: 15.625 }); // Tempo Sync syncs the attack too (default note 1/128 = 15.625 ms at 120 BPM)
  assert.equal(a.c.meters.autoReleaseMs, 250);
  for (let k = 0; k < a.y.length; k += 211) assert.equal(a.y[k], b.y[k]);
  assert.equal(run({ tempoSync: true, releaseNote: i, bpm: 60 }).c.meters.autoReleaseMs, 500, 'half the tempo, twice the time');
  assert.equal(run({ tempoSync: false, release: 99 }).c.meters.autoReleaseMs, 99, 'sync off: the knob');
});

test('Auto Release ignores Tempo Sync (it chooses its own time)', () => {
  const m = run({ tempoSync: true, releaseNote: 8, bpm: 90, autoRelease: true }).c.meters.autoReleaseMs;
  assert.ok(m >= 29 && m <= 801, `${m}`);
});

import { ATTACK_NOTES } from '../dsp/tempo.js';

test('Attack has its own, finer note list and is capped at the Attack knob maximum', () => {
  for (let i = 1; i < ATTACK_NOTES.length; i++) assert.ok(ATTACK_NOTES[i].beats > ATTACK_NOTES[i - 1].beats, ATTACK_NOTES[i].label);
  const idx = (l) => ATTACK_NOTES.findIndex((n) => n.label === l);
  assert.equal(noteToMs(idx('1/64'), 120, ATTACK_NOTES, 250), 31.25); assert.equal(noteToMs(idx('1/16'), 120, ATTACK_NOTES, 250), 125);
  assert.equal(noteToMs(ATTACK_NOTES.length - 1, 30, ATTACK_NOTES, 250), 250);
  assert.equal(sanitize({}).tempoSync, false); assert.equal(PARAM_SPECS.attackNote.max, ATTACK_NOTES.length - 1);
  assert.equal(sanitize({ attackNote: 99 }).attackNote, ATTACK_NOTES.length - 1);
});

test('with Tempo Sync the attack follows the tempo exactly like the same attack typed in; Auto Attack keeps the Attack knob as its maximum', () => {
  const i = ATTACK_NOTES.findIndex((n) => n.label === '1/64');
  const a = run({ tempoSync: true, attackNote: i, bpm: 120, attack: 3, release: 120 }), b = run({ tempoSync: false, attack: 31.25, release: 250 }); // the synced release defaults to 1/8 = 250 ms at 120 BPM
  assert.equal(a.c.meters.autoAttackMs, 31.25);
  for (let k = 0; k < a.y.length; k += 211) assert.equal(a.y[k], b.y[k]);
  assert.equal(run({ tempoSync: true, attackNote: i, bpm: 60 }).c.meters.autoAttackMs, 62.5);
  const auto = run({ tempoSync: true, attackNote: i, bpm: 120, attack: 40, autoAttack: true, threshold: -40 }).c.meters.autoAttackMs;
  assert.ok(auto <= 40 && auto >= 0.1, `Auto Attack never exceeds the knob (${auto})`);
});
