// Browser checks (Playwright + preinstalled Chromium). Run: npm run build && node test/ui.spec.mjs
import assert from 'node:assert/strict';
import { startServer, launch, wavBuffer } from './browser.mjs';

const results = [];
export async function check(name, fn) {
  try { await fn(); results.push([name, true]); console.log('ok  -', name); }
  catch (e) { results.push([name, false]); console.log('FAIL-', name, '\n     ', e.message); }
}

const { server, url } = await startServer();
const browser = await launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.setDefaultTimeout(6000);
await page.goto(url);

await check('page loads without console errors', async () => {
  await page.waitForSelector('#app');
  assert.deepEqual(errors, []);
});

await check('no AudioContext exists before a user gesture', async () => {
  assert.equal(await page.evaluate(() => window.__audioState()), 'not-started');
});

await check('loading a WAV and pressing Play starts playback with live meters', async () => {
  await page.setInputFiles('#file', { name: 'tone.wav', mimeType: 'audio/wav', buffer: wavBuffer(2) });
  await page.waitForFunction(() => window.__engineState && window.__engineState().duration > 1.5, null, { timeout: 8000 });
  await page.click('#play');
  await page.waitForFunction(() => window.__audioState() === 'running', null, { timeout: 8000 });
  await page.waitForFunction(() => window.__engineState().position > 0.2, null, { timeout: 8000 });
  const m = await page.evaluate(() => window.__lastMeters);
  assert.ok(m && Number.isFinite(m.inDb) && m.inDb > -30, JSON.stringify(m));
  await page.click('#pause');
});

await check('an undecodable file shows a friendly error and the page stays usable', async () => {
  await page.setInputFiles('#file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello, not audio') });
  await page.waitForSelector('#error:not(:empty)', { timeout: 8000 });
  assert.equal((await page.textContent('#error')).trim(), 'Could not read this file. Try WAV or MP3.');
  await page.setInputFiles('#file', { name: 'tone2.wav', mimeType: 'audio/wav', buffer: wavBuffer(1) });
  await page.waitForFunction(() => window.__engineState().duration > 0.5 && window.__engineState().duration < 1.5, null, { timeout: 8000 });
  assert.equal((await page.textContent('#error')).trim(), '');
});

// ---- Display and meters ----
const box = async () => page.locator('canvas.display').boundingBox();
const geom = () => page.evaluate(() => window.__geom());
const params = () => page.evaluate(() => window.__params());
const dy = (g, db) => g.top + -db * g.pxPerDb;
const dxIn = (g, db) => g.curveX0 + ((db + g.rangeDb) / g.rangeDb) * g.curveW;

await check('display canvas and meters exist with a real size', async () => {
  const b = await box(); assert.ok(b && b.width > 300 && b.height > 150, JSON.stringify(b));
  const m = await page.locator('canvas.meters').boundingBox(); assert.ok(m && m.width > 20 && m.height > 100);
});

await check('dragging the threshold line changes the threshold param', async () => {
  const b = await box(), g = await geom(), p = await params();
  const tx = b.x + g.curveW * 0.35; // the dashed threshold line is drawn over the curve zone only
  await page.mouse.move(tx, b.y + dy(g, p.threshold));
  await page.mouse.down(); await page.mouse.move(tx, b.y + dy(g, -30), { steps: 6 }); await page.mouse.up();
  assert.ok(Math.abs((await params()).threshold + 30) < 1.2, JSON.stringify(await params()));
});

await check('dragging the knee handle changes the knee param', async () => {
  const b = await box(), g = await geom(), h = await page.evaluate(() => window.__handles()), p = await params();
  await page.mouse.move(b.x + h.knee.x, b.y + h.knee.y); await page.mouse.down();
  await page.mouse.move(b.x + dxIn(g, p.threshold + 5), b.y + h.knee.y, { steps: 6 }); await page.mouse.up();
  assert.ok(Math.abs((await params()).knee - 10) < 1.5, JSON.stringify(await params()));
});

await check('with Upward on a second handle appears and drags the window', async () => {
  await page.evaluate(() => { window.__setParam('threshold', -8); window.__setParam('upward', true); });
  const b = await box(), g = await geom(), h = await page.evaluate(() => window.__handles()), p = await params();
  assert.ok(h.upWindow, 'upWindow handle');
  await page.mouse.move(b.x + h.upWindow.x, b.y + h.upWindow.y); await page.mouse.down();
  await page.mouse.move(b.x + h.upWindow.x, b.y + dy(g, p.threshold - 15), { steps: 6 }); await page.mouse.up();
  assert.ok(Math.abs((await params()).upWindow - 15) < 1.5, JSON.stringify(await params()));
  await page.evaluate(() => window.__setParam('upward', false));
});

await check('every canvas pixel is purple, red or neutral while a full-scale signal clips (red = details only; the green-to-red level meters are the one exception)', async () => {
  await page.evaluate(() => window.__setParam('bypass', true));
  await page.setInputFiles('#file', { name: 'loud.wav', mimeType: 'audio/wav', buffer: wavBuffer(3, 44100, 440, 0.999) });
  await page.waitForFunction(() => window.__engineState().duration > 2.5);
  await page.click('#play');
  await page.waitForFunction(() => window.__engineState().position > 1.2);
  const r = await page.evaluate(() => {
    let opaque = 0, bad = 0, clip = false;
    for (const c of document.querySelectorAll('canvas:not(.meters):not(.ring-canvas)')) { // the OUT bar and the Threshold ring are green -> red level meters on purpose
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 10) continue;
        opaque++;
        const [r, g, b] = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255], mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dl = mx - mn;
        if (l < 0.1 || dl === 0) continue;
        const sat = dl / (1 - Math.abs(2 * l - 1));
        let h = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
        h = (h * 60 + 360) % 360;
        const red = h >= 345 || h <= 12;
        if (sat >= 0.1 && !red && (h < 250 || h > 300)) bad++;
        if (red && sat > 0.5 && l > 0.45) clip = true;
      }
    }
    return { opaque, bad, clip };
  });
  assert.ok(r.opaque > 2000, `canvases look empty (${r.opaque} opaque px)`);
  assert.ok(r.bad <= r.opaque * 0.004, `${r.bad} of ${r.opaque} pixels outside purple/red/neutral (only blends of red and purple are tolerated)`);
  assert.ok(r.clip, 'clip indicator should be lit in red');
  await page.click('#pause');
  await page.evaluate(() => window.__setParam('bypass', false));
});

