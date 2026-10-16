# Purple Compressor (browser prototype) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-page, purple-only, Pro-C-3-style compressor that plays the user's audio files through a real-time DSP core in the browser, with 9 styles, an Upward switch and 10 presets.

**Architecture:** A pure ES-module DSP core (`compressor/dsp/`, no browser APIs) is tested in Node, wrapped by an AudioWorklet, and driven by a Canvas+DOM UI. A build script bundles everything into one `compressor/dist/index.html` (worklet inlined as a Blob URL). The DSP core is written so it can be ported 1:1 to C++/JUCE in stage 2.

**Tech Stack:** Vanilla JS (ES modules), Node ≥18 built-in `node --test`, esbuild (dev-only, bundling), Playwright with the preinstalled Chromium (`/opt/pw-browsers/chromium`, never run `playwright install`) for UI checks.

**Spec:** `docs/superpowers/specs/2026-10-14-purple-compressor-design.md`

## Global Constraints

- All UI text, tooltips and preset names are **English**.
- Colours: every hue in **255°–295°** (or neutral, saturation < 8%); no yellow/orange/green/red anywhere, including clipping (use brightest lilac/white).
- Tooltip delay is one constant `TOOLTIP_DELAY_MS = 4000`; tooltips cancel on mouse leave, click and drag; one at a time; ≤ ~12 words.
- **Alt+click** on a knob resets it to default (no double-click reset). Shift = fine adjust. Wheel = adjust.
- 9 styles: Clean, Classic, Opto, Vocal, Bus, Punch, Vari-Mu, Pump, Upward. Upward is also a switch available in every style.
- 10 presets exactly as in the spec table; all have Upward off.
- Upward defaults: Max Boost +12 dB, Floor −60 dB. Look-ahead range 0–10 ms.
- DSP core imports nothing from the browser or Node (only other `dsp/` files).
- Tests: `cd compressor && node --test test/` must pass before every commit.

## Review Focus

1. Mono, very short (< 1 render block) and different sample-rate (44.1/48/96 kHz) input → same timing in ms, no crash. (Task 3)
2. Silence and extreme settings (attack 0.1 ms, ratio 100, look-ahead 10 ms, threshold 0 dB) → no NaN/Infinity, silence stays silent. (Task 3)
3. Quiet→loud step with Upward on → boost retracts, output does not clip beyond the downward-only case. (Task 4)
4. Non-audio / undecodable file → friendly error message, no crash; audio does not start before a user gesture (AudioContext suspended). (Task 7)
5. Alt+click on Windows must not open the browser menu bar; tooltip must not appear while dragging. (Task 8)

---

## File Structure

```
compressor/
  package.json                 type:module, scripts: test, build
  build.mjs                    esbuild bundle -> dist/index.html (single file)
  dsp/util.js                  dbToLin, linToDb, clamp
  dsp/params.js                PARAM_SPECS, defaults(), sanitize(partial)
  dsp/gain.js                  computeGainDb(levelDb, p)  (static curve, down+up)
  dsp/styles.js                STYLES (9), applyStyle(params)
  dsp/compressor.js            Compressor class (detector, ballistics, lookahead, mix, auto gain)
  dsp/presets.js               PRESETS (10)
  worklet.js                   AudioWorkletProcessor 'purple-comp'
  ui/theme.js                  colour tokens (single source for CSS vars and canvas)
  ui/tooltip.js                TOOLTIP_DELAY_MS, attachTooltip(el, text)
  ui/knob.js                   createKnob(spec, onChange)
  ui/display.js                main Canvas display (history, GR, curves, handles)
  ui/meters.js                 GR + output meters
  ui/audio.js                  file loading, transport, graph, Original/Compressed
  ui/app.js                    assembly, top bar, rows, presets, A/B
  ui/index.template.html       page shell + CSS
  test/*.test.js               Node tests (DSP); test/ui.spec.mjs Playwright UI checks
  README.md                    how to run, how to test, how to export audio
```

---

### Task 1: Scaffold, utilities and parameter model

**Files:** Create `compressor/package.json`, `compressor/dsp/util.js`, `compressor/dsp/params.js`; Test `compressor/test/params.test.js`.

