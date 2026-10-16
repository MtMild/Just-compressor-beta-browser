# Purple Compressor (Pro-C-style) — Design

Date: 2026-10-14. Stage 1 of 2 (browser prototype). Stage 2 (VST3 for FL Studio / Windows via JUCE) is out of scope here and gets its own spec.

## Goal

A compressor with the ergonomics and layout of FabFilter Pro-C 3, but with a **purple** colour identity (FabFilter uses yellow/orange); see Revision 2 for the final colour rule. Used by a music-production student to test by ear in the browser on their own audio files, then ported to a VST3 plugin.

Success criteria:
1. Open one HTML file (or the published artifact), load an audio file, hear it compressed in real time.
2. Interface visibly follows the Pro-C 3 layout (see below), purple as the main colour (see Revision 2).
3. DSP core is a pure module (no DOM/Web Audio), verified by Node tests, and portable to C++ later.
4. 10 presets selectable from a preset browser.
5. **Simple and intuitive is the top priority** (see Usability).
6. Hovering a control for 4 seconds shows a short, clear tooltip (see Tooltips).

Language: all UI text, tooltips and preset names are in English.

Non-goals: cloning FabFilter's proprietary algorithms; MIDI learn; oversampling; external sidechain input; Dolby Atmos; plugin build (stage 2).

## Reference (user screenshot of Pro-C 3 + web research)

Layout elements to reproduce:
- **Top bar:** logo, undo/redo, A/B + Copy, preset name with prev/next arrows, Help, fullscreen.
- **Main display:** scrolling input-level history (grey area), gain reduction drawn as a coloured line/area hanging from the 0 dB line at the top, dashed threshold line with draggable handle, transfer-curve overlay with a draggable KNEE handle, dB scale on the right (0 … −66, selectable range e.g. 72 dB).
- **Right meters:** GR meter and output level meter with peak markers.
- **Knob row:** Threshold (with Auto), Ratio, Style button, Attack, Release (with Auto), Auto Gain, Dry; small knobs Knee, Range, Lookahead, Hold.
- **Sidechain panel:** Level slider, source label (Internal only), and a spectrum display with draggable filter nodes (see Revision 2).
- **Bottom bar:** Oversampling (display only, "Off"), Lookahead readout, in/out gain readouts.

Notes from research (FabFilter news, MusicTech and TapeOp reviews): Pro-C 3 has 14 styles; TTM is one of them. We implement a subset. Details of the real plugin beyond the screenshot are not verified.

## Architecture

```
compressor/
  dsp/compressor.js     pure DSP core (ES module), no browser APIs
  dsp/presets.js        10 presets as plain data
  worklet.js            AudioWorkletProcessor wrapper around dsp core
  index.html            UI (Canvas + DOM), audio graph, file loader, A/B original vs compressed
  test/*.test.js        Node tests for dsp core (node --test)
```

The worklet source is inlined into `index.html` via Blob URL so the page is a single file. If the artifact sandbox blocks AudioWorklet, the file still works when opened locally. DSP is identical either way.

### DSP core (`dsp/compressor.js`)

Per-sample, stereo-linked:
1. Sidechain: 2nd-order HPF (user cutoff) on the detector path only.
2. Level detector: peak or RMS depending on style, in dB.
3. Gain computer: threshold, ratio, soft knee (quadratic), range (max GR limit).
4. Gain smoothing: attack/release one-pole ballistics in dB domain, hold time, auto-release (two-stage fast/slow blend).
5. Look-ahead: delay line on the signal path, 0–10 ms; detector sees the undelayed signal.
6. Makeup/auto-gain, dry/wet mix (parallel compression), bypass with click-free crossfade.

Styles (9; each = detector type + ballistics shape + knee default, stored as plain data, no per-style code paths beyond a few shared branches): Clean, Classic, Opto, Vocal, Bus, Punch, Vari-Mu, Pump, Upward. TTM and Op-El from the real Pro-C 3 are skipped: their behaviour is unknown to us.

#### Upward compression (a switch available in every style)

Style-independent switch **Upward**; a style only supplies the ballistics, so Opto+Upward, Punch+Upward and Vocal+Upward sound different. The **Upward** style is a tuned starting point (RMS detector, slow boost, soft floor) with the switch on by default.

