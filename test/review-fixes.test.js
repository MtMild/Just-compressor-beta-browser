import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Compressor } from '../dsp/compressor.js';
import { sine, dc, peakDb, run } from './helpers.js';

const SR = 48000;
const here = path.dirname(fileURLToPath(import.meta.url));

test('changing look-ahead while audio plays does not click', () => {
  const n = SR, x = sine(n, SR, 211, -10);
  const c = new Compressor(SR); c.setParams({ threshold: 0, autoGain: false, lookahead: 0 });
  const out = new Float32Array(n), tmp = new Float32Array(n);
  for (let i = 0; i < n; i += 128) {
    if (i === 128 * 100) c.setParams({ lookahead: 3 });
    c.process(x.subarray(i, i + 128), x.subarray(i, i + 128), out.subarray(i, i + 128), tmp.subarray(i, i + 128), Math.min(128, n - i));
  }
  const jump = (a, b) => { let m = 0; for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(out[i] - out[i - 1])); return m; };
  const steady = jump(0, 128 * 90), around = jump(128 * 95, n - 1);
  assert.ok(around < steady * 1.6, `jump ${around} vs steady ${steady}`);
  assert.equal(c.latencySamples, Math.round(0.003 * SR));
});

test('Upward with no look-ahead: a loud hit after a quiet part is not boosted into clipping', () => {
  const x = new Float32Array(SR * 2); x.set(dc(SR, -50), 0); x.set(dc(SR, -6), SR);
  const cfg = { threshold: -20, ratio: 4, knee: 0, autoGain: false, upWindow: 12, upAmount: 3, upMaxBoost: 12, upFloor: -80, attack: 10, lookahead: 0 };
  const up = new Compressor(SR); up.setParams({ ...cfg, upward: true });
  const dn = new Compressor(SR); dn.setParams({ ...cfg, upward: false });
  const pu = peakDb(run(up, x, x, 1).outL, SR, SR * 2), pd = peakDb(run(dn, x, x, 1).outL, SR, SR * 2);
  assert.ok(pu <= pd + 1.0, `upward peak ${pu} vs downward-only ${pd}`);
  assert.ok(pu < 0, `must not exceed 0 dBFS, got ${pu}`);
});

test('two-stage release: the slow stage is not dragged at attack speed', () => {
  const c = new Compressor(SR);
  c.setParams({ threshold: -30, ratio: 6, knee: 0, autoGain: false, style: 'opto', release: 500, attack: 10 });
  const loud = dc(SR, -6), quiet = new Float32Array(Math.round(0.3 * SR));
  run(c, loud, loud, 128); run(c, quiet, quiet, 128);
  const before = c.gS[0];
  const mid = dc(Math.round(0.05 * SR), -14); // target lies between the two stages
  run(c, mid, mid, 128);
  assert.ok(Math.abs(c.gS[0] - before) < 1.5, `slow stage moved ${c.gS[0] - before} dB in 50 ms`);
});

test('process() does not allocate in steady state (no GC scavenges after warm-up)', () => {
  const script = `
    import { Compressor } from ${JSON.stringify(path.join(here, '../dsp/compressor.js'))};
    const SR = 48000, n = SR * 20, x = new Float32Array(n).map((_, i) => 0.3 * Math.sin(i * 0.05)), o = new Float32Array(n), o2 = new Float32Array(n);
    const c = new Compressor(SR); c.setParams({ style: 'vocal', upward: true });
    const views = []; for (let i = 0; i < n; i += 128) views.push([x.subarray(i, i + 128), o.subarray(i, i + 128), o2.subarray(i, i + 128)]);
    const warm = (SR * 4) / 128;
    for (let b = 0; b < warm; b++) c.process(views[b][0], views[b][0], views[b][1], views[b][2], 128); // warm-up: JIT compiles the hot loop
    console.log('START'); for (let b = warm; b < views.length; b++) c.process(views[b][0], views[b][0], views[b][1], views[b][2], 128); console.log('END');`;
  const r = spawnSync(process.execPath, ['--trace-gc', '--input-type=module', '-e', script], { encoding: 'utf8' });
  const out = r.stdout.split('START')[1].split('END')[0];
  const gcs = (out.match(/Scavenge|Mark-Compact|Mark-sweep/g) || []).length;
  assert.ok(gcs <= 1, `${gcs} GC events while processing 16 s of audio after warm-up`);
});
