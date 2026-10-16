import { clamp } from './util.js';
import { NOTES, DEFAULT_NOTE, ATTACK_NOTES, DEFAULT_ATTACK_NOTE } from './tempo.js';

export const STYLE_IDS = ['clean', 'classic', 'opto', 'vocal', 'bus', 'punch', 'varimu', 'pump', 'upward'];

const n = (min, max, def, unit) => ({ min, max, default: def, unit });

export const PARAM_SPECS = {
  threshold: n(-60, 12, -24, 'dB'),
  ratio: n(1, 100, 3, ':1'),
  knee: n(0, 30, 8, 'dB'),
  attack: n(0.1, 250, 10, 'ms'),
  release: n(0.1, 2500, 120, 'ms'),
  attackNote: { min: 0, max: ATTACK_NOTES.length - 1, default: DEFAULT_ATTACK_NOTE, unit: '', options: ATTACK_NOTES.map((_, i) => i) }, // Attack as a note value (used with Tempo Sync)
  releaseNote: { min: 0, max: NOTES.length - 1, default: DEFAULT_NOTE, unit: '', options: NOTES.map((_, i) => i) }, // Release as a note value (used with Tempo Sync)
  bpm: n(20, 300, 120, 'BPM'), // the project tempo, given by the host (in this demo: the BPM field)
  hold: n(0, 500, 0, 'ms'),
  range: n(0, 60, 60, 'dB'),
  lookahead: n(0, 10, 0, 'ms'),
  mix: n(0, 100, 100, '%'),
  gain: n(-24, 24, 0, 'dB'),
  sidechainHpf: n(20, 20000, 20, 'Hz'),
  scHpfSlope: { min: 6, max: 48, default: 12, unit: 'dB/oct', options: [6, 12, 24, 48] },
  scLevel: n(-24, 24, 0, 'dB'),
  scLpf: n(20, 20000, 20000, 'Hz'),
  scLpfSlope: { min: 6, max: 48, default: 12, unit: 'dB/oct', options: [6, 12, 24, 48] },
  scBandFreq: n(60, 12000, 1000, 'Hz'),
  scBandGain: n(-12, 12, 0, 'dB'),
  scBandQ: n(0.3, 8, 1, ''),
  upAmount: n(1, 3, 1, ':1'),
  upWindow: n(0, 30, 12, 'dB'),
  upMaxBoost: n(0, 24, 12, 'dB'),
  upFloor: n(-90, -6, -60, 'dB'),
  oversampling: { min: 1, max: 8, default: 1, unit: 'x', options: [1, 2, 4, 8] },
  tempoSync: { default: false }, // Release in note values of the project tempo
  lowLatency: { default: false }, // interface only: 30 fps graphics instead of 60
  autoGain: { default: true },
  autoRelease: { default: false },
  autoThreshold: { default: false },
  autoAttack: { default: false },
  scOn: { default: true }, // Side Chain switch: off = the detector hears the plain main input (no filters, no key)
  scListen: { default: false },
  unity: { default: false }, // Unity Gain (1:1): the makeup that keeps the input's loudness, so only the effect of the compression is heard
  scExternal: { default: false }, // the detector listens to a separate key input instead of the main input
  upward: { default: false },
  bypass: { default: false },
  loudnessMatch: { default: false }, // when bypassed, trim the dry signal to the compressed loudness
  style: { default: 'clean' },
};

export function defaults() {
  const d = {};
  for (const [k, s] of Object.entries(PARAM_SPECS)) d[k] = s.default;
  return d;
}

export function sanitize(partial = {}) {
  const out = defaults();
  for (const [k, v] of Object.entries(partial)) {
    const s = PARAM_SPECS[k];
    if (!s) continue;
    if (s.options) { // discrete choice: snap to the nearest option
      out[k] = Number.isFinite(v) ? s.options.reduce((a, o) => (Math.abs(o - v) < Math.abs(a - v) ? o : a)) : s.default;
    } else if (typeof s.default === 'number') {
      out[k] = Number.isFinite(v) ? clamp(v, s.min, s.max) : s.default;
    } else if (typeof s.default === 'boolean') {
      out[k] = Boolean(v);
    } else if (k === 'style') {
      out[k] = STYLE_IDS.includes(v) ? v : s.default;
    }
  }
  return out;
}
