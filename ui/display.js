import { COLORS } from './theme.js';
import { frameInterval } from './perf.js';
import { createMenu } from './controls.js';
import { computeGainDb } from '../dsp/gain.js';
import { effectiveParams } from '../dsp/styles.js';
import { makeGeom, dbToY, inToX, handles, dragTo, hitTest, envelopePath, RANGES, DEFAULT_RANGE_INDEX, zoomWindow, WINDOW_MIN_S, WINDOW_MAX_S, WINDOW_DEFAULT_S, gridSteps } from './display-math.js';

const HIST = 2048, REPORT_S = 0.016; // ~33 s of history at the worklet's 16 ms report interval; the wheel picks how much of it is shown
const HEIGHT = 400;

export function createDisplay({ getParams, setParam }) {
  const el = document.createElement('div');
  el.className = 'display-wrap';
  el.innerHTML = '<canvas class="display"></canvas>';
  const canvas = el.querySelector('canvas'), ctx = canvas.getContext('2d');
  let rangeIdx = DEFAULT_RANGE_INDEX, g = makeGeom(800, HEIGHT, RANGES[rangeIdx]), hover = null, drag = null, effThr = null;
  let dirty = true, lastDraw = 0, lastSig = '', lastPushT = 0, shift = 0;
  let windowS = WINDOW_DEFAULT_S, shownS = WINDOW_DEFAULT_S; // wanted / currently shown time span (eased towards the wanted one)
  const inDb = new Float32Array(HIST).fill(-120), outDb = new Float32Array(HIST).fill(-120), gain = new Float32Array(HIST);
  let head = 0, N = Math.round(WINDOW_DEFAULT_S / REPORT_S);

  // dB scale (how many dB below 0 the display shows): a dropdown at the bottom right, like Pro-Q's Scale
  const scale = createMenu({ buttonId: 'display-scale', menuId: 'display-scale-menu', itemClass: 'scale-item', tip: 'scale', radio: true, up: true,
    items: RANGES.map((r) => ({ id: String(r), label: `${r} dB` })), onPick: (id) => setRange(RANGES.indexOf(Number(id))) });
  scale.classList.add('scale-menu');
  el.appendChild(scale);
  const setRange = (i) => { dirty = true; rangeIdx = i; scale.setLabel(`${RANGES[i]} dB`); scale.setActive(RANGES[i]); g = makeGeom(g.w, g.h, RANGES[rangeIdx]); };
  setRange(rangeIdx);
  // Wheel = smooth time zoom of the envelope (wider/narrower), never the dB scale or the height
  canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); dirty = true; windowS = zoomWindow(windowS, ev.deltaY * (ev.deltaMode === 1 ? 16 : 1)); }, { passive: false });

  // With Auto Threshold the engine reports the effective threshold; the display shows and edits that one.
  const viewParams = () => { const p = getParams(); return p.autoThreshold && effThr !== null ? { ...p, threshold: effThr } : p; };

  function pushMeters(m) { dirty = true; lastPushT = performance.now(); head = (head + 1) % HIST; inDb[head] = m.inDb; outDb[head] = Number.isFinite(m.outDb) ? m.outDb : -120; gain[head] = m.gainDb; if (Number.isFinite(m.thresholdDb)) effThr = m.thresholdDb; }

  function fit() {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 800;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(HEIGHT * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (g.w !== w) g = makeGeom(w, HEIGHT, RANGES[rangeIdx]);
  }

  const xAtIdx = (i) => (i / (N - 1)) * g.plotW - shift; // i = 0 is the oldest shown sample; `shift` scrolls smoothly between two meter reports
  const ix = (i) => (head + 1 + (HIST - N) + i) % HIST;

  // Background, zone, grid and dB labels only change with the size and the dB scale: painted once into an offscreen layer and blitted every frame.
  const layer = document.createElement('canvas'), lctx = layer.getContext('2d');
  let layerKey = '';
  function paintStatic() {
    const dpr = window.devicePixelRatio || 1, key = `${g.w}|${g.rangeDb}|${dpr}`;
    if (key !== layerKey) {
      layerKey = key; layer.width = canvas.width; layer.height = canvas.height;
      const c = lctx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const bg = c.createLinearGradient(0, 0, 0, g.h);
        bg.addColorStop(0, COLORS.bg1); bg.addColorStop(1, COLORS.bg0);
        c.fillStyle = bg; c.fillRect(0, 0, g.w, g.h);

        // grey backdrop behind the transfer curve and knee
        const zx = inToX(g, 0) + 16, zg = c.createLinearGradient(0, g.top, 0, g.h);
        zg.addColorStop(0, COLORS.zoneBg); zg.addColorStop(1, COLORS.zoneFade);
        c.fillStyle = zg; c.fillRect(0, g.top, zx, g.h - g.top);
        c.strokeStyle = COLORS.grey2; c.lineWidth = 1;
        c.beginPath(); c.moveTo(zx + 0.5, g.top); c.lineTo(zx + 0.5, g.h); c.stroke();

        // grid + dB scale
        c.font = '10px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
        const { major, minor } = gridSteps(g.rangeDb);
        for (let db = 0; db >= -g.rangeDb; db -= minor) { // thin unlabelled lines in between show roughly where -1, -2 ... are
          if (db % major === 0) continue;
          const y = dbToY(g, db);
          c.strokeStyle = COLORS.gridMinor; c.lineWidth = 1;
          c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(g.plotW, y + 0.5); c.stroke();
        }
        for (let db = 0; db >= -g.rangeDb; db -= major) {
          const y = dbToY(g, db);
          c.strokeStyle = db === 0 ? COLORS.grey1 : COLORS.grid; c.lineWidth = 1;
          c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(g.plotW, y + 0.5); c.stroke();
          c.fillStyle = db === 0 ? COLORS.white : COLORS.textDim; c.font = db === 0 ? '600 10px system-ui, sans-serif' : '10px system-ui, sans-serif';
          c.fillText(db === 0 ? '0 dB' : String(db), g.plotW + 8, y);
        }
        // above the 0 dB line is the plus: boost and any signal over 0 dB
        c.font = '10px system-ui, sans-serif'; c.fillStyle = COLORS.textDim;
        for (const db of [3, 6]) { const y = dbToY(g, db); if (y > 8) { c.strokeStyle = COLORS.grid; c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(g.plotW, y + 0.5); c.stroke(); c.fillText(`+${db}`, g.plotW + 8, y); } }

    }
    ctx.drawImage(layer, 0, 0, g.w, g.h);
  }

  function render() {
    fit();
    shownS += (windowS - shownS) * 0.25; if (Math.abs(windowS - shownS) < 1e-3) shownS = windowS; // eased zoom
    N = Math.max(8, Math.min(HIST, Math.round(shownS / REPORT_S)));
    const step = Math.max(1, Math.floor(N / 600)); // at most ~600 points per line
    shift = Math.min(1, (performance.now() - lastPushT) / (REPORT_S * 1000)) * (g.plotW / (N - 1)) * step; // sub-step scroll: no stair-stepping from the 16 ms reports vs the 60 Hz frames
    const p = viewParams(), e = effectiveParams(p);
    paintStatic();
    // envelopes: the original input is a faint ghost behind, the compressed output is the main (see-through) area
    const plus = (v) => dbToY(g, Math.max(-g.rangeDb, Math.min((g.top - 4) / g.pxPerDb, v))); // signal over 0 dB rises into the plus zone
    const envelope = (arr, fill, line, lw) => {
      const pts = []; for (let i = 0; i < N; i += step) pts.push([xAtIdx(i), plus(arr[ix(i)])]);
      envelopePath(ctx, pts, g.plotW, g.h, true); ctx.fillStyle = fill; ctx.fill();
      envelopePath(ctx, pts, g.plotW, g.h, false); ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
    };
    const fade = (a0, a1) => { const f = ctx.createLinearGradient(0, g.top, 0, g.h); f.addColorStop(0, a0); f.addColorStop(1, a1); return f; };
    // gain reduction hangs from the 0 dB line, boost rises above it; the soft fills sit BEHIND the envelopes so input and output stay readable
    const zero = g.top;
    const gy = (v) => (v < 0 ? zero + Math.min(-v * g.pxPerDb, g.h - zero) : zero - Math.min(v * g.pxPerDb, zero - 4));
    for (const sign of [-1, 1]) { // reduction (red, hangs down) and boost (light purple, rises up) filled separately
      ctx.beginPath(); ctx.moveTo(0, zero);
      for (let i = 0; i < N; i += step) { const v = gain[ix(i)]; ctx.lineTo(xAtIdx(i), gy(sign * v > 0 ? v : 0)); }
      ctx.lineTo(g.plotW, zero); ctx.closePath();
      ctx.fillStyle = sign < 0 ? COLORS.grFill : COLORS.boostFill; ctx.fill();
    }
    envelope(inDb, COLORS.ghostFill, COLORS.ghostLine, 1.75); // input: a faint solid ghost line (a dashed one looked like stair steps)
    envelope(outDb, fade(COLORS.outFill, COLORS.outFade), COLORS.outLine, 1.5); // output: solid light purple
    // legend: what is what (red = what is being compressed)
    { ctx.font = '600 9px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; let lx = g.plotW - 6;
      for (const [label, color] of [['Reduction', COLORS.red], ['Output', COLORS.outLine], ['Input', COLORS.ghostLine]]) {
        const w = ctx.measureText(label).width; lx -= w; ctx.fillStyle = COLORS.textDim; ctx.fillText(label, lx, 12);
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(lx - 8, 12, 3.2, 0, Math.PI * 2); ctx.fill(); lx -= 24;
      } }

    const grPath = new Path2D(), boostPath = new Path2D(); // one stroke per colour instead of one per segment
    for (let i = step; i < N; i += step) {
      const a = gain[ix(i - step)], b = gain[ix(i)], path = (a + b) / 2 > 0.05 ? boostPath : grPath;
      path.moveTo(xAtIdx(i - step), gy(a)); path.lineTo(xAtIdx(i), gy(b));
    }
    ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.gr; ctx.stroke(grPath); ctx.strokeStyle = COLORS.boost; ctx.stroke(boostPath);
    // Range: reduction can never go deeper than this line
    if (p.range < 59.5) {
      const ry = zero + p.range * g.pxPerDb;
      if (ry < g.h - 2) {
        ctx.setLineDash([6, 6]); ctx.lineWidth = 1; ctx.strokeStyle = COLORS.rangeLine;
        ctx.beginPath(); ctx.moveTo(0, ry + 0.5); ctx.lineTo(g.plotW, ry + 0.5); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = COLORS.rangeText; ctx.font = '600 9px system-ui, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(`RANGE -${Math.round(p.range)} dB`, g.plotW - 6, ry - 7);
        ctx.textAlign = 'left';
      }
    }

    // the display melts into the knob area below
    const melt = ctx.createLinearGradient(0, g.h - 110, 0, g.h);
    melt.addColorStop(0, COLORS.meltFrom); melt.addColorStop(1, COLORS.bg0);
    ctx.fillStyle = melt; ctx.fillRect(0, g.h - 110, g.w, 110);

    // transfer curve (input on x within the left part, output on y) with 1:1 reference
    const outAt = (x) => Math.max(-g.rangeDb, Math.min((g.top - 4) / g.pxPerDb, x + computeGainDb(x, e)));
    ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = COLORS.edge;
    ctx.beginPath(); ctx.moveTo(inToX(g, -g.rangeDb), dbToY(g, -g.rangeDb)); ctx.lineTo(inToX(g, 0), dbToY(g, 0)); ctx.stroke();
    if (p.range < 59.5) { // Range: the curve cannot fall below the 1:1 line shifted down by Range
      ctx.setLineDash([6, 6]); ctx.strokeStyle = COLORS.rangeLine;
      ctx.beginPath(); ctx.moveTo(inToX(g, -g.rangeDb), dbToY(g, -g.rangeDb - p.range)); ctx.lineTo(inToX(g, 0), dbToY(g, -p.range)); ctx.stroke(); ctx.setLineDash([]);
    }
    const lifts = p.upward && p.upMaxBoost > 0.05; // with Max Boost 0 nothing is lifted: no shading, but Floor and Window stay
    if (p.upward && p.upFloor >= -g.rangeDb) { // Floor: nothing is lifted left of this input level
      ctx.setLineDash([2, 4]); ctx.lineWidth = 1; ctx.strokeStyle = COLORS.boost;
      ctx.beginPath(); ctx.moveTo(inToX(g, p.upFloor), g.top); ctx.lineTo(inToX(g, p.upFloor), g.h); ctx.stroke(); ctx.setLineDash([]);
    }
    if (lifts) { // shaded area between the 1:1 line and the curve where quiet sound is lifted
      ctx.beginPath(); let started = false;
      for (let x = -g.rangeDb; x <= 0; x += 0.5) { if (computeGainDb(x, e) > 0.05) { const X = inToX(g, x), Y = dbToY(g, outAt(x)); started ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); started = true; } }
      for (let x = 0; x >= -g.rangeDb; x -= 0.5) if (computeGainDb(x, e) > 0.05) ctx.lineTo(inToX(g, x), dbToY(g, x));
      ctx.closePath(); ctx.fillStyle = COLORS.boostFill; ctx.fill();
    }
    const curve = new Path2D();
    for (let x = -g.rangeDb; x <= 0; x += 0.5) { const X = inToX(g, x), Y = dbToY(g, outAt(x)); x === -g.rangeDb ? curve.moveTo(X, Y) : curve.lineTo(X, Y); }
    ctx.lineWidth = 7; ctx.strokeStyle = COLORS.glow; ctx.stroke(curve); // soft halo (cheaper than a canvas shadow)
    ctx.lineWidth = 2.5; ctx.strokeStyle = COLORS.curve; ctx.stroke(curve);
    if (lifts) { // the lifting part of the curve in light purple, thicker
      ctx.beginPath(); ctx.lineWidth = 3.5; ctx.strokeStyle = COLORS.boost; let on = false;
      for (let x = -g.rangeDb; x <= 0; x += 0.5) {
        if (computeGainDb(x, e) > 0.05) { const X = inToX(g, x), Y = dbToY(g, outAt(x)); on ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); on = true; } else if (on) break;
      }
      ctx.stroke();
    }

    // threshold line only over the curve zone (over the envelope it sat on top of the red line at 0 dB); Window and Floor lines with just their name and value
    const zoneW = inToX(g, 0) + 16;
    ctx.setLineDash([5, 5]); ctx.lineWidth = 1; ctx.strokeStyle = COLORS.thresholdLine;
    const ty = dbToY(g, p.threshold);
    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(zoneW, ty); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(inToX(g, p.threshold), g.top); ctx.lineTo(inToX(g, p.threshold), g.h); ctx.stroke();
    if (p.upward) {
      const label = (text, y, below) => { ctx.setLineDash([]); ctx.fillStyle = COLORS.boost; ctx.font = '600 9px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(text, g.plotW - 6, below ? y + 10 : y - 7); ctx.textAlign = 'left'; };
      const uy = Math.min(dbToY(g, p.threshold - p.upWindow), g.h - 8);
      ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(0, uy); ctx.lineTo(g.plotW, uy); ctx.stroke();
      label(`WINDOW ${Math.round(p.upWindow)} dB`, uy, false);
      if (p.upFloor >= -g.rangeDb && dbToY(g, p.upFloor) < g.h - 6) {
        const fy = dbToY(g, p.upFloor);
        ctx.setLineDash([2, 4]); ctx.strokeStyle = COLORS.boost; ctx.beginPath(); ctx.moveTo(0, fy + 0.5); ctx.lineTo(g.plotW, fy + 0.5); ctx.stroke();
        label(`FLOOR ${Math.round(p.upFloor)} dB`, fy, true);
      }
    }
    ctx.setLineDash([]);
    if (p.upward) { // Max Boost: shown only on the right, on the scale; the plus zone above 0 dB is where the boost rises
      const by = Math.max(11, g.top - p.upMaxBoost * g.pxPerDb), clamped = g.top - p.upMaxBoost * g.pxPerDb < 11, bx = g.plotW + 3, bw = g.gutter - 6;
      ctx.strokeStyle = COLORS.boost; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g.plotW, by + 0.5); ctx.lineTo(bx + 3, by + 0.5); ctx.stroke();
      ctx.fillStyle = COLORS.accentLo; ctx.beginPath(); ctx.roundRect(bx + 3, by - 8, bw - 3, 16, 4); ctx.fill();
      ctx.fillStyle = COLORS.text; ctx.font = '600 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${clamped ? '\u25B2' : ''}+${Math.round(p.upMaxBoost)}`, bx + 3 + (bw - 3) / 2, by); ctx.textAlign = 'left';
    }

    // handles
    const h = handles(g, p), active = drag ? drag.id : hover;
    const dot = (id, x, y) => {
      ctx.beginPath(); ctx.arc(x, y, id === active ? 10 : 8, 0, Math.PI * 2); ctx.fillStyle = COLORS.glow; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, id === active ? 6.5 : 5, 0, Math.PI * 2);
      ctx.fillStyle = id === active ? COLORS.accentHi : COLORS.accent; ctx.fill();
    };
    dot('threshold', h.threshold.x, h.threshold.y);
    if (p.threshold <= -1) dot('ratio', h.ratio.x, h.ratio.y);
    if (h.upWindow) dot('upWindow', h.upWindow.x, h.upWindow.y);
    ctx.fillStyle = active === 'knee' ? COLORS.accentHi : COLORS.accentLo;
    ctx.beginPath(); ctx.roundRect(h.knee.x - 20, h.knee.y - 9, 40, 18, 5); ctx.fill();
    ctx.fillStyle = COLORS.text; ctx.textAlign = 'center'; ctx.font = '600 9px system-ui, sans-serif';
    ctx.fillText('KNEE', h.knee.x, h.knee.y);
  }

  // Redraw only when something changed (new meters, a parameter, the mouse, the zoom) and at most 60 times a second (30 in Low latency mode): the canvas is the expensive part.
  function frame(now) {
    requestAnimationFrame(frame);
    const sig = JSON.stringify(getParams());
    if (sig !== lastSig) { lastSig = sig; dirty = true; }
    if (shownS !== windowS || canvas.clientWidth !== g.w || performance.now() - lastPushT < 100) dirty = true; // keeps scrolling smoothly while meters arrive
    if (!dirty || now - lastDraw < frameInterval()) return;
    dirty = false; lastDraw = now; render();
  }

  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointermove', (ev) => {
    const [x, y] = pos(ev); dirty = true;
    if (drag) {
      const view = viewParams(), off = view.threshold - getParams().threshold;
      for (const [k, v] of Object.entries(dragTo(drag.id, g, view, x, y))) setParam(k, k === 'threshold' ? v - off : v);
      return;
    }
    hover = hitTest(g, viewParams(), x, y);
    canvas.style.cursor = hover === 'knee' ? 'ew-resize' : hover ? 'ns-resize' : 'default';
  });
  canvas.addEventListener('pointerdown', (ev) => {
    const [x, y] = pos(ev), id = hitTest(g, viewParams(), x, y);
    if (!id) return;
    canvas.setPointerCapture(ev.pointerId); drag = { id }; dirty = true;
  });
  const end = () => { drag = null; dirty = true; };
  canvas.addEventListener('dblclick', (ev) => { const [x, y] = pos(ev); if (!hitTest(g, viewParams(), x, y)) { windowS = WINDOW_DEFAULT_S; setRange(DEFAULT_RANGE_INDEX); dirty = true; } }); // double-click on empty display: back to the default zoom and dB scale
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; dirty = true; });

  requestAnimationFrame(frame);
  return { el, pushMeters, windowSeconds: () => windowS,
    /* 1:1: back to the default time zoom and dB scale */ resetView() { windowS = WINDOW_DEFAULT_S; setRange(DEFAULT_RANGE_INDEX); dirty = true; }, geom: () => ({ ...g }), handles: () => handles(g, viewParams()), drawnThreshold: () => viewParams().threshold };
}