**Interfaces — Produces:**
- `util.js`: `dbToLin(db:number):number`, `linToDb(lin:number):number` (floors at −120 dB), `clamp(x,lo,hi):number`.
- `params.js`: `PARAM_SPECS: Record<string,{min,max,default,unit,step?}>` for: `threshold` (−60..0 dB, −24), `ratio` (1..100, 3), `knee` (0..30 dB, 8), `attack` (0.1..250 ms, 10), `release` (5..2500 ms, 120), `hold` (0..500 ms, 0), `range` (0..60 dB, 60), `lookahead` (0..10 ms, 0), `mix` (0..100 %, 100), `gain` (−24..24 dB, 0), `sidechainHpf` (20..1000 Hz, 20), `stereoLink` (0..100 %, 100), `upAmount` (1..3, 1.5), `upWindow` (0..30 dB, 12), `upMaxBoost` (0..24 dB, 12), `upFloor` (−90..−30 dB, −60); booleans `autoGain` (true), `autoRelease` (false), `upward` (false), `bypass` (false); `style` (string, `'clean'`). `defaults():Params`, `sanitize(partial:Partial<Params>):Params` (clamps numbers, coerces booleans, drops unknown keys, unknown style → `'clean'`).

- [ ] **Step 1: Write failing tests** `params.test.js`: `defaults()` values all within their spec ranges; `sanitize({threshold:+10})` → 0; `sanitize({ratio:NaN})` → default; `sanitize({foo:1})` has no `foo`; `linToDb(0)` is finite (−120); `dbToLin(linToDb(0.5))` ≈ 0.5.
- [ ] **Step 2:** Run `cd compressor && node --test test/params.test.js` → FAIL (modules missing).
- [ ] **Step 3:** Create `package.json` (`"type":"module"`, scripts `test: node --test test/`, `build: node build.mjs`, devDependency esbuild) and implement the two modules per the Interfaces block.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** `git add compressor && git commit -m "Add compressor scaffold, utilities and parameter model"`.

---

### Task 2: Static gain curve (downward, knee, range)

**Files:** Create `compressor/dsp/gain.js`; Test `compressor/test/gain.test.js`.

**Interfaces — Consumes:** `params.js` `Params`. **Produces:** `computeGainDb(levelDb:number, p:Params):number` — returns gain in dB (negative = reduction, positive = boost); downward part only in this task, upward added in Task 4 behind `p.upward`.

Algorithm: standard soft-knee gain computer (quadratic inside `|x−T| ≤ knee/2`, slope `1/ratio` above), reduction clamped to `range`.

- [ ] **Step 1: Write failing tests**: with `threshold −20, ratio 4, knee 0`: input −30 → 0; −20 → 0; 0 dB → −15 (±0.01); with `knee 10`: at input −20 gain is −0.9375 dB (±0.01; formula `(1/R−1)·(x−T+W/2)²/(2W)`) and the curve is continuous at both knee edges (−25 and −15); `range 6` caps reduction at −6; `ratio 1` → always 0.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `computeGainDb`. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Add static downward gain curve`.

---

### Task 3: Compressor core (downward path)

**Files:** Create `compressor/dsp/compressor.js`; Test `compressor/test/compressor.test.js`.

**Interfaces — Consumes:** `computeGainDb`, `sanitize`, `defaults`, util. **Produces:**
```js
export class Compressor {
  constructor(sampleRate:number)
  setParams(partial:Partial<Params>):void
  process(inL:Float32Array, inR:Float32Array, outL:Float32Array, outR:Float32Array, n:number):void // in-place allowed
  get meters():{gainDb:number, inPeakDb:number, outPeakDb:number} // gainDb<0 reduction, >0 boost
  get latencySamples():number // equals look-ahead in samples
}
```
Signal flow per sample: sidechain 2nd-order HPF (detector only) → detector level in dB (peak; RMS option used by styles later: `detector:'peak'|'rms'`) → stereo link (`stereoLink` % blends max of channels with own channel) → `computeGainDb` → smoothing in dB domain: attack when reduction deepens, release when it recovers, `hold` ms before release, auto-release = blend of fast/slow release stage → look-ahead delay on signal (and on dry path, so `mix` and `bypass` stay time-aligned) → makeup `gain` → `mix` (wet %). **Auto Gain:** offset tracked as slow RMS (τ ≈ 2 s) difference between dry and wet, clamped ±24 dB. `bypass` crossfades (≈5 ms) to the delayed dry signal.

- [ ] **Step 1: Write failing tests** (sine/noise generated in the test; helper `rmsDb(buf)`):
  - `static level`: 1 kHz sine at −8 dBFS, `threshold −20, ratio 4, knee 0, autoGain false`, after settling → output level −8−9 = −17 dBFS ±0.2.
  - `attack`: step from −60 to −10 dBFS, `attack 10 ms`: gain reduction reaches ≥ 63% of final within 10 ms (±15%); `release` likewise on step down.
  - `lookahead`: with `lookahead 5 ms, attack 1 ms`, the first transient sample is attenuated by ≥ 90% of final reduction (peak not overshooting); `latencySamples === round(0.005·sr)`.
  - `mix 0` output equals delayed input exactly; `bypass true` after the fade equals delayed input.
  - `auto gain`: stationary 10 s sine+noise, output RMS within 1 dB of input RMS.
  - **Review Focus 1:** same test signal at 44.1/48/96 kHz gives the same attack time in ms (±15%); `n=1` and `n=0` calls and mono (`inR===inL`) do not throw.
  - **Review Focus 2:** silence in → silence out (all zeros, no NaN); extreme params (`attack 0.1, ratio 100, lookahead 10, threshold 0`) on noise at 0 dBFS → every sample finite.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `Compressor` as specified (coefficient `exp(-1/(ms·0.001·sr))`, flush denormals with a 1e-20 offset). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Add compressor core with ballistics, look-ahead, mix and auto gain`.

