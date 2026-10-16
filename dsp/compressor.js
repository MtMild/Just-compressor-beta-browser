import { sanitize } from './params.js';
import { STYLES } from './styles.js';
import { computeGainDb } from './gain.js';
import { dbToLin, linToDb, clamp } from './util.js';
import { Biquad, makeStages, configureCut } from './filters.js';
import { noteToMs, ATTACK_NOTES } from './tempo.js';

export { Biquad };

const AUTO_TAU_S = 2;
const AUTO_BLOCK = 64;
const AUTO_REL_DENSITY_S = 0.7; // Auto Release looks at how much of the last ~0.7 s was spent compressing
const AUTO_THR_TAU_S = 0.6, AUTO_THR_SMOOTH_S = 0.8; // Auto Threshold: level averaged over ~0.6 s, then eased over ~0.8 s: follows a section change in about 2-3 s
const AUTO_REL_MIN_MS = 30, AUTO_REL_MAX_MS = 800;
const AUTO_FAST_S = 2; // after a setting change Auto Gain re-learns quickly for this long, then goes back to its slow, pump-free tracking
const AUTO_FAST_TAU_S = 0.1;
const AUTO_WATCH = ['threshold', 'ratio', 'knee', 'range', 'style', 'upward', 'upAmount', 'upWindow', 'upMaxBoost', 'upFloor', 'autoGain', 'autoThreshold', 'unity'];
const LA_FADE_S = 0.08; // a look-ahead change is a crossfade between the old and the new delay (a sliding delay would bend the pitch)
const UPWARD_MIN_LOOKAHEAD_MS = 2; // with Upward on the detector must see a hit before the boosted signal reaches the output
const RETRACT_MS = 0.5;
const AUTO_THR_REF_DB = -18; // Auto Threshold: input RMS that leaves the threshold knob unchanged
const AUTO_THR_FREEZE_DB = -80;
const AUTO_THR_PAUSE_DB = 24; // input more than this far below the slow level = a pause: keep the offset
const PEAK_RELEASE_MS = 10; // peak envelope decay: keeps sine ripple below ~0.1 dB at 1 kHz

const coef = (ms, sr) => Math.exp(-1 / Math.max(ms * 0.001 * sr, 1e-3));

// Transparent below 0.5, then smoothly bounded below 1.0 (used for Listen so a boosted detector signal cannot blast the speakers).
const softLimit = (x) => { const a = Math.abs(x); return a <= 0.5 ? x : Math.sign(x) * (0.5 + 0.5 * Math.tanh((a - 0.5) / 0.5)); };

