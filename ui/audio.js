import { Runner } from '../dsp/runner.js';

export const DECODE_ERROR = 'Could not read this file. Try WAV or MP3.';

const blobUrl = (src) => URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
const dataUrl = (src) => {
  const bytes = new TextEncoder().encode(src);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:text/javascript;base64,' + btoa(bin);
};

// AudioWorklet when the page may load it, otherwise a ScriptProcessorNode running the same DSP on the main thread.
async function makeNode(ctx, forceFallback) {
  if (!forceFallback && ctx.audioWorklet) {
    // blob: URLs work on http(s); a page opened from disk (file://) needs a data: URL instead.
    for (const makeUrl of [blobUrl, dataUrl]) {
      try {
        await ctx.audioWorklet.addModule(makeUrl(window.__WORKLET_SRC__));
        // one input with 4 channels: the main stereo input followed by the key (external sidechain) stereo input
        const node = new AudioWorkletNode(ctx, 'purple-comp', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 4, channelCountMode: 'explicit', channelInterpretation: 'discrete' });
        return {
          node, mode: 'worklet',
          post: (params) => node.port.postMessage({ type: 'params', params }),
          onMessage: (cb) => { node.port.onmessage = (e) => { if (e.data && e.data.type === 'meters') cb(e.data); }; },
        };
      } catch { /* try the next way to load the module */ }
    }
  }
  const sp = ctx.createScriptProcessor(1024, 4, 2);
  let cb = () => {};
  const runner = new Runner(ctx.sampleRate, (m) => cb(m));
  sp.onaudioprocess = (e) => {
    const i = e.inputBuffer, o = e.outputBuffer;
    const four = i.numberOfChannels >= 4;
    runner.process(i.getChannelData(0), i.getChannelData(Math.min(1, i.numberOfChannels - 1)), o.getChannelData(0), o.getChannelData(1), i.length, four ? i.getChannelData(2) : null, four ? i.getChannelData(3) : null);
  };
  return { node: sp, mode: 'script-processor', post: (p) => runner.setParams(p), onMessage: (f) => { cb = f; } };
}

// Must be called from a user gesture (file pick, drop or a click): that is when the AudioContext may start.
export async function createAudioEngine() {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const forceFallback = /[?&]noworklet\b/.test(location.search);
  const { node, mode, post: postParams, onMessage } = await makeNode(ctx, forceFallback);
  node.connect(ctx.destination);
  // Inputs: mainIn (stereo) -> channels 0-1, keyIn (stereo) -> channels 2-3 of the processor. A mono file is spread to both channels.
  const stereoIn = () => { const g = ctx.createGain(); g.channelCount = 2; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; return g; };
  const mainIn = stereoIn(), keyIn = stereoIn(), mainSplit = ctx.createChannelSplitter(2), keySplit = ctx.createChannelSplitter(2), merger = ctx.createChannelMerger(4);
  mainIn.connect(mainSplit); mainSplit.connect(merger, 0, 0); mainSplit.connect(merger, 1, 1);
  keyIn.connect(keySplit); keySplit.connect(merger, 0, 2); keySplit.connect(merger, 1, 3);
  merger.connect(node);
  const makeAnalyser = () => { const a = ctx.createAnalyser(); a.fftSize = 8192; a.smoothingTimeConstant = 0.8; a.minDecibels = -100; a.maxDecibels = 0; return a; };
  const analyser = makeAnalyser(), keyAnalyser = makeAnalyser(); // live spectrum of the main input / of the key for the sidechain EQ display
  mainIn.connect(analyser); keyIn.connect(keyAnalyser);

  let buffer = null, keyBuffer = null, source = null, keySource = null, external = false, startedAt = 0, offset = 0, loop = false, original = false, userBypass = false;
  const meterCbs = [];
  const state = { duration: 0, position: 0, playing: false, keyName: '' };
  onMessage((m) => { for (const cb of meterCbs) cb(m); });

  const post = postParams;
  const applyMode = () => post({ bypass: userBypass || original, loudnessMatch: original && !userBypass });
  const position = () => {
    if (!buffer) return 0;
    if (!state.playing) return offset;
    const p = offset + (ctx.currentTime - startedAt);
    return loop ? p % buffer.duration : Math.min(p, buffer.duration);
  };
  const killSource = () => {
    if (source) { source.onended = null; try { source.stop(); } catch { /* already stopped */ } source.disconnect(); source = null; }
    if (keySource) { try { keySource.stop(); } catch { /* already stopped */ } keySource.disconnect(); keySource = null; }
  };
  const refresh = () => { state.position = position(); };
  const tick = setInterval(refresh, 50);

  const start = () => {
    killSource();
    source = ctx.createBufferSource();
    source.buffer = buffer; source.loop = loop;
    source.connect(mainIn);
    source.onended = () => { if (!loop) { state.playing = false; offset = 0; refresh(); } };
    source.start(0, offset);
    if (keyBuffer) { // the key track loops, so it keeps going whatever its length
      keySource = ctx.createBufferSource(); keySource.buffer = keyBuffer; keySource.loop = true;
      keySource.connect(keyIn); keySource.start(0, offset % keyBuffer.duration);
    }
    startedAt = ctx.currentTime; state.playing = true;
  };

  const engine = {
    ctx, state, mode, binCount: analyser.frequencyBinCount,
    // Copies the current input spectrum (dB per bin) into `out`; false when nothing is playing.
    spectrum(out) { const a = external && keyBuffer ? keyAnalyser : analyser; if (!state.playing || out.length !== a.frequencyBinCount) return false; a.getFloatFrequencyData(out); return true; },
    async loadKey(file) { // the external sidechain (key) track of the demo
      let decoded;
      try { decoded = await ctx.decodeAudioData(await file.arrayBuffer()); } catch { throw new Error(DECODE_ERROR); }
      keyBuffer = decoded; state.keyName = file.name; if (state.playing) start();
    },
    clearKey() { keyBuffer = null; state.keyName = ''; if (state.playing) start(); },
    async loadFile(file) {
      let decoded;
      try { decoded = await ctx.decodeAudioData(await file.arrayBuffer()); } catch { throw new Error(DECODE_ERROR); }
      killSource(); state.playing = false; offset = 0;
      buffer = decoded; state.duration = decoded.duration; refresh();
    },
    async play() { if (!buffer) return; await ctx.resume(); if (!state.playing) start(); },
    pause() { if (!state.playing) return; offset = position(); killSource(); state.playing = false; refresh(); },
    seek(sec) { if (!buffer) return; offset = Math.max(0, Math.min(sec, buffer.duration - 0.001)); if (state.playing) start(); refresh(); },
    setLoop(b) { loop = b; if (source) source.loop = b; },
    setParams(p) {
      if ('scExternal' in p) external = Boolean(p.scExternal);
      if ('bypass' in p) { userBypass = Boolean(p.bypass); applyMode(); const { bypass, ...rest } = p; if (Object.keys(rest).length) post(rest); } else post(p);
    },
    setMode(m) { original = m === 'original'; applyMode(); },
    onMeters(cb) { meterCbs.push(cb); },
    dispose() { clearInterval(tick); killSource(); ctx.close(); },
  };
  applyMode();
  return engine;
}