// ---- Knobs, tooltips (fake clock page) ----
const cpage = await (await browser.newContext()).newPage();
await cpage.clock.install();
await cpage.goto(url);
const knob = (id) => cpage.locator(`[data-knob="${id}"]`);
const tip = cpage.locator('.tooltip.show');
const readout = async (id) => (await knob(id).locator('.knob-value').textContent()).trim();
const center = async (id) => { const b = await knob(id).locator('svg').boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

await check('tooltip appears after exactly 2.5 s of hovering, not before', async () => {
  await knob('threshold').locator('svg').hover();
  await cpage.clock.runFor(2400);
  assert.equal(await tip.count(), 0);
  await cpage.clock.runFor(200);
  assert.equal(await tip.count(), 1);
  assert.ok(/^Level above which the compressor starts working/.test((await tip.textContent()).trim()));
  const tb = await tip.boundingBox(), hb = await cpage.locator('#help').boundingBox();
  assert.ok(tb.y >= hb.y + hb.height && Math.abs((tb.x + tb.width) - (hb.x + hb.width)) < 40, 'bubble sits under the Help button');
  await cpage.mouse.move(5, 5); await cpage.clock.runFor(50);
  assert.equal(await tip.count(), 0);
});

await check('mouse leave, click and drag start cancel a pending tooltip', async () => {
  await knob('ratio').locator('svg').hover(); await cpage.clock.runFor(2000);
  await cpage.mouse.move(5, 5); await cpage.clock.runFor(2000);
  assert.equal(await tip.count(), 0, 'leave');
  await knob('ratio').locator('svg').hover(); await cpage.clock.runFor(2000);
  await cpage.mouse.down(); await cpage.mouse.up(); await cpage.clock.runFor(2000);
  assert.equal(await tip.count(), 0, 'click');
  await cpage.mouse.move(5, 5);
});

await check('no tooltip while dragging a knob, and only one tooltip at a time', async () => {
  const [x, y] = await center('attack');
  await cpage.mouse.move(x, y); await cpage.mouse.down(); await cpage.mouse.move(x, y - 20, { steps: 4 });
  await cpage.clock.runFor(5000);
  assert.equal(await tip.count(), 0, 'dragging');
  await cpage.mouse.up(); await cpage.mouse.move(5, 5);
  await knob('knee').locator('svg').hover(); await cpage.clock.runFor(4100);
  const [x2, y2] = await center('release'); await cpage.mouse.move(x2, y2); await cpage.clock.runFor(4100);
  assert.equal(await tip.count(), 1);
  assert.ok((await tip.textContent()).trim().startsWith('How fast the compressor lets go after loud sound'));
  await cpage.mouse.move(5, 5);
});

await check('dragging changes a value; Alt+click resets it; double-click does not', async () => {
  assert.equal(await readout('threshold'), '-24.0 dB');
  const [x, y] = await center('threshold');
  await cpage.mouse.move(x, y); await cpage.mouse.down(); await cpage.mouse.move(x, y - 40, { steps: 5 }); await cpage.mouse.up();
  assert.notEqual(await readout('threshold'), '-24.0 dB');
  await cpage.mouse.dblclick(x, y);
  assert.notEqual(await readout('threshold'), '-24.0 dB', 'double-click must not reset');
  await cpage.keyboard.down('Alt'); await cpage.mouse.click(x, y); await cpage.keyboard.up('Alt');
  assert.equal(await readout('threshold'), '-24.0 dB');
});

await check('mouse wheel adjusts a knob; Shift is finer', async () => {
  const [x, y] = await center('ratio');
  await cpage.mouse.move(x, y);
  const before = await readout('ratio');
  await cpage.mouse.wheel(0, -100);
  const coarse = await readout('ratio');
  assert.notEqual(coarse, before);
  await cpage.keyboard.down('Shift'); await cpage.mouse.wheel(0, 100); await cpage.keyboard.up('Shift');
  const fine = await readout('ratio');
  assert.ok(Math.abs(parseFloat(fine) - parseFloat(coarse)) < Math.abs(parseFloat(coarse) - parseFloat(before)));
});

await check('Alt keyup default is prevented so the Windows menu bar does not activate', async () => {
  await cpage.evaluate(() => { window.__altPrevented = null; window.addEventListener('keyup', (e) => { if (e.key === 'Alt') window.__altPrevented = e.defaultPrevented; }); });
  await cpage.keyboard.press('Alt');
  assert.equal(await cpage.evaluate(() => window.__altPrevented), true);
});

// ---- Full UI assembly ----
const apage = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
apage.setDefaultTimeout(3000);
const aerrors = [];
apage.on('pageerror', (e) => aerrors.push(String(e)));
await apage.goto(url);
const aval = async (id) => (await apage.locator(`[data-knob="${id}"] .knob-value`).textContent()).trim();
const aparams = () => apage.evaluate(() => window.__params());
const PRESET_NAMES = ['Vocal Control', 'Vocal Smash', 'Kick Punch', 'Snare Crack', 'Bass Tighten', 'Drum Bus Glue', 'Parallel Drum Crush', 'Mix Bus Glue', 'Mastering Gentle', 'Acoustic Guitar Even'];

await check('undo and redo step through parameter changes', async () => {
  await apage.evaluate(() => window.__setParam('ratio', 6));
  await apage.waitForTimeout(700);
  await apage.evaluate(() => window.__setParam('threshold', -40));
  assert.equal(await aval('threshold'), '-40.0 dB');
  await apage.click('#undo'); assert.equal(await aval('threshold'), '-24.0 dB'); assert.equal(await aval('ratio'), '6.0:1');
  await apage.click('#undo'); assert.equal(await aval('ratio'), '3.0:1');
  await apage.click('#redo'); assert.equal(await aval('ratio'), '6.0:1');
});

await check('preset menu lists the 10 presets in order; picking one sets the controls', async () => {
  assert.deepEqual((await apage.locator('.preset-item').allTextContents()).map((t) => t.trim()), PRESET_NAMES);
  await apage.click('#preset-name'); await apage.locator('.preset-item').nth(2).click();
  assert.equal((await apage.textContent('#preset-name')).trim(), 'Kick Punch');
  assert.deepEqual([await aval('threshold'), await aval('ratio'), await aval('attack'), await aval('release')], ['-20.0 dB', '5.0:1', '30 ms', '60 ms']);
  assert.equal((await apage.textContent('#style-btn')).trim(), 'Punch');
  await apage.click('#preset-next');
  assert.equal((await apage.textContent('#preset-name')).trim(), 'Snare Crack');
  await apage.click('#preset-prev'); await apage.click('#preset-prev');
  assert.equal((await apage.textContent('#preset-name')).trim(), 'Vocal Smash');
});

await check('style menu lists the 9 styles; the Upward style switches Upward on and shows its controls', async () => {
  assert.equal(await apage.locator('#upward-panel').isVisible(), false);
  await apage.click('#style-btn');
  assert.deepEqual((await apage.locator('.style-item').allTextContents()).map((t) => t.trim()), ['Clean', 'Classic', 'Opto', 'Vocal', 'Bus', 'Punch', 'Vari-Mu', 'Pump', 'Upward']);
  await apage.locator('.style-item', { hasText: 'Upward' }).click();
  assert.equal(await apage.getAttribute('#upward', 'aria-pressed'), 'true');
  await apage.waitForFunction(() => document.querySelector('#upward-panel').getBoundingClientRect().height > 20);
  for (const id of ['upAmount', 'upWindow', 'upMaxBoost', 'upFloor']) assert.equal(await apage.locator(`[data-knob="${id}"]`).isVisible(), true, id);
  await apage.click('#upward'); // the switch turns Upward off; the block stays where it is
  await apage.waitForTimeout(500);
  assert.ok(await apage.evaluate(() => document.querySelector('#upward-panel').getBoundingClientRect().height) > 20, 'switching off must not hide the Upward block');
  assert.equal(await apage.getAttribute('#upward', 'aria-pressed'), 'false');
  assert.equal((await apage.evaluate(() => window.__params())).upward, false);
  await apage.click('#upward');
  assert.equal(await apage.getAttribute('#upward', 'aria-pressed'), 'true');
});

await check('A/B keeps two independent settings', async () => {
  await apage.evaluate(() => window.__setParam('threshold', -30));
  await apage.click('#ab-b'); assert.equal(await aval('threshold'), '-30.0 dB');
  await apage.evaluate(() => window.__setParam('threshold', -10));
  await apage.click('#ab-a'); assert.equal(await aval('threshold'), '-30.0 dB');
  await apage.click('#ab-b'); assert.equal(await aval('threshold'), '-10.0 dB');
  await apage.click('#ab-a');
});

await check('toggles, help, sidechain panel and bottom bar work', async () => {
  await apage.click('#bypass'); assert.equal((await aparams()).bypass, true); await apage.click('#bypass');
  const ag = (await aparams()).autoGain; await apage.click('#autogain'); assert.equal((await aparams()).autoGain, !ag);
  await apage.click('#help'); const t = await apage.textContent('#help-panel'); assert.ok(t.includes('Alt+click'), t);
  for (const id of ['sidechainHpf', 'mix', 'gain', 'range', 'lookahead', 'hold', 'knee']) assert.equal(await apage.locator(`[data-knob="${id}"]`).isVisible(), true, id);
  const bar = await apage.textContent('#bottombar'); assert.ok(bar.includes('Lookahead'), bar);
});

await check('every parameter/mode control has a valid tooltip key and all UI text is English', async () => {
  const r = await apage.evaluate(() => ({ keys: [...new Set([...document.querySelectorAll('[data-tooltip]')].map((e) => e.dataset.tooltip))], all: Object.keys(window.__TOOLTIPS), text: document.body.innerText }));
  assert.deepEqual(r.all.filter((k) => !r.keys.includes(k)), [], 'controls missing for tooltip keys');
  assert.deepEqual(r.keys.filter((k) => !r.all.includes(k)), [], 'unknown tooltip keys');
  assert.ok(!/[Ѐ-ӿ぀-ヿ一-鿿]/.test(r.text), 'non-English text found');
  assert.deepEqual(aerrors, []);
});


await check('without AudioWorklet the page falls back to a script processor and still compresses', async () => {
  const fp = await (await browser.newContext()).newPage();
  fp.setDefaultTimeout(8000);
  await fp.goto(url + '?noworklet');
  await fp.setInputFiles('#file', { name: 'tone.wav', mimeType: 'audio/wav', buffer: wavBuffer(2, 44100, 440, 0.9) });
  await fp.waitForFunction(() => window.__engineState().duration > 1.5);
  await fp.evaluate(() => { window.__setParam('threshold', -30); window.__setParam('ratio', 10); window.__setParam('autoGain', false); });
  await fp.click('#play');
  await fp.waitForFunction(() => window.__engineState().position > 0.8);
  const r = await fp.evaluate(() => ({ mode: window.__engineMode(), m: window.__lastMeters }));
  assert.equal(r.mode, 'script-processor');
  assert.ok(r.m && r.m.gainDb < -5 && r.m.outDb < r.m.inDb - 3, JSON.stringify(r.m));
  assert.equal(await page.evaluate(() => window.__engineMode()), 'worklet');
  await fp.close();
});

await check('opened from disk (file://) the page still uses the AudioWorklet', async () => {
  const fp = await (await browser.newContext()).newPage();
  fp.setDefaultTimeout(8000);
  await fp.goto(new URL('../dist/index.html', import.meta.url).href);
  await fp.setInputFiles('#file', { name: 'tone.wav', mimeType: 'audio/wav', buffer: wavBuffer(1) });
  await fp.waitForFunction(() => window.__engineState().duration > 0.5);
  assert.equal(await fp.evaluate(() => window.__engineMode()), 'worklet');
  assert.match((await fp.textContent('#engine-mode')).trim(), /AudioWorklet/);
  await fp.close();
});

await check('native controls and focus rings are purple (Loop checkbox, focused buttons)', async () => {
  await apage.keyboard.press('Tab');
  const r = await apage.evaluate(() => {
    const hue = (css) => { const m = css.match(/[\d.]+/g).map(Number); const [r, g, b] = [m[0] / 255, m[1] / 255, m[2] / 255], mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return -1; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
    const el = document.querySelector('#loop'), btn = document.activeElement;
    return { accent: hue(getComputedStyle(el).accentColor), outline: hue(getComputedStyle(btn).outlineColor), style: getComputedStyle(el).accentColor };
  });
  assert.ok(r.accent >= 255 && r.accent <= 295, JSON.stringify(r));
  assert.ok(r.outline >= 255 && r.outline <= 295, JSON.stringify(r));
});

await check('seek bar jumps in the track and Auto Release has a toggle', async () => {
  const sp = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  sp.setDefaultTimeout(8000);
  await sp.goto(url);
  await sp.setInputFiles('#file', { name: 'tone.wav', mimeType: 'audio/wav', buffer: wavBuffer(2) });
  await sp.waitForFunction(() => window.__engineState().duration > 1.5);
  await sp.locator('#seek').fill('50');
  await sp.waitForFunction(() => Math.abs(window.__engineState().position - 1.0) < 0.3);
  const ar = (await sp.evaluate(() => window.__params())).autoRelease;
  await sp.click('#auto-release');
  assert.equal((await sp.evaluate(() => window.__params())).autoRelease, !ar);
  assert.equal(await sp.getAttribute('#auto-release', 'data-tooltip'), 'autoRelease');
  await sp.close();
});

// ---- Layout v2 ----
const lpage = await (await browser.newContext({ viewport: { width: 1180, height: 1000 } })).newPage();
lpage.setDefaultTimeout(4000);
await lpage.goto(url);

await check('the plugin frame has no demo controls; the Demo player is a separate strip', async () => {
  assert.equal(await lpage.locator('#plugin #play, #plugin #pause, #plugin #file, #plugin #seek, #plugin #mode').count(), 0);
  assert.equal(await lpage.locator('#demo-bar #play, #demo-bar #pause, #demo-bar #file, #demo-bar #seek, #demo-bar #mode').count(), 5);
  assert.equal(await lpage.locator('#demo-bar').evaluate((e) => !!e.closest('#plugin')), false);
});

await check('settings are one group: Mix is last after Gain; small knobs sit in the same group', async () => {
  const main = await lpage.locator('.settings .settings-main [data-knob]').evaluateAll((els) => els.map((e) => e.dataset.knob));
  assert.deepEqual(main, ['threshold', 'ratio', 'attack', 'release', 'gain', 'mix']);
  const small = await lpage.locator('.settings .settings-small [data-knob]').evaluateAll((els) => els.map((e) => e.dataset.knob));
  assert.deepEqual(small, ['knee', 'range', 'lookahead', 'hold']);
  assert.equal(await lpage.locator('.settings #style-btn').count(), 1);
});

await check('AUTO pills sit under Threshold, Attack, Release and Gain; clicking one does not move the knob', async () => {
  for (const [knob, pill] of [['threshold', 'auto-threshold'], ['attack', 'auto-attack'], ['release', 'auto-release'], ['gain', 'autogain']]) {
    assert.equal(await lpage.locator(`[data-knob="${knob}"] #${pill}.auto-pill`).count(), 1, pill);
  }
  const before = await lpage.evaluate(() => window.__params().threshold);
  await lpage.click('#auto-threshold');
  const after = await lpage.evaluate(() => window.__params());
  assert.equal(after.autoThreshold, true); assert.equal(after.threshold, before);
  assert.equal(await lpage.getAttribute('#auto-threshold', 'aria-pressed'), 'true');
  await lpage.click('#auto-attack'); assert.equal(await lpage.evaluate(() => window.__params().autoAttack), true);
  await lpage.click('#auto-threshold'); await lpage.click('#auto-attack');
});

await check('Upward is an accordion: collapsed by default, animates open and closed, hidden content is not focusable', async () => {
  const h = () => lpage.evaluate(() => document.querySelector('#upward-panel').getBoundingClientRect().height);
  assert.equal(await lpage.getAttribute('#upward-acc-toggle', 'aria-expanded'), 'false');
  assert.equal(await h(), 0);
  assert.equal(await lpage.evaluate(() => document.querySelector('#upward-panel').inert), true);
  const samples = lpage.evaluate(() => new Promise((res) => { const out = []; const t0 = performance.now(); const tick = () => { out.push(document.querySelector('#upward-panel').getBoundingClientRect().height); performance.now() - t0 < 600 ? requestAnimationFrame(tick) : res(out); }; tick(); }));
  await lpage.evaluate(() => window.__setParam('upAmount', 2));
  const seen = await samples;
  const final = seen.at(-1);
  assert.ok(final > 40, `final height ${final}`);
  assert.ok(seen.some((v) => v > 3 && v < final - 3), `no intermediate height (animation) in ${seen.map((v) => Math.round(v)).join(',')}`);
  assert.equal(await lpage.getAttribute('#upward-acc-toggle', 'aria-expanded'), 'true');
  assert.equal(await lpage.evaluate(() => document.querySelector('#upward-panel').inert), false);
  await lpage.evaluate(() => window.__setParam('upAmount', 1));
  await lpage.waitForTimeout(500);
  assert.equal(await lpage.getAttribute('#upward-acc-toggle', 'aria-expanded'), 'true', 'Amount 1:1 does not close the block');
  await lpage.click('#upward-acc-toggle');
  await lpage.waitForFunction(() => document.querySelector('#upward-panel').getBoundingClientRect().height < 1);
  assert.equal(await lpage.getAttribute('#upward-acc-toggle', 'aria-expanded'), 'false');
  assert.equal(await lpage.getAttribute('#sc-acc-toggle', 'aria-expanded'), 'false', 'Side Chain is collapsed by default, like Upward');
  assert.equal(await lpage.evaluate(() => document.querySelector('#sc-panel').getBoundingClientRect().height), 0);
  await lpage.click('#sc-acc-toggle');
  await lpage.waitForFunction(() => document.querySelector('#sc-panel').getBoundingClientRect().height > 100);
  await lpage.click('#sc-acc-toggle');
  await lpage.waitForFunction(() => document.querySelector('#sc-panel').getBoundingClientRect().height < 1);
});

// ---- Display v2 ----
const dpage = await (await browser.newContext({ viewport: { width: 1180, height: 800 } })).newPage();
dpage.setDefaultTimeout(6000);
await dpage.goto(url);

const scaleNow = async () => (await dpage.textContent('#display-scale')).trim();
await check('dB scale is a dropdown at the bottom right of the display (6-60 dB, tick on the current one); the wheel never changes it', async () => {
  const b = await dpage.locator('canvas.display').boundingBox(), sb = await dpage.locator('#display-scale').boundingBox();
  assert.ok(sb.x > b.x + b.width * 0.6 && sb.y > b.y + b.height * 0.8 && sb.x + sb.width <= b.x + b.width, 'bottom right of the display');
  assert.equal(await scaleNow(), '36 dB');
  await dpage.click('#display-scale');
  assert.deepEqual((await dpage.locator('.scale-item').allTextContents()).map((t) => t.trim()), ['6 dB', '12 dB', '18 dB', '24 dB', '36 dB', '48 dB', '60 dB']);
  assert.equal(await dpage.getAttribute('.scale-item[data-id="36"]', 'aria-checked'), 'true');
  const m = await dpage.locator('#display-scale-menu').boundingBox();
  assert.ok(m.y >= 0 && m.y + m.height <= sb.y, 'the list opens upwards');
  await dpage.click('.scale-item[data-id="60"]');
  assert.equal(await scaleNow(), '60 dB'); assert.equal((await dpage.evaluate(() => window.__geom())).rangeDb, 60);
  await dpage.click('#display-scale'); await dpage.click('.scale-item[data-id="6"]');
  const g = await dpage.evaluate(() => window.__geom()), h = await dpage.evaluate(() => window.__handles());
  assert.equal(g.rangeDb, 6);
  assert.ok(h.threshold.y >= g.top && h.threshold.y <= g.h, 'threshold handle stays visible when zoomed in');
  await dpage.mouse.move(b.x + b.width * 0.5, b.y + 150); await dpage.mouse.wheel(0, 300);
  assert.equal((await dpage.evaluate(() => window.__geom())).rangeDb, 6, 'the wheel does not change the dB scale');
  await dpage.click('#display-scale'); await dpage.click('.scale-item[data-id="36"]');
  assert.equal(await scaleNow(), '36 dB');
});

await check('wheel over the display zooms the envelope in time: smooth, no steps, limited at both ends, page does not scroll, height stays', async () => {
  const b = await dpage.locator('canvas.display').boundingBox();
  const t0 = await dpage.evaluate(() => window.__timeWindow());
  await dpage.mouse.move(b.x + b.width * 0.8, b.y + 120);
  await dpage.mouse.wheel(0, 100);
  const t1 = await dpage.evaluate(() => window.__timeWindow());
  await dpage.mouse.wheel(0, 100);
  const t2 = await dpage.evaluate(() => window.__timeWindow());
  assert.ok(t1 > t0 && t2 > t1 && Math.abs((t2 - t1) - (t1 - t0)) > 0.01, `continuous: ${t0} ${t1} ${t2}`);
  assert.equal(await dpage.evaluate(() => window.scrollY), 0);
  for (let i = 0; i < 40; i++) await dpage.mouse.wheel(0, 400);
  assert.equal(await dpage.evaluate(() => window.__timeWindow()), 30);
  for (let i = 0; i < 80; i++) await dpage.mouse.wheel(0, -400);
  assert.equal(await dpage.evaluate(() => window.__timeWindow()), 2);
  assert.equal((await dpage.locator('canvas.display').boundingBox()).height, b.height, 'the display height is unchanged');
  assert.equal((await dpage.evaluate(() => window.__geom())).rangeDb, 36);
  await dpage.mouse.wheel(0, 1e5);
});

await check('the wheel over a knob adjusts only the knob, not the display range', async () => {
  const k = await dpage.locator('[data-knob="ratio"] svg').boundingBox();
  const before = await dpage.evaluate(() => window.__params().ratio);
  await dpage.mouse.move(k.x + k.width / 2, k.y + k.height / 2);
  await dpage.mouse.wheel(0, -120);
  assert.notEqual(await dpage.evaluate(() => window.__params().ratio), before);
  assert.equal(await scaleNow(), '36 dB');
});

await check('with Auto Threshold the drawn threshold follows the effective threshold from the engine', async () => {
  await dpage.setInputFiles('#file', { name: 'loud.wav', mimeType: 'audio/wav', buffer: wavBuffer(3, 44100, 440, 0.8) });
  await dpage.waitForFunction(() => window.__engineState().duration > 2.5);
  await dpage.evaluate(() => window.__setParam('autoThreshold', true));
  await dpage.click('#play');
  await dpage.waitForFunction(() => window.__engineState().position > 1.5);
  const r = await dpage.evaluate(() => ({ drawn: window.__drawnThreshold(), eff: window.__lastMeters.thresholdDb, knob: window.__params().threshold }));
  assert.ok(Math.abs(r.drawn - r.eff) < 0.6, JSON.stringify(r));
  assert.ok(Math.abs(r.eff - r.knob) > 1, `effective threshold should differ from the knob: ${JSON.stringify(r)}`);
  await dpage.click('#pause');
  await dpage.evaluate(() => window.__setParam('autoThreshold', false));
  assert.equal(await dpage.evaluate(() => window.__drawnThreshold()), await dpage.evaluate(() => window.__params().threshold));
});

// ---- Meters v2 ----
const mpage = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
mpage.setDefaultTimeout(6000);
await mpage.goto(url);

await check('GR and OUT numbers update, the Threshold ring shows input level, red stays a detail', async () => {
  await mpage.setInputFiles('#file', { name: 'tone.wav', mimeType: 'audio/wav', buffer: wavBuffer(3, 44100, 440, 0.5) });
  await mpage.waitForFunction(() => window.__engineState().duration > 2.5);
  await mpage.click('#play');
  await mpage.waitForFunction(() => window.__engineState().position > 1.2);
  const r = await mpage.evaluate(() => {
    const num = (id) => parseFloat(document.querySelector(id).textContent);
    const c = document.querySelector('canvas.display'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let opaque = 0, red = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 10) continue; opaque++;
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (r > 150 && g < 110 && b < 110) red++;
    }
    return { gr: num('#gr-readout'), out: num('#out-readout'), ring: (() => { const c = document.querySelector('[data-knob="threshold"] .ring-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0, faint = 0, hues = new Set(); for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 230) { lit++; if (d[i + 1] > d[i] + 40) hues.add('green'); if (d[i] > d[i + 1] + 80) hues.add('warm'); } else if (d[i + 3] > 20) faint++; } return { lit, faint, hues: [...hues] }; })(), share: red / opaque, red };
  });
  assert.ok(r.gr < -3 && r.gr > -40, `GR readout ${r.gr}`);
  assert.ok(r.out > -12 && r.out <= 0.5, `OUT readout ${r.out}`);
  assert.ok(r.ring.lit > 200 && r.ring.faint > 200, `ring pixels lit ${r.ring.lit}, faint scale ${r.ring.faint}`);
  assert.ok(r.ring.hues.includes('green'), 'the lit ring is a smooth gradient starting green');
  assert.ok(r.red > 20, `no red pixels on the display (GR line expected): ${r.red}`);
  assert.ok(r.share < 0.10, `red share ${r.share}`);
});

// ---- Sidechain EQ ----
const spage = await (await browser.newContext({ viewport: { width: 1180, height: 1250 } })).newPage();
spage.setDefaultTimeout(5000);
await spage.goto(url);
await spage.click('#sc-acc-toggle'); await spage.waitForFunction(() => document.querySelector('#sc-panel').getBoundingClientRect().height > 100);
const scParams = () => spage.evaluate(() => window.__params());
const scBox = () => spage.locator('canvas.sc-eq').boundingBox();
const scNodes = () => spage.evaluate(() => window.__scNodes());
const scG = () => spage.evaluate(() => window.__scGeom());
const px = async (id) => { const [b, n] = [await scBox(), await scNodes()]; return [b.x + n[id].x, b.y + n[id].y]; };
const fxAt = (b, g, f) => b.x + g.padL + (Math.log10(f / 20) / 3) * g.plotW;

await check('sidechain EQ: dragging the HPF, band and LPF nodes sets their params; Alt+click resets a node', async () => {
  const b = await scBox(), g = await scG();
  let [x, y] = await px('hpf');
  await spage.mouse.move(x, y); await spage.mouse.down(); await spage.mouse.move(fxAt(b, g, 200), y, { steps: 8 }); await spage.mouse.up();
  let p = await scParams(); assert.ok(p.sidechainHpf > 170 && p.sidechainHpf < 230, `HPF ${p.sidechainHpf}`);
  [x, y] = await px('hpf');
  await spage.keyboard.down('Alt'); await spage.mouse.click(x, y); await spage.keyboard.up('Alt');
  assert.equal((await scParams()).sidechainHpf, 20);
  [x, y] = await px('band');
  const gy = (db) => b.y + g.h / 2 - (db / 24) * (g.h / 2 - 12);
  await spage.mouse.move(x, y); await spage.mouse.down(); await spage.mouse.move(fxAt(b, g, 2000), gy(6), { steps: 8 }); await spage.mouse.up();
  p = await scParams(); assert.ok(p.scBandFreq > 1700 && p.scBandFreq < 2300 && p.scBandGain > 4.5 && p.scBandGain < 7.5, `band ${p.scBandFreq} Hz ${p.scBandGain} dB`);
  [x, y] = await px('band');
  await spage.mouse.move(x, y); await spage.mouse.wheel(0, -100);
  assert.ok((await scParams()).scBandQ > 1, 'wheel up on the band node raises Q');
  [x, y] = await px('lpf');
  await spage.mouse.move(x - 2, y); await spage.mouse.down(); await spage.mouse.move(fxAt(b, g, 5000), y, { steps: 8 }); await spage.mouse.up();
  p = await scParams(); assert.ok(p.scLpf > 4200 && p.scLpf < 5800, `LPF ${p.scLpf}`);
});

await check('sidechain Level slider and Listen switch drive their params', async () => {
  await spage.locator('#sc-level').fill('6');
  assert.equal((await scParams()).scLevel, 6);
  await spage.keyboard.down('Alt'); await spage.locator('#sc-level').click(); await spage.keyboard.up('Alt');
  assert.equal((await scParams()).scLevel, 0);
  await spage.click('#sc-listen'); assert.equal((await scParams()).scListen, true);
  await spage.click('#sc-listen'); assert.equal((await scParams()).scListen, false);
});

await check('sidechain EQ canvas has a neutral grey background and draws the live input spectrum while playing', async () => {
  const stats = () => spage.evaluate(() => {
    const c = document.querySelector('canvas.sc-eq'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0], d[1], d[2]]; let diff = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24) diff++;
    return { bg, diff };
  });
  const before = await stats();
  assert.ok(Math.max(...before.bg) - Math.min(...before.bg) <= 6 && before.bg[0] > 15 && before.bg[0] < 70, `bg ${before.bg}`);
  await spage.setInputFiles('#file', { name: 'tone.wav', mimeType: 'audio/wav', buffer: wavBuffer(3, 44100, 440, 0.5) });
  await spage.waitForFunction(() => window.__engineState().duration > 2.5);
  await spage.click('#play');
  await spage.waitForFunction(() => window.__engineState().position > 1.2);
  const after = await stats();
  assert.ok(after.diff - before.diff > 500, `spectrum should add pixels: ${before.diff} -> ${after.diff}`);
  await spage.click('#pause');
});

await check('the settings knobs never cover the display (curve, knee, threshold line stay visible)', async () => {
  const lp = await (await browser.newContext({ viewport: { width: 1180, height: 1000 } })).newPage();
  await lp.goto(url);
  const r = await lp.evaluate(() => {
    const c = document.querySelector('canvas.display').getBoundingClientRect(), set = document.querySelector('.settings').getBoundingClientRect();
    const knobs = [...document.querySelectorAll('.settings .knob, .settings .menu-btn')].map((e) => e.getBoundingClientRect().top);
    return { canvasBottom: c.bottom, settingsTop: set.top, firstKnobTop: Math.min(...knobs) };
  });
  assert.ok(r.settingsTop >= r.canvasBottom - 1, `settings overlap the display: ${JSON.stringify(r)}`);
  assert.ok(r.firstKnobTop >= r.canvasBottom - 1, `a knob overlaps the display: ${JSON.stringify(r)}`);
  await lp.close();
});

await check('knobs, values, labels and AUTO pills are aligned on common lines', async () => {
  const ap = await (await browser.newContext({ viewport: { width: 1180, height: 1000 } })).newPage();
  await ap.goto(url);
  const r = await ap.evaluate(() => {
    const top = (e, sel) => e.querySelector(sel).getBoundingClientRect().top;
    const mid = (e) => { const b = e.querySelector('svg, .menu-btn').getBoundingClientRect(); return b.top + b.height / 2; };
    const rows = (sel) => [...document.querySelectorAll(sel)];
    const spread = (a) => Math.max(...a) - Math.min(...a);
    const main = rows('.settings-main > *');
    return {
      mainLabels: spread(main.map((e) => top(e, '.knob-label'))),
      mainValues: spread(main.map((e) => top(e, '.knob-value'))),
      mainMids: spread(main.map(mid)),
      pills: spread(rows('.settings-main .auto-pill').map((e) => e.getBoundingClientRect().top)),
      smallSvg: spread(rows('.settings-small > .knob').map((e) => top(e, 'svg'))),
      smallLabels: spread(rows('.settings-small > .knob').map((e) => top(e, '.knob-label'))),
      upLabels: spread(rows('#upward-panel .knob').map((e) => top(e, '.knob-label'))),
      scLabels: spread(rows('.sc-knobs > .knob').map((e) => top(e, '.knob-label'))),
    };
  });
  for (const [k, v] of Object.entries(r)) assert.ok(v <= 2, `${k} is off by ${v}px: ${JSON.stringify(r)}`);
  await ap.close();
});

await check('the Upward accordion keeps the state the user gave it while parameters change', async () => {
  const up = await (await browser.newContext({ viewport: { width: 1180, height: 1000 } })).newPage();
  up.setDefaultTimeout(4000);
  await up.goto(url);
  const h = () => up.evaluate(() => document.querySelector('#upward-panel').getBoundingClientRect().height);
  await up.click('#upward-acc-toggle'); // open by hand with Upward off
  await up.waitForFunction(() => document.querySelector('#upward-panel').getBoundingClientRect().height > 40);
  await up.evaluate(() => window.__setParam('upAmount', 2));
  await up.waitForTimeout(450);
  assert.ok(await h() > 40, 'a hand-opened block must stay open while a parameter changes');
  await up.waitForTimeout(450); // Upward is on since Amount is above 1:1: stays open
  await up.click('#upward-acc-toggle'); // collapse by hand with Upward on
  await up.waitForFunction(() => document.querySelector('#upward-panel').getBoundingClientRect().height < 1);
  await up.evaluate(() => window.__setParam('threshold', -30));
  await up.waitForTimeout(450);
  assert.ok(await h() < 1, 'a hand-collapsed block must stay collapsed while a parameter changes');
  await up.close();
});

await check('the Upward header has one Upward title button and an On/Off switch, and the title still expands the block', async () => {
  const hp = await (await browser.newContext({ viewport: { width: 1180, height: 1000 } })).newPage();
  hp.setDefaultTimeout(4000);
  await hp.goto(url);
  const texts = await hp.locator('#upward-acc .acc-head button').allTextContents();
  const clean = texts.map((t) => t.trim().toLowerCase());
  assert.equal(new Set(clean).size, clean.length, `duplicate header buttons: ${clean}`);
  assert.equal(clean.filter((t) => t === 'upward').length, 1, `exactly one "Upward" button: ${clean}`);
  assert.equal(await hp.locator('button#upward').count(), 1, 'the Upward switch is a button');
  assert.equal((await hp.textContent('#upward')).trim(), 'Off');
  await hp.evaluate(() => window.__setParam('upAmount', 2)); assert.equal((await hp.textContent('#upward')).trim(), 'On');
  await hp.waitForFunction(() => document.querySelector('#upward-panel').getBoundingClientRect().height > 20); // turning Upward on opened the block
  await hp.evaluate(() => window.__setParam('upAmount', 1)); await hp.waitForTimeout(450);
  assert.ok(await hp.evaluate(() => document.querySelector('#upward-panel').getBoundingClientRect().height) > 20, 'Amount 1:1 keeps the block open');
  await hp.click('#upward-acc-toggle'); await hp.waitForFunction(() => document.querySelector('#upward-panel').getBoundingClientRect().height < 1);
  await hp.click('#upward-acc-toggle');
  await hp.waitForFunction(() => document.querySelector('#upward-panel').getBoundingClientRect().height > 20);
  await hp.close();
});

await check('filter slopes: the wheel over HPF/LPF nodes sets 6/12/24/48 dB per octave, Alt+click resets, no Q knobs', async () => {
  const ep = await (await browser.newContext({ viewport: { width: 1180, height: 1250 } })).newPage();
  ep.setDefaultTimeout(4000);
  await ep.goto(url);
  await ep.click('#sc-acc-toggle'); await ep.waitForFunction(() => document.querySelector('#sc-panel').getBoundingClientRect().height > 100);
  assert.equal(await ep.locator('[data-knob="scHpfQ"], [data-knob="scLpfQ"]').count(), 0, 'filters have no resonance control');
  assert.equal(await ep.locator('#hpf-slope, #lpf-slope, #sc-panel .segmented').count(), 0, 'no slope buttons: the slope is chosen with the wheel on the filter point');
  const box = await ep.locator('canvas.sc-eq').boundingBox();
  for (const [node, key] of [['hpf', 'scHpfSlope'], ['lpf', 'scLpfSlope']]) {
    const n = await ep.evaluate(() => window.__scNodes());
    await ep.waitForTimeout(200); // one slope step per wheel flick
    await ep.mouse.move(box.x + n[node].x, box.y + n[node].y); await ep.mouse.wheel(0, -200);
    assert.equal(await ep.evaluate((k) => window.__params()[k], key), 24, `${key} steepens on wheel up`);
  }
  { const n = await ep.evaluate(() => window.__scNodes()); await ep.waitForTimeout(200); await ep.mouse.move(box.x + n.hpf.x, box.y + n.hpf.y); await ep.mouse.wheel(0, -200); await ep.waitForTimeout(200); await ep.mouse.wheel(0, -200); }
  assert.equal(await ep.evaluate(() => window.__params().scHpfSlope), 48);
  const hpfN = await ep.evaluate(() => window.__scNodes().hpf);
  await ep.keyboard.down('Alt'); await ep.mouse.click(box.x + hpfN.x, box.y + hpfN.y); await ep.keyboard.up('Alt');
  assert.equal(await ep.evaluate(() => window.__params().scHpfSlope), 12, 'Alt+click resets the slope too');
  await ep.close();
});

await check('Settings gear (top right) holds Oversampling and Low latency mode; the bottom bar shows the real latency', async () => {
  const sp = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  sp.setDefaultTimeout(5000);
  await sp.goto(url);
  const gear = await sp.locator('#settings-btn').boundingBox(), fs = await sp.locator('#fullscreen').boundingBox();
  assert.ok(gear.x >= fs.x + fs.width - 1, 'the gear is the right-most button of the top bar');
  assert.equal(await sp.locator('#settings-panel').isVisible(), false);
  assert.equal(await sp.locator('#settings-panel #oversampling').count(), 1, 'oversampling lives in the gear panel');
  assert.equal(await sp.locator('.topbar > #oversampling').count(), 0, 'not loose in the top bar');
  await sp.click('#settings-btn');
  assert.equal(await sp.locator('#settings-panel').isVisible(), true);
  const pb = await sp.locator('#settings-panel').boundingBox();
  assert.ok(pb.x >= 0 && pb.x + pb.width <= 1180, 'the panel stays inside the window');
  const rows = (await sp.locator('#settings-panel .pop-text > div:first-child').allTextContents()).map((t) => t.trim());
  assert.deepEqual(rows, ['Oversampling', 'Low latency mode']);
  assert.deepEqual((await sp.locator('#oversampling button').allTextContents()).map((t) => t.trim()), ['Off', '2x', '4x', '8x']);
  assert.equal(await sp.getAttribute('#oversampling button[data-value="1"]', 'aria-pressed'), 'true');
  await sp.click('#oversampling button[data-value="4"]');
  assert.equal(await sp.evaluate(() => window.__params().oversampling), 4);
  assert.equal(await sp.getAttribute('#oversampling button[data-value="4"]', 'aria-pressed'), 'true');
  assert.equal(await sp.evaluate(() => window.__frameInterval()), 14, '60 fps by default');
  assert.equal(await sp.getAttribute('#low-latency', 'aria-checked'), 'false');
  await sp.click('#low-latency');
  assert.equal(await sp.evaluate(() => window.__params().lowLatency), true);
  assert.equal(await sp.evaluate(() => window.__frameInterval()), 31, 'Low latency mode draws at 30 fps');
  assert.equal(await sp.getAttribute('#low-latency', 'aria-checked'), 'true');
  await sp.click('#low-latency');
  assert.equal(await sp.evaluate(() => window.__frameInterval()), 14);
  await sp.keyboard.press('Escape');
  assert.equal(await sp.locator('#settings-panel').isVisible(), false, 'Escape closes the panel');
  await sp.click('#settings-btn'); await sp.mouse.click(300, 400);
  assert.equal(await sp.locator('#settings-panel').isVisible(), false, 'a click outside closes the panel');
  await sp.setInputFiles('#file', { name: 'a.wav', mimeType: 'audio/wav', buffer: wavBuffer(3, 44100, 440, 0.5) });
  await sp.waitForFunction(() => window.__engineState().duration > 2.5);
  await sp.click('#play');
  await sp.waitForFunction(() => window.__lastMeters && window.__lastMeters.latencySamples > 0 && /Latency: (0\.[1-9]|[1-9])/.test(document.querySelector('#latency-readout').textContent));
  await sp.close();
});

await check('AUTO on a knob: greyed and locked, the dial turns by itself and shows the live value; off returns to the value the user set; the Threshold ring keeps its colours', async () => {
  const ap2 = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  ap2.setDefaultTimeout(6000);
  await ap2.goto(url);
  const val = (id) => ap2.textContent(`[data-knob="${id}"] .knob-value`).then((t) => t.trim());
  const ind = (id) => ap2.evaluate((k) => document.querySelector(`[data-knob="${k}"] .ind`).getAttribute('x2'), id);
  await ap2.evaluate(() => { window.__setParam('threshold', -40); window.__setParam('attack', 10); window.__setParam('release', 120); window.__setParam('autoGain', false); });
  await ap2.setInputFiles('#file', { name: 'a.wav', mimeType: 'audio/wav', buffer: wavBuffer(6, 44100, 220, 0.8) });
  await ap2.waitForFunction(() => window.__engineState().duration > 5); await ap2.click('#play');
  await ap2.waitForTimeout(500);
  const manual = { threshold: await val('threshold'), attack: await val('attack'), release: await val('release'), gain: await val('gain') };
  assert.deepEqual(manual, { threshold: '-40.0 dB', attack: '10 ms', release: '120 ms', gain: '0.0 dB' });
  const indBefore = await ind('release');
  for (const [id, pill, param] of [['threshold', 'auto-threshold', 'autoThreshold'], ['attack', 'auto-attack', 'autoAttack'], ['release', 'auto-release', 'autoRelease'], ['gain', 'autogain', 'autoGain']]) {
    await ap2.click(`#${pill}`);
    assert.equal(await ap2.evaluate((k) => window.__params()[k], param), true);
    assert.equal(await ap2.evaluate((k) => document.querySelector(`[data-knob="${k}"]`).classList.contains('auto-on'), id), true, `${id} greyed`);
    assert.equal((await ap2.textContent(`#${pill}`)).trim(), 'AUTO', 'the pill keeps its plain label');
    assert.equal(await ap2.getAttribute(`[data-knob="${id}"] svg`, 'aria-disabled'), 'true');
  }
  await ap2.waitForTimeout(2500);
  const live = { threshold: await val('threshold'), attack: await val('attack'), release: await val('release'), gain: await val('gain') };
  for (const k of Object.keys(live)) assert.notEqual(live[k], manual[k], `${k} shows the live value (${live[k]})`);
  assert.notEqual(await ind('release'), indBefore, 'the dial itself moved');
  // locked: dragging, wheel and Alt+click do nothing
  const kb = await ap2.locator('[data-knob="attack"] svg').boundingBox();
  await ap2.mouse.move(kb.x + 30, kb.y + 30); await ap2.mouse.down(); await ap2.mouse.move(kb.x + 30, kb.y - 40, { steps: 5 }); await ap2.mouse.up();
  await ap2.mouse.wheel(0, -300);
  assert.equal(await ap2.evaluate(() => window.__params().attack), 10, 'the locked knob cannot be changed');
  // the Threshold ring is not greyed
  const ring = await ap2.evaluate(() => { const c = document.querySelector('[data-knob="threshold"] .ring-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let col = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 230 && Math.abs(d[i] - d[i + 1]) > 40) col++; return col; });
  assert.ok(ring > 100, `ring colourful pixels ${ring}`);
  // switching AUTO off brings back the value the user had set
  for (const pill of ['auto-threshold', 'auto-attack', 'auto-release']) await ap2.click(`#${pill}`);
  await ap2.click('#autogain');
  await ap2.waitForTimeout(300);
  assert.deepEqual({ threshold: await val('threshold'), attack: await val('attack'), release: await val('release'), gain: await val('gain') }, manual);
  assert.equal(await ap2.evaluate(() => document.querySelector('[data-knob="attack"]').classList.contains('auto-on')), false);
  await ap2.mouse.move(kb.x + 30, kb.y + 30); await ap2.mouse.wheel(0, -200);
  assert.notEqual(await ap2.evaluate(() => window.__params().attack), 10, 'unlocked again');
  await ap2.close();
});

await check('the Upward switch shows On/Off: it does not change while the compressor works, a click switches it', async () => {
  const lp = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  lp.setDefaultTimeout(5000);
  await lp.goto(url);
  await lp.evaluate(() => { window.__setParam('upAmount', 2); window.__setParam('threshold', -40); window.__setParam('ratio', 8); });
  await lp.setInputFiles('#file', { name: 'a.wav', mimeType: 'audio/wav', buffer: wavBuffer(4, 44100, 220, 0.8) });
  await lp.waitForFunction(() => window.__engineState().duration > 3); await lp.click('#play');
  const seen = new Set();
  for (let i = 0; i < 20; i++) { seen.add((await lp.textContent('#upward')).trim()); await lp.waitForTimeout(100); }
  assert.deepEqual([...seen], ['On']);
  await lp.click('#upward');
  assert.equal((await lp.textContent('#upward')).trim(), 'Off');
  await lp.close();
});

await check('External sidechain: Source switch, a key track from the demo bar drives the detector, the filters go all along the graph', async () => {
  const xp = await (await browser.newContext({ viewport: { width: 1180, height: 1250 } })).newPage();
  xp.setDefaultTimeout(6000);
  await xp.goto(url);
  await xp.click('#sc-acc-toggle'); await xp.waitForFunction(() => document.querySelector('#sc-panel').getBoundingClientRect().height > 100);
  assert.deepEqual((await xp.locator('#sc-source button').allTextContents()).map((t) => t.trim()), ['Internal', 'External']);
  assert.equal(await xp.getAttribute('#sc-source button[data-value="0"]', 'aria-pressed'), 'true');
  assert.equal((await xp.textContent('#sc-key-hint')).trim(), '');
  await xp.evaluate(() => { window.__setParam('threshold', -30); window.__setParam('ratio', 8); window.__setParam('autoGain', false); });
  await xp.setInputFiles('#file', { name: 'quiet.wav', mimeType: 'audio/wav', buffer: wavBuffer(6, 44100, 440, 0.01) }); // main: very quiet
  await xp.waitForFunction(() => window.__engineState().duration > 5); await xp.click('#play');
  await xp.waitForTimeout(800);
  const gr = () => xp.evaluate(() => window.__lastMeters.gainDb);
  assert.ok(Math.abs(await gr()) < 0.3, 'internal: the quiet main signal is not compressed');
  await xp.click('#sc-source button[data-value="1"]');
  assert.equal(await xp.evaluate(() => window.__params().scExternal), true);
  assert.match(await xp.textContent('#sc-key-hint'), /No key track/);
  await xp.waitForTimeout(500);
  assert.ok(Math.abs(await gr()) < 0.3, 'external without a key: the detector hears silence');
  await xp.setInputFiles('#key-file', { name: 'kick.wav', mimeType: 'audio/wav', buffer: wavBuffer(2, 44100, 60, 0.9) }); // key: loud, and shorter than the main track (it loops)
  await xp.waitForFunction(() => /Key: kick.wav/.test(document.querySelector('#sc-key-hint').textContent));
  await xp.waitForFunction(() => window.__lastMeters.gainDb < -6);
  await xp.click('#sc-source button[data-value="0"]');
  await xp.waitForFunction(() => Math.abs(window.__lastMeters.gainDb) < 0.5);
  // the HPF/LPF points can be dragged along the whole graph
  await xp.waitForTimeout(300);
  const box = await xp.locator('canvas.sc-eq').boundingBox(), nodes = await xp.evaluate(() => window.__scNodes()), g = await xp.evaluate(() => window.__scGeom());
  const fx = (f) => g.padL + (Math.log10(f / 20) / Math.log10(1000)) * g.plotW;
  await xp.mouse.move(box.x + nodes.hpf.x + 1, box.y + nodes.hpf.y); await xp.mouse.down(); await xp.mouse.move(box.x + fx(8000), box.y + nodes.hpf.y, { steps: 10 }); await xp.mouse.up();
  const hp = await xp.evaluate(() => window.__params().sidechainHpf); assert.ok(hp > 6500 && hp < 9500, `HPF ${hp}`);
  const n2 = await xp.evaluate(() => window.__scNodes());
  await xp.mouse.move(box.x + n2.lpf.x - 1, box.y + n2.lpf.y); await xp.mouse.down(); await xp.mouse.move(box.x + fx(120), box.y + n2.lpf.y, { steps: 10 }); await xp.mouse.up();
  const lp = await xp.evaluate(() => window.__params()); assert.ok(lp.scLpf >= lp.sidechainHpf * 1.2, `LPF ${lp.scLpf} stays above HPF ${lp.sidechainHpf}`);
  await xp.close();
});

await check('Side Chain has an on/off button in its header; off dims and locks the panel; AUTO digits refresh about 4 times a second', async () => {
  const sp2 = await (await browser.newContext({ viewport: { width: 1180, height: 1250 } })).newPage();
  sp2.setDefaultTimeout(6000);
  await sp2.goto(url);
  assert.equal((await sp2.textContent('#sc-enable')).trim(), 'On');
  assert.equal(await sp2.getAttribute('#sc-enable', 'aria-pressed'), 'true');
  await sp2.click('#sc-acc-toggle'); await sp2.waitForFunction(() => document.querySelector('#sc-panel').getBoundingClientRect().height > 100);
  await sp2.click('#sc-enable');
  assert.equal(await sp2.evaluate(() => window.__params().scOn), false);
  assert.equal((await sp2.textContent('#sc-enable')).trim(), 'Off');
  assert.equal(await sp2.evaluate(() => document.querySelector('#sc-panel .acc-inner').inert), true, 'the panel is locked while off');
  assert.ok(Number(await sp2.evaluate(() => getComputedStyle(document.querySelector('#sc-panel .acc-inner')).opacity)) < 0.6, 'and dimmed');
  await sp2.click('#sc-enable'); assert.equal(await sp2.evaluate(() => window.__params().scOn), true);
  assert.equal(await sp2.evaluate(() => document.querySelector('#sc-panel .acc-inner').inert), false);
  // AUTO digits: a value that changes all the time is shown at most ~4 times a second
  await sp2.evaluate(() => { window.__setParam('threshold', -40); window.__setParam('ratio', 6); window.__setParam('autoAttack', true); window.__setParam('autoRelease', true); });
  await sp2.setInputFiles('#file', { name: 'a.wav', mimeType: 'audio/wav', buffer: wavBuffer(6, 44100, 220, 0.8) });
  await sp2.waitForFunction(() => window.__engineState().duration > 5); await sp2.click('#play');
  await sp2.waitForTimeout(800);
  const changes = await sp2.evaluate(() => new Promise((res) => { const el = document.querySelector('[data-knob="attack"] .knob-value'); let n = 0; const mo = new MutationObserver(() => n++); mo.observe(el, { childList: true, characterData: true, subtree: true }); setTimeout(() => { mo.disconnect(); res(n); }, 2000); }));
  assert.ok(changes <= 9, `the Attack digits were rewritten ${changes} times in 2 s (limit ~4 per second)`);
  await sp2.close();
});

await check('Hot bar (bottom left): 1:1 (Unity gain) and SYNC (Tempo sync) buttons with tooltips; Tempo sync turns Release and Attack into note values of the BPM field (the simulated host tempo)', async () => {
  const hp2 = await (await browser.newContext({ viewport: { width: 1180, height: 1000 } })).newPage();
  hp2.setDefaultTimeout(5000);
  await hp2.goto(url);
  const bar = await hp2.locator('#bottombar').boundingBox(), u = await hp2.locator('#unity-gain').boundingBox(), ts = await hp2.locator('#tempo-sync').boundingBox(), byp = await hp2.locator('#bypass').boundingBox();
  assert.ok(u.x < ts.x && ts.x < byp.x && u.x - bar.x < 40, 'icon buttons sit at the left of the bottom bar, Bypass at the right');
  for (const [id, key] of [['unity-gain', 'unity'], ['tempo-sync', 'tempoSync']]) assert.equal(await hp2.getAttribute(`#${id}`, 'data-tooltip'), key);
  assert.equal((await hp2.textContent('#unity-gain')).trim(), '1:1');
  assert.equal((await hp2.textContent('#tempo-sync')).trim(), 'SYNC', 'a word, not a note icon');
  assert.equal(await hp2.locator('#delta').count(), 0, 'Delta was removed');
  // Unity gain is an on/off monitoring button
  for (const [id, param] of [['unity-gain', 'unity']]) {
    assert.equal(await hp2.getAttribute(`#${id}`, 'aria-pressed'), 'false');
    await hp2.click(`#${id}`); assert.equal(await hp2.evaluate((k) => window.__params()[k], param), true); assert.equal(await hp2.getAttribute(`#${id}`, 'aria-pressed'), 'true');
    await hp2.click(`#${id}`); assert.equal(await hp2.evaluate((k) => window.__params()[k], param), false);
  }
  assert.equal(await hp2.getAttribute('#bpm', 'value'), '120');
  const txt = (id) => hp2.textContent(`[data-knob="${id}"] .knob-value`).then((t) => t.trim());
  assert.equal(await txt('release'), '120 ms'); assert.equal(await txt('attack'), '10 ms');
  await hp2.click('#tempo-sync');
  assert.equal(await hp2.getAttribute('#tempo-sync', 'aria-pressed'), 'true');
  assert.equal(await txt('release'), '1/8 \u00b7 250 ms'); assert.equal(await txt('attack'), '1/128 \u00b7 15.6 ms');
  assert.equal((await hp2.textContent('#bpm-readout')).trim(), '120 BPM');
  await hp2.fill('#bpm', '90');
  assert.equal(await txt('release'), '1/8 \u00b7 333 ms'); assert.equal(await txt('attack'), '1/128 \u00b7 20.8 ms'); assert.equal((await hp2.textContent('#bpm-readout')).trim(), '90 BPM');
  for (const [id, noteKey, start] of [['release', 'releaseNote', 4], ['attack', 'attackNote', 2]]) {
    const k = await hp2.locator(`[data-knob="${id}"] svg`).boundingBox();
    await hp2.mouse.move(k.x + k.width / 2, k.y + k.height / 2); await hp2.mouse.wheel(0, -100);
    const prm = await hp2.evaluate(() => window.__params());
    assert.equal(prm[noteKey], start + 1, `${id}: one note step per wheel notch`); assert.equal(prm[id], id === 'release' ? 120 : 10, `${id}: the millisecond value is untouched`);
    await hp2.waitForTimeout(150);
  }
  await hp2.click('#auto-attack');
  assert.equal(await hp2.evaluate(() => document.querySelector('[data-knob="attack"]').classList.contains('auto-on')), true, 'Auto Attack takes over from the note value');
  await hp2.click('#auto-attack');
  await hp2.click('#tempo-sync');
  assert.equal(await txt('release'), '120 ms', 'sync off: Release is milliseconds again, with the value it had'); assert.equal(await txt('attack'), '10 ms');
  // double-click on the empty display resets its zoom
  const b = await hp2.locator('canvas.display').boundingBox();
  await hp2.mouse.move(b.x + b.width * 0.8, b.y + 150); await hp2.mouse.wheel(0, 500);
  await hp2.click('#display-scale'); await hp2.click('.scale-item[data-id="12"]');
  assert.notEqual(await hp2.evaluate(() => window.__timeWindow()), 8);
  await hp2.mouse.dblclick(b.x + b.width * 0.8, b.y + 150);
  assert.equal(await hp2.evaluate(() => window.__timeWindow()), 8);
  assert.equal((await hp2.evaluate(() => window.__geom())).rangeDb, 36);
  await hp2.close();
});

await browser.close(); server.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
