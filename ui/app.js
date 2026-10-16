import { createTransport } from './transport.js';
import { createKnob } from './knob.js';
import { createDisplay } from './display.js';
import { createMeters } from './meters.js';
import { createAccordion } from './accordion.js';
import { createScEq } from './sc-eq.js';
import { createStore } from './store.js';
import { createToggle, createMenu, createSegmented } from './controls.js';
import { applyThemeVars, COLORS } from './theme.js';
import { setLowLatency, frameInterval } from './perf.js';
import { attachTooltip, TOOLTIPS } from './tooltip.js';
import { PARAM_SPECS } from '../dsp/params.js';
import { STYLES } from '../dsp/styles.js';
import { PRESETS } from '../dsp/presets.js';
import { NOTES, ATTACK_NOTES, noteToMs } from '../dsp/tempo.js';

applyThemeVars();
const app = document.getElementById('app');
const plugin = document.createElement('div');
plugin.id = 'plugin';
const root = plugin; // everything below builds the plugin frame; the Demo player is added outside it
const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
let engine = null, keyName = '', hostBpm = 120; // hostBpm: the project tempo (the host's in a plugin, the BPM field here)

const store = createStore({
  onChange(params, keys) {
    syncUI(params);
    if (engine) engine.setParams(Object.fromEntries(keys.map((k) => [k, params[k]])));
  },
});
const setParam = (k, v) => store.set(k, v);

// ---- top bar ----
const top = el('div', 'topbar');
const logo = el('div', 'logo', 'Purple<span>&middot;</span>C');
const undo = el('button', 'icon-btn', 'Undo'); undo.id = 'undo'; undo.type = 'button';
const redo = el('button', 'icon-btn', 'Redo'); redo.id = 'redo'; redo.type = 'button';
undo.addEventListener('click', () => store.undo());
redo.addEventListener('click', () => store.redo());

const ab = el('div', 'ab-group'); ab.dataset.tooltip = 'ab'; attachTooltip(ab, TOOLTIPS.ab);
const abA = el('button', 'icon-btn', 'A'), abB = el('button', 'icon-btn', 'B'), abCopy = el('button', 'icon-btn', 'Copy');
abA.id = 'ab-a'; abB.id = 'ab-b'; abCopy.id = 'ab-copy';
for (const b of [abA, abB, abCopy]) b.type = 'button';
abA.addEventListener('click', () => store.ab.switch('A'));
abB.addEventListener('click', () => store.ab.switch('B'));
abCopy.addEventListener('click', () => store.ab.copyToOther());
ab.append(abA, abB, abCopy);

const prev = el('button', 'icon-btn', '&lsaquo;'); prev.id = 'preset-prev'; prev.type = 'button'; prev.setAttribute('aria-label', 'Previous preset');
const next = el('button', 'icon-btn', '&rsaquo;'); next.id = 'preset-next'; next.type = 'button'; next.setAttribute('aria-label', 'Next preset');
prev.addEventListener('click', () => store.prevPreset());
next.addEventListener('click', () => store.nextPreset());
const presetMenu = createMenu({ buttonId: 'preset-name', menuId: 'preset-menu', itemClass: 'preset-item', items: PRESETS.map((p, i) => ({ id: String(i), label: p.name })), onPick: (id) => store.loadPreset(Number(id)) });
const presets = el('div', 'preset-group'); presets.append(prev, presetMenu, next);

