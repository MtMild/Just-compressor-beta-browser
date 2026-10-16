import { COLORS } from './theme.js';
import { frameInterval } from './perf.js';
import { ringColor } from './levelcolor.js';

const W = 64, H = 400, TOP = 36, GR_RANGE = 24, OUT_RANGE = 72, CLIP_DB = -0.1, CLIP_HOLD_MS = 1500, READOUT_MS = 250; // numbers refresh ~4x per second so the digits stay readable

export function formatGr(db) { return Math.abs(db) < 0.05 ? '0.0' : db < 0 ? db.toFixed(1) : '+' + db.toFixed(1); }
export function formatOut(db) { return db < -99 ? '-inf' : db.toFixed(1); }

// Slows a numeric readout down: shows the first value at once, then only every `interval` ms the extreme (pick = Math.min/Math.max) of what happened in between.
export function createReadout(interval, pick, empty) {
  let shown = null, last = 0, acc = empty;
  return {
    push(v, now) {
      acc = pick(acc, v);
      if (shown === null) { shown = v; last = now; acc = empty; }
      else if (now - last >= interval) { shown = acc; last = now; acc = empty; }
      return shown;
    },
  };
}

// Meters column: GR and OUT numbers on top, gain-reduction bar (hangs from the top, red) and output bar with peak hold.
// Clipping lights a small red block.
export function createMeters() {
  const el = document.createElement('div');
  el.className = 'meter-col';
  el.innerHTML = '<div class="meter-nums"><span id="gr-readout" class="gr-num">0.0</span><span id="out-readout" class="out-num">-inf</span></div>';
  const canvas = document.createElement('canvas');
  canvas.className = 'meters';
  el.appendChild(canvas);
  const grNum = el.querySelector('#gr-readout'), outNum = el.querySelector('#out-readout');
  const ctx = canvas.getContext('2d');
  let gain = 0, out = -120, peak = -120, peakAt = 0, clipAt = -1e9, shownGr = '', shownOut = '';
  const grRead = createReadout(READOUT_MS, Math.min, 1e9), outRead = createReadout(READOUT_MS, Math.max, -1e9);

  let dirty = true, lastDraw = 0, lastClip = false;
  function push(m) {
    dirty = true; gain = m.gainDb; out = m.outPeakDb;
    const now = performance.now();
    if (out > peak || now - peakAt > 1200) { peak = out; peakAt = now; }
    if (out > CLIP_DB) clipAt = now;
    const g = formatGr(grRead.push(gain, now)), o = formatOut(outRead.push(out, now));
    if (g !== shownGr) { grNum.textContent = shownGr = g; }
    if (o !== shownOut) { outNum.textContent = shownOut = o; }
  }

  function draw(now) {
    requestAnimationFrame(draw);
    const clippingNow = performance.now() - clipAt < CLIP_HOLD_MS;
    if (!dirty && clippingNow === lastClip) return; // nothing new
    if (now - lastDraw < frameInterval()) return;
    dirty = false; lastDraw = now; lastClip = clippingNow;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLORS.bg1; ctx.fillRect(0, 0, W, H);
    const barH = H - TOP - 20, bx = 10, ox = 38;
    // gain reduction: left bar hanging from the top, red
    const gr = Math.max(0, -gain) / GR_RANGE * barH;
    const grad = ctx.createLinearGradient(0, TOP, 0, TOP + barH);
    grad.addColorStop(0, COLORS.red); grad.addColorStop(1, COLORS.redDim);
    ctx.fillStyle = COLORS.grid; ctx.fillRect(bx, TOP, 16, barH);
    ctx.fillStyle = grad; ctx.fillRect(bx, TOP, 16, Math.min(gr, barH));
    if (gain > 0.05) { const bh = Math.min(gain / GR_RANGE * barH, TOP - 4); ctx.fillStyle = COLORS.boost; ctx.fillRect(bx, TOP - bh, 16, bh); }
    // output level: right bar from the bottom with peak hold
    const lv = (db) => Math.max(0, Math.min(1, (db + OUT_RANGE) / OUT_RANGE)) * barH;
    const g2 = ctx.createLinearGradient(0, TOP + barH, 0, TOP);
    for (let db = -OUT_RANGE; db <= 0; db += 6) g2.addColorStop((db + OUT_RANGE) / OUT_RANGE, ringColor(db)); // the same green -> red as the Threshold ring
    ctx.fillStyle = COLORS.grid; ctx.fillRect(ox, TOP, 16, barH);
    ctx.fillStyle = g2; ctx.fillRect(ox, TOP + barH - lv(out), 16, lv(out));
    ctx.fillStyle = COLORS.white; ctx.fillRect(ox, TOP + barH - lv(peak) - 1, 16, 2);
    const clipping = performance.now() - clipAt < CLIP_HOLD_MS;
    ctx.fillStyle = clipping ? COLORS.clip : COLORS.grey2;
    ctx.fillRect(ox, TOP - 12, 16, 8);
    ctx.fillStyle = COLORS.textDim; ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('GR', bx + 8, H - 6); ctx.fillText('OUT', ox + 8, H - 6);
  }
  requestAnimationFrame(draw);
  return { el, push };
}
