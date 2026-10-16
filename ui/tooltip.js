export const TOOLTIP_DELAY_MS = 2500;

export const TOOLTIPS = {
  threshold: 'Level above which the compressor starts working. Lower it and more of the sound gets compressed; at 0 dB nothing below full scale is touched.',
  ratio: 'How strongly sound above the threshold is reduced. 2:1 turns 2 dB over the threshold into 1 dB; 10:1 and above acts almost like a limiter.',
  knee: 'How gradually compression kicks in around the threshold. A hard knee (0) bites at once, a soft knee blends in smoothly and sounds gentler.',
  attack: 'How fast the compressor reacts to loud sound. Slow lets the first hit through (punch), fast catches it and makes the sound softer.',
  release: 'How fast the compressor lets go after loud sound. Short gives energy and pumping, long sounds smooth and steady.',
  autoRelease: 'Release adapts to the material: short for rare hits, longer when the sound is compressed all the time. The knob shows the live value.',
  autoThreshold: 'The threshold follows the average input level, so the amount of compression stays similar when the input gets louder or quieter.',
  scLevel: 'Volume of the sidechain signal in Listen mode only. It does not change the sound of the compressor itself.',
  scLpf: 'Removes highs from the signal the compressor listens to, so bright sounds such as hi-hats trigger it less. Mouse wheel on the point sets the slope.',
  scBand: 'Boosts or cuts a frequency range in the signal the compressor listens to, to make it react more or less to that range.',
  scSlope: 'Mouse wheel on the HPF or LPF point sets its slope: 6, 12, 24 or 48 dB per octave. Steeper cuts are sharper.',
  scOn: 'Side Chain on or off. Off = the compressor listens to the plain input, with no filters and no external track.',
  scSource: 'Internal: the compressor listens to its own input. External: it listens to another track, for example a kick that ducks a bass.',
  scListen: 'Hear the signal the compressor listens to (after the filters) instead of the output. Handy to set HPF and LPF by ear.',
  autoAttack: 'Attack adapts to the signal: the further it exceeds the threshold, the faster the attack. The knob is the slowest attack and shows the live value.',
  hold: 'How long the compression is held before the release starts. Useful against distortion on low notes and for steadier bass.',
  range: 'Limits the maximum gain reduction. At 12 dB the compressor never turns the sound down by more than 12 dB, however loud the input gets.',
  lookahead: 'The compressor sees loud hits in advance and starts reducing before they arrive. Costs a little delay (latency).',
  style: 'Compression character: clean, optical, tube and more. A style changes detector, timing and knee, not your knob values.',
  autoGain: 'Keeps loudness the same before and after compression by adding makeup gain automatically, so you judge the sound and not the volume.',
  mix: 'Blends in the uncompressed sound. 100% is fully compressed; lower values give parallel compression that keeps the punch.',
  gain: 'Output level after compression (makeup gain). It is locked while Auto Gain or 1:1 is on.',
  sidechainHpf: "Removes bass from the signal the compressor listens to, so kicks and bass don't squash everything. Mouse wheel on the point sets the slope.",
  upward: 'Switches Upward compression on or off. It lifts quiet sound while normal compression turns loud sound down.',
  upAmount: 'How strongly quiet sound is lifted. 1:1 = off. At 2:1 every 2 dB below the Upward threshold is raised by 1 dB.',
  upWindow: 'Gap between the two thresholds. Sound inside the window is left alone; only sound below the lower line is lifted.',
  upMaxBoost: 'Shown on the right scale. The most gain that can be added to quiet sound. Keeps the lift under control so peaks do not clip and noise is not blown up.',
  upFloor: 'Below this input level nothing is lifted, so noise and silence between notes stay quiet instead of being raised.',
  ab: 'Two settings slots to compare. Switch between A and B while listening; the other slot keeps its settings.',
  unity: 'Unity gain: the output keeps the loudness of the input, so you hear only what the compressor does and not that it got quieter.',
  tempoSync: 'Tempo sync: Attack and Release are set in note values of the project tempo instead of milliseconds. AUTO knobs ignore it.',
  settings: 'Settings: oversampling for less aliasing, and low latency mode that draws the display at 30 fps to leave CPU for the audio.',
  lowLatency: 'Draws the display at 30 fps instead of 60 to leave more CPU for the audio. The sound is not affected.',
  scale: 'How many dB the display shows below 0 dB. A smaller range is closer up, 60 dB shows the whole threshold range.',
  oversampling: 'Processes at a higher sample rate for less aliasing. Higher values cost more CPU and add a little delay.',
  bypass: 'Turns the compressor off to compare with the original. Nothing is processed while it is on.',
  mode: 'Switches between the original and the processed sound at equal loudness, so the louder one does not seem better.',
};

let tipEl = null, timer = null;

function ensureEl() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

export function hideTooltip() {
  clearTimeout(timer); timer = null;
  if (tipEl) tipEl.classList.remove('show');
}

// Like FabFilter: the bubble always appears under the Help button (top right) with its pointer aimed at it.
function showTooltip(target, text) {
  const el = ensureEl();
  el.textContent = text;
  el.classList.add('show');
  const help = document.getElementById('help'), r = (help || target).getBoundingClientRect(), t = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.right - t.width));
  el.style.left = left + 'px';
  el.style.top = (r.bottom + 12) + 'px';
  el.style.setProperty('--arrow-x', Math.max(14, Math.min(t.width - 14, r.left + r.width / 2 - left)) + 'px');
}

// Shows `text` after the pointer rests on `el` for TOOLTIP_DELAY_MS. Leaving, clicking or dragging cancels it.
export function attachTooltip(el, text) {
  el.addEventListener('pointerenter', () => {
    hideTooltip();
    timer = setTimeout(() => showTooltip(el, text), TOOLTIP_DELAY_MS);
  });
  for (const ev of ['pointerleave', 'pointerdown', 'click', 'wheel']) el.addEventListener(ev, hideTooltip);
}
