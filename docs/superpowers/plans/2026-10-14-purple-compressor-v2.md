# Purple Compressor v2 (integrated UI, Auto buttons, Sidechain EQ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the browser demo's interface as one integrated Pro-C-style surface with Auto Threshold/Attack/Release/Gain, a full Sidechain EQ, an animated Upward block and the new colour rule, keeping the plugin frame free of demo controls.

**Architecture:** Same layers as v1 (pure `dsp/` core → worklet/fallback `Runner` → canvas+DOM `ui/`, bundled into one HTML). The core gains Auto Threshold, Auto Attack, detector-path EQ (Level, HPF, LPF, bell) and Listen; the UI splits into a Demo player strip and the `#plugin` frame whose knobs overlay the display.

**Tech Stack:** Vanilla JS ES modules, Node 22 `node --test "test/*.test.js"`, esbuild, Playwright-core with the preinstalled Chromium (run `npm run build` then `node test/ui.spec.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-14-purple-compressor-design.md` (read "Revision 2"; it supersedes earlier text).

## Global Constraints

- All UI text, tooltips and preset names are English; tooltip delay `TOOLTIP_DELAY_MS = 4000`; Alt+click resets a control; double-click does not.
- Colour rule: every colour token is **purple (hue 255–295), red (hue 350–10, wrapping) or neutral (saturation < 8%)**; red only in details (GR line/numbers/meter, clip, Threshold-ring part above threshold); neutral grey only for the curve-zone backdrop and the sidechain EQ background; red pixels < 10% of the display canvas.
- **Stereo Link is removed**: no `stereoLink` param, knob or tooltip; the detector always links both channels.
- Release range 0.1–2500 ms (log mapping); Attack 0.1–250 ms.
- New params and ranges: `autoThreshold` (bool, false), `autoAttack` (bool, false), `scLevel` (−24..24 dB, 0), `sidechainHpf` (20..1000 Hz, 20 = off), `scLpf` (1000..20000 Hz, 20000 = off), `scBandFreq` (60..12000 Hz, 1000), `scBandGain` (−12..12 dB, 0 = off), `scBandQ` (0.3..8, 1), `scListen` (bool, false).
- Auto Threshold: effective threshold = knob + (slow input RMS level − (−18 dB)), slow level ≈ 2 s, clamped −60…0 dB, frozen below −80 dB. Auto Attack: attack = max(0.1 ms, Attack × 10^(−overshoot/20)), overshoot in dB above the effective threshold.
- Default display range 36 dB (36/54/72/90); curve zone = 55% of plot width; display and settings are one surface (knobs overlay the display; under 760 px they sit below it).
- Knob order in the main row: Threshold, Ratio, Style, Attack, Release, Gain, **Mix (last)**; small knobs Knee, Range, Lookahead, Hold in the same group.
- DSP core imports nothing from the browser or Node. Tests: `cd compressor && npm test` and `node test/ui.spec.mjs` green before every commit. Existing v1 tests that contradict Revision 2 (colour rule, `stereoLink`, `#autogain`/`#autorelease` buttons, Upward visibility, tooltip count) are updated in the task that changes the behaviour.

## Review Focus

1. Auto Threshold on silence, very quiet and very loud input: no NaN, effective threshold always within −60…0 dB, frozen below −80 dB. (Task 3)
2. Sidechain filters at extremes (HPF 1000 + LPF 1000 so the detector is nearly silent; bell 12 kHz at 44.1 kHz; LPF 20000 treated as off): finite output, stable. (Task 2)
3. **Listen** with Level +24 dB and loud input must not blast the ears: output is soft-limited to ±1. (Task 2)
4. Accordions: collapsed content is not focusable, `aria-expanded` follows state, animation is disabled under `prefers-reduced-motion`. (Task 6)
5. Mouse wheel over the display zooms the dB range without scrolling the page, and does not fight knob wheels. (Task 7)
6. Clicking an AUTO pill never starts a knob drag; layout at 390 px has no horizontal scroll and no overlapping controls. (Tasks 6, 10)

---

## File Structure

```
compressor/
  dsp/params.js        (modify) remove stereoLink; release min 0.1; new params
  dsp/compressor.js    (modify) Biquad (HP/LP/peaking), sidechain chain, Listen, Auto Threshold, Auto Attack, thresholdDb meter
  dsp/runner.js        (modify) meters message carries thresholdDb
  ui/theme.js          (modify) palette v2 (purple + red details + neutral greys)
  ui/style.css         (modify) layout: demo bar, plugin frame, stage overlay, accordions, pills
  ui/knob.js           (modify) optional auto pill and input ring
  ui/accordion.js      (new)    createAccordion({id,title,headerExtra,open,onToggle})
  ui/display-math.js   (modify) 55% curve zone, 36 dB default range helpers
  ui/display.js        (modify) grey backdrop, history, red GR, effective threshold, wheel zoom
  ui/meters.js         (modify) readout numbers + red GR/clip (exports readout formatting)
  ui/sc-math.js        (new)    pure: biquad magnitude, freq/gain<->pixel, nodes, hitTest, dragTo
  ui/sc-eq.js          (new)    sidechain EQ canvas with spectrum and draggable nodes
  ui/audio.js          (modify) AnalyserNode spectrum tap
  ui/tooltip.js        (modify) tooltip keys
  ui/app.js            (modify) new layout assembly
  test/*.test.js, test/ui.spec.mjs (modify/add)
```

---

### Task 1: Parameter model changes

**Files:** Modify `compressor/dsp/params.js`, `compressor/dsp/compressor.js` (remove `stereoLink` use only), `compressor/test/params.test.js`, `compressor/test/theme.test.js` (release mapping), `compressor/ui/app.js` (remove the Stereo Link knob).

**Interfaces — Produces:** `PARAM_SPECS` per Global Constraints; `sanitize` clamps all new numbers and coerces the three new booleans; `stereoLink` no longer exists (unknown key is dropped by `sanitize`). Compressor links channels with `link = 1`.

- [ ] **Step 1: Write failing tests**: `PARAM_SPECS.release.min === 0.1`; `sanitize({release: 0.05}).release === 0.1`; defaults for the 9 new params equal the Global Constraints values; `sanitize({scLpf: 500}).scLpf === 1000`, `sanitize({scBandQ: 20}).scBandQ === 8`, `sanitize({stereoLink: 50})` has no `stereoLink` key; release knob mapping: `normToValue(PARAM_SPECS.release, 0.5)` ≈ √(0.1·2500) (±1) (update the existing assertion in `theme.test.js`).
- [ ] **Step 2:** `cd compressor && npm test` → the new assertions FAIL.
- [ ] **Step 3:** Implement in `params.js` (specs, defaults), delete `stereoLink` from specs, from `compressor.js` (`link = 1`) and the knob from `app.js`/tooltip list is handled in Task 10 (leave the tooltip key until then; the key count assertion is updated there).
- [ ] **Step 4:** `npm test` → PASS; `npm run build && node test/ui.spec.mjs` → green except checks that mention the Stereo Link knob (update those assertions to the new list in this step).
- [ ] **Step 5:** Commit `Param model v2: remove Stereo Link, release from 0.1 ms, new sidechain/auto params`.

---

### Task 2: Sidechain chain in the DSP (Level, HPF, LPF, bell, Listen)

**Files:** Modify `compressor/dsp/compressor.js`; Test `compressor/test/sidechain.test.js`.

**Interfaces — Consumes:** Task 1 params. **Produces:** class `Biquad` (internal) with `setHighpass(f, sr)`, `setLowpass(f, sr)`, `setPeaking(f, gainDb, q, sr)`, `process(x)`; detector chain per channel: `x · dbToLin(scLevel)` → HPF (on if `sidechainHpf > 20.5`) → LPF (on if `scLpf < 19999`) → bell (on if `|scBandGain| > 0.05`) → detector. `scListen: true` makes `outL/outR` the filtered detector signal passed through `tanh` (|out| ≤ 1), ignoring Mix/Bypass/latency.

- [ ] **Step 1: Write failing tests** (helpers from `test/helpers.js`, 48 kHz): (a) `scLevel +6` on a −20 dBFS 1 kHz sine at threshold −20, ratio 4 gives mean GR within 0.3 dB of `scLevel 0` at threshold −26; (b) 100 Hz −10 dBFS sine with `sidechainHpf 1000` has |GR| < 1 dB while with HPF off |GR| > 6 dB; (c) 10 kHz −10 dBFS sine with `scLpf 1000` has |GR| < 1 dB, with `scLpf 20000` > 6 dB; (d) bell `scBandFreq 1000, scBandGain +12, scBandQ 1` on a −32 dBFS 1 kHz sine at threshold −20 gives the same mean GR (±1 dB) as `scBandGain 0` with the threshold lowered by 12 dB (−32); (e) `scListen` with all filters off returns the input exactly for |x|≤0.5 within 1e-3 (tanh tolerance) and for a 100 Hz sine with HPF 1000 returns < −30 dB of the input level; (f) **Review Focus 3:** `scListen`, `scLevel +24`, full-scale noise → every |sample| ≤ 1; (g) **Review Focus 2:** HPF 1000 + LPF 1000 + bell 12 kHz at 44.1 kHz on noise → all outputs finite and silence-in stays silent.
- [ ] **Step 2:** `node --test test/sidechain.test.js` → FAIL.
- [ ] **Step 3:** Implement `Biquad` (RBJ cookbook) replacing `Highpass`, wire the chain in `process()` with no per-sample allocation (preallocated state; keep `test/review-fixes.test.js` allocation test green).
- [ ] **Step 4:** `npm test` → PASS (incl. earlier look-ahead/GC tests).
- [ ] **Step 5:** Commit `Add sidechain level, HPF, LPF, bell band and Listen`.

---

### Task 3: Auto Threshold

**Files:** Modify `compressor/dsp/compressor.js`, `compressor/dsp/runner.js`; Test `compressor/test/autothreshold.test.js`.

**Interfaces — Produces:** `Compressor.meters` gains `thresholdDb` (the effective threshold currently used); `Runner` posts it as `thresholdDb` in the meters message. When `autoThreshold` is on the effective threshold = `clamp(threshold + offset, −60, 0)` with `offset` smoothed (≈0.5 s) toward `slowRmsDb − (−18)`; slow level from the existing 2 s power tracker; offset frozen when slow level < −80 dB.

- [ ] **Step 1: Write failing tests**: (a) same pink-ish material (sine+noise) at RMS ≈ −24 dB and ≈ −12 dB for 10 s, threshold −24, ratio 4, `autoGain false`: with `autoThreshold true` the mean |GR| over the last 3 s differs by < 2 dB between the two levels, with it off by > 5 dB; (b) `meters.thresholdDb` equals the knob value when off and moves with level when on; (c) **Review Focus 1:** silence for 5 s, then −80 dB noise, then full-scale noise: all outputs finite and `thresholdDb` always within [−60, 0]; offset does not change during silence.
- [ ] **Step 2:** run → FAIL. **Step 3:** Implement (update `pe.threshold` every `AUTO_BLOCK` samples; no allocation). **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `Add Auto Threshold`.

---

### Task 4: Auto Attack

**Files:** Modify `compressor/dsp/compressor.js`; Test `compressor/test/autoattack.test.js`.

**Interfaces — Consumes:** effective threshold from Task 3. **Produces:** when `autoAttack` is on, the attack coefficient used in the attacking branch is computed per sample from `overshootDb = levelDb − effThreshold` as `attack = max(0.1, Attack·cfg.attackScale·10^(−max(0, overshootDb)/20))` ms; off → unchanged behaviour.

- [ ] **Step 1: Write failing tests**: DC steps (as in `compressor.test.js`), `attack 10`, `release 500`, `autoThreshold false`: (a) time to 63% of final reduction for a 30 dB overshoot is at least 10× shorter than for a 3 dB overshoot with `autoAttack true`; (b) with `autoAttack false` both times are within ±15% of 10 ms (regression); (c) with a 0.5 dB overshoot the 63% time is ≤ 12 ms (knob is the maximum); (d) extreme: `attack 250`, 60 dB overshoot, noise at full scale → finite.
- [ ] **Step 2:** run → FAIL. **Step 3:** Implement (compute the coefficient only while attacking; `Math.exp` per attacking sample is acceptable). **Step 4:** `npm test` → PASS (GC test still ≤ 1).
- [ ] **Step 5:** Commit `Add Auto Attack`.

---

### Task 5: Palette v2 and theme tests

**Files:** Modify `compressor/ui/theme.js`, `compressor/ui/style.css` (variables only), `compressor/test/theme.test.js`.

**Interfaces — Produces:** `COLORS` tokens (all `hsl(h s% l% [/ a])`): existing purple tokens kept; new tokens `red` (hue 0–8), `redFill` (alpha), `redDim`; neutral tokens `white`, `grey1…grey3` (saturation 0–6%) and `zoneBg`/`scBg` (neutral greys); `applyThemeVars` unchanged.

- [ ] **Step 1: Write failing test** (rewrite the colour test): every token is purple (255–295), red (350–360 or 0–10, saturation ≥ 40%) or neutral (saturation < 8%); tokens `red`, `zoneBg`, `scBg`, `white` exist; `zoneBg` and `scBg` are neutral; at least 5 purple tokens.
- [ ] **Step 2:** run → FAIL. **Step 3:** Add tokens, switch `grGr/gr` uses to red later in Tasks 7–8. **Step 4:** `npm test` → PASS (the v1 pixel test in `ui.spec.mjs` is replaced in Task 10).
- [ ] **Step 5:** Commit `Palette v2: purple main, red details, neutral greys`.

---

### Task 6: Layout restructure, Auto pills and accordions

**Files:** Create `compressor/ui/accordion.js`; Modify `compressor/ui/knob.js`, `compressor/ui/app.js`, `compressor/ui/transport.js`, `compressor/ui/style.css`, `compressor/ui/tooltip.js` (tooltip keys), `compressor/test/ui.spec.mjs`, `compressor/test/theme.test.js` (tooltip count).

**Interfaces — Produces:**
- `createAccordion({ id, title, headerExtra?: HTMLElement, open?: boolean, onToggle?: (open:boolean)=>void }): HTMLElement` with `.body` (content container), `.setOpen(b)`, header button `#<id>-toggle`, `aria-expanded`, body animates via `grid-template-rows` 0fr↔1fr (~250 ms, none under `prefers-reduced-motion`), collapsed body has `inert` and `aria-hidden="true"`.
- `createKnob({ …, auto?: { id: string, tip: string, onToggle: () => void }, ring?: boolean })`: when `auto` is given a small pill button `<button id=auto.id class="auto-pill" data-tooltip=auto.tip aria-pressed>AUTO</button>` is rendered inside the knob under its label (clicking it never starts a drag); `el.setAuto(bool)`; when `ring` is true the knob SVG has `<path class="ring">` and `el.setRing(levelDb:number|null, thresholdValue:number)`.
- DOM contract: `#demo-bar` (transport: `#file #play #pause #seek #loop #mode #status #engine-mode #error`) is **outside** `#plugin`; `#plugin` contains `.topbar`, `.stage` (display + `.settings` overlay + meters), `#upward-acc` (header holds `#upward` switch; body `#upward-panel` with Amount/Window/Max Boost/Floor), `#sc-acc` (placeholder body for Task 9), `#bottombar` (Oversampling Off, `#la-readout`, `#bypass`). `.settings` knob order: threshold(auto `auto-threshold`), ratio, style block, attack(auto `auto-attack`), release(auto `auto-release`), gain(auto = `autogain`), mix; `.settings-small`: knee, range, lookahead, hold. Tooltip keys added: `autoThreshold` ("Threshold follows the average input level"), `autoAttack` ("Attack gets faster the further the signal exceeds the threshold"); `stereoLink` key removed.

- [ ] **Step 1: Write failing tests** (Playwright, `apage`-style): `#plugin` contains no `#play/#pause/#file`, `#demo-bar` does; knob DOM order in `.settings` is threshold, ratio, attack, release, gain, mix (Mix last); `.auto-pill` exists inside threshold, attack, release and gain knobs; clicking `#auto-threshold` sets `autoThreshold` true and does not change the threshold value; `#upward-panel` is not focusable/`inert` when collapsed, `#upward` click sets `aria-expanded="true"` on `#upward-acc-toggle` and the body height animates from 0 to > 40 px (poll `getBoundingClientRect().height` over time: observed an intermediate value) and back; Node tooltip test expects the new key set (stereoLink gone, +2).
- [ ] **Step 2:** `npm run build && node test/ui.spec.mjs` → new checks FAIL; `npm test` fails on tooltip keys.
- [ ] **Step 3:** Implement accordion, knob extensions and the new `app.js` assembly (move transport into `#demo-bar` built by `createTransport`; remove the separate Auto toggles; Upward toggle moves into the accordion header; `toggles.upward` logic unchanged). Overlay CSS: `.stage{position:relative}`, `.settings` absolutely positioned at the bottom over a gradient scrim; `@media (max-width: 760px)` makes it static below the display.
- [ ] **Step 4:** Run both suites → green (update remaining v1 assertions that referenced `#autogain` visibility, `#autorelease`, Upward panel visibility to the new DOM).
- [ ] **Step 5:** Commit `New layout: demo bar, integrated settings, auto pills, accordions`.

---

### Task 7: Display v2 (zone, history, red GR, zoom, effective threshold)

**Files:** Modify `compressor/ui/display-math.js`, `compressor/ui/display.js`, `compressor/ui/app.js`; Test `compressor/test/display-math.test.js`, `compressor/test/ui.spec.mjs`.

**Interfaces — Consumes:** meters messages with `thresholdDb` (Task 3), colours (Task 5). **Produces:** `makeGeom(w, h, rangeDb)` returns `curveW = plotW * 0.55`; exported `RANGES = [36, 54, 72, 90]`, `zoomRange(current:number, deltaY:number): number` (wheel up = smaller range, clamped to the list); `createDisplay({ getParams, setParam })` now defaults to 36 dB, draws the curve zone on a `zoneBg` grey gradient with the KNEE tab on its right edge, history as `histFill`/`histLine` area, GR as a red line (`COLORS.red`) hanging from 0 dB, the dashed threshold at the **effective** threshold from the latest meters, and handles as before; `display.pushMeters(m)` consumes `thresholdDb`; wheel over the canvas calls `zoomRange` with `preventDefault` and updates the range button text.

- [ ] **Step 1: Write failing tests**: Node: `makeGeom(800,320,36).curveW ≈ 0.55·plotW`; `zoomRange(36, -120) === 36`, `zoomRange(36, 120) === 54`, `zoomRange(90, 120) === 90`, `zoomRange(72, -120) === 54`; the round-trip/drag tests still pass with the new geometry. Playwright: default range button text is `36 dB`; wheel down over `canvas.display` changes it to `54 dB` and `window.scrollY` stays 0 (**Review Focus 5**); knob wheel still adjusts only the knob; with `autoThreshold` on and loud audio playing `window.__geom` unchanged but the drawn threshold line moves (read `window.__lastMeters.thresholdDb` ≠ knob value).
- [ ] **Step 2:** run → FAIL. **Step 3:** Implement. **Step 4:** both suites green. **Step 5:** Commit `Display v2: wider curve zone, readable history, red GR, wheel zoom`.

---

### Task 8: Meters v2 and Threshold input ring

**Files:** Modify `compressor/ui/meters.js`, `compressor/ui/knob.js`, `compressor/ui/app.js`, `compressor/ui/style.css`; Test `compressor/test/meters.test.js`, `compressor/test/ui.spec.mjs`.

**Interfaces — Produces:** `formatGr(gainDb:number): string` → one decimal with real minus sign (`-6.2`, `0.0` for ≥ 0, `+3.1` for boost); `formatOut(db:number): string` (`-1.3`, `-inf` below −99); DOM `#gr-readout` (red) and `#out-readout` above the meters canvas updated from meters messages; GR meter bar and clip block use `COLORS.red`; Threshold knob `ring` shows `inPeakDb` on the knob's −60…0 dB scale (neutral arc; the part above the knob value in red) via `setRing`.

- [ ] **Step 1: Write failing tests**: Node: `formatGr(-6.234) === '-6.2'`, `formatGr(0) === '0.0'`, `formatGr(3.14) === '+3.1'`, `formatOut(-120) === '-inf'`, `formatOut(-1.34) === '-1.3'`. Playwright: while a −6 dBFS loud WAV plays `#out-readout` parses to a number > −12 and `#gr-readout` is ≤ 0; `[data-knob=threshold] .ring` has a non-empty `d`; the red share of display+meters pixels is > 0 (GR line present) and < 10% of the display canvas.
- [ ] **Step 2:** run → FAIL. **Step 3:** Implement. **Step 4:** both suites green. **Step 5:** Commit `Meters v2: GR/OUT numbers, red GR, Threshold input ring`.

---

### Task 9: Sidechain EQ panel

**Files:** Create `compressor/ui/sc-math.js`, `compressor/ui/sc-eq.js`; Modify `compressor/ui/audio.js`, `compressor/ui/app.js`, `compressor/ui/style.css`, `compressor/ui/tooltip.js`; Test `compressor/test/sc-math.test.js`, `compressor/test/ui.spec.mjs`.

**Interfaces — Produces:**
- `sc-math.js`: `freqToX(g, f)`, `xToFreq(g, x)` (log 20–20000), `gainToY(g, db)`, `yToGain(g, y)` (±24 dB), `makeScGeom(w, h)`; `responseDb(p, f, sr): number` (sum of HP2 + LP2 + peaking magnitudes in dB, same RBJ formulas as the DSP; HPF off at ≤ 20.5, LPF off at ≥ 19999, bell off at |gain| ≤ 0.05); `scNodes(g, p)` → `{hpf:{x,y}, band:{x,y}, lpf:{x,y}}`; `scHit(g, p, x, y)` → `'hpf'|'band'|'lpf'|null`; `scDragTo(id, g, p, x, y)` → partial params (`hpf`: `sidechainHpf` from x clamped 20–1000; `lpf`: `scLpf` clamped 1000–20000; `band`: `scBandFreq` clamped 60–12000 and `scBandGain` clamped ±12); `scWheel(p, deltaY)` → `{scBandQ}` (wheel up = higher Q, clamped 0.3–8).
- `audio.js`: `engine.spectrum(out:Float32Array): boolean` copying `AnalyserNode` dB data (fftSize 4096, smoothing 0.8) fed from the playing source; false before the engine exists.
- `sc-eq.js`: `createScEq({ getParams, setParam, getSpectrum })` → `{ el, geom() }`, a canvas on the `scBg` neutral grey with spectrum fill, combined response curve in purple, three draggable nodes, Alt+click resets a node (HPF 20, LPF 20000, band gain 0 and freq 1000), wheel on the band node changes Q.
- Panel `#sc-panel` in `#sc-acc` (open by default): vertical **Level** slider `#sc-level` (range −24..24, Alt+click resets to 0), `#sc-listen` switch, a static "Internal" label, `.sc-eq` canvas. Tooltip keys: `scLevel` "Gain of the signal the compressor listens to", `scLpf` "Removes highs from the signal the compressor listens to", `scBand` "Boosts or cuts a frequency range the compressor listens to", `scListen` "Hear the signal the compressor listens to" (HPF keeps `sidechainHpf`). Test hooks: `window.__scGeom()`, `window.__scNodes()`.

- [ ] **Step 1: Write failing tests**: Node `sc-math.test.js`: `freqToX/xToFreq` and `gainToY/yToGain` round-trip; `responseDb` for HPF 1000 is ≈ −3 dB at 1 kHz (±0.5) and ≈ −12 dB at 500 Hz (±1.5), LPF 1000 is ≈ −3 dB at 1 kHz, bell +12 dB Q 1 at 1 kHz is +12 (±0.2) and ≈ 0 at 10 Hz, all off returns 0 everywhere; dragging each node to its own position returns its param (±1%); `scDragTo('band', …)` clamps; `scWheel` clamps Q. Playwright: dragging the HPF node to ~200 Hz sets `sidechainHpf` ≈ 200 (±15%); dragging the band node up sets `scBandGain` > 3 and `scBandFreq` follows x; wheel on the band node raises `scBandQ`; Alt+click on the HPF node resets to 20; `#sc-level` input changes `scLevel`; `#sc-listen` toggles `scListen`; the sc-eq canvas background pixel is neutral grey; with audio playing the spectrum draws (canvas has > 500 non-background pixels beyond the curve); every new tooltip key has an element with that `data-tooltip`.
- [ ] **Step 2:** run → FAIL. **Step 3:** Implement. **Step 4:** both suites green. **Step 5:** Commit `Sidechain EQ panel with spectrum, level and listen`.

---

### Task 10: Verification, phone layout, README, publish

**Files:** Modify `compressor/test/ui.spec.mjs` (replace the v1 purple-only pixel check with the Revision 2 rule), `compressor/README.md`; no new features.

- [ ] **Step 1:** Replace the pixel test: with a full-scale WAV playing, every opaque canvas pixel is purple (255–295), red (350–10) or neutral (saturation < 10%); red pixels on `canvas.display` are < 10%; the clip indicator pixel is red. **Review Focus 6:** at 390 px width, no horizontal scroll with Upward and Sidechain open, and `.settings` does not overlap the display canvas (its top ≥ the canvas bottom).
- [ ] **Step 2:** Run `cd compressor && npm test && npm run build && node test/ui.spec.mjs` → all green.
- [ ] **Step 3:** Take headless screenshots (default, Upward open, Sidechain with spectrum, 390 px) and compare with the Pro-C reference image's layout; fix any overlap or unreadable text (one pass).
- [ ] **Step 4:** Update the README (new layout, Auto buttons, Sidechain, removed Stereo Link, Demo player vs plugin frame, colour note). Commit `README and verification for v2`; push; republish `dist/artifact.html`.
