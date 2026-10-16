import { COLORS } from './theme.js';
import { frameInterval } from './perf.js';
import { attachTooltip, TOOLTIPS } from './tooltip.js';
import { makeScGeom, freqToX, xToFreq, gainToY, responseDb, scNodes, scHit, scDragTo, scWheelNode, scReset, spectrumLevel, makeResponse } from './sc-math.js';

const HEIGHT = 200;
const fmtF = (f) => (f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`);

// Sidechain EQ: grey display with the live input spectrum, the combined detector-filter response and three draggable nodes.
export function createScEq({ getParams, setParam, getSpectrum, getSampleRate = () => 48000, isVisible = () => true }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'sc-eq';
  const ctx = canvas.getContext('2d');
  canvas.dataset.tooltip = 'scSlope'; attachTooltip(canvas, TOOLTIPS.scSlope);
  let g = makeScGeom(640, HEIGHT), hover = null, drag = null, lastSlopeWheel = -1e9;

  function fit() {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 640;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(HEIGHT * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (g.w !== w) g = makeScGeom(w, HEIGHT);
  }

  const syncGeom = () => { const w = canvas.clientWidth || 640; if (g.w !== w) g = makeScGeom(w, HEIGHT); };

  let spec = null;
  function render() {
    fit();
    const p = getParams(), sr = getSampleRate(), resp = makeResponse(p, sr); // filters set up once per frame
    ctx.clearRect(0, 0, g.w, g.h);
    ctx.fillStyle = COLORS.scBg; ctx.fillRect(0, 0, g.w, g.h);
    ctx.strokeStyle = COLORS.grey2; ctx.lineWidth = 1; ctx.font = '9px system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const x = Math.round(freqToX(g, f)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, g.h); ctx.stroke();
      ctx.fillStyle = COLORS.grey1; ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x, g.h - 11);
    }
    for (const db of [-12, 0, 12]) { const y = Math.round(gainToY(g, db)) + 0.5; ctx.strokeStyle = db === 0 ? COLORS.grey1 : COLORS.grey2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(g.w, y); ctx.stroke(); }

    if (spec) { // ghost = the original input spectrum; in front = what the detector hears (input + the filter curve)
      const { data, sr: ssr } = spec, nyq = ssr / 2, bottom = g.h - 14, span = g.h - 30, xs = [], raw = [], filt = [];
      for (let x = g.padL; x <= g.w - g.padR; x += 2) {
        const lvl = spectrumLevel(data, nyq, xToFreq(g, x - 1), xToFreq(g, x + 1));
        xs.push(x); raw.push(lvl); filt.push(lvl + resp(xToFreq(g, x)));
      }
      const yOf = (m) => bottom - Math.max(0, Math.min(1, (m + 100) / 100)) * span;
      const smooth = (arr) => arr.map((v, i) => (arr[Math.max(0, i - 1)] + 2 * v + arr[Math.min(arr.length - 1, i + 1)]) / 4);
      const area = (arr, fill, line) => {
        const ys = arr.map(yOf);
        ctx.beginPath(); ctx.moveTo(xs[0], bottom); ctx.lineTo(xs[0], ys[0]);
        for (let i = 1; i < xs.length; i++) ctx.quadraticCurveTo(xs[i - 1], ys[i - 1], (xs[i - 1] + xs[i]) / 2, (ys[i - 1] + ys[i]) / 2);
        ctx.lineTo(xs.at(-1), ys.at(-1)); ctx.lineTo(xs.at(-1), bottom); ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
        if (line) { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke(); }
      };
      area(smooth(raw), COLORS.ghostFill, COLORS.ghostLine);
      area(smooth(filt), COLORS.histFill, null);
    }

    const curve = new Path2D();
    for (let x = g.padL; x <= g.w - g.padR; x += 2) {
      const y = gainToY(g, resp(xToFreq(g, x))); // no clamping: steep cuts bend down smoothly
      x === g.padL ? curve.moveTo(x, y) : curve.lineTo(x, y);
    }
    ctx.lineWidth = 7; ctx.strokeStyle = COLORS.glow; ctx.stroke(curve); // soft halo (cheaper than a canvas shadow)
    ctx.lineWidth = 2.5; ctx.strokeStyle = COLORS.curve; ctx.stroke(curve);

    const n = scNodes(g, p, sr), active = drag ? drag.id : hover;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = '600 9px system-ui, sans-serif';
    for (const [id, label0] of [['hpf', 'HPF'], ['band', 'BAND'], ['lpf', 'LPF']]) {
      const label = id === 'hpf' ? (p.sidechainHpf > 20.5 ? `HPF ${p.scHpfSlope}` : 'HPF') : id === 'lpf' ? (p.scLpf < 19999 ? `LPF ${p.scLpfSlope}` : 'LPF') : label0; // the slope is written right on the point
      ctx.beginPath(); ctx.arc(n[id].x, n[id].y, id === active ? 11 : 9, 0, Math.PI * 2); ctx.fillStyle = COLORS.glow; ctx.fill();
      ctx.beginPath(); ctx.arc(n[id].x, n[id].y, id === active ? 7 : 5.5, 0, Math.PI * 2);
      ctx.fillStyle = id === active ? COLORS.accentHi : COLORS.accent; ctx.fill();
      ctx.fillStyle = COLORS.text; ctx.fillText(label, Math.min(g.w - 14, Math.max(14, n[id].x)), n[id].y - 9);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = COLORS.textDim; ctx.font = '10px system-ui, sans-serif';
    const hpf = p.sidechainHpf > 20.5 ? `${fmtF(p.sidechainHpf)} ${p.scHpfSlope} dB/oct` : 'off', lpf = p.scLpf < 19999 ? `${fmtF(p.scLpf)} ${p.scLpfSlope} dB/oct` : 'off';
    const band = Math.abs(p.scBandGain) > 0.05 ? `${fmtF(p.scBandFreq)} ${p.scBandGain > 0 ? '+' : ''}${p.scBandGain.toFixed(1)} dB Q${p.scBandQ.toFixed(1)}` : 'off';
    ctx.fillText(`HPF ${hpf}   BAND ${band}   LPF ${lpf}`, 10, 6);
    ctx.textAlign = 'right'; ctx.fillText('wheel on HPF/LPF point = slope (dB/oct), on BAND = Q   Alt+click = reset', g.w - 10, 6);
  }

  // Draws only while the Side Chain block is open, and only when something changed (parameters, mouse, a new spectrum), at most 60 times a second (30 in Low latency mode).
  let dirty = true, lastDraw = 0, lastSig = '', wasVisible = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const vis = isVisible();
    if (!vis) { wasVisible = false; return; }
    if (!wasVisible) { wasVisible = true; dirty = true; }
    spec = getSpectrum(); // null when nothing plays
    const sig = JSON.stringify(getParams());
    if (sig !== lastSig) { lastSig = sig; dirty = true; }
    if (spec || canvas.clientWidth !== g.w) dirty = true;
    if (!dirty || now - lastDraw < frameInterval()) return;
    dirty = false; lastDraw = now; render();
  }

  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const apply = (partial) => { for (const [k, v] of Object.entries(partial)) setParam(k, v); };
  canvas.addEventListener('pointermove', (ev) => {
    const [x, y] = pos(ev); dirty = true;
    if (drag) { apply(scDragTo(drag.id, g, getParams(), x, y)); return; }
    hover = scHit(g, getParams(), x, y, getSampleRate());
    canvas.style.cursor = hover ? (hover === 'band' ? 'move' : 'ew-resize') : 'default';
  });
  canvas.addEventListener('pointerdown', (ev) => {
    const [x, y] = pos(ev), id = scHit(g, getParams(), x, y, getSampleRate());
    if (!id) return;
    if (ev.altKey) { ev.preventDefault(); apply(scReset(id)); return; }
    canvas.setPointerCapture(ev.pointerId); drag = { id };
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; });
  canvas.addEventListener('wheel', (ev) => {
    const [x, y] = pos(ev);
    const id = scHit(g, getParams(), x, y, getSampleRate());
    if (!id) return;
    ev.preventDefault();
    const now = performance.now();
    if (id !== 'band' && now - lastSlopeWheel < 140) return; // one slope step per flick on a trackpad
    if (id !== 'band') lastSlopeWheel = now;
    apply(scWheelNode(id, getParams(), ev.deltaY));
  }, { passive: false });

  requestAnimationFrame(frame);
  return { el: canvas, geom: () => { syncGeom(); return { ...g }; }, nodes: () => { syncGeom(); return scNodes(g, getParams(), getSampleRate()); } };
}