export class Compressor {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.p = sanitize({});
    this.cfg = STYLES.clean;
    this.pe = { ...this.p };
    this.size = Math.ceil(0.01 * sampleRate) + 4;
    this.dly = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0;
    this.hp = [makeStages(), makeStages()]; this.hpN = 1; this.hpSlope = 12;
    this.lp = [makeStages(), makeStages()]; this.lpN = 1; this.lpSlope = 12;
    this.bp = [new Biquad(), new Biquad()];
    this.ms = [0, 0];
    this.pk = [0, 0];
    this.gF = [0, 0]; this.gS = [0, 0]; this.hold = [0, 0];
    this.thrOffset = 0; this.effThr = -24; this.lis = 0;
    this.dens = 0; this.autoRelMs = 120; this.curAttMs = 10; this.ovr = [0, 0]; this.attShow = Math.log(10);
    this.gIn = 0; this.gOut = 0; this.autoFast = Math.round(AUTO_FAST_S * sampleRate);
    this.byp = 0; this.trim = 1; this.autoOffset = 0; this.pIn = 0; this.pOut = 0; this.autoCount = 0;
    this.lv = new Float64Array(2); this.lin = new Float64Array(2);
    this.laA = 0; this.laB = 0; this.laFade = 1; this.started = false; // delay taps (samples): the current one and the one being faded in
    this.trimTarget = 1; this.inPeak = 0; this.outPeak = 0; this.gainDbNow = 0;
    this._derive();
  }

  get autoGainDb() { return this.p.autoGain ? this.autoOffset : 0; }

  setParams(partial) {
    const prev = this.p;
    this.p = sanitize({ ...this.p, ...partial });
    if (AUTO_WATCH.some((k) => prev[k] !== this.p[k])) this.autoFast = Math.round(AUTO_FAST_S * this.sr);
    this.cfg = STYLES[this.p.style];
    this._derive();
  }

  _derive() {
    const { sr, p, cfg } = this;
    const minLa = p.upward ? Math.round(UPWARD_MIN_LOOKAHEAD_MS * 0.001 * sr) : 0;
    this.laSamples = Math.max(Math.round(p.lookahead * 0.001 * sr), minLa);
    if (!this.started) { this.laA = this.laB = this.laSamples; this.laFade = 1; }
    this.attKnobMs = p.tempoSync && !p.autoAttack ? noteToMs(p.attackNote, p.bpm, ATTACK_NOTES, 250) : p.attack; // Tempo Sync: the attack is a note value (Auto Attack keeps the knob as its maximum)
    this.retractC = coef(Math.min(this.attKnobMs * cfg.attackScale, RETRACT_MS), sr);
    this.attMs = this.attKnobMs * cfg.attackScale;
    this.attC = coef(this.attMs, sr);
    this.relMul = cfg.releaseShape === 'twoStage' ? cfg.relMul : p.autoRelease ? [0.25, 2.5] : [1, 1];
    this.relKnobMs = p.tempoSync ? noteToMs(p.releaseNote, p.bpm) : p.release; // Tempo Sync: the release is a note value of the project tempo
    this._setRelease(p.autoRelease ? this.autoRelMs : this.relKnobMs);
    this.densC = 1 - Math.exp(-1 / (AUTO_REL_DENSITY_S * sr));
    this.ovC = 1 - Math.exp(-1 / (0.12 * sr));
    this.attShowC = 1 - Math.exp(-1 / (0.25 * sr));
    this.tC = Math.exp(-1 / (AUTO_THR_TAU_S * sr)); this.tCFast = Math.exp(-1 / (0.3 * sr));
    this.thrStep = 1 - Math.exp(-AUTO_BLOCK / (AUTO_THR_SMOOTH_S * sr)); this.thrStepFast = 1 - Math.exp(-AUTO_BLOCK / (0.15 * sr));
    if (!p.autoThreshold) this.thrOffset = 0;
    Object.assign(this.pe, p, { knee: clamp(p.knee + cfg.kneeBias, 0, 30) });
    this.effThr = this.pe.threshold = clamp(p.threshold + this.thrOffset, -60, 12);
    this.holdSamples = Math.round(p.hold * 0.001 * sr);
    this.scLin = dbToLin(p.scLevel);
    const wasHp = this.hpfOn, wasLp = this.lpfOn, wasBand = this.bandOn;
    this.hpfOn = p.scOn && p.sidechainHpf > 20.5;
    if (this.hpfOn) {
      for (let c = 0; c < 2; c++) this.hpN = configureCut(this.hp[c], 'hp', p.sidechainHpf, sr, p.scHpfSlope);
      if (!wasHp || p.scHpfSlope !== this.hpSlope) for (const ch of this.hp) for (const st of ch) st.z1 = st.z2 = 0;
    }
    this.hpSlope = p.scHpfSlope;
    this.lpfOn = p.scOn && p.scLpf < 19999;
    if (this.lpfOn) {
      for (let c = 0; c < 2; c++) this.lpN = configureCut(this.lp[c], 'lp', p.scLpf, sr, p.scLpfSlope);
      if (!wasLp || p.scLpfSlope !== this.lpSlope) for (const ch of this.lp) for (const st of ch) st.z1 = st.z2 = 0;
    }
    this.lpSlope = p.scLpfSlope;
    this.bandOn = p.scOn && Math.abs(p.scBandGain) > 0.05;
    if (this.bandOn) for (const f of this.bp) { f.setPeaking(p.scBandFreq, p.scBandGain, p.scBandQ, sr); if (!wasBand) f.z1 = f.z2 = 0; }
    if (!this.started) this.lis = p.scListen ? 1 : 0;
    this.rmsC = coef(10, sr);
    this.pkC = coef(PEAK_RELEASE_MS, sr);
    this.peakDecay = coef(300, sr);
    this.bypStep = 1 / (0.005 * sr);
    this.laStep = 1 / (LA_FADE_S * sr);
    this.autoStep = 1 - Math.exp(-AUTO_BLOCK / (0.5 * sr));
    this.pC = Math.exp(-1 / (AUTO_TAU_S * sr));
    this.pCFast = Math.exp(-1 / (AUTO_FAST_TAU_S * sr));
    this.autoStepFast = 1 - Math.exp(-AUTO_BLOCK / (0.05 * sr));
  }

  get latencySamples() { return this.laSamples; }

  // relMs is in knob terms; the style scales it. Fast and slow stage use the style's (or Auto Release's) multipliers.
  _setRelease(relMs) {
    const rel = relMs * this.cfg.releaseScale, mul = this.relMul;
    this.relFastC = coef(rel * mul[0], this.sr);
    this.relSlowC = coef(rel * mul[1], this.sr);
  }

  // One smoothing stage in the dB domain. Falling gain = attack (or fast retraction of a boost); rising = release unless held.
  _stage(g, target, relC, holding) {
    if (target < g) return target + (g - target) * (g > 0 ? this.retractC : this.attC);
    return holding ? g : target + (g - target) * relC;
  }

  get meters() {
    const { p } = this;
    return { gainDb: this.gainDbNow, inPeakDb: linToDb(this.inPeak), outPeakDb: linToDb(this.outPeak), thresholdDb: this.effThr,
      autoAttackMs: p.autoAttack ? this.curAttMs : this.attKnobMs, autoReleaseMs: p.autoRelease ? this.autoRelMs : this.relKnobMs }; // what Attack / Release are really doing now
  }

  // keyL/keyR: the external sidechain (key) input; used only when the External switch is on (a missing key counts as silence).
  process(inL, inR, outL, outR, n, keyL = null, keyR = null) {
    const { p, cfg, size, dly, laSamples: la } = this;
    const det = cfg.detector, useRms = det !== 'peak', pe = this.pe;
    const wet = p.mix / 100, bypT = p.bypass ? 1 : 0, ext = p.scOn && p.scExternal;
    const gF = this.gF, gS = this.gS, hold = this.hold, lv = this.lv, lin0 = this.lin;
    this.started = true;
    for (let i = 0; i < n; i++) {
      const x0 = inL[i], x1 = inR[i];
      dly[0][this.w] = x0; dly[1][this.w] = x1;
      if (this.laFade >= 1 && this.laB !== la) { this.laB = la; this.laFade = 0; } // start a crossfade to the new delay once the last one has finished
      const rA = (this.w - this.laA + size) % size;
      let d0 = dly[0][rA], d1 = dly[1][rA];
      if (this.laFade < 1) {
        this.laFade = Math.min(1, this.laFade + this.laStep);
        const rB = (this.w - this.laB + size) % size, f = this.laFade;
        d0 += (dly[0][rB] - d0) * f; d1 += (dly[1][rB] - d1) * f;
        if (f >= 1) this.laA = this.laB; // the new delay is fully in
      }
      this.w = (this.w + 1) % size;

      // detector (sidechain path only)
      const k0 = ext ? (keyL ? keyL[i] : 0) : x0, k1 = ext ? (keyR ? keyR[i] : 0) : x1; // what the detector is fed: the main input or the key
      let s0 = k0, s1 = k1;
      if (this.hpfOn) for (let k = 0; k < this.hpN; k++) { s0 = this.hp[0][k].process(s0); s1 = this.hp[1][k].process(s1); }
      if (this.lpfOn) for (let k = 0; k < this.lpN; k++) { s0 = this.lp[0][k].process(s0); s1 = this.lp[1][k].process(s1); }
      if (this.bandOn) { s0 = this.bp[0].process(s0); s1 = this.bp[1].process(s1); }
      this.pk[0] = Math.max(Math.abs(s0), this.pk[0] * this.pkC);
      this.pk[1] = Math.max(Math.abs(s1), this.pk[1] * this.pkC);
      let l0 = this.pk[0], l1 = this.pk[1];
      if (useRms) {
        this.ms[0] = this.ms[0] * this.rmsC + s0 * s0 * (1 - this.rmsC);
        this.ms[1] = this.ms[1] * this.rmsC + s1 * s1 * (1 - this.rmsC);
        const r0 = Math.sqrt(this.ms[0]) * Math.SQRT2, r1 = Math.sqrt(this.ms[1]) * Math.SQRT2;
        if (det === 'rms') { l0 = r0; l1 = r1; } else { l0 = 0.5 * (l0 + r0); l1 = 0.5 * (l1 + r1); }
      }
      const mx = Math.max(l0, l1);
      lv[0] = mx; lv[1] = mx; // channels are always linked: same gain reduction left and right

      // gain computer + ballistics (dB domain)
      let gSum = 0;
      for (let c = 0; c < 2; c++) {
        if (cfg.varimu) pe.ratio = p.ratio * (1 + cfg.varimu * clamp(-(0.5 * (gF[c] + gS[c])) / 12, 0, 2));
        const lvDb = linToDb(lv[c]);
        const target = computeGainDb(lvDb, pe);
        // Auto Attack: the knob is the maximum; the further above the threshold, the faster (never below 0.1 ms)
        if (p.autoAttack) { // follows the recent overshoot (rises at once, falls over ~120 ms), not every single sample
          const over = Math.max(0, lvDb - pe.threshold); let ov = this.ovr[c];
          ov = over > ov ? over : ov + (over - ov) * this.ovC; this.ovr[c] = ov;
          const am = Math.max(0.1, this.attMs * Math.pow(10, -ov / 20)); this.attC = coef(am, this.sr);
          if (c === 0) { this.attShow += (Math.log(am / cfg.attackScale) - this.attShow) * this.attShowC; this.curAttMs = Math.exp(this.attShow); } // the readout is smoothed further
        }
        const gf = gF[c], attacking = target < gf;
        if (attacking) hold[c] = this.holdSamples;
        const holding = !attacking && hold[c] > 0;
        if (holding) hold[c]--;
        gF[c] = this._stage(gf, target, this.relFastC, holding);
        gS[c] = this._stage(gS[c], target, this.relSlowC, holding);
        const g = 0.5 * (gF[c] + gS[c]);
        gSum += g;
        lin0[c] = dbToLin(g);
      }
      this.gainDbNow = gSum / 2;
      this.dens += (clamp(-this.gainDbNow / 6, 0, 1) - this.dens) * this.densC; // graded: deeper reduction counts more

      const w0 = d0 * lin0[0], w1 = d1 * lin0[1];

      // slow loudness tracking for Auto Gain (dry vs. compressed, before makeup)
      const fast = this.autoFast > 0; if (fast) this.autoFast--;
      const tc = fast ? this.tCFast : this.tC; // the level Auto Threshold follows is that of the detector input (the key when External)
      this.pIn = this.pIn * tc + (k0 * k0 + k1 * k1) * (1 - tc);
      const gc = fast ? this.pCFast : this.pC; // Auto Gain keeps its own power averages so the Auto Threshold level stays slow
      this.gIn = this.gIn * gc + (x0 * x0 + x1 * x1) * (1 - gc);
      this.gOut = this.gOut * gc + (w0 * w0 + w1 * w1) * (1 - gc);
      if (++this.autoCount >= AUTO_BLOCK) {
        this.autoCount = 0;
        if (this.gIn > 1e-12 && this.gOut > 1e-12) {
          const t = clamp(10 * Math.log10(this.gIn / this.gOut), -24, 24);
          this.autoOffset += (t - this.autoOffset) * (this.autoFast > 0 ? this.autoStepFast : this.autoStep);
        }
        if (p.autoRelease) { this.autoRelMs = AUTO_REL_MIN_MS * Math.pow(AUTO_REL_MAX_MS / AUTO_REL_MIN_MS, this.dens); this._setRelease(this.autoRelMs); }
        if (p.autoThreshold) {
          const levelDb = 10 * Math.log10(this.pIn * 0.5 + 1e-30); // slow RMS per channel
          const fastDb = linToDb(this.inPeak);
          if (levelDb > AUTO_THR_FREEZE_DB && fastDb > levelDb - AUTO_THR_PAUSE_DB) this.thrOffset += (levelDb - AUTO_THR_REF_DB - this.thrOffset) * (fast ? this.thrStepFast : this.thrStep);
          this.thrOffset = clamp(this.thrOffset, -60 - p.threshold, 12 - p.threshold); // the effective threshold never sits on the clamp
          this.effThr = pe.threshold = clamp(p.threshold + this.thrOffset, -60, 12);
        }
        const delta = (p.unity ? this.autoOffset : p.gain + (p.autoGain ? this.autoOffset : 0)) - this.autoOffset;
        this.trimTarget = p.loudnessMatch ? dbToLin(delta) : 1;
      }
      this.trim += (this.trimTarget - this.trim) * 0.0005;
      const mk = dbToLin(p.unity ? this.autoOffset : p.gain + (p.autoGain ? this.autoOffset : 0)); // Unity Gain: exactly the makeup that keeps the loudness of the input (Gain and Auto Gain are not used)
      let v0 = w0 * mk, v1 = w1 * mk;
      if (cfg.saturation) { const a = cfg.saturation; v0 = (1 - a) * v0 + a * Math.tanh(v0); v1 = (1 - a) * v1 + a * Math.tanh(v1); }
      const o0 = d0 * (1 - wet) + v0 * wet;
      const o1 = d1 * (1 - wet) + v1 * wet;

      // bypass crossfade
      if (this.byp < bypT) this.byp = Math.min(bypT, this.byp + this.bypStep);
      else if (this.byp > bypT) this.byp = Math.max(bypT, this.byp - this.bypStep);
      const b = this.byp;
      let y0 = d0 * this.trim * b + o0 * (1 - b), y1 = d1 * this.trim * b + o1 * (1 - b);
      const lisT = p.scListen ? 1 : 0;
      if (this.lis < lisT) this.lis = Math.min(lisT, this.lis + this.bypStep);
      else if (this.lis > lisT) this.lis = Math.max(lisT, this.lis - this.bypStep);
      if (this.lis > 0) { const l = this.lis; y0 = y0 * (1 - l) + softLimit(s0 * this.scLin) * l; y1 = y1 * (1 - l) + softLimit(s1 * this.scLin) * l; }

      this.inPeak = Math.max(Math.abs(x0), Math.abs(x1), this.inPeak * this.peakDecay);
      this.outPeak = Math.max(Math.abs(y0), Math.abs(y1), this.outPeak * this.peakDecay);
      outL[i] = y0; outR[i] = y1;
    }
  }
}