- Gain computer gets a second segment: below `T_up = Threshold − Window`, boost = `(T_up − x) · (1 − 1/Amount)`, with a soft knee; between `T_up` and `Threshold` slope is 1:1 (dead zone).
- **Max Boost** (default +12 dB) caps the boost.
- **Floor** (default −60 dB): boost fades smoothly to zero below it so silence and noise are not raised.
- Ballistics: boost rises slowly (release-like, with hold) and retracts fast when level rises, so a loud hit after a quiet part is not boosted into clipping; look-ahead sees the hit first.
- Auto Gain accounts for both downward and upward gain.
- Controls (shown only when Upward is on): Amount (1:1…1:3), Window, Max Boost, Floor.
- Display: transfer curve gets a second, draggable segment below `T_up`; boost is drawn in light lilac **upward** from the 0 line, reduction downward, so both are visible at once.

Exposes: `process(inL, inR, outL, outR, n)`, `setParams(p)`, and state getters (current GR, input/output peak) for the UI.

### UI

Canvas for display, meters, transfer curve and spectrum; DOM for knobs and buttons. Knobs: drag, mouse wheel, Alt+click resets to default, shift for fine adjust. Colour system is CSS variables (see Revision 2 for the rule).

### Audio I/O

File input + drag-and-drop (WAV/MP3/etc. via `decodeAudioData`), play/pause/loop/seek. Original/Compressed toggle with loudness-matched switching. Microphone input optional, off by default.

## Usability (top priority)

- **Progressive disclosure.** Opening view shows only what matters: preset, Style, Threshold, Ratio, Attack, Release, Auto Gain, Dry/Mix, the big display and meters. Knee, Range, Hold, Lookahead sit in the small row as in the reference; Upward controls and sidechain details sit in their own expandable blocks.
- **Sensible defaults.** Init state compresses audibly but gently on any material; Auto Gain on, so loudness stays comparable.
- **Direct manipulation.** Threshold and knee are dragged right on the display; knobs support drag, wheel, **Alt+click = reset to default**, shift = fine; current value is shown while dragging.
- **Feedback you can see.** Gain reduction is always visible (display line + meter), with a Compressed/Original toggle at matched loudness.
- **Plain wording.** Labels follow Pro-C conventions that producers know; presets are named by the source they suit ("Vocal Control", "Kick Punch").
- **Nothing hidden behind modes.** No menus deeper than one level; every control has a tooltip.

## Tooltips

- Shown after the pointer rests on a control for **4000 ms** (single constant `TOOLTIP_DELAY_MS`; 4 s is long compared with the usual ~0.5–1 s, kept as requested and easy to change).
- Cancelled on mouse leave, on drag/click, and while a knob is being dragged. One tooltip at a time.
- Short: one sentence, at most ~12 words, plain language. **The whole plugin UI, including tooltips, is in English.**
- Purple styling consistent with the UI.

Draft texts:

| Control | Tooltip |
|---|---|
| Threshold | Level above which the compressor starts working |
| Ratio | How strongly sound above the threshold is reduced |
| Knee | How gradually compression kicks in around the threshold |
| Attack | How fast the compressor reacts to loud sound |
| Release | How fast the compressor lets go after loud sound |
| Auto (Release) | Release adapts to the material automatically |
| Hold | How long compression is held before releasing |
| Range | Maximum gain reduction allowed |
| Lookahead | Sees hits in advance so the compressor can react in time |
| Style | Compression character: clean, optical, tube and more |
| Auto Gain | Keeps loudness the same before and after compression |
| Dry/Mix | Blends in uncompressed sound for parallel compression |
| Gain | Output level after compression |
| SC HPF | Removes bass from the detector so kicks don't squash everything |
| Upward | Lifts quiet parts instead of only squashing loud ones |
| Amount | How strongly quiet sounds are lifted |
| Window | Gap between the two thresholds where sound is left alone |
| Max Boost | Maximum lift applied to quiet sounds |
| Floor | Below this level lifting stops, so noise isn't raised |
| A/B | Two settings slots to compare |
| Bypass | Turns the compressor off to compare with the original |
| Original/Compressed | Switches between original and processed at equal loudness |

## Presets (10)

