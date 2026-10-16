import { Runner } from './dsp/runner.js';

class PurpleComp extends AudioWorkletProcessor {
  constructor() {
    super();
    this.runner = new Runner(sampleRate, (m) => this.port.postMessage(m));
    this.port.onmessage = (e) => { if (e.data && e.data.type === 'params') this.runner.setParams(e.data.params); };
  }

  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    if (!inp || !inp.length) { for (const ch of out) ch.fill(0); return true; }
    // channels 0-1: the main input, 2-3: the key (external sidechain) when connected
    this.runner.process(inp[0], inp[1] || inp[0], out[0], out[1] || null, out[0].length, inp[2] || null, inp[3] || inp[2] || null);
    return true;
  }
}

registerProcessor('purple-comp', PurpleComp);