---

### Task 4: Upward compression

**Files:** Modify `compressor/dsp/gain.js`, `compressor/dsp/compressor.js`; Test `compressor/test/upward.test.js`.

**Interfaces — Consumes:** Tasks 2–3. **Produces:** `computeGainDb` honours `p.upward`: with `Tup = threshold − upWindow`, for `x < Tup` boost `= (Tup − x)·(1 − 1/upAmount)` with a soft knee, capped at `upMaxBoost`, multiplied by a smoothstep fade to 0 over `upFloor … upFloor+10 dB`; between `Tup` and `threshold` gain 0. In `Compressor` the boost uses slow rise (release-like with hold) and **fast retraction** (≈ attack time ×2) when level rises.

- [ ] **Step 1: Write failing tests**: below `Tup` the slope of output-vs-input equals `1/upAmount` (±0.02); dead zone is 1:1; boost never exceeds `upMaxBoost`; at inputs ≤ `upFloor` boost is 0; silence stays silent (no NaN); with `upward false` results equal Task 2 outputs exactly.
  - **Review Focus 3:** signal −50 dBFS for 1 s then −6 dBFS: boost retracts to < 1 dB within 50 ms of the step and peak output ≤ downward-only peak + 0.5 dB.
  - Auto Gain with upward on: stationary test signal output RMS within 1 dB of input.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run all tests → PASS.
- [ ] **Step 5:** Commit `Add upward compression with floor, max boost and fast retraction`.

---

### Task 5: Styles and presets

**Files:** Create `compressor/dsp/styles.js`, `compressor/dsp/presets.js`; Modify `compressor/dsp/compressor.js` (apply style); Test `compressor/test/styles.test.js`.

**Interfaces — Produces:** `STYLES: Record<StyleId,{label:string, detector:'peak'|'rms', kneeBias:number, attackScale:number, releaseShape:'fixed'|'twoStage'|'program', upwardDefault:boolean, saturation:number}>` for the 9 ids; `PRESETS: Array<{name:string, params:Partial<Params>}>` with the 10 rows from the spec table (Vocal Control … Acoustic Guitar Even; `style` ids: Vocal→`vocal`, Punch→`punch`, Classic→`classic`, Clean→`clean`, Bus→`bus`, Opto→`opto`).

Style behaviour as in spec: Clean peak/fixed/no colour; Classic peak+rms mix, hard knee, fast attack; Opto two-stage program-dependent release, soft knee, slowed attack; Vocal rms + auto-release; Bus rms, slow attack, wide knee; Punch peak, long attack, short release; Vari-Mu ratio and knee grow with reduction + light saturation; Pump exaggerated fast release; Upward rms, slow boost, `upwardDefault true`.

