import { attachTooltip, TOOLTIPS } from './tooltip.js';
import { ringColor } from './levelcolor.js';

const isLog = (spec) => spec.min > 0 && spec.max / spec.min >= 50;
export function valueToNorm(spec, v) {
  const c = Math.min(spec.max, Math.max(spec.min, v));
  return isLog(spec) ? Math.log(c / spec.min) / Math.log(spec.max / spec.min) : (c - spec.min) / (spec.max - spec.min);
}
export function normToValue(spec, n) {
  const c = Math.min(1, Math.max(0, n));
  return isLog(spec) ? spec.min * Math.pow(spec.max / spec.min, c) : spec.min + c * (spec.max - spec.min);
}

export function formatValue(id, spec, v) {
  switch (spec.unit) {
    case 'dB': return `${v.toFixed(1)} dB`;
    case ':1': return `${v.toFixed(1)}:1`;
    case 'ms': return v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`;
    case 'Hz': return `${Math.round(v)} Hz`;
    case '%': return `${Math.round(v)}%`;
    default: return v.toFixed(1);
  }
}

const SWEEP = 270, START = 135; // degrees, clockwise from 3 o'clock (135 = bottom-left). The Threshold knob runs -60 ... +12 dB, so its 0 dB sits at 3 o'clock, where the input ring has its 0 too
const pt = (cx, cy, r, deg) => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)];
const arc = (cx, cy, r, a0, a1) => {
  if (a1 - a0 < 0.01) return '';
  const [x0, y0] = pt(cx, cy, r, a0), [x1, y1] = pt(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

export { ringColor };
export const AUTO_TEXT_MS = 250; // the digits of an automated value update 4 times a second

let altGuard = false;
function guardAltKey() { // a lone Alt keyup would focus the browser menu bar on Windows
  if (altGuard) return; altGuard = true;
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt') e.preventDefault(); });
}

export function createKnob({ id, label, spec: spec0, value, format: format0 = null, onChange: onChange0, size = 'normal', auto = null, ring = false, tip = id }) {
  guardAltKey();
  let spec = spec0, onChange = onChange0; // the Release knob can switch between milliseconds and note values (Tempo Sync)
  const defaultFormat = (v) => formatValue(id, spec, v);
  let format = format0 || defaultFormat;
  const el = document.createElement('div');
  el.className = `knob ${size}`;
  el.dataset.knob = id; el.dataset.tooltip = tip;
  el.innerHTML = `<svg viewBox="0 0 64 64" role="slider" tabindex="0" aria-label="${label}">
      <circle class="body" cx="32" cy="32" r="21"/>
      ${ring ? '<line class="zero-tick"/><text class="zero-label" text-anchor="middle" dominant-baseline="middle">0</text>' : ''}
      <path class="track" d="${arc(32, 32, 27, START, START + SWEEP)}"/>
      <path class="fill"/><line class="ind" x1="32" y1="32" x2="32" y2="32"/></svg>
    <div class="knob-value"></div>
    <div class="knob-label">${label}</div>`;
  if (ring) { const cv = document.createElement('canvas'); cv.className = 'ring-canvas'; cv.width = cv.height = 176; el.appendChild(cv); }
  const svg = el.querySelector('svg'), fill = el.querySelector('.fill'), ind = el.querySelector('.ind'), val = el.querySelector('.knob-value');
  let current = value, autoOn = false, liveTarget = null, liveShown = null, raf = 0, textTimer = 0;
  const shown = () => (autoOn && liveShown !== null ? liveShown : current); // on AUTO the knob shows what the automation is doing

  const render = () => {
    const v = shown(), a = START + valueToNorm(spec, v) * SWEEP, [x0, y0] = pt(32, 32, 7, a), [x1, y1] = pt(32, 32, 17, a);
    fill.setAttribute('d', arc(32, 32, 27, START, a));
    ind.setAttribute('x1', x0); ind.setAttribute('y1', y0); ind.setAttribute('x2', x1); ind.setAttribute('y2', y1);
    if (!autoOn) val.textContent = format(v); // on AUTO the digits are refreshed 4x a second (textTimer) so they stay readable while the dial moves
    svg.setAttribute('aria-valuenow', String(v));
  };
  const set = (v, emit = true) => {
    current = Math.min(spec.max, Math.max(spec.min, v));
    if (spec.options) current = spec.options.reduce((a, o) => (Math.abs(o - current) < Math.abs(a - current) ? o : a)); // discrete knobs snap to their steps
    render(); if (emit && onChange) onChange(current);
  };
  const byNorm = (dn) => {
    if (autoOn) return;
    if (spec.options) { const i = spec.options.indexOf(current); set(spec.options[Math.max(0, Math.min(spec.options.length - 1, i + (dn > 0 ? 1 : -1)))]); return; } // a discrete knob moves one step per wheel notch or key press
    set(normToValue(spec, valueToNorm(spec, current) + dn));
  };

  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (autoOn) return; // AUTO owns the knob
    if (e.altKey) { e.preventDefault(); set(spec.default); return; }
    svg.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, n: valueToNorm(spec, current) };
    el.classList.add('dragging');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = e.shiftKey ? 1000 : 200; // pixels for the full range
    set(normToValue(spec, drag.n + (drag.y - e.clientY) / k));
    if (e.shiftKey) { drag.y = e.clientY; drag.n = valueToNorm(spec, current); }
  });
  const end = () => { drag = null; el.classList.remove('dragging'); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => { e.preventDefault(); byNorm((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.004 : 0.02)); }, { passive: false });
  svg.addEventListener('keydown', (e) => {
    if (autoOn) return;
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (d) { e.preventDefault(); byNorm(d * (e.shiftKey ? 0.002 : 0.01)); }
  });

  if (ring) { // live input level: a smooth green -> yellow -> orange -> red meter around the knob, 0 dB at 3 o'clock, red plus zone below it
    const ringA = (v) => START + valueToNorm(spec, v) * SWEEP, zeroA = ringA(0), tick = el.querySelector('.zero-tick'), zl = el.querySelector('.zero-label');
    const [tx0, ty0] = pt(32, 32, 26, zeroA), [tx1, ty1] = pt(32, 32, 34, zeroA), [lx, ly] = pt(32, 32, 41, zeroA);
    tick.setAttribute('x1', tx0); tick.setAttribute('y1', ty0); tick.setAttribute('x2', tx1); tick.setAttribute('y2', ty1);
    zl.setAttribute('x', lx); zl.setAttribute('y', ly);
    const cv = el.querySelector('.ring-canvas'), cx = cv.getContext('2d'), C = cv.width / 2, R = 31.5 * 2.25, rad = (d) => (d * Math.PI) / 180;
    const endA = ringA(spec.max);
    const grad = cx.createConicGradient(rad(START), C, C); // one continuous gradient around the whole scale
    for (let d = spec.min; d <= spec.max + 0.001; d += 3) grad.addColorStop(((ringA(d) - START) / 360), ringColor(d));
    let lastEnd = null;
    el.setRing = (levelDb) => { // lit up to the current level, the rest stays as a faint scale
      const on = levelDb !== null && Number.isFinite(levelDb);
      const end = !on ? START : ringA(Math.max(spec.min, Math.min(levelDb, spec.max)));
      if (lastEnd !== null && Math.abs(end - lastEnd) < 0.2) return; // nothing visible changed
      lastEnd = end;
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.lineWidth = 3.6 * 2.25; cx.strokeStyle = grad; cx.lineCap = 'butt';
      cx.globalAlpha = 0.16; cx.beginPath(); cx.arc(C, C, R, rad(START), rad(endA)); cx.stroke();
      if (end > START + 0.1) { cx.globalAlpha = 1; cx.beginPath(); cx.arc(C, C, R, rad(START), rad(end)); cx.stroke(); }
      cx.globalAlpha = 1;
    };
    el.setRing(null);
  }
  if (auto) { // small AUTO pill under the label (never starts a drag: it lives outside the slider)
    const pill = document.createElement('button');
    pill.type = 'button'; pill.id = auto.id; pill.className = 'auto-pill'; pill.textContent = 'AUTO';
    pill.setAttribute('aria-pressed', 'false'); pill.dataset.tooltip = auto.tip;
    pill.addEventListener('click', (e) => { e.stopPropagation(); auto.onToggle(); });
    attachTooltip(pill, TOOLTIPS[auto.tip] || '');
    el.appendChild(pill);
    el.setAuto = (v) => { pill.setAttribute('aria-pressed', String(Boolean(v))); setAutoMode(Boolean(v)); };
  }
  function tick() { // ease the dial towards the value the automation reports so it visibly turns by itself
    if (!autoOn || liveTarget === null) { raf = 0; return; }
    liveShown += (liveTarget - liveShown) * 0.25;
    if (Math.abs(liveTarget - liveShown) < (spec.max - spec.min) * 1e-4) liveShown = liveTarget;
    render();
    raf = liveShown === liveTarget ? 0 : requestAnimationFrame(tick);
  }
  function setAutoMode(on) {
    autoOn = on; el.classList.toggle('auto-on', on);
    svg.setAttribute('aria-disabled', String(on)); svg.tabIndex = on ? -1 : 0;
    if (on && liveTarget !== null && liveShown === null) liveShown = liveTarget;
    if (!on) liveShown = null;
    clearInterval(textTimer); textTimer = 0;
    if (on) textTimer = setInterval(() => { val.textContent = format(shown()); }, AUTO_TEXT_MS);
    render(); val.textContent = format(shown());
  }
  el.setLive = (v) => { // the value AUTO is currently using (null when unknown)
    if (v === null || !Number.isFinite(v)) return;
    liveTarget = Math.min(spec.max, Math.max(spec.min, v));
    if (liveShown === null) liveShown = liveTarget;
    if (autoOn && !raf) raf = requestAnimationFrame(tick);
  };
  attachTooltip(el, TOOLTIPS[tip] || '');
  render();
  el.setValue = (v) => set(v, false);
  el.setSpec = ({ spec: s, format: f = null, onChange: oc, value: v }) => { spec = s; format = f || defaultFormat; onChange = oc; set(v, false); }; // swap what the knob controls
  Object.defineProperty(el, 'value', { get: () => current });
  return el;
}
