// How often the canvases are redrawn. 60 fps normally; Low latency mode draws at 30 fps to leave more CPU to the audio.
let interval = 14;
export const setLowLatency = (on) => { interval = on ? 31 : 14; };
export const frameInterval = () => interval;
