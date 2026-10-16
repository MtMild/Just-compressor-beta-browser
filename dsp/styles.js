import { STYLE_IDS } from './params.js';
import { clamp } from './util.js';

// A style is plain data that shapes the shared engine: detector, ballistics, knee, colour.
//  detector: 'peak' | 'rms' | 'mix' (average of both)
//  attackScale / releaseScale: multipliers on the user's Attack / Release
//  releaseShape: 'fixed' | 'twoStage' (fast + slow release stage, relMul = [fast, slow] x release)
//  kneeBias: dB added to the Knee knob; varimu: ratio grows with gain reduction; saturation: 0..1 tanh colour
const S = (label, o) => ({
  label, detector: 'peak', attackScale: 1, releaseScale: 1, releaseShape: 'fixed', relMul: [1, 1],
  kneeBias: 0, varimu: 0, saturation: 0, upwardDefault: false, ...o,
});

export const STYLES = {
  clean: S('Clean', {}),
  classic: S('Classic', { detector: 'mix', attackScale: 0.6, kneeBias: -4 }),
  opto: S('Opto', { detector: 'rms', attackScale: 2.5, kneeBias: 8, releaseShape: 'twoStage', relMul: [0.2, 4] }),
  vocal: S('Vocal', { detector: 'rms', kneeBias: 4, releaseShape: 'twoStage', relMul: [0.3, 2] }),
  bus: S('Bus', { detector: 'rms', attackScale: 2, kneeBias: 6 }),
  punch: S('Punch', { attackScale: 3, releaseScale: 0.5, kneeBias: -2 }),
  varimu: S('Vari-Mu', { detector: 'rms', attackScale: 2, kneeBias: 6, varimu: 0.5, saturation: 0.3 }),
  pump: S('Pump', { attackScale: 0.5, releaseScale: 0.25, kneeBias: -4 }),
  upward: S('Upward', { detector: 'rms', attackScale: 1.5, kneeBias: 4, releaseShape: 'twoStage', relMul: [0.5, 3], upwardDefault: true }),
};

if (Object.keys(STYLES).join() !== STYLE_IDS.join()) throw new Error('STYLES and STYLE_IDS out of sync');

// Params a UI should apply when the user picks a style (only things a style owns, not knob values).
export const styleDefaults = (id) => ({ upward: STYLES[id].upwardDefault });

// Params as the gain computer sees them: the style's knee bias is added to the Knee knob.
// The knee may not reach below 0 dBFS-ish: its lower edge sits at threshold - knee/2, so near 0 dB it is squeezed (threshold 0 = a hard knee, nothing below full scale is touched).
export const effectiveParams = (p) => ({ ...p, knee: clamp(Math.min(p.knee + STYLES[p.style].kneeBias, 4 * Math.max(0, -p.threshold)), 0, 30) });
