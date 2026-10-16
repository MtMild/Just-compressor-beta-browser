import { clamp } from './util.js';

const FLOOR_FADE_DB = 10;

// Downward part: soft-knee compression above the threshold. Returns dB (<= 0).
function downwardDb(levelDb, p) {
  const T = p.threshold, W = p.knee, R = p.ratio;
  const d = levelDb - T;
  let gain;
  if (2 * d < -W) gain = 0;
  else if (W > 0 && 2 * Math.abs(d) <= W) {
    const k = d + W / 2;
    gain = (1 / R - 1) * k * k / (2 * W);
  } else gain = d / R - d;
  return Math.max(gain, -p.range);
}

// Upward part: lifts levels below T_up = threshold - window. Returns dB (>= 0).
function upwardDb(levelDb, p) {
  const Tup = p.threshold - p.upWindow, W = p.knee, k = 1 - 1 / p.upAmount;
  const d = Tup - levelDb; // > 0 when below T_up
  let boost;
  if (2 * d < -W) boost = 0;
  else if (W > 0 && 2 * Math.abs(d) <= W) {
    const e = d + W / 2;
    boost = k * e * e / (2 * W);
  } else boost = d * k;
  boost = Math.min(boost, p.upMaxBoost);
  const f = clamp((levelDb - p.upFloor) / FLOOR_FADE_DB, 0, 1);
  return boost * f * f * (3 - 2 * f); // smoothstep fade so noise below the floor is not raised
}

// Static gain computer. Returns gain in dB (negative = reduction, positive = boost).
export function computeGainDb(levelDb, p) {
  const g = downwardDb(levelDb, p);
  return p.upward ? g + upwardDb(levelDb, p) : g;
}
