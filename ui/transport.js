import { createAudioEngine, DECODE_ERROR } from './audio.js';
import { attachTooltip, TOOLTIPS } from './tooltip.js';

const NO_AUDIO_ERROR = 'Audio playback is not available in this browser.';

// Transport row: load/drop a file, Play/Pause, Loop, Original/Compressed. The AudioContext is created lazily on a user gesture.
export function createTransport({ onEngine, onKey = () => {}, onBpm = () => {} }) {
  const el = document.createElement('div');
  el.className = 'transport';
  el.id = 'demo-bar';
  el.innerHTML = `
    <span class="demo-title">Demo player</span>
    <label class="btn" id="load">Load audio<input id="file" type="file" accept="audio/*" hidden></label>
    <label class="btn" id="load-key" title="A second track for the External sidechain">Load sidechain audio<input id="key-file" type="file" accept="audio/*" hidden></label>
    <button id="play" class="btn" disabled>Play</button>
    <button id="pause" class="btn" disabled>Pause</button>
    <label class="chk"><input id="loop" type="checkbox"> Loop</label>
    <label class="chk" title="The project tempo a host would give the plugin (for Tempo Sync)">BPM <input id="bpm" type="number" min="20" max="300" step="1" value="120"></label>
    <button id="mode" class="btn" aria-pressed="false" disabled>Compressed</button>
    <input id="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Seek" disabled>
    <span id="status"></span>
    <span id="engine-mode"></span>
    <div id="error" role="alert"></div>`;
  const $ = (s) => el.querySelector(s);
  $('#mode').dataset.tooltip = 'mode'; attachTooltip($('#mode'), TOOLTIPS.mode);
  let engine = null, pending = null, mode = 'compressed';

  const ensure = () => (pending ||= createAudioEngine().then((e) => {
    engine = e; onEngine(e);
    $('#engine-mode').textContent = e.mode === 'worklet' ? 'Engine: AudioWorklet' : 'Engine: fallback (main thread)';
    return e;
  }));
  const setError = (m) => { $('#error').textContent = m; };

  async function load(file) {
    setError('');
    let e;
    try { e = await ensure(); } catch { pending = null; setError(NO_AUDIO_ERROR); return; }
    try {
      await e.loadFile(file);
      $('#status').textContent = `${file.name} · ${e.state.duration.toFixed(1)} s`;
      for (const id of ['#play', '#pause', '#mode', '#seek']) $(id).disabled = false;
    } catch { setError(DECODE_ERROR); }
  }

  async function loadKey(file) {
    setError('');
    let e;
    try { e = await ensure(); } catch { pending = null; setError(NO_AUDIO_ERROR); return; }
    try { await e.loadKey(file); onKey(file.name); } catch { setError(DECODE_ERROR); }
  }
  $('#key-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadKey(f); });
  $('#file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) load(f); });
  $('#play').addEventListener('click', async () => { try { await (await ensure()).play(); } catch { pending = null; setError(NO_AUDIO_ERROR); } });
  $('#pause').addEventListener('click', () => engine && engine.pause());
  let seeking = false;
  $('#seek').addEventListener('input', (e) => { seeking = true; if (engine && engine.state.duration) engine.seek((e.target.value / 100) * engine.state.duration); });
  $('#seek').addEventListener('change', () => { seeking = false; });
  setInterval(() => { if (engine && engine.state.duration && !seeking) $('#seek').value = String((engine.state.position / engine.state.duration) * 100); }, 100);
  $('#bpm').addEventListener('input', (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 20 && v <= 300) onBpm(v); });
  $('#bpm').addEventListener('change', (e) => { const v = Math.min(300, Math.max(20, Number(e.target.value) || 120)); e.target.value = String(v); onBpm(v); });
  $('#loop').addEventListener('change', (e) => engine && engine.setLoop(e.target.checked));
  $('#mode').addEventListener('click', () => {
    mode = mode === 'compressed' ? 'original' : 'compressed';
    $('#mode').textContent = mode === 'original' ? 'Original' : 'Compressed';
    $('#mode').setAttribute('aria-pressed', String(mode === 'original'));
    if (engine) engine.setMode(mode);
  });
  for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => {
    e.preventDefault();
    if (t === 'drop' && e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
  });
  return { el, getEngine: () => engine, getMode: () => mode };
}