- [ ] **Step 1: Write failing tests**: `STYLES` has exactly the 9 ids; `PRESETS.length === 10` and names match the spec; every preset param passes `sanitize` unchanged (in range) and has `upward` falsy; different styles on the same 100 ms-spaced click train give measurably different gain-reduction curves (pairwise max difference > 0.5 dB for Clean vs Opto, Clean vs Pump, Clean vs Bus).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement data files and `Compressor.setParams` style application (the style only shapes detector/ballistics, never overwrites user knob values). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Add 9 styles and 10 presets`.

---

### Task 6: AudioWorklet wrapper and build pipeline

**Files:** Create `compressor/worklet.js`, `compressor/build.mjs`, `compressor/ui/index.template.html` (minimal shell for now); Test `compressor/test/worklet.test.js`.

**Interfaces — Produces:** worklet registers `'purple-comp'`; port messages in: `{type:'params', params}`; out: `{type:'meters', gainDb, inPeakDb, outPeakDb, hist}` about every 16 ms. `build.mjs` bundles `worklet.js` to a string inlined as `window.__WORKLET_SRC__` and `ui/app.js` to an IIFE, writing `dist/index.html`.

- [ ] **Step 1: Write failing test**: with a mocked global `AudioWorkletProcessor`/`registerProcessor`/`sampleRate`, importing `worklet.js` registers `'purple-comp'`; `process([[L,R]],[[outL,outR]])` returns `true` and applies params sent through `port.onmessage`; mono input (one channel) is handled.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement worklet and `build.mjs`. **Step 4:** `npm test` passes and `npm run build` creates `dist/index.html` (open size < 1 MB).
- [ ] **Step 5:** Commit `Add AudioWorklet wrapper and single-file build`.

---

### Task 7: Audio I/O (file, transport, Original/Compressed)

**Files:** Create `compressor/ui/audio.js`; Test `compressor/test/ui.spec.mjs` (Playwright; created here, extended later).

**Interfaces — Produces:** `createAudioEngine():Promise<{loadFile(file:File):Promise<void>, play():void, pause():void, seek(sec:number):void, setLoop(b:boolean):void, setParams(p:Partial<Params>):void, setMode('compressed'|'original'):void, onMeters(cb):void, state:{duration,position,playing}}>`. `setMode('original')` routes through the same worklet with `bypass` so latency is identical, and applies loudness matching (offset from the worklet's auto-gain estimator). `AudioContext` is created/resumed only inside a user gesture. Drag-and-drop and `<input type=file>` both call `loadFile`; decode errors reject with a message the UI shows (`Could not read this file. Try WAV or MP3.`).

- [ ] **Step 1: Write failing Playwright test** (headless Chromium, launch with `executablePath:'/opt/pw-browsers/chromium'`, serve `dist/` with a tiny static server in the test): page loads with no console errors; AudioContext state is `'suspended'` before any click; loading a generated 1 s WAV via the file input starts playback after Play click; loading a `.txt` file shows the error text and the page stays usable (**Review Focus 4**).
- [ ] **Step 2:** Run `npx playwright test`-equivalent (`node test/ui.spec.mjs`) → FAIL. **Step 3:** Implement `audio.js` and wire a minimal transport in the shell. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Add audio engine: file loading, transport, original/compressed`.

---

### Task 8: Theme, tooltips and knobs

**Files:** Create `compressor/ui/theme.js`, `compressor/ui/tooltip.js`, `compressor/ui/knob.js`; Test `compressor/test/theme.test.js`, extend `ui.spec.mjs`.

**Interfaces — Produces:** `theme.js` exports `COLORS` (every token as `hsl(h s% l%)`, h ∈ 255–295 or s < 8%) and `applyThemeVars(root)`. `tooltip.js` exports `TOOLTIP_DELAY_MS = 4000`, `attachTooltip(el, text)`, `TOOLTIPS: Record<string,string>` (the 21 English texts from the spec table). `knob.js` exports `createKnob({id,label,spec,value,format,onChange}):HTMLElement` supporting drag, wheel, Shift fine adjust, **Alt+click reset to `spec.default`**, value readout while dragging.