const helpBtn = el('button', 'icon-btn', 'Help'); helpBtn.id = 'help'; helpBtn.type = 'button';
const fsBtn = el('button', 'icon-btn', 'Fullscreen'); fsBtn.id = 'fullscreen'; fsBtn.type = 'button';
fsBtn.addEventListener('click', () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch { /* not allowed here */ } });
// ---- settings (gear, top right): Oversampling and Low latency mode ----
const osSeg = createSegmented({ id: 'oversampling', label: '', options: [1, 2, 4, 8], labels: { 1: 'Off', 2: '2x', 4: '4x', 8: '8x' }, tip: 'oversampling', onPick: (v) => setParam('oversampling', v) });
const llSwitch = el('button', 'switch'); llSwitch.id = 'low-latency'; llSwitch.type = 'button'; llSwitch.setAttribute('role', 'switch'); llSwitch.setAttribute('aria-checked', 'false'); llSwitch.setAttribute('aria-label', 'Low latency mode');
llSwitch.dataset.tooltip = 'lowLatency'; attachTooltip(llSwitch, TOOLTIPS.lowLatency);
llSwitch.addEventListener('click', () => setParam('lowLatency', !store.params.lowLatency));
const popRow = (title, hint, control) => { const r = el('div', 'pop-row'); const t = el('div', 'pop-text', `<div>${title}</div>${hint ? `<small>${hint}</small>` : ''}`); r.append(t, control); return r; };
const settingsPanel = el('div', 'pop'); settingsPanel.id = 'settings-panel'; settingsPanel.hidden = true;
settingsPanel.append(popRow('Oversampling', 'Less aliasing, more CPU and delay', osSeg), popRow('Low latency mode', 'Graphics at 30 fps, leaves more CPU to the audio', llSwitch));
const gearBtn = el('button', 'icon-btn gear', '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>');
gearBtn.id = 'settings-btn'; gearBtn.type = 'button'; gearBtn.setAttribute('aria-label', 'Settings'); gearBtn.setAttribute('aria-haspopup', 'true'); gearBtn.setAttribute('aria-expanded', 'false');
gearBtn.dataset.tooltip = 'settings'; attachTooltip(gearBtn, TOOLTIPS.settings);
const gearWrap = el('div', 'gear-wrap'); gearWrap.append(gearBtn, settingsPanel);
const setPanel = (open) => { settingsPanel.hidden = !open; gearBtn.setAttribute('aria-expanded', String(open)); };
gearBtn.addEventListener('click', (e) => { e.stopPropagation(); setPanel(settingsPanel.hidden); });
settingsPanel.addEventListener('click', (e) => e.stopPropagation());
window.addEventListener('click', () => setPanel(false));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setPanel(false); });
top.append(logo, undo, redo, ab, presets, el('div', 'spacer'), helpBtn, fsBtn, gearWrap);
root.appendChild(top);

const help = el('div', 'help-panel');
help.id = 'help-panel'; help.hidden = true;
help.innerHTML = '<p>Drag a knob to change it. Shift = fine, mouse wheel = step, Alt+click = reset.</p><p>Drag the threshold line, the KNEE tab and the dots right on the display.</p><p>Hover any control for 2.5 seconds to see a tip (it appears under Help).</p><p>Original/Compressed switches at equal loudness. Bottom left: 1:1 = unity gain (the loudness stays that of the input, so you hear only the effect of the compression), SYNC = Tempo sync (Attack and Release in note values). Double-click the display to reset its zoom.</p><p>AUTO knobs turn by themselves and show the live value (updated 4 times a second). Auto Attack: the knob is the slowest attack, the more the signal overshoots the threshold the faster it gets. Auto Release: about 30 ms for rare hits, up to 800 ms when the sound is compressed all the time.</p>';
helpBtn.addEventListener('click', () => { help.hidden = !help.hidden; });
root.appendChild(help);

// ---- test audio transport ----
const transport = createTransport({
  onKey(name) { keyName = name; syncUI(store.params); },
  onBpm(v) { hostBpm = v; if (engine) engine.setParams({ bpm: v }); syncUI(store.params); },
  onEngine(e) {
    engine = e;
    e.setMode(transport.getMode());
    e.setParams(store.params); e.setParams({ bpm: hostBpm });
    e.onMeters((m) => { window.__lastMeters = m; display.pushMeters(m); meters.push(m); if (Number.isFinite(m.latencySamples)) document.getElementById('latency-readout').textContent = `Latency: ${(1000 * m.latencySamples / e.ctx.sampleRate).toFixed(1)} ms`; knobs.threshold.setRing(m.inPeakDb, m.thresholdDb); liveAuto(m); });
  },
});
app.append(transport.el, plugin);