Starting points, assembled from general compression cheat sheets (2:1 general-purpose, ~6 dB GR on loud moments, vocals ≈10 ms attack, kick/snare 4–10:1, parallel compression on drum bus, low ratios on bus/master). They are **not** FabFilter factory presets; exact numbers are our choice and meant to be adjusted by ear.

| # | Name | Style | Thr dB | Ratio | Knee dB | Attack ms | Release ms | Mix % | Notes |
|---|------|-------|-------:|------:|--------:|----------:|-----------:|------:|-------|
| 1 | Vocal Control | Vocal | −24 | 3:1 | 12 | 10 | 120 | 100 | gentle levelling |
| 2 | Vocal Smash | Vocal | −30 | 6:1 | 6 | 5 | 80 | 100 | upfront pop vocal |
| 3 | Kick Punch | Punch | −20 | 5:1 | 4 | 30 | 60 | 100 | lets the beater through |
| 4 | Snare Crack | Classic | −22 | 6:1 | 3 | 5 | 100 | 100 | |
| 5 | Bass Tighten | Clean | −26 | 4:1 | 8 | 15 | 100 | 100 | SC HPF 80 Hz |
| 6 | Drum Bus Glue | Bus | −18 | 2:1 | 8 | 30 | 150 | 100 | |
| 7 | Parallel Drum Crush | Punch | −36 | 10:1 | 2 | 1 | 120 | 35 | parallel mix |
| 8 | Mix Bus Glue | Bus | −14 | 1.5:1 | 14 | 30 | 200 | 100 | 1–2 dB GR |
| 9 | Mastering Gentle | Clean | −16 | 1.3:1 | 20 | 40 | 300 | 100 | look-ahead on |
| 10 | Acoustic Guitar Even | Opto | −26 | 3:1 | 14 | 20 | 150 | 100 | |

## Testing

Node tests on the DSP core (no audio hardware needed):
- Static curve: output level for sine at several input levels matches threshold/ratio/knee theory within 0.1 dB.
- Ballistics: step response reaches ~63% of target GR in the attack time; release likewise.
- Look-ahead: transient attenuated before it hits when look-ahead ≥ attack.
- Mix 0% equals dry; bypass equals input; no NaN/denormal on silence.
- Presets: all values within parameter ranges. All 10 presets have Upward off.
- Upward: slope below `T_up` matches the formula; 1:1 in the dead zone; silence stays silent (no boost, no NaN); boost never exceeds Max Boost; after a quiet→loud step boost retracts within the set time and output does not exceed the input peak by more than the downward-only case; Auto Gain keeps output loudness near input on test signals.
- Tooltips: delay constant equals 4000 ms; tooltip is cancelled on mouse leave, drag start and click (checked in headless browser with fake timers).

UI is verified manually in the browser (headless Chromium screenshots for layout and colour checks).

## Risks

- Artifact sandbox may block AudioWorklet or file input → fall back to local HTML (documented in README).
- Visual match is to the screenshot and Pro-C 2/3 conventions only.
- Sound will differ from the real Pro-C; judged by ear on the user's material.

## Revision 2 (after the first browser test)

Supersedes earlier statements where they conflict. Browser demo only; the VST3 stays a later stage.

### Layout
- A **Demo player** strip (Load, Play, Pause, seek, Loop, Original/Compressed, engine label) sits **outside** the plugin frame, so the plugin frame (`#plugin`) can be reused unchanged in the VST. The plugin frame holds: top bar, display with overlaid controls, meters, the Upward accordion, the Sidechain accordion, bottom bar (Oversampling "Off", Lookahead readout, Bypass).
- Display and settings are **one surface**: the settings knobs sit directly under the plot on the same dark background (no box or border between them) and **never cover the curve, the knee or the threshold line** (user feedback after the first v2 build: overlaid knobs hid the knee). Desktop only: the plugin is not designed for phones, so there is no narrow-screen layout.
- Compressor settings are **one group**: Threshold, Ratio, Style, Attack, Release, Gain, **Mix (last, after Gain)**, plus the small knobs Knee, Range, Lookahead, Hold. Upward and Sidechain are separate blocks.

### Colour rule (replaces "purple-only")
Purple is the main colour (hue 255–295: knobs, curve, buttons, accents). Red (hue 350–10) appears **in details only**: gain-reduction line and numbers, GR meter, clip indicator, input-above-threshold part of the Threshold ring. Black and white complete the palette (backgrounds, text). Neutral grey (saturation < 8%) is used for the curve-zone backdrop behind the knee and for the sidechain EQ background. Test: every colour token is purple, red or neutral; red pixels make up under 10% of the display canvas.

