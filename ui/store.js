import { defaults, sanitize } from '../dsp/params.js';
import { STYLES } from '../dsp/styles.js';
import { PRESETS } from '../dsp/presets.js';

const COALESCE_MS = 600, MAX_UNDO = 100;

// Parameter state with undo/redo (rapid changes of one control form one step), A/B slots and presets.
export function createStore({ now = () => performance.now(), onChange = () => {} } = {}) {
  let params = defaults();
  let undoStack = [], redoStack = [], lastKey = null, lastT = -1e9;
  let presetIndex = -1, modified = false;
  const slots = { A: null, B: null };
  let current = 'A';

  const diff = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]);
  const apply = (next) => { const keys = diff(params, next); params = next; if (keys.length) onChange({ ...params }, keys); return keys; };
  const record = (key) => {
    const t = now();
    if (key === lastKey && t - lastT < COALESCE_MS) { lastT = t; return; }
    undoStack.push({ ...params }); if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = []; lastKey = key; lastT = t;
  };

  const store = {
    get params() { return { ...params }; },
    get presetIndex() { return presetIndex; },
    get presetName() { return presetIndex >= 0 ? PRESETS[presetIndex].name : 'Init'; },
    get modified() { return modified; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },

    set(key, value) {
      const patch = { [key]: value };
      if (key === 'style' && STYLES[value] && STYLES[value].upwardDefault) { patch.upward = true; if (params.upAmount <= 1) patch.upAmount = 1.5; }
      if (key === 'upAmount' && value > 1 && !params.upward) patch.upward = true; // raising Amount switches Upward on; lowering it never switches it off
      const next = sanitize({ ...params, ...patch });
      if (diff(params, next).length === 0) return;
      record(key); modified = true;
      apply(next);
    },
    replaceAll(next) { apply(sanitize(next)); }, // no undo record (used internally and by tests)
    loadPreset(i) {
      const idx = ((i % PRESETS.length) + PRESETS.length) % PRESETS.length;
      record('preset');
      presetIndex = idx; modified = false;
      apply(sanitize({ ...defaults(), bypass: params.bypass, scListen: params.scListen, unity: params.unity, oversampling: params.oversampling, lowLatency: params.lowLatency, tempoSync: params.tempoSync, ...PRESETS[idx].params }));
    },
    nextPreset() { store.loadPreset(presetIndex + 1); },
    prevPreset() { store.loadPreset(presetIndex < 0 ? PRESETS.length - 1 : presetIndex - 1); },
    undo() {
      if (!undoStack.length) return;
      redoStack.push({ ...params }); lastKey = null;
      apply(undoStack.pop());
    },
    redo() {
      if (!redoStack.length) return;
      undoStack.push({ ...params }); lastKey = null;
      apply(redoStack.pop());
    },
    ab: {
      get current() { return current; },
      switch(slot) {
        if (slot === current) return;
        slots[current] = { ...params };
        const target = { ...(slots[slot] || params), bypass: params.bypass, scListen: params.scListen, unity: params.unity, oversampling: params.oversampling, lowLatency: params.lowLatency, tempoSync: params.tempoSync }; // monitoring state and the settings (oversampling, low latency, tempo sync) are not part of a slot
        current = slot; lastKey = null;
        apply(target);
      },
      copyToOther() { slots[current === 'A' ? 'B' : 'A'] = { ...params }; },
    },
  };
  return store;
}
