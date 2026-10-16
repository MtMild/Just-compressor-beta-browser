# Purple Compressor (browser prototype)

A Pro-C-style compressor in purple. Stage 1 of 2: this page runs a real-time DSP core in the browser so you can test it by ear on your own audio. Stage 2 (VST3 for FL Studio on Windows) will reuse the same DSP core in JUCE.

## Try it

**Live demo:** https://claude.ai/artifact/NC4nGpkKcGLe72njapVu1J

1. Open `dist/index.html` in Chrome or Edge (double-click works), or open the published artifact link. The line next to the file name shows which audio engine runs: `AudioWorklet` (best) or `fallback (main thread)`, used only when the host page blocks worklets.
2. Click **Load audio** (or drop a WAV/MP3 onto the page), then **Play**.
3. Pick a preset (top bar), or turn knobs. Use the Demo player's **Compressed / Original** button to compare at equal loudness.

Audio only starts after your first click (browsers block autoplay).

### How to get your music into it

The browser cannot hear your DAW, so export a short bounce from FL Studio (File > Export > WAV, 30-60 s of a drum loop, vocal or full mix) and load that file. Try the same file with different presets and styles.

## Layout

- **Demo player** (top strip, dashed): Load audio, Play/Pause, seek, Loop, Original/Compressed. It exists only for this browser demo; the **plugin frame** below it has no player and is what will be reused in the VST.
- **Plugin frame:** top bar (undo/redo, A/B, presets, Help), the big display with the settings knobs laid over it, GR/OUT meters with numbers, an expandable **Upward** block, an expandable **Side Chain** block, and a bottom bar with Bypass.

## Controls

- Knobs: drag up/down, mouse wheel to step, **Shift** for fine adjustment, **Alt+click** to reset to default.
- Small **AUTO** pills under Threshold, Attack, Release and Gain. While AUTO is on the knob is greyed and locked, its dial turns by itself and the value under it is the live one (the digits refresh 4 times a second); switching AUTO off brings back the value you had set:
  - *Threshold*: follows the average level of the detector input (our own design: the knob sets how far below the average level the threshold sits, reference -18 dB RMS; it follows a section change in 2-3 s); the dashed line on the display shows the effective threshold.
  - *Attack*: the knob is the maximum, the louder the recent overshoot above the threshold the faster the attack (never below 0.1 ms; the overshoot rises at once and falls over ~120 ms, so the value is steady). Our own design.
  - *Release*: two-stage and adaptive: about 30 ms for rare hits up to about 800 ms (knob terms) for dense, constantly compressed sound. *Gain*: keeps loudness equal before and after; the pill shows the makeup it applies (AUTO +5.1). It tracks the average loudness slowly so it does not pump, but re-learns within about a second after you change Threshold, Ratio, Knee, Range or Upward settings.
