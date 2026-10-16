import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sine, rmsDb } from './helpers.js';

const SR = 48000;
const registry = {};
globalThis.sampleRate = SR;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { posted: [], onmessage: null, postMessage(m) { this.posted.push(m); } }; } };
globalThis.registerProcessor = (name, cls) => { registry[name] = cls; };
await import('../worklet.js');

const blockRun = (proc, x, mono = false) => {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i += 128) {
    const inp = x.slice(i, i + 128), o = [new Float32Array(128), new Float32Array(128)];
    const ret = proc.process([mono ? [inp] : [inp, inp]], [o]);
    assert.equal(ret, true);
    out.set(o[0], i);
  }
  return out;
};

test("worklet registers 'purple-comp' and applies params from the port", () => {
  assert.ok(registry['purple-comp']);
  const proc = new registry['purple-comp']();
  proc.port.onmessage({ data: { type: 'params', params: { threshold: -20, ratio: 4, knee: 0, autoGain: false } } });
  const x = sine(SR * 2, SR, 1000, -8);
  const y = blockRun(proc, x);
  const d = rmsDb(y, SR, SR * 2) - rmsDb(x, SR, SR * 2);
  assert.ok(d < -7 && d > -10, `reduction ${d}`);
});

test('worklet handles mono input and posts finite meters', () => {
  const proc = new registry['purple-comp']();
  blockRun(proc, sine(128 * 200, SR, 440, -12), true);
  const m = proc.port.posted.filter((p) => p.type === 'meters');
  assert.ok(m.length > 5);
  for (const k of ['gainDb', 'inPeakDb', 'outPeakDb', 'inDb', 'outDb']) assert.ok(Number.isFinite(m.at(-1)[k]), k);
});

test('build produces a single-file dist/index.html with the worklet inlined', () => {
  const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
  execFileSync('node', ['build.mjs'], { cwd: root });
  const f = root + '/dist/index.html';
  assert.ok(existsSync(f));
  assert.ok(statSync(f).size < 1_000_000);
  const html = readFileSync(f, 'utf8');
  assert.ok(html.includes('purple-comp'));
  assert.ok(!/<script[^>]+src=/.test(html), 'no external scripts');
});

test('build also produces dist/artifact.html: a page fragment for publishing', () => {
  const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
  execFileSync('node', ['build.mjs'], { cwd: root });
  const html = readFileSync(root + '/dist/artifact.html', 'utf8');
  assert.ok(html.includes('<title>Purple Compressor</title>'));
  assert.ok(html.includes('<meta name="claude:viewport-fit-sides" content="cover">'));
  assert.ok(!/<!doctype|<html|<head|<body/i.test(html), 'must be a fragment without document tags');
  assert.ok(html.includes('purple-comp') && html.includes('color-scheme:dark') && html.includes('--accent:'));
  assert.ok(/padding-left:\s*max\(16px,\s*env\(safe-area-inset-left/.test(html), 'side gutter');
  assert.ok(statSync(root + '/dist/artifact.html').size < 1_000_000);
});