// ---- display + meters ----
const display = createDisplay({ getParams: () => store.params, setParam });
const meters = createMeters();
const dRow = el('div', 'display-row'); dRow.append(display.el, meters.el);
const stage = el('div', 'stage'); const settings = el('div', 'settings');
stage.append(dRow, settings);
root.appendChild(stage);

// ---- controls ----
const knobs = {};
// While AUTO is on, a knob shows (and its dial follows) the value the automation is really using.
function liveAuto(m) {
  const p = store.params;
  if (p.autoThreshold) knobs.threshold.setLive(m.thresholdDb);
  if (p.autoAttack) knobs.attack.setLive(m.autoAttackMs);
  if (p.autoRelease) knobs.release.setLive(m.autoReleaseMs);
  if (p.autoGain) knobs.gain.setLive(p.gain + (m.autoGainDb || 0));
}
const fmtMs = (v) => (v < 100 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`);
const SYNC = { release: { note: 'releaseNote', list: NOTES, max: 2500, auto: 'autoRelease' }, attack: { note: 'attackNote', list: ATTACK_NOTES, max: 250, auto: 'autoAttack' } };
const syncMode = { release: 'ms', attack: 'ms' };
const AUTO = { threshold: ['auto-threshold', 'autoThreshold'], attack: ['auto-attack', 'autoAttack'], release: ['auto-release', 'autoRelease'], gain: ['autogain', 'autoGain'] };
const knob = (id, label, size, tip) => {
  const a = AUTO[id];
  knobs[id] = createKnob({ id, label, spec: PARAM_SPECS[id], value: store.params[id], onChange: (v) => setParam(id, v), size, tip, ring: id === 'threshold',
    auto: a ? { id: a[0], tip: a[1], onToggle: () => setParam(a[1], !store.params[a[1]]) } : null });
  return knobs[id];
};
const toggles = {};
const upToggle = createToggle({ id: 'upward', label: 'Off', tip: 'upward', onClick: () => setParam('upward', !store.params.upward) }); // real switch: Upward on/off
const setLamp = () => { const on = store.params.upward; upToggle.setPressed(on); upToggle.textContent = on ? 'On' : 'Off'; upAcc.inner.classList.toggle('sc-off', !on); };
toggles.bypass = createToggle({ id: 'bypass', label: 'Bypass', tip: 'bypass', onClick: () => setParam('bypass', !store.params.bypass) });

const styleBlock = el('div', 'style-block', '<div class="knob-value">&nbsp;</div><div class="knob-label">Style</div>');
const styleMenu = createMenu({ buttonId: 'style-btn', menuId: 'style-menu', itemClass: 'style-item', tip: 'style', items: Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label })), onPick: (id) => setParam('style', id) });
styleBlock.prepend(styleMenu);

const settingsMain = el('div', 'settings-main');
settingsMain.append(knob('threshold', 'Threshold'), knob('ratio', 'Ratio'), styleBlock, knob('attack', 'Attack'), knob('release', 'Release'), knob('gain', 'Gain'), knob('mix', 'Mix'));
const settingsSmall = el('div', 'settings-small');
settingsSmall.append(knob('knee', 'Knee', 'small'), knob('range', 'Range', 'small'), knob('lookahead', 'Lookahead', 'small'), knob('hold', 'Hold', 'small'));
settings.append(settingsMain, settingsSmall);

let upOpen = false, lastUpward = false; // opens by itself when Upward turns on, otherwise keeps what the user chose
const upAcc = createAccordion({ id: 'upward-acc', bodyId: 'upward-panel', title: 'Upward', headerExtra: upToggle, onToggle: (v) => { upOpen = v; } });
upAcc.inner.append(knob('upAmount', 'Amount', 'small'), knob('upWindow', 'Window', 'small'), knob('upMaxBoost', 'Max Boost', 'small'), knob('upFloor', 'Floor', 'small'));

toggles.scOn = createToggle({ id: 'sc-enable', label: 'On', tip: 'scOn', onClick: () => setParam('scOn', !store.params.scOn) });
const scAcc = createAccordion({ id: 'sc-acc', bodyId: 'sc-panel', title: 'Side Chain', headerExtra: toggles.scOn });
const specBuf = new Float32Array(4096);
const scEq = createScEq({
  getParams: () => store.params, setParam,
  getSpectrum: () => (engine && engine.spectrum(specBuf) ? { data: specBuf, sr: engine.ctx.sampleRate } : null),
  getSampleRate: () => (engine ? engine.ctx.sampleRate : 48000),
  isVisible: () => scAcc.classList.contains('open'),
});
toggles.scListen = createToggle({ id: 'sc-listen', label: 'Listen', tip: 'scListen', onClick: () => setParam('scListen', !store.params.scListen) });
const level = el('div', 'sc-level-wrap', '<div class="knob-label">Level</div><input id="sc-level" class="sc-level" type="range" min="-24" max="24" step="0.1" value="0" aria-label="Sidechain level" data-tooltip="scLevel"><div id="sc-level-val" class="knob-value">0.0 dB</div>');
const levelInput = level.querySelector('#sc-level');
attachTooltip(levelInput, TOOLTIPS.scLevel);
levelInput.addEventListener('input', () => setParam('scLevel', Number(levelInput.value)));
levelInput.addEventListener('pointerdown', (e) => { if (e.altKey) { e.preventDefault(); setParam('scLevel', 0); } });
const srcSeg = createSegmented({ id: 'sc-source', label: 'Source', options: [0, 1], labels: { 0: 'Internal', 1: 'External' }, tip: 'scSource', onPick: (v) => setParam('scExternal', v === 1) });
const keyHint = el('div', 'sc-key-hint'); keyHint.id = 'sc-key-hint';
const scSide = el('div', 'sc-side'); scSide.append(srcSeg, keyHint, toggles.scListen);
const scKnobs = el('div', 'sc-knobs');
scKnobs.append(knob('sidechainHpf', 'HPF', 'small'), knob('scLpf', 'LPF', 'small'), knob('scBandFreq', 'Band Freq', 'small', 'scBand'), knob('scBandGain', 'Band Gain', 'small', 'scBand'), knob('scBandQ', 'Band Q', 'small', 'scBand'));
const scMain = el('div', 'sc-main'); scMain.append(scEq.el, scKnobs);
scAcc.inner.append(level, scMain, scSide);

const bottom = el('div', 'bottombar'); bottom.id = 'bottombar';
const span = (id) => { const s = el('span', ''); s.id = id; return s; };
// hot bar: small icon buttons, the tip appears after 2.5 s of hovering
const hotBtn = (id, content, tip, label, onClick) => { const b = el('button', 'hot-btn', content); b.id = id; b.type = 'button'; b.setAttribute('aria-label', label); b.setAttribute('aria-pressed', 'false'); b.dataset.tooltip = tip; attachTooltip(b, TOOLTIPS[tip]); b.addEventListener('click', onClick); return b; };
const unityBtn = hotBtn('unity-gain', '1:1', 'unity', 'Unity gain', () => setParam('unity', !store.params.unity));
const tempoBtn = hotBtn('tempo-sync', 'SYNC', 'tempoSync', 'Tempo sync', () => setParam('tempoSync', !store.params.tempoSync));
const hot = el('div', 'hotbar'); hot.append(unityBtn, tempoBtn, span('bpm-readout'));
bottom.append(hot, el('div', 'spacer'), span('la-readout'), span('latency-readout'), toggles.bypass);
root.append(upAcc, scAcc, bottom);

function syncUI(p) {
  // Tempo Sync: Release and Attack become note values of the project tempo (an AUTO knob chooses its own time)
  for (const [id, cfg] of Object.entries(SYNC)) {
    const mode = p.tempoSync && !p[cfg.auto] ? 'note' : 'ms';
    if (mode === 'note') knobs[id].setSpec({ spec: PARAM_SPECS[cfg.note], value: p[cfg.note], onChange: (v) => setParam(cfg.note, Math.round(v)),
      format: (v) => `${cfg.list[Math.round(v)].label} \u00b7 ${fmtMs(noteToMs(v, hostBpm, cfg.list, cfg.max))}` });
    else if (syncMode[id] === 'note') knobs[id].setSpec({ spec: PARAM_SPECS[id], value: p[id], onChange: (v) => setParam(id, v) });
    syncMode[id] = mode;
  }
  for (const [id, k] of Object.entries(knobs)) { const key = syncMode[id] === 'note' ? SYNC[id].note : id; if (k.value !== p[key]) k.setValue(p[key]); }
  for (const [knobId, [, key]] of Object.entries(AUTO)) knobs[knobId].setAuto(p[key]);
  setLamp(); toggles.bypass.setPressed(p.bypass);
  styleMenu.setLabel(STYLES[p.style].label);
  if (p.upward && !lastUpward) upOpen = true; // turning Upward on opens its block; turning it off never hides it
  lastUpward = p.upward;
  upAcc.setOpen(upOpen);
  presetMenu.setLabel(store.presetName + (store.modified ? ' *' : ''));
  unityBtn.setAttribute('aria-pressed', String(p.unity));
  tempoBtn.setAttribute('aria-pressed', String(p.tempoSync)); { const r = document.getElementById('bpm-readout'); r.textContent = p.tempoSync ? `${hostBpm} BPM` : ''; }
  osSeg.setValue(p.oversampling); llSwitch.setAttribute('aria-checked', String(p.lowLatency)); setLowLatency(p.lowLatency);
  document.getElementById('la-readout').textContent = `Lookahead: ${p.lookahead.toFixed(1)} ms`;
  undo.disabled = !store.canUndo; redo.disabled = !store.canRedo;
  abA.setAttribute('aria-pressed', String(store.ab.current === 'A')); abB.setAttribute('aria-pressed', String(store.ab.current === 'B'));
  levelInput.value = String(p.scLevel); document.getElementById('sc-level-val').textContent = `${p.scLevel >= 0 ? '+' : ''}${p.scLevel.toFixed(1)} dB`;
  toggles.scOn.setPressed(p.scOn); toggles.scOn.textContent = p.scOn ? 'On' : 'Off'; scAcc.inner.classList.toggle('sc-off', !p.scOn); scAcc.inner.inert = !p.scOn; // Side Chain off: the detector hears the plain input
  toggles.scListen.setPressed(p.scListen); srcSeg.setValue(p.scExternal ? 1 : 0);
  keyHint.textContent = !p.scExternal ? '' : keyName ? `Key: ${keyName}` : 'No key track: use Load sidechain audio above';
  keyHint.classList.toggle('warn', p.scExternal && !keyName);
}
syncUI(store.params);

// Test hooks
window.__TOOLTIPS = TOOLTIPS;
window.__audioState = () => (transport.getEngine() ? transport.getEngine().ctx.state : 'not-started');
window.__engineState = () => (transport.getEngine() ? { ...transport.getEngine().state } : { duration: 0, position: 0, playing: false });
window.__geom = () => display.geom();
window.__frameInterval = () => frameInterval();
window.__timeWindow = () => display.windowSeconds();
window.__handles = () => display.handles();
window.__scGeom = () => scEq.geom();
window.__scNodes = () => scEq.nodes();
window.__drawnThreshold = () => display.drawnThreshold();
window.__params = () => store.params;
window.__setParam = setParam;
window.__engineMode = () => (transport.getEngine() ? transport.getEngine().mode : 'not-started');