- A ring around the Threshold knob is the live input meter, one smooth gradient (green, yellow, orange, red towards 0 dB); the OUT bar uses the same colours; the white **0** mark (3 o'clock, the ring has its own scale) is 0 dB, and input beyond it continues the ring in red, into the plus.
- On the display: drag the dashed **threshold line**, the **KNEE** tab, the dot at the right end of the curve (**ratio**). with Upward on a second dot on the Upward threshold sets **Window** (the line is labelled WINDOW and its value); Floor is a dotted line labelled FLOOR and its value. The mouse wheel over the display zooms the envelope in time (smoothly, from 2 s to 30 s of history; the dB scale and the display height do not change). The **dB scale** (how many dB below 0 are shown: 6/12/18/24/36/48/60) is picked with the dropdown at the bottom right of the display. The envelope area shows the compressed output in front and the original input as a faint ghost behind; thin unlabelled lines mark every dB between the labelled ones. 0 dB is a bright line with room above it for boost and signal over 0 dB. With Upward on, the lifted part of the curve and of the history is light purple and shaded (not when Max Boost is 0; Window and Floor stay). The curve starts at the left border of the display. The dashed threshold line is drawn over the curve zone only, and the red reduction line only where there is reduction. **Range** shows as a red dotted line: on the history it is the depth reduction can never pass, on the curve it is the 1:1 line shifted down by Range.
- Above the meters: gain reduction (red) and output peak. The numbers refresh about four times a second and show the extreme of that window, so they stay readable.
- **Upward** (expandable block, any style): lifts quiet parts; Amount / Window / Max Boost (the most gain added to quiet sound; no longer drawn on the graph) / Floor (input level, up to -6 dB, below which nothing is lifted; drawn on the curve and across the envelope). Upward is on when Amount is above 1:1; the header lamp only shows the state (Off / On).
- **Side Chain** (expandable block, with an On/Off button in its header: off = the detector hears the plain input, without filters or key): the signal the compressor listens to. Drag the HPF, BAND and LPF points on the spectrum. The mouse wheel on the HPF or LPF point sets its slope (6/12/24/48 dB/oct, written on the point; filters never resonate), on BAND it changes Q; Alt+click on a point resets it. The spectrum behind shows what the detector hears in front and the original input as a faint ghost. The vertical **Level** slider only sets the volume of Listen: it never changes compression or the main output. **Listen** plays the signal the detector hears. **Source** switches the detector between Internal (the input itself) and External (a key track): in this demo load it with **Load sidechain audio** in the demo bar (it loops and is spread to stereo if mono); in the VST it will be the plugin's sidechain input. Listen and the HPF/LPF/Band apply to the key too. The HPF and LPF points can be dragged along the whole graph (they stop short of each other).
- **Hot bar** (bottom left; the name appears after 2.5 s of hovering): **1:1** = Unity Gain: the loudness stays that of the input (exactly the makeup that matches it; Gain and Auto Gain are not used), so you hear only the effect of the compression and not that it got quieter; **SYNC** = Tempo sync: Attack (1/256 ... 1/8) and Release (1/32 ... 1/1, with triplets and dotted) become note values of the project tempo, shown as `1/8 · 250 ms`. In a browser there is no host tempo, so the demo bar has a **BPM** field that stands in for it (20-300). An AUTO knob ignores Tempo Sync. Double-click the empty display to reset its zoom.
- **A/B** keeps two settings, **Copy** copies the current one to the other. **Undo/Redo** step through changes.
- **Settings** (gear, top right): **Oversampling** Off / 2x / 4x / 8x. The whole compressor runs at the higher rate between two linear-phase half-band filters (less aliasing, mostly from the saturating styles). Cost on this JavaScript build, stereo: about 2% / 5% / 10% / 20% of one core; the added delay is 0 / 24 / 28 / 30 samples and is shown as Latency in the bottom bar. **Low latency mode** draws the graphics at 30 fps instead of 60 to leave more CPU to the audio. Both are global settings: presets and A/B do not change them.
- The envelope area shows three things: the original input (faint dashed line), the compressed output (solid light line) and in red only what is being compressed (the reduction); a small legend names them. Hover any parameter for 2.5 seconds to see a short tip.

## Styles and presets

9 styles: Clean, Classic, Opto, Vocal, Bus, Punch, Vari-Mu, Pump, Upward. 10 presets: Vocal Control, Vocal Smash, Kick Punch, Snare Crack, Bass Tighten, Drum Bus Glue, Parallel Drum Crush, Mix Bus Glue, Mastering Gentle, Acoustic Guitar Even. Presets are starting points collected from general compression rules of thumb, not FabFilter factory presets; adjust by ear.

## Development

```
npm install
npm test                 # DSP + state unit tests (Node)
npm run build            # bundles everything into dist/index.html
node test/ui.spec.mjs    # browser checks (Playwright + preinstalled Chromium; needs a fresh build)
```

Layout: `dsp/` pure DSP core (no browser APIs), `worklet.js` AudioWorklet wrapper, `ui/` interface, `test/` tests, `build.mjs` single-file bundler.

## Known limits

- Desktop only: like a plugin window, the page is not meant for phones.
- This is our own compressor in the spirit of Pro-C; FabFilter's algorithms are proprietary, so it will not sound identical.
- Not implemented: MIDI learn, the TTM and Op-El styles (their behaviour is unknown to us). Stereo Link was removed on purpose (both channels always get the same gain reduction).
- If a sandbox blocks AudioWorklet the page switches to a main-thread fallback with the same DSP (slightly more latency, may glitch on slow devices). If it blocks file input too, open `dist/index.html` locally.
- Changing Look-ahead (or switching Upward on, which needs 2 ms) crossfades between the old and the new delay over 80 ms instead of sliding it, so the pitch does not bend (a sliding delay bent it by up to 5 %); at most ~15 cents on a 110 Hz bass for 80 ms, nothing on mid and high material.
- With Upward on, the compressor adds 2 ms of internal look-ahead (latency) so the detector sees a loud hit before the boosted signal reaches the output.
- Loudness matching in Original mode is approximate when Mix is below 100%.
- Tooltips use a 2.5 s delay as requested (the bubble sits under the Help button) (`TOOLTIP_DELAY_MS` in `ui/tooltip.js`).