### Display
- Default range **36 dB** (cycle 36/54/72/90 with the range button or the mouse wheel over the display; the curve is drawn on the same scale so it stretches with it).
- Curve zone is wider: 55% of the plot width (was 42%), on a grey backdrop with the KNEE tab on its right edge; the history area is correspondingly shorter. The zone is not draggable.
- Input-level history: grey area with a light outline, scale labels inside the right edge; gain reduction is a red line hanging from the 0 dB line.
- Above the meters two numbers: current gain reduction (red, e.g. −6.2) and output peak (white).
- A level ring around the **Threshold** knob shows live input level on the knob's own −60…0 dB scale (neutral; the part above the threshold is red).

### Auto buttons
Small AUTO pills under the labels of **Threshold**, **Attack**, **Release** and **Gain** (Gain's pill is the existing Auto Gain).
- **Auto Release**: existing (two-stage release).
- **Auto Threshold** (new, our own design; FabFilter's exact method is not known to us): effective threshold = knob + (slow input level − (−18 dB)), slow level = RMS over ~2 s, clamped to −60…0 dB, frozen below −80 dB. The threshold line and the curve on the display show the effective threshold.
- **Auto Attack** (new, our own design): the Attack knob is the maximum; attack time = max(0.1 ms, Attack × 10^(−overshoot/20)) where overshoot is dB above the effective threshold, so small overshoots let transients through and large ones are caught quickly.
- Release range becomes **0.1–2500 ms** (log mapping).

### Upward accordion
A header bar with the Upward switch and a chevron; the body (Amount, Window, Max Boost, Floor) expands/collapses with a ~250 ms height animation (CSS grid rows 0fr→1fr), `aria-expanded` kept in sync, collapsed content not focusable. Collapsed by default.

### Sidechain (separate accordion, open by default)
Source "Internal" (external input is impossible in the browser). Controls:
- **Level** slider, ±24 dB, applied to the detector signal only.
- **EQ display** (grey background, log frequency 20 Hz–20 kHz, ±24 dB, combined response curve, live input spectrum behind it from an AnalyserNode): draggable nodes **HPF** (20–1000 Hz), **LPF** (1–20 kHz; 20 kHz = off) and one **bell band** (60 Hz–12 kHz, gain ±12 dB, Q 0.3–8 via mouse wheel on the node). Alt+click on a node resets it.
- **Stereo Link is removed** (decided after the first browser test): the detector always links both channels (same gain reduction on left and right). The `stereoLink` param, its knob and its tooltip are deleted.
- **Listen** switch: output becomes the filtered detector signal so the filters can be tuned by ear.
New params: `scLevel`, `sidechainHpf` (max raised to 1000), `scLpf`, `scBandFreq`, `scBandGain`, `scBandQ`, `scListen`, `autoThreshold`, `autoAttack`.

### New tooltips (English, ≤ 12 words)
| Control | Tooltip |
|---|---|
| Auto (Threshold) | Threshold follows the average input level |
| Auto (Attack) | Attack gets faster the further the signal exceeds the threshold |
| Level (Sidechain) | Gain of the signal the compressor listens to |
| LPF | Removes highs from the signal the compressor listens to |
| Band | Boosts or cuts a frequency range the compressor listens to |
| Listen | Hear the signal the compressor listens to |

### Tests added
- DSP: Auto Threshold keeps gain reduction within 2 dB when the same material is 12 dB louder; Auto Attack: a 30 dB overshoot is caught at least 10× faster than a 3 dB overshoot, and the knob value is the maximum; release 0.1 ms works (no NaN); sidechain LPF/bell/Level change the detector as the biquad formulas predict; Listen outputs the filtered detector signal; all new params sanitize/clamp.
- UI: palette rule (purple/red/neutral) and red share < 10%; Upward accordion height animates and `aria-expanded` follows the switch; sidechain nodes drag the right params; Mix is the last knob after Gain; Auto pills exist under the four knobs; the plugin frame contains no transport controls; meter numbers update; threshold ring renders; curve zone is 55% wide.