- [ ] **Step 1: Write failing tests**: Node `theme.test.js` parses every colour in `COLORS` and asserts hue/saturation rule; `TOOLTIP_DELAY_MS === 4000`; all `TOOLTIPS` strings ≤ 12 words. Playwright (fake clock via `page.clock`): hover a knob → no tooltip at 3.9 s, visible at 4.0 s; mouse leave, click, or drag start hides/cancels it; only one tooltip at a time. Alt+click resets a changed knob to default; plain double-click does **not** reset. **Review Focus 5:** Alt keyup default is prevented so the Windows menu bar does not activate; no tooltip appears while dragging.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Add purple theme, 4s tooltips and knobs with Alt+click reset`.

---

### Task 9: Main display and meters

**Files:** Create `compressor/ui/display.js`, `compressor/ui/meters.js`; extend `ui.spec.mjs`.

**Interfaces — Consumes:** meters messages from Task 6, `computeGainDb` (curve drawing), `COLORS`. **Produces:** `createDisplay({getParams,setParam}):{el,pushMeters(m)}` — scrolling input-level history, GR line hanging from the 0 dB line, boost drawn upward in light lilac, dashed threshold line with a draggable handle, transfer-curve overlay with draggable KNEE handle and (when Upward on) a draggable second segment below `Tup`, dB scale on the right (selectable 72 dB range). `createMeters():{el,push(m)}` — GR and output meters with peak holds; clipping shown in brightest lilac.

- [ ] **Step 1: Write failing Playwright tests**: canvas exists with non-zero size; dragging the threshold handle changes the `threshold` param by the expected dB for the pixel delta (±1 dB); dragging knee handle changes `knee`; with Upward on the second handle appears and drags `upWindow`; sampled canvas pixels contain no colour outside the purple rule while a loud signal clips.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (requestAnimationFrame render, devicePixelRatio aware). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Add main display with draggable threshold/knee and meters`.

---

### Task 10: App assembly (layout, presets, A/B, upward controls, sidechain)

**Files:** Create `compressor/ui/app.js`; Modify `compressor/ui/index.template.html`; extend `ui.spec.mjs`.

**Interfaces — Consumes:** everything above. **Produces:** the full layout from the spec: top bar (logo, undo/redo, A/B + Copy, preset prev/next + name, Help, fullscreen), display + meters, knob row (Threshold, Ratio, Style button/menu, Attack, Release, Auto Gain, Dry/Mix; small Knee, Range, Lookahead, Hold), sidechain panel (HPF node, Stereo Link, Level), bottom bar (Oversampling "Off" display, look-ahead readout), the Upward switch with Amount/Window/Max Boost/Floor shown only when on, transport row with file picker/drop zone, Play/Pause/Loop, Original/Compressed toggle, Bypass. Every control has its tooltip from `TOOLTIPS`. Preset prev/next and menu load the 10 presets; A/B stores two parameter sets; undo/redo steps through parameter changes.

- [ ] **Step 1: Write failing Playwright tests**: all 10 preset names appear in order and selecting one sets the matching knob values; Style menu lists the 9 styles; Upward controls hidden until the switch is on; A/B toggles between two stored sets; undo restores the previous value; every interactive control has a `data-tooltip` key present in `TOOLTIPS`; no visible non-English UI text (assert against a list of allowed strings from source).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Assemble full compressor UI`.

---

### Task 11: Verification, README, publish

**Files:** Create `compressor/README.md`; no new code.

- [ ] **Step 1:** Run `cd compressor && npm test && npm run build && node test/ui.spec.mjs`; all green.
- [ ] **Step 2:** Take headless screenshots of default state, Upward on, and a preset loaded; check against the reference layout and the purple rule; fix any mismatch.
- [ ] **Step 3:** Write README: how to open `dist/index.html`, how to load audio, tooltip/Alt+click behaviour, how to export a DAW bounce to test in the browser, known limits (no FabFilter algorithms, stage 2 = VST3 for FL Studio).
- [ ] **Step 4:** Publish `dist/index.html` as an artifact (check AudioWorklet and file input work in the sandbox; if blocked, say so in the README and the reply). Commit `Add README and publish prototype`; push the branch.
