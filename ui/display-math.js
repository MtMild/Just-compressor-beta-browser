import { computeGainDb } from '../dsp/gain.js';
import { effectiveParams, STYLES } from '../dsp/styles.js';
import { clamp } from '../dsp/util.js';

const HIT_R = 11, LINE_HIT = 8, KNEE_TAB_Y = 44;

export function makeGeom(w, h, rangeDb) {
  const gutter = 44, top = 56, bottom = 8; // `top` px of headroom above 0 dB: boost and signal in the plus
  const plotW = w - gutter;
  return { w, h, rangeDb, gutter, top, plotW, pxPerDb: (h - top - bottom) / rangeDb, curveX0: 0, curveW: plotW * 0.55 };
}
export const RANGES = [6, 12, 18, 24, 36, 48, 60]; // visible dB scale: 0 down to -6 ... -60 (60 = the whole threshold range)
export const DEFAULT_RANGE_INDEX = 4; // 36 dB
// The wheel zooms the TIME axis of the envelope (not the dB scale): smooth, continuous, limited at both ends.
export const WINDOW_MIN_S = 2, WINDOW_MAX_S = 30, WINDOW_DEFAULT_S = 8;
export function zoomWindow(seconds, deltaY) {
  return clamp(seconds * Math.exp(deltaY * 0.0015), WINDOW_MIN_S, WINDOW_MAX_S); // wheel up (negative) shows less time = a wider envelope
}
// Grid: labelled lines every `major` dB, unlabelled lines every `minor` dB in between (to see roughly where -1, -2 ... are).
export function gridSteps(rangeDb) {
  return { major: rangeDb <= 6 ? 1 : rangeDb <= 12 ? 2 : rangeDb <= 24 ? 3 : 6, minor: rangeDb <= 36 ? 1 : 2 };
}
export const dbToY = (g, db) => g.top + -db * g.pxPerDb;
export const yToDb = (g, y) => -(y - g.top) / g.pxPerDb;
export const inToX = (g, db) => g.curveX0 + ((db + g.rangeDb) / g.rangeDb) * g.curveW;
export const xToIn = (g, x) => ((x - g.curveX0) / g.curveW) * g.rangeDb - g.rangeDb;

// Handles that fall outside the zoomed range stay on the plot edge (still draggable) instead of vanishing.
const onPlotX = (g, x) => clamp(x, 4, g.plotW - 4), onPlotY = (g, y) => clamp(y, 6, g.h - 8);
export function handles(g, p) {
  const e = effectiveParams(p), out = (x) => x + computeGainDb(x, e);
  const h = {
    threshold: { x: onPlotX(g, inToX(g, p.threshold)), y: onPlotY(g, dbToY(g, p.threshold)) },
    knee: { x: onPlotX(g, inToX(g, p.threshold + e.knee / 2)), y: g.top + KNEE_TAB_Y },
    ratio: { x: inToX(g, 0), y: onPlotY(g, dbToY(g, out(0))) },
  };
  if (p.upward) { // Window: the gap between the two thresholds; the second handle sits on the Upward threshold
    const tup = p.threshold - p.upWindow;
    h.upWindow = { x: onPlotX(g, inToX(g, tup)), y: onPlotY(g, dbToY(g, tup)) };
  }
  return h;
}

export function dragTo(id, g, p, x, y) {
  const db = yToDb(g, y);
  switch (id) {
    case 'threshold': return { threshold: clamp(db, -60, 12) };
    case 'knee': return { knee: clamp(2 * (xToIn(g, x) - p.threshold) - STYLES[p.style].kneeBias, 0, 30) };
    case 'ratio': {
      const d = Math.min(db, 0) - p.threshold;
      return { ratio: d <= 0.05 ? 100 : clamp(-p.threshold / d, 1, 100) };
    }
    case 'upWindow': return { upWindow: clamp(p.threshold - db, 0, 30) };
    default: return {};
  }
}

export function hitTest(g, p, x, y) {
  const h = handles(g, p);
  let best = null, bestD = HIT_R;
  for (const id of ['knee', 'ratio', 'upWindow']) {
    if (!h[id]) continue;
    if (id === 'ratio' && p.threshold > -1) continue;
    const d = Math.hypot(x - h[id].x, y - h[id].y);
    if (d <= bestD) { best = id; bestD = d; }
  }
  if (best) return best;
  if (x >= 0 && x <= inToX(g, 0) + 16 && Math.abs(y - h.threshold.y) <= LINE_HIT) return 'threshold'; // the dashed line is drawn over the curve zone only
  return null;
}

// Builds the smooth envelope shape on a canvas context (or Path2D): curves through the midpoints of `pts` [[x, y], ...].
// fill = true gives one closed shape down to the bottom edge `h`; false gives just the open outline.
export function envelopePath(c, pts, plotW, h, fill) {
  c.beginPath();
  if (fill) { c.moveTo(pts[0][0], h); c.lineTo(pts[0][0], pts[0][1]); } else c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], (pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2);
  c.lineTo(plotW, pts.at(-1)[1]);
  if (fill) { c.lineTo(plotW, h); c.closePath(); }
}
