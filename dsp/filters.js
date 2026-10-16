// Filters for the detector path. Cut filters are Butterworth cascades: the overall response is maximally flat
// (-3 dB at the cutoff, no resonance peak); a higher slope only makes the bend steeper.
// Second-order filter (transposed direct form II) with RBJ cookbook coefficient setters.
export class Biquad {
  constructor() { this.z1 = 0; this.z2 = 0; this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; }
  _set(b0, b1, b2, a0, a1, a2) { this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; }
  setHighpass1(f, sr) { // first order, 6 dB/oct
    const k = Math.tan(Math.PI * Math.min(f, 0.45 * sr) / sr);
    this._set(1 / (1 + k), -1 / (1 + k), 0, 1, (k - 1) / (1 + k), 0);
  }
  setLowpass1(f, sr) {
    const k = Math.tan(Math.PI * Math.min(f, 0.45 * sr) / sr);
    this._set(k / (1 + k), k / (1 + k), 0, 1, (k - 1) / (1 + k), 0);
  }
  setHighpass(f, sr, q = Math.SQRT1_2) { // q = sharpness of the bend at the cutoff
    f = Math.min(f, 0.45 * sr); // frequencies near or above Nyquist would make the filter unstable
    const w = 2 * Math.PI * f / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    this._set((1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al);
  }
  setLowpass(f, sr, q = Math.SQRT1_2) {
    f = Math.min(f, 0.45 * sr);
    const w = 2 * Math.PI * f / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    this._set((1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al);
  }
  setPeaking(f, gainDb, q, sr) {
    f = Math.min(f, 0.45 * sr);
    const A = Math.pow(10, gainDb / 40), w = 2 * Math.PI * f / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    this._set(1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A);
  }
  // Magnitude response in dB at frequency f (used by the UI to draw the filter curve with the exact DSP coefficients).
  magnitudeDb(f, sr) {
    const w = 2 * Math.PI * f / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = -(this.b1 * s1 + this.b2 * s2);
    const dr = 1 + this.a1 * c1 + this.a2 * c2, di = -(this.a1 * s1 + this.a2 * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) + 1e-30);
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    if (!(Math.abs(this.z1) < 1e15 && Math.abs(this.z2) < 1e15)) { this.z1 = 0; this.z2 = 0; return 0; } // never keep NaN/Infinity
    if (Math.abs(this.z1) < 1e-20) this.z1 = 0;
    if (Math.abs(this.z2) < 1e-20) this.z2 = 0;
    return y;
  }
}


export const SLOPE_OPTIONS = [6, 12, 24, 48]; // dB per octave
// Q of each biquad section of a Butterworth cascade; 6 dB/oct is a single first-order section (null).
export const SLOPE_STAGES = { 6: null, 12: [Math.SQRT1_2], 24: [0.5412, 1.3066], 48: [0.5098, 0.6013, 0.9, 2.5629] };
export const MAX_STAGES = 4;
export const makeStages = () => Array.from({ length: MAX_STAGES }, () => new Biquad());

// Sets up `stages` as a high-pass ('hp') or low-pass ('lp') of the given slope; returns how many stages are in use.
export function configureCut(stages, kind, f, sr, slope) {
  const qs = SLOPE_STAGES[slope];
  if (qs === null) { kind === 'hp' ? stages[0].setHighpass1(f, sr) : stages[0].setLowpass1(f, sr); return 1; }
  qs.forEach((q, k) => (kind === 'hp' ? stages[k].setHighpass(f, sr, q) : stages[k].setLowpass(f, sr, q)));
  return qs.length;
}
